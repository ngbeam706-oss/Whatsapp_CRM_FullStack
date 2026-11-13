// The customer's side of a voice call (call.html, opened from the link the team sends on WhatsApp).
// Same signalling as the dashboard (src/webrtcCallManager.ts): Supabase Realtime broadcast on
// `call_room_<room>`, then a direct WebRTC audio connection. Bundled by Vite, so no CDN or inline
// script is needed and the site-wide Content Security Policy covers this page.
//
// Ringing the team: the link carries a server-signed token (?t=). The page sends it to
// POST /api/call-ring and the SERVER alerts that business's dashboard (server/calls.cjs). The page
// never broadcasts the alert itself, so it can't reach any other business.
import './call.css';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../supabaseClient';

type Signal =
  | { type: 'offer' | 'answer'; sdp: RTCSessionDescriptionInit }
  | { type: 'ice-candidate'; candidate: RTCIceCandidateInit }
  | { type: 'hangup' };

const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get('room') || 'default_room';
/** The server-signed token that lets this page ring the team (absent on links from before 2026-11-09). */
const ringToken = urlParams.get('t') || '';
// The business's name, from the link its team sent (each business sends its own).
const businessName = (urlParams.get('business') || '').trim().slice(0, 80);

/** An element the page must have (call.html). */
function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`call.html is missing #${id}`);
  return found as T;
}

const statusEl = el<HTMLParagraphElement>('callStatus');
const timerContainer = el<HTMLDivElement>('timerContainer');
const timerEl = el<HTMLSpanElement>('callTimer');
const muteBtn = el<HTMLButtonElement>('muteBtn');
const endBtn = el<HTMLButtonElement>('endBtn');
const remoteAudio = el<HTMLAudioElement>('remoteAudio');

if (businessName) {
  el<HTMLHeadingElement>('businessName').textContent = businessName;
  document.title = `${businessName}: voice call`;
}
const teamLabel = businessName ? `the ${businessName} team` : 'our team';

let localStream: MediaStream | null = null;
let peerConnection: RTCPeerConnection | null = null;
let channel: RealtimeChannel | null = null;
let isMuted = false;
let timerInterval: ReturnType<typeof setInterval> | null = null;
let secondsElapsed = 0;

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ],
};

function signal(payload: Signal) {
  channel?.send({ type: 'broadcast', event: 'signal', payload });
}

/** Ask the server to ring this business's team. Returns false when the link can't ring (invalid/old). */
async function ringTeam(): Promise<boolean> {
  if (!ringToken) return false;
  try {
    const res = await fetch('/api/call-ring', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ t: ringToken }),
    });
    if (res.ok) return true;
    const data = await res.json().catch(() => ({}));
    statusEl.textContent = (data && typeof data.error === 'string' && data.error) || 'Could not reach the team. Try again in a minute.';
    statusEl.classList.add('text-rose-400');
    return false;
  } catch {
    statusEl.textContent = 'No internet connection. Check your connection and open the link again.';
    statusEl.classList.add('text-rose-400');
    return false;
  }
}

async function startCustomerCall() {
  try {
    statusEl.textContent = 'Connecting to microphone...';
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    localStream = stream;

    statusEl.textContent = `Ringing ${teamLabel}...`;

    const pc = new RTCPeerConnection(ICE_SERVERS);
    peerConnection = pc;

    stream.getTracks().forEach(track => {
      pc.addTrack(track, stream);
    });

    pc.ontrack = (event) => {
      remoteAudio.srcObject = event.streams[0];
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === 'connected') {
        statusEl.textContent = 'Connected with Staff';
        statusEl.classList.remove('animate-pulse');
        timerContainer.classList.remove('hidden');
        startTimer();
      } else if (state === 'disconnected' || state === 'failed' || state === 'closed') {
        finishCall();
      }
    };

    // Realtime Signaling
    const room = supabase.channel('call_room_' + roomId);
    channel = room;

    room.on('broadcast', { event: 'signal' }, async (message) => {
      const payload = message.payload as Signal | undefined;
      if (!payload) return;
      if (payload.type === 'offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        signal({ type: 'answer', sdp: answer });
      } else if (payload.type === 'answer') {
        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      } else if (payload.type === 'ice-candidate') {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
        } catch { /* a stale candidate: the others still connect */ }
      } else if (payload.type === 'hangup') {
        finishCall();
      }
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        signal({ type: 'ice-candidate', candidate: event.candidate.toJSON() });
      }
    };

    room.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        // Alert this business's team (the server checks the link and rings only its dashboard).
        void ringTeam();

        // Customer initiates call offer
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        signal({ type: 'offer', sdp: offer });
      }
    });
  } catch {
    statusEl.textContent = 'Microphone permission denied. Please allow microphone access.';
    statusEl.classList.add('text-rose-400');
  }
}

function startTimer() {
  if (timerInterval) clearInterval(timerInterval);
  secondsElapsed = 0;
  timerInterval = setInterval(() => {
    secondsElapsed++;
    const m = Math.floor(secondsElapsed / 60).toString().padStart(2, '0');
    const s = (secondsElapsed % 60).toString().padStart(2, '0');
    timerEl.textContent = `${m}:${s}`;
  }, 1000);
}

function toggleMute() {
  if (!localStream) return;
  isMuted = !isMuted;
  localStream.getAudioTracks().forEach(t => { t.enabled = !isMuted; });
  muteBtn.classList.toggle('bg-amber-600', isMuted);
  const label = muteBtn.querySelector('span');
  if (label) label.textContent = isMuted ? 'Muted' : 'Mute';
}

function finishCall() {
  if (timerInterval) clearInterval(timerInterval);
  if (channel) {
    signal({ type: 'hangup' });
    supabase.removeChannel(channel);
    channel = null;
  }
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
  }
  if (peerConnection) {
    peerConnection.close();
  }
  statusEl.textContent = businessName ? `Call ended. Thank you for calling ${businessName}!` : 'Call ended. Thank you for calling!';
  statusEl.classList.remove('text-emerald-400', 'animate-pulse');
  statusEl.classList.add('text-slate-400');
}

muteBtn.addEventListener('click', toggleMute);
endBtn.addEventListener('click', finishCall);

// Module scripts run after the page is parsed; `load` also waits for the stylesheet.
if (document.readyState === 'complete') startCustomerCall();
else window.addEventListener('load', startCustomerCall);
