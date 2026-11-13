import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://fgflvtxqdlchclrfybca.supabase.co';
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_aPp971u5APMfha8SKXlC0g_a_r7LTuC';

export const supabase = createClient(supabaseUrl, supabaseKey);

// (2026-11-09: removed seven unused helpers from the single-business days that read and wrote
// leads, bot rules and the catalog straight from the browser. The server API does all of that now.)

interface CallMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  sender: string;
  senderName: string;
  recipient: string;
  body: string;
  type?: string;
  audioUrl?: string | null;
  timestamp?: string;
}

/** Log a call in the chat history (used only for call recordings below). */
async function saveMessageToSupabase(msg: CallMessage) {
  try {
    const { error } = await supabase
      .from('whatsapp_messages')
      .insert([
        {
          message_id: msg.id,
          direction: msg.direction,
          sender: msg.sender,
          sender_name: msg.senderName,
          recipient: msg.recipient,
          // Links the row to the customer's conversation in the inbox.
          contact_phone: String((msg.direction === 'inbound' ? msg.sender : msg.recipient) || '').replace(/[^\d]/g, '') || null,
          body: msg.body,
          type: msg.type || 'text',
          audio_url: msg.audioUrl || null,
          timestamp: msg.timestamp || new Date().toISOString()
        }
      ]);

    if (error) {
      console.warn('Supabase save message notice:', error.message);
    }
    return { success: !error };
  } catch (err) {
    console.warn('Supabase message log exception:', err);
    return { success: false };
  }
}

interface CallRecording {
  phone: string;
  callerName?: string | null;
  /** Seconds. */
  duration: number;
  blob?: Blob | null;
  roomId?: string;
}

/**
 * Save an Audio Call Recording to Supabase Storage & Messages Log.
 * Returns a link to the recording (or a local blob: link if the upload failed), or null.
 */
export async function saveCallRecording({ phone, callerName, duration, blob }: CallRecording): Promise<string | null> {
  let audioUrl: string | null = null;
  const fileName = `call_${phone}_${Date.now()}.webm`;

  try {
    if (blob) {
      const { data: uploadData, error: uploadErr } = await supabase.storage
        .from('call-recordings')
        .upload(fileName, blob, { contentType: 'audio/webm', upsert: true });

      if (!uploadErr && uploadData) {
        const { data: publicUrlData } = supabase.storage
          .from('call-recordings')
          .getPublicUrl(fileName);
        audioUrl = publicUrlData?.publicUrl || null;
      }
    }
  } catch (storageErr) {
    console.warn('[Storage Notice] Bucket call-recordings:', storageErr);
  }

  if (!audioUrl && blob) {
    try {
      audioUrl = URL.createObjectURL(blob);
    } catch { /* no local link either */ }
  }

  try {
    const mins = Math.floor(duration / 60);
    const secs = duration % 60;
    await saveMessageToSupabase({
      id: `call_${Date.now()}`,
      direction: 'inbound',
      sender: phone,
      senderName: callerName || `+${phone}`,
      recipient: 'You (Business)',
      body: `📞 Audio Call Completed (${mins}m ${secs}s)`,
      type: 'audio',
      audioUrl: audioUrl,
      timestamp: new Date().toISOString()
    });
  } catch { /* the call itself already ended; logging is best effort */ }

  return audioUrl;
}
