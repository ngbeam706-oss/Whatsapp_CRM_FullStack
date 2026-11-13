import {
  FileCheck2, Users, Smartphone, Send, Layers, CheckCheck, Inbox, Megaphone, MessageCircle, UserX, UserCheck, Ban, PenLine,
  Clock, CircleCheck, CircleX, PauseCircle, Zap, Timer, CalendarClock, StopCircle,
} from 'lucide-react';
import { Figure, Flow, Funnel, PhoneMessage, Blank, Timeline, Decision, Node } from './guideVisuals';

// Pictures for the "How this works" guides on the Broadcasts page (src/BroadcastGuide.tsx): broadcast campaigns,
// templates and automations. Examples use a made-up business ("Sunrise Clinic"), never a real customer's names.

export function CampaignPictures() {
  return (
    <>
      <Figure label="How a broadcast campaign works" caption="Replies land in your Inbox like any other chat.">
        <Flow steps={[
          { icon: FileCheck2, title: 'Approved template', text: 'From the Templates tab.', tone: 'violet' },
          { icon: Users, title: 'Choose who gets it', text: 'By source, tags, last chat, or a list. STOP is always left out.', tone: 'sky' },
          { icon: Smartphone, title: 'Test on your phone', text: 'Send it to yourself first.', tone: 'amber' },
          { icon: Send, title: 'Send now', text: 'Or save as draft and start later.', tone: 'teal' },
          { icon: Layers, title: 'Goes out in batches', text: 'Small batches every few minutes, so thousands take a while.', tone: 'slate' },
          { icon: CheckCheck, title: 'Delivered · read · replied', text: 'Per person, with reasons for failures.', tone: 'emerald' },
        ]} />
      </Figure>

      <Figure label="Broadcast campaign or ad campaign?" caption="Same word, different things: a broadcast messages people who already know you.">
        <div className="grid sm:grid-cols-2 gap-2">
          <Node icon={MessageCircle} title="Broadcast campaign (this page)" text="You → your own contacts. A WhatsApp message on their phone. Paid per message." tone="teal" />
          <Node icon={Megaphone} title="Ad campaign (Ads page)" text="Meta → new people on Facebook/Instagram. They tap and message you. Paid for ad views." tone="violet" />
        </div>
      </Figure>

      <div className="grid md:grid-cols-2 gap-3">
        <Figure label="What your customer receives" caption="Green = the blanks, filled in for each person.">
          <PhoneMessage business="Sunrise Clinic" header="Free eye check-up camp"
            body={<>Hello <Blank n={1}>Priya</Blank>, Sunrise Clinic is holding a free eye check-up camp on <Blank n={2}>Sunday, 7 Dec</Blank>. Reply BOOK to reserve your slot.</>}
            footer="Reply STOP to unsubscribe" buttons={['Book a slot', 'Not now']} />
        </Figure>
        <Figure label="What the results look like" caption="Example: 500 contacts. Open the campaign to see each person.">
          <Funnel rows={[
            { label: 'sent', value: 500, tone: 'slate' },
            { label: 'delivered', value: 478, tone: 'sky', note: '22 failed: number not on WhatsApp, or blocked' },
            { label: 'read', value: 341, tone: 'violet' },
            { label: 'replied', value: 62, tone: 'emerald', note: 'Continue in the Inbox: book, answer, sell' },
          ]} />
        </Figure>
      </div>

      <Figure label="Who is left out automatically">
        <div className="grid sm:grid-cols-3 gap-2">
          <Node icon={UserX} title="Replied STOP" text="Never sent again until they reply START." tone="rose" small />
          <Node icon={Ban} title="Over your limits" text="Plan's monthly broadcasts or WhatsApp's daily limit: refused before it starts." tone="amber" small />
          <Node icon={UserCheck} title="Everyone else you chose" text="Gets one message each." tone="emerald" small />
        </div>
      </Figure>
    </>
  );
}

