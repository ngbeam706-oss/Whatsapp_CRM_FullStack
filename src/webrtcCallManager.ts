// -------------------------------------------------------------
// WebRTC Audio Call Manager & Synthesized Ringtone Engine
// -------------------------------------------------------------
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabaseClient';

/** What the two browsers send each other over the Supabase Realtime channel. */
type Signal =
  | { type: 'offer' | 'answer'; sdp: RTCSessionDescriptionInit }
  | { type: 'ice-candidate'; candidate: RTCIceCandidateInit }
  | { type: 'hangup' };

interface CallSessionOptions {
  roomId: string;
  isInitiator: boolean;
  onRemoteStream?: (stream: MediaStream) => void;
  onCallEnd?: (recording: Blob | null) => void;
  onConnected?: () => void;
}

// STUN servers for WebRTC NAT traversal (Google Public STUN)
const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ]
};

// -------------------------------------------------------------
// 1. Synthetic Ringtone & Call Audio Cues (Web Audio API)
// -------------------------------------------------------------
let audioCtx: AudioContext | null = null;
let ringtoneInterval: ReturnType<typeof setInterval> | null = null;

function getAudioContext(): AudioContext | null {
  if (!audioCtx) {
    // Older Safari only has the prefixed name.
    const AudioContextClass: typeof AudioContext | undefined =
      window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

/**
 * Play authentic dual-frequency telephone ring (440Hz + 480Hz)
 */
export function startRingtone() {
  stopRingtone();
  const ctx = getAudioContext();
  if (!ctx) return;

  const playToneBurst = () => {
    try {
      const now = ctx.currentTime;
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.type = 'sine';
      osc2.type = 'sine';
      osc1.frequency.setValueAtTime(440, now);
      osc2.frequency.setValueAtTime(480, now);

      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.18, now + 0.05);
      gain.gain.setValueAtTime(0.18, now + 1.8);
      gain.gain.linearRampToValueAtTime(0, now + 2.0);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 2.0);
      osc2.stop(now + 2.0);
    } catch {
      // Audio autoplay policy notice
    }
  };

  playToneBurst();
  ringtoneInterval = setInterval(playToneBurst, 4000);
}

export function stopRingtone() {
  if (ringtoneInterval) {
    clearInterval(ringtoneInterval);
    ringtoneInterval = null;
  }
}

/**
 * Play a short call connect / disconnect chime
 */
export function playChime(type: 'connect' | 'disconnect' = 'connect') {
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';

    if (type === 'connect') {
      osc.frequency.setValueAtTime(587.33, now); // D5
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.15); // A5
    } else {
      osc.frequency.setValueAtTime(440, now); // A4
      osc.frequency.exponentialRampToValueAtTime(220, now + 0.2); // A3
    }

    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.25);
  } catch { /* audio blocked: the call works without the chime */ }
}

// -------------------------------------------------------------
// 2. WebRTC Peer Connection & Realtime Signaling
// -------------------------------------------------------------
export class WebRTCCallSession {
  roomId: string;
  isInitiator: boolean;
  onRemoteStream?: (stream: MediaStream) => void;
  onCallEnd?: (recording: Blob | null) => void;
  onConnected?: () => void;

  peerConnection: RTCPeerConnection | null = null;
  localStream: MediaStream | null = null;
  remoteStream: MediaStream | null = null;
  channel: RealtimeChannel | null = null;
  mediaRecorder: MediaRecorder | null = null;
  recordedChunks: Blob[] = [];
  isMuted = false;

  constructor({ roomId, isInitiator, onRemoteStream, onCallEnd, onConnected }: CallSessionOptions) {
    this.roomId = roomId;
    this.isInitiator = isInitiator;
    this.onRemoteStream = onRemoteStream;
    this.onCallEnd = onCallEnd;
    this.onConnected = onConnected;
  }

  /** Send one signal to the other browser (no-op once the call has ended). */
  private signal(payload: Signal) {
    this.channel?.send({ type: 'broadcast', event: 'signal', payload });
  }

