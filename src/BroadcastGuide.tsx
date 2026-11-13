import { useState, type ReactNode } from 'react';
import { BookOpen, ChevronDown, ChevronUp, Lightbulb, ListOrdered, Info, Building2, Stethoscope, UtensilsCrossed, Store, Sparkles, Image as ImageIcon, type LucideIcon } from 'lucide-react';
import { CampaignPictures, TemplatePictures, AutomationPictures } from './broadcastGuidePictures';
import { Drawer } from './ui';

/** "In pictures" for each guide (flow charts, a phone preview, funnels, the 24-hour rule…). */
const PICTURES: Partial<Record<Topic, () => ReactNode>> = {
  campaigns: () => <CampaignPictures />,
  templates: () => <TemplatePictures />,
  automations: () => <AutomationPictures />,
};

type Topic = 'campaigns' | 'templates' | 'automations' | 'queries';
interface Guide {
  title: string;
  what: string;
  helps: Array<{ icon: LucideIcon; who: string; text: string }>;
  benefits: string[];
  steps: string[];
  know: string[];
  tips: string[];
}

// "How this works" guides for the Broadcasts screen: what each feature is, how it helps a business
// (hospitals, food businesses, shops and services), how to use it step by step, and what to keep in mind.

const GUIDES: Partial<Record<Topic, Guide>> = {
  campaigns: {
    title: 'Broadcast campaigns: send one WhatsApp message to many of your contacts',
    what: 'A campaign sends one approved WhatsApp template to a group of your contacts at the same time, then shows you, for every person, whether the message was sent, delivered, read and replied to.',
    helps: [
      { icon: Stethoscope, who: 'Hospitals and clinics', text: 'Announce a free health camp, a new specialist or changed OPD timings, run vaccination or check-up drives, and share holiday timings with all your patients at once.' },
      { icon: UtensilsCrossed, who: 'Food and restaurants', text: 'Share a new menu, a festival offer or a weekend special with past customers, and bring back people who have not ordered for a while.' },
      { icon: Store, who: 'Shops and services', text: 'Tell customers about a sale, new arrivals, items back in stock or an event, and invite them to book or visit.' },
    ],
    benefits: [
      'Reach hundreds of people in minutes instead of messaging one by one.',
      'WhatsApp messages are opened far more often than email or SMS, so more people actually see your news.',
      'Send only to the right people: for example contacts from an Instagram ad, contacts with a tag, or people active in the last 30 days.',
      'See exactly what worked: delivered, read and replied counts for every campaign.',
      'Replies come straight into your Inbox, where your team can continue the conversation and book or sell.',
    ],
    steps: [
      'Make sure you have an approved template (Templates tab). Broadcast campaigns can only send approved templates.',
      'Click "New broadcast" and give it a name only your team sees, for example "Health camp - December".',
      'Choose the template and fill in its blanks: the customer\'s first name, or the same text for everyone (like a date or offer).',
      'Choose who gets it: filter by where contacts came from, by tags, or by how recently they chatted, or paste a list of numbers. The count updates as you choose. Customers who replied STOP are always left out.',
      'Type your own number next to "Test" and send it to yourself first, to check how it looks on a phone.',
      'Click "Send now", or "Save as draft" to start it later from the campaign list.',
      'Open the campaign to follow it: for each person you see sent, delivered, read, replied or failed (with the reason).',
    ],
    know: [
      'Meta charges your WhatsApp account for each conversation a campaign opens. Marketing messages cost more than utility messages.',
      'Your WhatsApp number has a daily limit of new customer conversations (shown at the top of this page). It grows as you send good-quality messages.',
      'Your plan has a monthly broadcast limit (see Setup, Plan and usage). A campaign larger than what is left this month is refused before it starts.',
      'Big campaigns go out in batches every few minutes, so a list of thousands can take a while to finish.',
      'If many people block or report your messages, Meta lowers your number\'s quality rating and can limit sending. Send only to people who know you.',
    ],
    tips: [
      'Use the customer\'s first name and keep one clear message with one clear action ("Reply BOOK to reserve a slot").',
      'Send at sensible hours, and not more than about once a week to the same people.',
      'Add "Reply STOP to unsubscribe" in the footer of marketing templates. It keeps your quality rating healthy.',
      'Hospitals: share information, never promises of cures or results. Meta rejects such templates, and they can mislead patients.',
    ],
  },

  templates: {
    title: 'Templates: approved messages you can send any time',
    what: 'A template is a message layout that Meta (WhatsApp) has reviewed and approved. WhatsApp only lets a business send free-form messages within 24 hours of the customer\'s last message. Outside that window, and for every campaign and automatic follow-up, you must use an approved template.',
    helps: [
      { icon: Stethoscope, who: 'Hospitals and clinics', text: 'Appointment confirmations and reminders, "your report is ready", follow-up visit reminders, and health camp invitations.' },
      { icon: UtensilsCrossed, who: 'Food and restaurants', text: 'Order confirmations, "your order is on the way", reorder reminders and new-menu announcements.' },
      { icon: Store, who: 'Shops and services', text: 'Booking confirmations, payment reminders, back-in-stock alerts and offers.' },
    ],
    benefits: [
      'Message a customer even days or weeks after they last wrote to you.',
      'The same professional, checked wording every time, whoever on your team sends it.',
      'Blanks like {{1}} are filled per customer (their name, the item they booked), so each message feels personal.',
      'One template is reused everywhere: in campaigns, in automatic follow-ups, and in the Inbox ("Send template" when a chat is older than 24 hours).',
    ],
    steps: [
      'Click "New template".',
      'Name it in lowercase with underscores, for example appointment_reminder.',
      'Pick the category. Utility = updates about something the customer asked for (appointment, report, order, payment). Marketing = offers, news and promotions.',
      'Pick the language the text is written in.',
      'Optional header: a short bold line, or an image, video or document.',
      'Write the body. Use {{1}}, {{2}}... where the text changes per customer, and give an example for each one (Meta needs examples to review it).',
      'Optional footer (small grey text) and up to 3 buttons: quick replies (like "Confirm" or "Call me") or a website link.',
      'Submit. Meta usually reviews it within minutes (sometimes up to 24 hours). The list shows Approved, Pending, Rejected (with the reason) or Paused.',
    ],
    know: [
      'Templates belong to your WhatsApp Business Account (connected on the WhatsApp page). You will also see them in Meta\'s WhatsApp Manager.',
      'An approved template can\'t be edited. To change the wording, create a new template and delete the old one.',
      'Meta may change the category: a "utility" template that contains an offer is treated as marketing.',
      'Meta often rejects templates that start or end with a blank ({{1}}), have too many blanks for the amount of text, or look like spam.',
      'If customers block a template often, Meta can pause it.',
    ],
    tips: [
      'Keep it short and clear. Say who you are in the first line.',
      'Example (utility, hospital): "Hello {{1}}, this is a reminder of your appointment at City Hospital on {{2}}. Reply YES to confirm or CHANGE to reschedule."',
      'Example (marketing, restaurant): "Hi {{1}}, our new weekend menu is here! Reply MENU to see it. Reply STOP to unsubscribe."',
      'Avoid ALL CAPS, many emojis and medical or "guaranteed" claims.',
    ],
  },

  automations: {
    title: 'Automations: automatic follow-ups at the right moment',
    what: 'An automation sends a follow-up template by itself when a customer does something (or stops doing something), after a delay you choose. It runs every few minutes in the background, only during your sending hours, and stops itself when it is no longer needed.',
    helps: [
      { icon: Stethoscope, who: 'Hospitals and clinics', text: 'Remind people who asked about a doctor or service but did not book, check on patients two days after a visit, invite them back for a follow-up after 30 days, and welcome new patients with your timings and location.' },
      { icon: UtensilsCrossed, who: 'Food and restaurants', text: 'Nudge customers who looked at the menu but did not order, ask "how was your order?", and remind regular customers to reorder.' },
      { icon: Store, who: 'Shops and services', text: 'Follow up on enquiries, ask for feedback after a purchase, and win back customers who have gone quiet.' },
    ],
    benefits: [
      'No customer is forgotten: every enquiry gets a follow-up, even on busy days.',
      'Saves your team hours of manual reminders.',
      'Messages arrive at the right time (for example 1 day after an enquiry), which brings more bookings and orders.',
      'It never annoys people who already acted: it stops by itself if they reply or book.',
    ],
    steps: [
      'Make sure you have an approved template for the follow-up (Templates tab).',
      'Click "New automation" and pick a ready-made idea, or start from blank.',
      'Give it a name, for example "Enquiry, no booking".',
      'Choose when it sends: after they look at a service or product in the bot, after a booking or order enquiry, after their first message, or when they have been quiet for a number of days. Then choose the delay.',
      'Choose when it stops: if the customer replies, and/or if they book or order before it is due.',
      'Choose the template and fill its blanks: the customer\'s name, or the item they looked at or booked.',
      'Save. It starts working at once. Open it any time to see who is waiting, who got it, and who read or replied, and cancel one person\'s follow-up if needed.',
    ],
    know: [
      'Follow-ups go out only within your sending hours (Setup page, default 9 am to 8 pm). One due at night waits until the morning.',
      'Each customer has at most one waiting follow-up per automation. A newer action restarts the timer instead of sending twice.',
      'Customers who replied STOP are skipped automatically.',
      'Pausing an automation cancels the follow-ups that were waiting, so nothing old goes out when you switch it back on.',
      'Your plan sets how many automations can be active at once (Setup, Plan and usage).',
      'It checks every few minutes, so a follow-up can arrive a few minutes after the exact delay.',
    ],
    tips: [
      'Start with one or two that matter most, such as "enquiry but no booking, after 1 day".',
      'Keep "stop if they reply" on for most follow-ups. It avoids sending a reminder to someone already talking to your team.',
      'Use a Utility template for reminders about something the customer asked for, and Marketing only for offers.',
      'Check the results after a week and adjust the delay or wording.',
    ],
  },
};

