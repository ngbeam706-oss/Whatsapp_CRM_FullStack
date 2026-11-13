import { useState } from 'react';
import { RotateCcw, List, ChevronLeft, Hand } from 'lucide-react';
import type { CatalogButton, CatalogItem } from './types';

// Bot Flow: a phone showing the conversation exactly as the server's bot sends it (server/bot.cjs:
// welcome + buttons, the services list, an item's details, the two replies). Tapping a button in the
// preview plays the next step, so the business sees the whole flow before saving.

export interface PhoneDraft {
  welcomeMessage: string;
  welcomeButtons: CatalogButton[];
  menuPrompt: string;
  menuButtonLabel: string;
  enquireButtonLabel: string;
  menuItems: CatalogItem[];
  orderConfirmReply: string;
  staffNotificationReply: string;
}

type Msg = { from: 'customer' | 'bot' | 'note'; text: string; buttons?: Array<{ id: string; title: string }>; list?: string };
const TALK = { id: 'btn_talk_staff', title: '💬 Talk to our team' };

/** The bot's own wording for an item (same as server/bot.cjs menuItemDetails). */
function itemDetails(i: CatalogItem): string {
  if (i.details && String(i.details).trim()) return String(i.details);
  const price = Number(i.price) > 0 ? `\nPrice: ₹${i.price}` : '';
  const desc = i.description ? `\n${i.description}` : '';
  return `*${i.title || 'Selected option'}*${price}${desc}\n\nWould you like to book or enquire?`;
}

/** WhatsApp's *bold* shown as bold. */
function Rich({ text }: { text: string }) {
  const parts = text.split(/(\*[^*\n]+\*)/g);
  return <>{parts.map((p, k) => (p.startsWith('*') && p.endsWith('*') && p.length > 2 ? <strong key={k}>{p.slice(1, -1)}</strong> : <span key={k}>{p}</span>))}</>;
}

