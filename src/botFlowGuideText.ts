// Bot Flow help text, used by the floating guide's "Good to know" topics (BotFlowAgent.tsx; the step-by-step tour
// itself is in botFlowTour.ts). It describes what server/bot.cjs really does for
// a business on the basic flow, so keep it in step with the bot: the order of checks, the button actions,
// the pipeline moves and WhatsApp's length limits. Plain words: business owners read this, not developers.

export interface GuideSection {
  /** id of the card on the page this explains ("Show me" scrolls to it); none for background topics. */
  target?: string;
  title: string;
  what: string;
  fields?: Array<{ name: string; does: string; tip?: string }>;
}

export const BOT_FLOW_GUIDE = {
  intro:
    'The bot answers customers on WhatsApp by itself, any time of day. When a customer says "hi" (or anything the bot '
    + 'doesn\'t understand) it sends your welcome message with up to three buttons. From there the customer can see your '
    + 'services, book or enquire, raise a query, or ask for a person. Everything on this page is that conversation: '
    + 'change it here, press Save changes, and the next customer gets the new version.',

  // First-time setup, in order.
  steps: [
    { title: 'Write your welcome message', text: 'Say who you are and what the customer can do, in one or two short lines. Example: "Welcome to Mayura Hospitals! 👋 How can we help you today?"', target: 'bf-welcome' },
    { title: 'Choose the menu buttons', text: 'Tick the buttons you want under the welcome message (up to 3) and give each a short name. Most businesses keep all three: services, talk to the team, raise a query.', target: 'bf-welcome' },
    { title: 'Add your services or products', text: 'Click "Add a service or product" for each thing customers ask about (up to 9). Give it a name, an optional price and the details the customer should get.', target: 'bf-services' },
    { title: 'Write the two automatic replies', text: 'What the bot says after "Book / Enquire", and what it says when the customer asks for a person.', target: 'bf-replies' },
    { title: 'Check the preview, then Save changes', text: '"How the flow works" at the top shows what customers will see. Nothing changes for customers until you press Save changes.', target: 'bf-preview' },
    { title: 'Test it from a phone', text: 'From a phone that is NOT your business number, send "hi" to your WhatsApp number. Tap every button once. The chat appears in the Inbox, so your team sees it too.' },
  ],

  // Every part of the screen, top to bottom.
  sections: [
    {
      title: 'Top bar: Save changes and Reset',
      what: 'Your edits stay on this page until you save them.',
      fields: [
        { name: 'Save changes', does: 'Makes your edits live for customers. It says "Saved" when there is nothing new to save, and stays greyed out while something is missing (the yellow box lists what).' },
        { name: 'Reset to basic flow', does: 'Puts the starting flow back: the default welcome, buttons and replies, and an EMPTY services list. Use it only to start over; it asks before replacing anything.' },
      ],
    },
    {
      target: 'bf-preview',
      title: 'How the flow works (preview)',
      what: 'A live picture of the conversation, updated as you type: 1. what the customer gets after "hi", 2. the services list, 3. what they get after picking an item. Nothing to fill in here; use it to check your wording before saving.',
    },
    {
      target: 'bf-welcome',
      title: 'Welcome message and menu buttons',
      what: 'The first thing every customer sees. It is sent when they say hi, hello, hey, start or namaste, and also when they type something the bot doesn\'t understand, so they always get your menu instead of silence.',
      fields: [
        { name: 'Welcome message', does: 'The text above the buttons. Up to 1,024 characters, but 1–3 short lines work best on a phone.', tip: 'Several WhatsApp numbers? Each extra number can greet in its own words: WhatsApp page → Your WhatsApp numbers → Edit welcome.' },
        { name: '📋 Our services', does: 'Opens your services list (the next section). It stays hidden from customers until you add at least one service.' },
        { name: '💬 Talk to our team', does: 'Sends your "When they ask for a person" reply, then PAUSES the bot for this customer for 12 hours so your team can reply in the Inbox without the bot interrupting.' },
        { name: '📝 Raise a query', does: 'Starts the query form: the customer picks a category, describes the problem in one message and gets a reference number (e.g. Q-1004). It then appears on the Queries page. Categories are set on the Queries page.' },
        { name: 'Button text', does: 'You can rename each button (max 20 characters, WhatsApp\'s limit). An emoji at the start helps customers find it. Untick a button to hide it.' },
      ],
    },
    {
      target: 'bf-services',
      title: 'Services list',
      what: 'Your services or products as a WhatsApp list (up to 9 items; the list always ends with "Talk to our team"). Customers also get it when they type words like menu, services, price or options.',
      fields: [
        { name: 'Message above the list', does: 'The line shown with the list, e.g. "Here is what we offer. Tap an option to see the details:".' },
        { name: 'List button text', does: 'The button the customer taps to open the list (max 20 characters), e.g. "View options".' },
        { name: 'Button under an item', does: 'The action button sent with each item\'s details (max 20 characters), e.g. "✅ Book / Enquire" or "📅 Book a visit".' },
        { name: 'Item: Name', does: 'Shown in the list (max 24 characters). Keep it short: "General consultation", "Blood test".' },
        { name: 'Item: Short description', does: 'Optional grey line under the name in the list (max 72 characters): timings, duration, who it is for.' },
        { name: 'Item: Price in ₹', does: 'Optional. Shown with the item when filled; leave it empty if prices vary. Only enter prices you really charge.' },
        { name: 'Item: Details sent when picked', does: 'Optional full text sent when the customer picks the item (up to 1,024 characters). Empty = the bot sends the name, price and description.' },
        { name: 'Edit / remove', does: 'Pencil to change an item, bin to remove it. Added or changed items go live only after Save changes.' },
      ],
    },
    {
      target: 'bf-replies',
      title: 'Automatic replies',
      what: 'The two messages the bot sends at the end of the flow.',
      fields: [
        { name: 'After Book / Enquire', does: 'Sent when the customer taps the button under an item. Tell them what happens next: "Thank you! Our team will call you within 30 minutes to confirm your slot."' },
        { name: 'When they ask for a person', does: 'Sent for "Talk to our team" (and when the AI hands over a chat). The bot then pauses for 12 hours for this customer. Say when someone will reply: "Our team will reply here shortly (Mon–Sat, 9am–8pm)."' },
      ],
    },
    {
      title: 'What happens behind the scenes',
      what: 'Taps in the bot also update your CRM, so the team can follow up.',
      fields: [
        { name: 'Pipeline', does: 'A customer who opens an item moves from "New enquiry" to "In discussion"; tapping Book / Enquire moves them to "Booked" (or "Returning" if they booked before).' },
        { name: 'Inbox', does: 'Every bot message is in the chat, marked "🤖 Bot flow". When staff reply, the bot pauses for that chat for 12 hours; the "Bot on / You\'re chatting" button in the chat switches it.' },
        { name: 'Follow-ups', does: 'Broadcasts → Automations can send a template after "looked at a product but didn\'t order" or after "placed an order enquiry".' },
        { name: 'Analytics', does: 'Products shows looked-at vs booked per item; enquiries count in the KPIs.' },
      ],
    },
    {
      title: 'In what order the bot decides',
      what: 'For each message, the bot uses the first rule that fits:',
      fields: [
        { name: '1. STOP / START', does: 'Unsubscribes or re-subscribes the customer from broadcasts (always, even if the bot is paused).' },
        { name: '2. Paused chat', does: 'If your team took over the chat, the bot stays quiet; the message only shows in the Inbox.' },
        { name: '3. Queries', does: 'Finishing a query, or words like "complaint" / "raise a query", go to the query form.' },
        { name: '4. AI replies', does: 'If AI replies are switched ON (header switch / AI page), the AI answers typed questions. Button taps still follow this flow.' },
        { name: '5. Keyword replies', does: 'Your own rules on the Auto-replies page (e.g. "timings", "location").' },
        { name: '6. Services words', does: '"menu", "services", "price", "options" open the services list.' },
        { name: '7. Welcome', does: 'Anything else gets the welcome message and buttons.' },
      ],
    },
  ] as GuideSection[],

  limits: [
    ['Welcome, list message, replies, item details', '1,024 characters'],
    ['Menu buttons', '3 buttons, 20 characters each'],
    ['List button / button under an item', '20 characters'],
    ['Services in the list', '9 (plus "Talk to our team")'],
    ['Item name', '24 characters'],
    ['Item description', '72 characters'],
  ] as Array<[string, string]>,

  tips: [
    'Never promise cures, results or "100% guaranteed" outcomes, and only quote prices you really charge. WhatsApp and the law treat health claims strictly.',
    'Short beats long: customers read on a phone. Put details in the item, not in the welcome.',
    'Test after every change by sending "hi" from another phone.',
    'Answers to common questions (timings, address, parking) belong on the Auto-replies page, so they work even when typed.',
  ],
};