  async init() {
    // 1. Access Agent Microphone
    const localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false
    });
    this.localStream = localStream;

    // 2. Setup RTCPeerConnection
    const pc = new RTCPeerConnection(ICE_SERVERS);
    this.peerConnection = pc;

    // Add local mic audio tracks to connection
    localStream.getTracks().forEach(track => {
      pc.addTrack(track, localStream);
    });

    // Receive customer remote audio track
    pc.ontrack = (event) => {
      this.remoteStream = event.streams[0];
      if (this.onRemoteStream) this.onRemoteStream(this.remoteStream);
      this.startAudioRecording();
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === 'connected') {
        playChime('connect');
        if (this.onConnected) this.onConnected();
      } else if (state === 'disconnected' || state === 'failed' || state === 'closed') {
        this.endCall();
      }
    };

    // 3. Supabase Realtime Broadcast Signaling Channel
    this.channel = supabase.channel(`call_room_${this.roomId}`);

    this.channel
      .on('broadcast', { event: 'signal' }, async (message) => {
        const payload = message.payload as Signal | undefined;
        // After hang-up the connection is closed (null): ignore late signals.
        if (!payload || !this.peerConnection) return;

        if (payload.type === 'offer' && !this.isInitiator) {
          await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          this.signal({ type: 'answer', sdp: answer });
        } else if (payload.type === 'answer' && this.isInitiator) {
          await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        } else if (payload.type === 'ice-candidate') {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
          } catch { /* a stale candidate: the others still connect */ }
        } else if (payload.type === 'hangup') {
          this.endCall(false);
        }
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED' && this.isInitiator) {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          this.signal({ type: 'offer', sdp: offer });
        }
      });

    // Forward local ICE candidates to peer
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.signal({ type: 'ice-candidate', candidate: event.candidate.toJSON() });
      }
    };
  }

  // -------------------------------------------------------------
  // 3. Combined Call Audio Recording Engine (Agent + Customer)
  // -------------------------------------------------------------
  startAudioRecording() {
    try {
      const ctx = getAudioContext();
      if (!ctx || !this.localStream) return;

      const destination = ctx.createMediaStreamDestination();

      // Mix local microphone
      if (this.localStream.getAudioTracks().length > 0) {
        const localSource = ctx.createMediaStreamSource(this.localStream);
        localSource.connect(destination);
      }

      // Mix remote customer audio
      if (this.remoteStream && this.remoteStream.getAudioTracks().length > 0) {
        const remoteSource = ctx.createMediaStreamSource(this.remoteStream);
        remoteSource.connect(destination);
      }

      const mixedStream = destination.stream;
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      const recorder = new MediaRecorder(mixedStream, { mimeType });
      this.mediaRecorder = recorder;
      this.recordedChunks = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          this.recordedChunks.push(e.data);
        }
      };

      recorder.start(1000); // 1-second chunks
      console.log('[WebRTC Call] Live mixed audio recording active');
    } catch (err) {
      console.warn('[WebRTC Recording Warning]', err);
    }
  }

  toggleMute() {
    if (!this.localStream) return false;
    this.isMuted = !this.isMuted;
    this.localStream.getAudioTracks().forEach(track => {
      track.enabled = !this.isMuted;
    });
    return this.isMuted;
  }

  async stopRecordingAndGetBlob(): Promise<Blob | null> {
    return new Promise((resolve) => {
      const recorder = this.mediaRecorder;
      if (!recorder || recorder.state === 'inactive') {
        const blob = this.recordedChunks.length > 0 ? new Blob(this.recordedChunks, { type: 'audio/webm' }) : null;
        resolve(blob);
        return;
      }

      recorder.onstop = () => {
        const blob = new Blob(this.recordedChunks, { type: 'audio/webm' });
        resolve(blob);
      };

      try {
        recorder.stop();
      } catch {
        resolve(null);
      }
    });
  }

  async endCall(notifyPeer = true): Promise<Blob | null> {
    playChime('disconnect');

    if (notifyPeer && this.channel) {
      try {
        this.signal({ type: 'hangup' });
      } catch { /* the other side times out instead */ }
    }

    const recordedBlob = await this.stopRecordingAndGetBlob();

    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
    }
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
    if (this.channel) {
      supabase.removeChannel(this.channel);
      this.channel = null;
    }

    if (this.onCallEnd) {
      this.onCallEnd(recordedBlob);
    }

    return recordedBlob;
  }
}

