// WhatsApp voice calls in the browser (WhatsApp Business Calling API).
// Meta sends the call's WebRTC offer; the browser answers it with the staff member's microphone and the
// audio then flows directly between this browser and Meta. Signalling goes through our server
// (server/waCalls.cjs), which passes the answer to Meta.

/** Events from the business's private Realtime channel (App.tsx forwards them here). */
export interface WaCallEvent { callId: string; phone?: string; name?: string; by?: string; numberId?: string | null }
export type WaCallEventName = 'wa_call' | 'wa_call_taken' | 'wa_call_end';
export const waCallEvents = new EventTarget();
export function emitWaCallEvent(name: WaCallEventName, payload: unknown) {
  const p = payload as WaCallEvent | undefined;
  if (!p || typeof p.callId !== 'string') return;
  waCallEvents.dispatchEvent(new CustomEvent<WaCallEvent>(name, { detail: p }));
}

const ICE_GATHER_MS = 2500;
const PIECE_MS = 10000;          // upload a piece every 10 s (a closed tab loses at most this much)
const RECORD_BITRATE = 32000;    // ~240 KB per minute, plenty for speech

type Api = <T = unknown>(path: string, opts?: { method?: string; body?: unknown }) => Promise<T>;

/**
 * Records both sides of a WhatsApp call in the browser (server/callRecordings.cjs stores it privately).
 * Pieces go up every 10 s while the call runs; the whole file goes up when it ends. If the tab closes
 * mid-call, the server joins the pieces it has.
 */
export class CallRecorder {
  private ctx: AudioContext | null = null;
  private dest: MediaStreamAudioDestinationNode | null = null;
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private part = 0;
  private uploads: Promise<unknown>[] = [];
  private startedAt = 0;
  private remoteAdded = false;
  failed = false;

  constructor(private callId: string, private api: Api) {}

  static supported() {
    return typeof window !== 'undefined' && typeof MediaRecorder !== 'undefined' && typeof AudioContext !== 'undefined';
  }

  /** Start with the microphone; the customer's audio is added as soon as it arrives. */
  start(mic: MediaStream, remote: MediaStream | null) {
    if (!CallRecorder.supported() || this.rec) return;
    try {
      this.ctx = new AudioContext();
      this.dest = this.ctx.createMediaStreamDestination();
      this.ctx.createMediaStreamSource(mic).connect(this.dest);
      if (remote) this.addRemote(remote);
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm'].find(t => MediaRecorder.isTypeSupported(t)) || '';
      this.rec = new MediaRecorder(this.dest.stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: RECORD_BITRATE });
      this.rec.ondataavailable = (e) => {
        if (!e.data || !e.data.size) return;
        this.chunks.push(e.data);
        this.part += 1;
        this.uploads.push(this.put({ part: this.part }, e.data).catch(() => { /* the whole file goes up at the end anyway */ }));
      };
      this.startedAt = Date.now();
      this.rec.start(PIECE_MS);
    } catch {
      this.failed = true;
    }
  }

  addRemote(remote: MediaStream) {
    if (!this.ctx || !this.dest || this.remoteAdded || !remote.getAudioTracks().length) return;
    this.ctx.createMediaStreamSource(remote).connect(this.dest);
    this.remoteAdded = true;
  }

  private async put(which: { part?: number; final?: boolean }, blob: Blob) {
    const r = await this.api<{ url: string; contentType: string }>('/api/wa-calls/recording/upload-url', { method: 'POST', body: { callId: this.callId, ...which } });
    const res = await fetch(r.url, { method: 'PUT', body: blob, headers: { 'Content-Type': r.contentType || 'audio/webm', 'x-upsert': 'true' } });
    if (!res.ok) throw new Error(`Upload failed (${res.status})`);
  }

  /** Stop, upload the whole recording and tell the server. Safe to call more than once. */
  async finish(): Promise<boolean> {
    const rec = this.rec;
    if (!rec) return false;
    this.rec = null;
    if (rec.state !== 'inactive') {
      await new Promise<void>((resolve) => { rec.addEventListener('stop', () => resolve(), { once: true }); rec.stop(); });
    }
    const seconds = Math.round((Date.now() - this.startedAt) / 1000);
    try { await this.ctx?.close(); } catch { /* already closed */ }
    await Promise.all(this.uploads);
    if (!this.chunks.length) return false;
    try {
      await this.put({ final: true }, new Blob(this.chunks, { type: 'audio/webm' }));
      await this.api('/api/wa-calls/recording/complete', { method: 'POST', body: { callId: this.callId, seconds } });
      return true;
    } catch {
      return false; // the pieces are uploaded: the server joins them
    }
  }
}