GUIDES.queries = {
  title: 'Queries: track every question and complaint until it is solved',
  what: 'A query is a question, request or complaint that needs follow-up. Each one gets a number (Q-1001), a priority, a due time and a stage, so nothing is forgotten in a busy chat. Customers raise queries on WhatsApp, the AI raises one when it hands a chat to staff, and your team can raise them from a chat. Staff can also raise team queries for managers or the Business Admin, and anyone can contact Platform support about the app itself.',
  helps: [
    { icon: Stethoscope, who: 'Hospitals and clinics', text: 'Report not received, appointment changes, billing doubts and complaints about waiting time each get a number and an owner, and patients are told on WhatsApp when it is resolved.' },
    { icon: UtensilsCrossed, who: 'Food and restaurants', text: 'Late deliveries, wrong items, refund requests and quality complaints are tracked until solved, so an unhappy customer becomes a returning one.' },
    { icon: Store, who: 'Shops and services', text: 'Returns, exchanges, warranty questions and service requests are followed up on time, with a clear history if the customer asks again.' },
  ],
  benefits: [
    'Customers get a reference number, so they feel heard and can follow up with "NOT SOLVED" if needed.',
    'Due times and the overdue warning show what needs attention first.',
    'Escalation takes hard cases to managers, then the Business Admin, with the full history attached.',
    'Agents can ask managers for approvals or help without leaving the app, and get a written answer.',
    'Numbers show how fast your team responds and resolves, which categories come up most, and how satisfied people are.',
  ],
  steps: [
    'Customers type QUERY, COMPLAINT or HELP on WhatsApp (or tap "Raise a query"), pick a category and describe the problem. They get a number right away.',
    'New queries appear under Customer queries. Open one and use "Take it" (agents) or Assign (managers) so everyone knows who is on it.',
    'Reply to the customer from the query (it goes to WhatsApp with the number), add comments, or write internal notes only staff see.',
    'Move the stage as you work: In progress, Waiting (for the customer or someone else; the clock stops), then Resolved. The customer is told it is resolved.',
    'Stuck? Escalate: customer queries go to managers, then the Business Admin. Team queries go to the Business Admin, then Platform support.',
    'If the customer replies NOT SOLVED within 7 days, the query reopens. Resolved queries close by themselves after 3 days.',
    'Need help yourself? Click "Raise a query" at the top: choose Managers, the Business Admin, or Platform support.',
  ],
  know: [
    'Agents work on queries that are theirs or unassigned (like chats). Managers and the Business Admin can work on all of them.',
    'Messages to a customer more than 24 hours after their last message need an approved "query_update" template (see Settings). Customers who replied STOP are not messaged then.',
    'Internal notes never go to the customer. Platform support never sees your customers, chats or customer queries, only what you send them.',
    'The Business Admin sets due times and categories in Settings.',
  ],
  tips: [
    'Use Waiting when you are waiting for the customer, so the query is not shown as overdue.',
    'Keep the subject short and specific ("Report for test on 4 Nov not received"), so the list is easy to scan.',
    'Check Numbers each week: a growing category usually points to a problem you can fix once for everyone.',
    'Hospitals: answer with facts and next steps. Never promise cures or results in replies.',
  ],
};