export function TemplatePictures() {
  return (
    <>
      <Figure label="The WhatsApp 24-hour rule" caption="Every new message from the customer opens a fresh 24 hours.">
        <Timeline segments={[
          { label: 'Customer writes (10:00 Mon)', text: 'The window opens.', tone: 'sky', grow: 1 },
          { label: 'Next 24 hours', text: 'Reply with anything: text, photos, lists. Free.', tone: 'emerald', grow: 3 },
          { label: 'After 10:00 Tue', text: 'Only an approved template can start the chat again.', tone: 'amber', grow: 3 },
        ]} />
      </Figure>

      <div className="grid md:grid-cols-2 gap-3">
        <Figure label="The parts of a template" caption="What you write: blanks are {{1}}, {{2}}…">
          <PhoneMessage business="Sunrise Clinic" labels header="Appointment reminder"
            body={'Hello {{1}}, this is a reminder of your appointment at Sunrise Clinic on {{2}}. Reply YES to confirm or CHANGE to reschedule.'}
            footer="Sunrise Clinic, Main Road" buttons={['Yes, confirm', 'Change time']} />
        </Figure>
        <Figure label="What the customer sees" caption="The CRM fills the blanks for each person.">
          <PhoneMessage business="Sunrise Clinic" header="Appointment reminder"
            body={<>Hello <Blank n={1}>Ravi</Blank>, this is a reminder of your appointment at Sunrise Clinic on <Blank n={2}>Fri 5 Dec, 11:30 am</Blank>. Reply YES to confirm or CHANGE to reschedule.</>}
            footer="Sunrise Clinic, Main Road" buttons={['Yes, confirm', 'Change time']} />
        </Figure>
      </div>

      <Figure label="Which category should I choose?" caption="Meta can move a template to Marketing if it contains an offer.">
        <Decision items={[
          { q: 'Is it a login or verification code?', yes: 'Authentication', tone: 'sky' },
          { q: 'Is it about something the customer asked for (appointment, report, order, payment)?', yes: 'Utility (costs less)', tone: 'emerald' },
        ]} otherwise="Marketing: offers, news, invitations (costs more)" />
      </Figure>

      <Figure label="From writing to sending" caption="Approved templates can't be edited: make a new one to change the wording.">
        <Flow steps={[
          { icon: PenLine, title: 'Write it here', text: 'Name, category, language, text, examples.', tone: 'slate' },
          { icon: Send, title: 'Submit to Meta', text: 'From this page.', tone: 'sky' },
          { icon: Clock, title: 'In review', text: 'Usually minutes, up to 24 hours.', tone: 'amber' },
          { icon: CircleCheck, title: 'Approved', text: 'Ready for campaigns, follow-ups and the Inbox.', tone: 'emerald' },
        ]} />
        <div className="mt-2 grid sm:grid-cols-2 gap-2">
          <Node icon={CircleX} title="Rejected" text="The reason shows in the list. Fix the wording and submit a new one." tone="rose" small />
          <Node icon={PauseCircle} title="Paused" text="Many people blocked or reported it. Improve it, or wait for Meta to lift the pause." tone="amber" small />
        </div>
      </Figure>

      <Figure label="Where one template is used">
        <div className="grid sm:grid-cols-4 gap-2">
          <Node icon={Megaphone} title="Broadcast campaigns" tone="teal" small />
          <Node icon={Zap} title="Automatic follow-ups" tone="violet" small />
          <Node icon={Inbox} title="Inbox, after 24 hours" tone="sky" small />
          <Node icon={MessageCircle} title="Query updates" tone="amber" small />
        </div>
      </Figure>
    </>
  );
}

export function AutomationPictures() {
  return (
    <Figure label="How an automatic follow-up works" caption="Example: someone asks about a check-up but doesn't book; one day later they get a reminder.">
      <Flow steps={[
        { icon: Zap, title: 'Something happens', text: 'An enquiry, a first message, or days of silence.', tone: 'violet' },
        { icon: Timer, title: 'Wait', text: 'The delay you chose (e.g. 1 day).', tone: 'slate' },
        { icon: CalendarClock, title: 'Within sending hours', text: 'Night-time ones wait for the morning.', tone: 'amber' },
        { icon: Send, title: 'Template sent', text: 'With their name or the item filled in.', tone: 'teal' },
        { icon: StopCircle, title: 'Stops by itself', text: 'If they reply or book first.', tone: 'rose' },
      ]} />
    </Figure>
  );
}
