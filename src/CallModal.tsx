import {
  Phone,
  PhoneOff,
  Mic,
  MicOff,
  Download,
  Clock,
  CheckCircle2,
  X,
  Sparkles
} from 'lucide-react';

export type CallState = 'incoming' | 'connected' | 'ended';
export interface CallerInfo { name?: string; phone?: string; sourceBadge?: string; sourceBadgeColor?: string; roomId?: string }

interface CallModalProps {
  isOpen: boolean;
  callState: CallState | string;
  callerInfo: CallerInfo | null;
  /** Seconds. */
  callDuration: number;
  isMuted: boolean;
  recordingBlob: Blob | null;
  recordingUrl: string | null;
  isSavingRecording: boolean;
  onAccept: () => void;
  onDecline: () => void;
  onHangup: () => void;
  onToggleMute: () => void;
  onClose: () => void;
}

export default function CallModal({
  isOpen,
  callState, // 'incoming', 'connected', 'ended'
  callerInfo, // { name, phone, sourceBadge, sourceBadgeColor, roomId }
  callDuration,
  isMuted,
  recordingBlob,
  recordingUrl,
  isSavingRecording,
  onAccept,
  onDecline,
  onHangup,
  onToggleMute,
  onClose
}: CallModalProps) {
  if (!isOpen) return null;

  // Format seconds to mm:ss
  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
      <div className="bg-slate-900 text-white rounded-3xl shadow-2xl max-w-sm w-full overflow-hidden border border-slate-700 flex flex-col relative">
        
        {/* Subtle Brand Header */}
        <div className="bg-slate-800/80 px-5 py-3 border-b border-slate-700/60 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
              Voice call
            </span>
          </div>
          {callState === 'ended' && (
            <button 
              onClick={onClose} 
              className="text-slate-400 hover:text-white p-1 rounded-lg transition cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Modal Center Body */}
        <div className="p-6 flex flex-col items-center text-center space-y-4">
          
          {/* Caller Avatar with Animated Waves */}
          <div className="relative my-2">
            {callState === 'incoming' && (
              <>
                <div className="absolute -inset-3 rounded-full bg-emerald-500/20 animate-ping" />
                <div className="absolute -inset-6 rounded-full bg-emerald-500/10 animate-pulse" />
              </>
            )}
            {callState === 'connected' && (
              <div className="absolute -inset-3 rounded-full bg-teal-500/25 animate-pulse" />
            )}

            <div className="w-24 h-24 rounded-full bg-gradient-to-tr from-teal-600 to-emerald-500 text-white flex items-center justify-center text-3xl font-bold shadow-xl border-4 border-slate-800 relative z-10">
              {callerInfo?.name ? callerInfo.name.slice(0, 2).toUpperCase() : 'CU'}
            </div>
          </div>

          {/* Caller Identity Details */}
          <div>
            <h3 className="text-xl font-bold text-white tracking-tight">
              {callerInfo?.name || 'Customer'}
            </h3>
            <p className="text-xs text-slate-400 font-mono mt-0.5">
              +{callerInfo?.phone}
            </p>

            {/* Source Attribution Badge */}
            {callerInfo?.sourceBadge && (
              <div className="mt-2 inline-flex items-center gap-1 text-xs font-bold px-2.5 py-0.5 rounded-full border bg-slate-800 text-slate-200 border-slate-700">
                <span>{callerInfo.sourceBadge}</span>
              </div>
            )}
          </div>

          {/* Dynamic Status / Call Timer */}
          <div>
            {callState === 'incoming' && (
              <p className="text-sm font-semibold text-emerald-400 animate-pulse">
                Incoming Audio Call...
              </p>
            )}

            {callState === 'connected' && (
              <div className="space-y-1">
                <div className="text-2xl font-mono font-bold text-teal-300">
                  {formatTime(callDuration)}
                </div>
                <div className="flex items-center justify-center gap-1.5 text-xs text-rose-400 font-bold uppercase tracking-wider">
                  <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                  <span>Recording Call (Supabase)</span>
                </div>
              </div>
            )}

            {callState === 'ended' && (
              <div className="space-y-3 w-full pt-1">
                <div className="bg-slate-800/80 rounded-xl p-3 border border-slate-700 text-left space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" /> Call Duration
                    </span>
                    <span className="font-mono text-white font-bold">{formatTime(callDuration)}</span>
                  </div>

                  {/* Playable Recording Audio */}
                  {recordingUrl && (
                    <div className="pt-2 border-t border-slate-700/80">
                      <span className="text-xs font-bold text-slate-400 block mb-1 uppercase tracking-wider">
                        Recorded Audio:
                      </span>
                      <audio controls src={recordingUrl} className="w-full h-8" />
                    </div>
                  )}

                  {isSavingRecording && (
                    <p className="text-xs text-teal-400 font-medium animate-pulse flex items-center gap-1">
                      <Sparkles className="w-3.5 h-3.5" /> Saving recording to Supabase...
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

        </div>

        {/* Action Controls Footer */}
        <div className="bg-slate-800/60 p-5 border-t border-slate-700/60 flex items-center justify-around">
          
          {callState === 'incoming' && (
            <>
              {/* Decline Button */}
              <button
                type="button"
                onClick={onDecline}
                className="w-16 h-16 rounded-full bg-rose-600 hover:bg-rose-700 text-white flex flex-col items-center justify-center shadow-lg transition transform active:scale-95 cursor-pointer"
                title="Decline Call"
              >
                <PhoneOff className="w-6 h-6" />
                <span className="text-xs font-bold mt-0.5">Decline</span>
              </button>

              {/* Accept / Pickup Button */}
              <button
                type="button"
                onClick={onAccept}
                className="w-16 h-16 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white flex flex-col items-center justify-center shadow-lg transition transform active:scale-95 cursor-pointer animate-bounce"
                title="Answer Call"
              >
                <Phone className="w-6 h-6" />
                <span className="text-xs font-bold mt-0.5">Pickup</span>
              </button>
            </>
          )}

          {callState === 'connected' && (
            <>
              {/* Mute / Unmute Mic */}
              <button
                type="button"
                onClick={onToggleMute}
                className={`w-14 h-14 rounded-full flex flex-col items-center justify-center transition cursor-pointer ${
                  isMuted 
                    ? 'bg-amber-500 hover:bg-amber-600 text-white' 
                    : 'bg-slate-700 hover:bg-slate-600 text-slate-200'
                }`}
                title={isMuted ? 'Unmute Microphone' : 'Mute Microphone'}
              >
                {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                <span className="text-2xs font-bold mt-0.5">{isMuted ? 'Muted' : 'Mute'}</span>
              </button>

              {/* End Call / Hang Up */}
              <button
                type="button"
                onClick={onHangup}
                className="w-16 h-16 rounded-full bg-rose-600 hover:bg-rose-700 text-white flex flex-col items-center justify-center shadow-lg transition transform active:scale-95 cursor-pointer"
                title="Hang Up"
              >
                <PhoneOff className="w-6 h-6" />
                <span className="text-xs font-bold mt-0.5">Hang Up</span>
              </button>
            </>
          )}

          {callState === 'ended' && (
            <div className="w-full flex items-center justify-between gap-2">
              {recordingBlob && (
                <a
                  href={recordingUrl ?? undefined}
                  download={`call_${callerInfo?.phone || 'customer'}_${Date.now()}.webm`}
                  className="bg-slate-700 hover:bg-slate-600 text-white text-xs font-semibold px-4 py-2.5 rounded-xl flex items-center gap-1.5 transition cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>Download Audio</span>
                </a>
              )}

              <button
                type="button"
                onClick={onClose}
                className="bg-wa-teal hover:bg-teal-700 text-white text-xs font-semibold px-5 py-2.5 rounded-xl transition cursor-pointer flex items-center gap-1.5 ml-auto"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Done</span>
              </button>
            </div>
          )}

        </div>

      </div>
    </div>
  );
}

