// The Bot Flow guide's tour (BotFlowAgent.tsx walks through these, scrolling to and spotlighting each part of
// GenericBotFlow.tsx by its data-tour name). Keep it in step with server/bot.cjs and the page. Plain words: read by
// business owners. `target`: the first data-tour name found on the page is used (later ones are fallbacks).

export interface TourStep {
  id: string;
  /** Which part of the page this step is about (shown in "Show me a part"). */
  part: 'Start' | 'Preview' | 'Welcome' | 'Services' | 'Replies' | 'Finish';
  target: string[];
  title: string;
  text: string;
  points?: string[];
  tip?: string;
}

export const TOUR: TourStep[] = [
  {
    id: 'intro', part: 'Start', target: ['bf-header'],
    title: 'This page is your WhatsApp bot',
    text: 'When a customer messages your business on WhatsApp, the bot answers straight away, day and night. Everything it says is set on this page.',
    points: [
      'Change anything here, then press Save changes. Customers get the new version from their next message.',
      'Nothing changes for customers until you save.',
    ],
  },
  {
    id: 'progress', part: 'Start', target: ['bf-steps'],
    title: 'Three parts to set up',
    text: 'The bot has three parts: 1. the welcome message with its buttons, 2. your services list, 3. two automatic replies. Each one shows "Done" when it\'s ready.',
    tip: 'Click a part here to jump to it.',
  },
  {
    id: 'phone', part: 'Preview', target: ['bf-phone'],
    title: 'Try it on the phone',
    text: 'This phone shows exactly what a customer sees, using what you typed (even before saving). Tap the buttons in it to play the conversation.',
    points: [
      'Green bubble on the right = the customer. White bubble on the left = your bot.',
      'Yellow notes explain what happens behind the scenes (pipeline, pausing the bot).',
      'Press "Start again" to go back to "hi".',
    ],
  },
  {
    id: 'welcome', part: 'Welcome', target: ['bf-welcome-text'],
    title: '1. The welcome message',
    text: 'The first thing every customer gets. It\'s sent when they say hi, hello, hey, start or namaste, and also when they type something the bot doesn\'t understand, so nobody is left without an answer.',
    points: [
      'Say who you are and what they can do here, in one or two short lines.',
      'Up to 1,024 characters, but short reads best on a phone.',
    ],
    tip: 'Several WhatsApp numbers? Each extra number can greet in its own words: WhatsApp page → Your WhatsApp numbers → Edit welcome.',
  },
  {
    id: 'btn-services', part: 'Welcome', target: ['bf-btn-btn_menu'],
    title: 'Button: Our services',
    text: 'Opens your services list (part 2). The customer picks one and gets its details with a Book / Enquire button.',
    points: [
      'Tick the box to show the button; type in the box to rename it (max 20 characters, WhatsApp\'s limit).',
      'It stays hidden from customers until you add at least one service.',
    ],
  },
  {
    id: 'btn-team', part: 'Welcome', target: ['bf-btn-btn_talk_staff'],
    title: 'Button: Talk to our team',
    text: 'For customers who want a person. The bot sends your "When they ask for a person" reply and then stays quiet in that chat for 12 hours, so your team can answer in the Inbox without the bot interrupting.',
  },
  {
    id: 'btn-query', part: 'Welcome', target: ['bf-btn-btn_raise_query'],
    title: 'Button: Raise a query',
    text: 'For problems and complaints. The customer chooses a category, describes it in one message and gets a reference number (like Q-1004). The query appears on your Queries page to track until it\'s solved.',
    tip: 'The categories are set on the Queries page.',
  },
  {
    id: 'list-settings', part: 'Services', target: ['bf-list-settings'],
    title: '2. How the services list looks',
    text: 'Three small texts around your list:',
    points: [
      'Message above the list: the line sent with it ("Here is what we offer…").',
      'List button text: the button the customer taps to open the list (max 20 characters).',
      'Button under an item: the action sent with each item\'s details, e.g. "✅ Book / Enquire" or "📅 Book a visit".',
    ],
  },
  {
    id: 'items', part: 'Services', target: ['bf-add-item', 'bf-items'],
    title: 'Add your services or products',
    text: 'Each card is one line in the WhatsApp list (up to 9; the list always ends with "Talk to our team"). Click "Add a service or product" to add one:',
    points: [
      'Name (max 24 characters), shown in the list.',
      'Short description (optional, max 72): timings, duration, who it\'s for.',
      'Price (optional): only real prices; leave it empty if prices vary.',
      'Details (optional): the full text sent when it\'s picked. Empty = name, price and description.',
    ],
    tip: 'Customers also get this list when they type words like menu, services or price.',
  },
  {
    id: 'reply-book', part: 'Replies', target: ['bf-reply-book'],
    title: '3. Reply after Book / Enquire',
    text: 'Sent when the customer taps the button under an item. Tell them what happens next, e.g. "Thank you! Our team will call you within 30 minutes to confirm your slot."',
    points: [
      'The chat moves to "Booked" in your Pipeline.',
      'It can start an automatic follow-up (Broadcasts → Automations), and, if switched on, is reported to Meta for your ads.',
    ],
  },
  {
    id: 'reply-person', part: 'Replies', target: ['bf-reply-person'],
    title: 'Reply when they ask for a person',
    text: 'Sent for "Talk to our team" (and when the AI hands a chat over). Say when someone will answer, e.g. "Our team will reply here shortly (Mon–Sat, 9am–8pm)."',
  },
  {
    id: 'save', part: 'Finish', target: ['bf-save'],
    title: 'Save, then test from a phone',
    text: 'Press Save changes to make it live. Then send "hi" to your WhatsApp number from another phone and tap every button once. The chat shows in the Inbox too.',
    points: [
      'Reset to basic flow puts the starting texts back and EMPTIES the services list (it asks first).',
      'Never promise cures or results, and only quote prices you really charge.',
    ],
    tip: 'Answers to common questions ("timings", "location") go on the Auto-replies page, so they work when typed.',
  },
];

export const TOUR_PARTS: TourStep['part'][] = ['Start', 'Preview', 'Welcome', 'Services', 'Replies', 'Finish'];