/** One answered WhatsApp call: microphone out, the customer's voice in. */
export class WhatsAppCallSession {
  private pc: RTCPeerConnection | null = null;
  private mic: MediaStream | null = null;
  private audio: HTMLAudioElement | null = null;
  /** Called once if the connection drops (not when close() is called). */
  onDropped?: () => void;
  /** Called when the customer's audio arrives (for the recorder). */
  onRemoteStream?: (stream: MediaStream) => void;
  remoteStream: MediaStream | null = null;
  /** The microphone (for the recorder). */
  get micStream(): MediaStream | null { return this.mic; }
  private closed = false;

  /** Opens the microphone, answers Meta's offer and returns the SDP answer to send to the server. */
  async answer(offerSdp: string): Promise<string> {
    this.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    // Silent until Meta confirms "accept" (Meta: media before that clips or confuses the call).
    this.setMuted(true);
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    this.pc = pc;
    this.mic.getAudioTracks().forEach(t => pc.addTrack(t, this.mic as MediaStream));
    pc.ontrack = (e) => {
      if (!this.audio) {
        this.audio = new Audio();
        this.audio.autoplay = true;
      }
      const stream = e.streams[0] || new MediaStream([e.track]);
      this.audio.srcObject = stream;
      void this.audio.play().catch(() => { /* plays once the page is interacted with */ });
      if (this.remoteStream !== stream) {
        this.remoteStream = stream;
        this.onRemoteStream?.(stream);
      }
    };
    pc.onconnectionstatechange = () => {
      if (!this.closed && (pc.connectionState === 'failed' || pc.connectionState === 'closed')) {
        this.onDropped?.();
      }
    };
    await pc.setRemoteDescription({ type: 'offer', sdp: offerSdp });
    await pc.setLocalDescription(await pc.createAnswer());
    // Send the answer with this browser's network candidates in it (no trickle ICE with Meta).
    await new Promise<void>((resolve) => {
      if (pc.iceGatheringState === 'complete') return resolve();
      const done = () => { pc.removeEventListener('icegatheringstatechange', check); resolve(); };
      const check = () => { if (pc.iceGatheringState === 'complete') done(); };
      pc.addEventListener('icegatheringstatechange', check);
      setTimeout(done, ICE_GATHER_MS);
    });
    const sdp = pc.localDescription?.sdp;
    if (!sdp) throw new Error('The browser could not prepare the call.');
    return sdp;
  }

  /** Waits (up to `ms`) for the audio connection with Meta; true if it connected. */
  async waitConnected(ms: number): Promise<boolean> {
    const pc = this.pc;
    if (!pc) return false;
    if (pc.connectionState === 'connected') return true;
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => { pc.removeEventListener('connectionstatechange', check); resolve(false); }, ms);
      const check = () => {
        if (pc.connectionState === 'connected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          clearTimeout(timer);
          pc.removeEventListener('connectionstatechange', check);
          resolve(pc.connectionState === 'connected');
        }
      };
      pc.addEventListener('connectionstatechange', check);
    });
  }

  setMuted(muted: boolean) {
    this.mic?.getAudioTracks().forEach(t => { t.enabled = !muted; });
  }

  close() {
    this.closed = true;
    try { this.pc?.close(); } catch { /* already closed */ }
    this.mic?.getTracks().forEach(t => t.stop());
    if (this.audio) { this.audio.pause(); this.audio.srcObject = null; }
    this.pc = null; this.mic = null; this.audio = null;
  }
}