export default function BotFlowPhone({ draft }: { draft: PhoneDraft }) {
  const items = draft.menuItems.filter(i => i && i.title);
  // The welcome buttons a customer actually sees ("Our services" is hidden while there are no services).
  const shown = draft.welcomeButtons.filter(b => b.id !== 'btn_menu' || items.length > 0);
  const welcome: Msg = { from: 'bot', text: draft.welcomeMessage || '(Write a welcome message)', buttons: shown };
  const start: Msg[] = [{ from: 'customer', text: 'hi' }, welcome];
  const [chat, setChat] = useState<Msg[]>(start);
  const [listOpen, setListOpen] = useState<false | 'services' | 'query'>(false);
  const [paused, setPaused] = useState(false);
  // Edits to the page restart the conversation, so the preview always shows the current text.
  const [seen, setSeen] = useState(draft);
  if (seen !== draft) { setSeen(draft); setChat(start); setListOpen(false); setPaused(false); }

  const say = (...m: Msg[]) => setChat(c => [...c, ...m]);
  const tap = (id: string, title: string) => {
    if (paused) return;
    if (id === 'btn_menu') {
      say({ from: 'customer', text: title }, { from: 'bot', text: draft.menuPrompt || 'Here is what we offer:', list: draft.menuButtonLabel || 'View options' });
    } else if (id === 'btn_talk_staff') {
      say({ from: 'customer', text: title }, { from: 'bot', text: draft.staffNotificationReply || '(Write the "When they ask for a person" reply)' },
        { from: 'note', text: 'The bot now pauses for this customer for 12 hours. Your team replies from the Inbox.' });
      setPaused(true);
    } else if (id === 'btn_raise_query') {
      say({ from: 'customer', text: title }, { from: 'bot', text: 'What is your query about? Choose the closest option.', list: 'Choose' },
        { from: 'note', text: 'They pick a category (set on the Queries page), describe it in one message and get a reference number like Q-1004.' });
    } else if (id.startsWith('btn_confirm_')) {
      say({ from: 'customer', text: title }, { from: 'bot', text: draft.orderConfirmReply || '(Write the "After Book / Enquire" reply)' },
        { from: 'note', text: 'The chat moves to "Booked" in your Pipeline, and can start a follow-up.' });
    }
  };
  const pick = (i: CatalogItem | 'talk') => {
    setListOpen(false);
    if (i === 'talk') { tap(TALK.id, TALK.title); return; }
    say({ from: 'customer', text: i.title }, { from: 'bot', text: itemDetails(i), buttons: [{ id: `btn_confirm_${i.id}`, title: draft.enquireButtonLabel || '✅ Book / Enquire' }, TALK] },
      { from: 'note', text: 'Opening an item moves the chat from "New enquiry" to "In discussion".' });
  };
  const restart = () => { setChat(start); setListOpen(false); setPaused(false); };
  // Only the latest bot message's buttons can be tapped (like a real chat moving on).
  const lastBot = chat.map(m => m.from).lastIndexOf('bot');

  return (
    <div className="mx-auto w-full max-w-[340px]" data-testid="bot-phone">
      <div className="rounded-[2rem] border-[6px] border-slate-800 bg-slate-800 shadow-xl overflow-hidden">
        <div className="bg-wa-teal text-white px-3 py-2 flex items-center gap-2">
          <ChevronLeft className="w-4 h-4 opacity-80" />
          <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center text-xs font-bold">B</div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold truncate">Your business</div>
            <div className="text-[10px] opacity-80">{paused ? 'Your team is replying' : 'Bot replies instantly'}</div>
          </div>
          <button type="button" onClick={restart} className="p-1 rounded hover:bg-white/10 cursor-pointer" title="Start the conversation again" aria-label="Start the preview again"><RotateCcw className="w-3.5 h-3.5" /></button>
        </div>
        <div className="relative bg-[#efeae2] h-[480px] overflow-y-auto px-2.5 py-3 space-y-2 text-[12px] leading-snug" aria-live="polite">
          {chat.map((m, k) => (
            m.from === 'note' ? (
              <div key={k} className="mx-auto max-w-[92%] text-center text-[10.5px] bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-2 py-1">{m.text}</div>
            ) : (
              <div key={k} className={`flex ${m.from === 'customer' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-lg shadow-sm ${m.from === 'customer' ? 'bg-[#d9fdd3]' : 'bg-white'}`}>
                  <div className="px-2.5 py-1.5 whitespace-pre-wrap break-words"><Rich text={m.text} /></div>
                  {m.list && (
                    <button type="button" onClick={() => setListOpen(m.list === 'Choose' ? 'query' : 'services')} disabled={paused || k !== lastBot}
                      className="w-full border-t border-slate-100 py-1.5 text-[#027eb5] font-semibold flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50">
                      <List className="w-3.5 h-3.5" /> {m.list}
                    </button>
                  )}
                  {m.buttons?.map(b => (
                    <button key={b.id} type="button" onClick={() => tap(b.id, b.title)} disabled={paused || k !== lastBot}
                      className="w-full border-t border-slate-100 py-1.5 text-[#027eb5] font-semibold cursor-pointer disabled:cursor-default disabled:opacity-60">
                      {b.title}
                    </button>
                  ))}
                </div>
              </div>
            )
          ))}
          {paused && <div className="flex justify-center"><span className="inline-flex items-center gap-1 text-[10.5px] text-slate-600 bg-white/80 rounded-full px-2 py-0.5"><Hand className="w-3 h-3" /> Bot paused</span></div>}
          {listOpen && (
            <div className="absolute inset-x-0 bottom-0 bg-white rounded-t-2xl shadow-2xl border-t border-slate-200 max-h-[80%] overflow-y-auto" role="dialog" aria-label="List in the preview">
              <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
                <span className="font-semibold text-slate-800">{listOpen === 'query' ? 'Query type' : 'Our services'}</span>
                <button type="button" onClick={() => setListOpen(false)} className="text-[#027eb5] font-semibold cursor-pointer">Close</button>
              </div>
              {listOpen === 'query' ? (
                <div className="px-3 py-3 text-slate-600 text-[11px]">Your query categories appear here (Queries page → settings).</div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {items.slice(0, 9).map(i => (
                    <li key={i.id}><button type="button" onClick={() => pick(i)} className="w-full text-left px-3 py-2 hover:bg-slate-50 cursor-pointer">
                      <div className="font-medium text-slate-800">{String(i.title).slice(0, 24)}</div>
                      {i.description && <div className="text-[11px] text-slate-500">{String(i.description).slice(0, 72)}</div>}
                    </button></li>
                  ))}
                  <li><button type="button" onClick={() => pick('talk')} className="w-full text-left px-3 py-2 hover:bg-slate-50 cursor-pointer">
                    <div className="font-medium text-slate-800">💬 Talk to our team</div>
                    <div className="text-[11px] text-slate-500">A person from our team will reply</div>
                  </button></li>
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
      <p className="text-[11px] text-slate-500 text-center mt-2">Tap the buttons to try the flow. <button type="button" onClick={restart} className="text-wa-teal font-semibold hover:underline cursor-pointer">Start again</button></p>
    </div>
  );
}