const STORAGE_KEY = 'broadcast_guides_hidden_v1';
function readHidden(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {}; } catch { return {}; }
}
function writeHidden(v: Record<string, boolean>) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(v)); } catch { /* storage blocked: just don't remember */ }
}

/**
 * A collapsible "How this works" guide: 'campaigns' | 'templates' | 'automations' | 'queries'.
 * compact (U4): just a "How this works" button that opens the guide in a side panel, for when a form is open
 * on the page and the full guide would push it down.
 */
export default function BroadcastGuide({ topic, compact = false }: { topic: Topic; compact?: boolean }) {
  const g = GUIDES[topic];
  const [hidden, setHidden] = useState(() => !!readHidden()[topic]);
  const [panel, setPanel] = useState(false);
  if (!g) return null;
  const toggle = () => {
    const next = !hidden;
    setHidden(next);
    writeHidden({ ...readHidden(), [topic]: next });
  };

  if (compact) {
    return (
      <>
        <button onClick={() => setPanel(true)} data-testid={`guide-help-${topic}`}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-wa-teal bg-white border border-teal-200 rounded-lg px-3 py-1.5 hover:bg-teal-50 cursor-pointer">
          <BookOpen className="w-4 h-4" aria-hidden="true" /> How this works
        </button>
        {panel && (
          <Drawer title={`How this works: ${g.title.split(':')[0]}`} onClose={() => setPanel(false)}>
            <GuideBody topic={topic} g={g} />
          </Drawer>
        )}
      </>
    );
  }

  return (
    <section className="bg-white border border-teal-200 rounded-xl overflow-hidden">
      <button onClick={toggle} className="w-full flex items-center gap-2 px-4 py-3 text-left bg-teal-50/60 hover:bg-teal-50 cursor-pointer" aria-expanded={!hidden}>
        <BookOpen className="w-4 h-4 text-wa-teal flex-shrink-0" />
        <span className="text-sm font-semibold text-slate-800 flex-1">How this works: {g.title.split(':')[0]}</span>
        <span className="text-xs text-slate-500">{hidden ? 'Show guide' : 'Hide guide'}</span>
        {hidden ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronUp className="w-4 h-4 text-slate-500" />}
      </button>
      {!hidden && <GuideBody topic={topic} g={g} />}
    </section>
  );
}

/** The guide itself (inline under the header, or inside the side panel). */
function GuideBody({ topic, g }: { topic: Topic; g: Guide }) {
  return (
        <div className="p-4 space-y-4 text-xs text-slate-700">
          <div>
            <div className="text-sm font-semibold text-slate-800">{g.title}</div>
            <p className="mt-1 leading-relaxed">{g.what}</p>
          </div>

          {PICTURES[topic] && (
            <div data-testid={`guide-pictures-${topic}`}>
              <Heading icon={ImageIcon}>In pictures</Heading>
              {PICTURES[topic]?.()}
            </div>
          )}

          <div>
            <Heading icon={Building2}>How it helps your business</Heading>
            <div className="grid md:grid-cols-3 gap-2 mt-2">
              {g.helps.map(({ icon: Icon, who, text }) => (
                <div key={who} className="border border-slate-200 rounded-lg p-3 bg-slate-50/60">
                  <div className="font-semibold text-slate-800 flex items-center gap-1.5"><Icon className="w-3.5 h-3.5 text-wa-teal" /> {who}</div>
                  <p className="mt-1 leading-relaxed text-slate-600">{text}</p>
                </div>
              ))}
            </div>
            <ul className="mt-3 space-y-1.5">
              {g.benefits.map(b => <li key={b} className="flex gap-2"><Sparkles className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-px" /><span>{b}</span></li>)}
            </ul>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <Heading icon={ListOrdered}>How to use it, step by step</Heading>
              <ol className="mt-2 space-y-1.5">
                {g.steps.map((s, i) => (
                  <li key={s} className="flex gap-2">
                    <span className="w-5 h-5 rounded-full bg-wa-teal text-white text-xs font-bold flex items-center justify-center flex-shrink-0">{i + 1}</span>
                    <span className="leading-relaxed">{s}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div className="space-y-4">
              <div>
                <Heading icon={Info}>Good to know</Heading>
                <ul className="mt-2 space-y-1.5 list-disc pl-4 marker:text-slate-400">{g.know.map(k => <li key={k} className="leading-relaxed">{k}</li>)}</ul>
              </div>
              <div>
                <Heading icon={Lightbulb}>Tips for best results</Heading>
                <ul className="mt-2 space-y-1.5 list-disc pl-4 marker:text-amber-400">{g.tips.map(t => <li key={t} className="leading-relaxed">{t}</li>)}</ul>
              </div>
            </div>
          </div>
        </div>
  );
}

function Heading({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return <div className="text-xs font-bold uppercase tracking-wide text-slate-500 flex items-center gap-1.5"><Icon className="w-3.5 h-3.5" /> {children}</div>;
}
