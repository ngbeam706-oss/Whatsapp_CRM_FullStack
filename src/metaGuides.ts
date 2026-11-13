// Step-by-step Meta setup guides shown on the WhatsApp and Ads pages (rendered by MetaSetupGuide.tsx).
// Menu names follow Meta's screens as of late 2026; Meta renames things now and then, so each step also
// links straight to the page. Keep the wording plain: these are read by business owners, not developers.

export interface GuideLink { label: string; href: string }
export interface SetupGuide {
  /** Remembers open/closed per guide. */
  id: string;
  title: string;
  intro: string;
  before: string[];
  steps: Array<{ title: string; text: string; path?: string; links?: GuideLink[] }>;
  values: Array<{ name: string; where: string; looksLike: string; link?: GuideLink }>;
  prosTitle: string;
  pros: string[];
  consTitle: string;
  cons: string[];
  notes: string[];
  docs: GuideLink[];
}

const L = {
  apps: { label: 'Meta for Developers: My apps', href: 'https://developers.facebook.com/apps/' },
  business: { label: 'Meta Business Suite', href: 'https://business.facebook.com/' },
  systemUsers: { label: 'Business settings: System users', href: 'https://business.facebook.com/settings/system-users' },
  waAccounts: { label: 'Business settings: WhatsApp accounts', href: 'https://business.facebook.com/settings/whatsapp-business-accounts' },
  waManager: { label: 'WhatsApp Manager', href: 'https://business.facebook.com/wa/manage/home/' },
  security: { label: 'Business settings: Security Centre (verification)', href: 'https://business.facebook.com/settings/security' },
  tokenDebugger: { label: 'Access Token Debugger', href: 'https://developers.facebook.com/tools/debug/accesstoken/' },
  adsManager: { label: 'Ads Manager', href: 'https://adsmanager.facebook.com/adsmanager/' },
  adAccounts: { label: 'Business settings: Ad accounts', href: 'https://business.facebook.com/settings/ad-accounts' },
};

export const WHATSAPP_GUIDE: SetupGuide = {
  id: 'whatsapp',
  title: 'Guide: connect your WhatsApp number (where to find each ID in Meta)',
  intro:
    'Your number is connected through Meta\'s WhatsApp Business Platform (the "Cloud API"). You need four values from Meta: '
    + 'the Phone number ID, the WhatsApp Business Account ID, a permanent access token and the App secret. You also paste this '
    + 'page\'s Callback URL and Verify token into Meta, so customer messages reach this CRM. Plan about 30 minutes the first time.',
  before: [
    'A Meta Business portfolio (Meta Business Suite) where you are an admin.',
    'A Meta developer app of the type "Business", in that business portfolio. One app is enough for WhatsApp and Ads.',
    'The phone number you want to use. It must be able to receive an SMS or voice call for the verification code.',
    'If that number is on the WhatsApp or WhatsApp Business app today, read the "things to know" list below first. In most cases the number stops working in the app.',
    'A privacy policy web page for your business (Meta asks for its address before the app can go Live).',
  ],
  steps: [
    {
      title: 'Create or open your Meta app, and add WhatsApp',
      text: 'Create an app (type "Business") and pick your business portfolio. Then add the WhatsApp product. If you already have an app for this business, open it.',
      path: 'developers.facebook.com → My apps → Create app → Business → Add product: WhatsApp → Set up',
      links: [L.apps],
    },
    {
      title: 'Add your real phone number',
      text: 'Add the number and the display name customers will see. The name must match your business; Meta reviews it, which can take a day or two. Then verify the number with the code Meta sends by SMS or voice call. (The "test number" Meta gives you can\'t message real customers.)',
      path: 'Your app → WhatsApp → API Setup → Add phone number   (or WhatsApp Manager → Phone numbers → Add)',
      links: [L.waManager],
    },
    {
      title: 'Copy the Phone number ID and the WhatsApp Business Account ID',
      text: 'On API Setup, choose your number in the "From" list. The Phone number ID and the WhatsApp Business Account ID are shown just below it. The Phone number ID is NOT the phone number itself.',
      path: 'Your app → WhatsApp → API Setup → From: your number',
      links: [L.apps, L.waAccounts],
    },
    {
      title: 'Create a permanent access token (system user)',
      text: 'Don\'t use the temporary token on API Setup: it stops working after 24 hours. Instead, add a system user (for example "CRM", role Admin). Give it your app and your WhatsApp account with full control. Then generate a token: choose your app, set the expiry to "Never", and tick whatsapp_business_messaging and whatsapp_business_management. Copy the token straight away: Meta shows it only once.',
      path: 'Business settings → Users → System users → Add → Assign assets (app + WhatsApp account) → Generate new token',
      links: [L.systemUsers, L.tokenDebugger],
    },
    {
      title: 'Copy the App secret',
      text: 'The App secret lets this CRM check that each incoming message really comes from Meta. Messages without the right signature are rejected.',
      path: 'Your app → App settings → Basic → App secret → Show',
      links: [L.apps],
    },
    {
      title: 'Set up the webhook in Meta (the "Step 1" box on this page)',
      text: 'Paste this page\'s Callback URL and Verify token, click "Verify and save", then subscribe to "messages". You can do this before saving your details here.',
      path: 'Your app → WhatsApp → Configuration → Webhook → Edit → Verify and save → Webhook fields → Manage → messages',
    },
    {
      title: 'Save your details here and test',
      text: 'Paste the Phone number ID, WhatsApp Business Account ID, access token and App secret below, then press "Save and check". This CRM checks them with Meta. Then send "hi" to your number from another phone: it should appear in the Inbox within a few seconds.',
    },
    {
      title: 'Switch the app to Live',
      text: 'In Development mode, Meta may not deliver real customers\' messages. Add your privacy policy address, then switch the app mode to Live.',
      path: 'Your app → top bar: App mode → Live   (App settings → Basic → Privacy policy URL first)',
      links: [L.apps],
    },
    {
      title: 'Recommended: verify your business',
      text: 'Business verification lets your daily sending limit grow, makes the display name more trusted, and is needed before you can apply for the blue tick. It usually takes a few days and asks for business documents.',
      path: 'Business settings → Security Centre → Business verification → Start',
      links: [L.security],
    },
  ],
  values: [
    { name: 'Phone number ID', where: 'App → WhatsApp → API Setup, under your number. Also WhatsApp Manager → Phone numbers → your number.', looksLike: '15–16 digits, e.g. 123456789012345', link: L.waManager },
    { name: 'WhatsApp Business Account ID', where: 'App → WhatsApp → API Setup. Also Business settings → Accounts → WhatsApp accounts.', looksLike: '15–16 digits, e.g. 100098765432109', link: L.waAccounts },
    { name: 'Access token', where: 'Business settings → Users → System users → Generate new token (expiry: Never).', looksLike: 'Long text starting with EAA…', link: L.systemUsers },
    { name: 'App secret', where: 'App → App settings → Basic → App secret → Show.', looksLike: '32 letters and numbers', link: L.apps },
    { name: 'Callback URL and Verify token', where: 'Shown on THIS page (Step 1 box). You paste these into Meta, not the other way round.', looksLike: 'https://…/webhook/… and a random word' },
  ],
  prosTitle: 'What you get by connecting the number',
  pros: [
    'The whole team answers from one number at the same time in the Inbox. Each chat has an owner, notes and a pipeline stage, and no one needs to keep a phone online.',
    'Customers get an answer at any hour: the bot menu, keyword replies and, if you switch it on, AI replies.',
    'Broadcasts and automatic follow-ups with approved templates, and you can see who received, read and replied to each one.',
    'Every chat stays with the business, even when a staff member leaves. Their chats go back to the shared queue.',
    'Analytics: where leads come from (including Click-to-WhatsApp ads), busy hours, team response times and conversions.',
    'Customers who reply STOP are unsubscribed automatically, which protects your number\'s quality rating.',
    'After business verification you can apply for an official business account (blue tick).',
  ],
  consTitle: 'Things to know before you connect',
  cons: [
    'The number usually can\'t stay on the WhatsApp or WhatsApp Business app at the same time. Meta offers "coexistence" (the app and this CRM on one number) for some WhatsApp Business app numbers: check when you add the number in WhatsApp Manager. Without it, old chats in the app are not moved over, so back them up first.',
    'Messages you start, and any message more than 24 hours after the customer\'s last message, must use a template Meta has approved. Replies within 24 hours are free text.',
    'Meta charges for template messages (marketing costs more than utility). Replies to customers within the 24-hour window are free. See Meta\'s pricing page for your country\'s rates.',
    'A new number can start only a limited number of conversations a day (often 250). The limit grows with good quality and business verification.',
    'If many customers block or report your messages, Meta lowers the number\'s quality rating and can limit or pause it. Only message people who agreed to hear from you.',
    'The display name is reviewed by Meta, and changing it later needs another review.',
    'Some app features aren\'t available on this platform, such as groups, status updates and normal WhatsApp voice calls from the app.',
    'Keep the token and App secret private. If the token is deleted or the App secret changes in Meta, this CRM can\'t send until you paste new ones here.',
  ],
  notes: [
    'The token and App secret are stored encrypted. They are never shown again here, and Platform Admins never see them.',
    'Only the Business Admin can change these details. Everyone in the team can see whether the number is connected.',
    'If saving says the token was rejected, open the Access Token Debugger and check that the token is valid, has no expiry and has both WhatsApp permissions.',
    'Each business connects its own number; your customers never see another business\'s number.',
  ],
  docs: [
    { label: 'Cloud API: get started', href: 'https://developers.facebook.com/docs/whatsapp/cloud-api/get-started' },
    { label: 'Pricing', href: 'https://developers.facebook.com/docs/whatsapp/pricing' },
    { label: 'Messaging limits', href: 'https://developers.facebook.com/docs/whatsapp/messaging-limits' },
    L.tokenDebugger,
  ],
};

export const EXTRA_NUMBER_GUIDE: SetupGuide = {
  id: 'whatsapp-extra-number',
  title: 'Guide: add another WhatsApp number (e.g. Pharmacy, Lab)',
  intro:
    'Extra numbers use the same Meta app and the same webhook address as your main number, so nothing changes in the webhook settings. '
    + 'Each customer stays ONE chat in the Inbox, whichever of your numbers they write to; replies go out from the number they last wrote to.',
  before: [
    'Your main number is connected on this page.',
    'The new phone number can receive an SMS or voice call for Meta\'s verification code, and is not on the WhatsApp app (or uses Meta\'s coexistence).',
    'Your plan allows another number (see the count above the list). The Platform Admin can raise it.',
  ],
  steps: [
    {
      title: 'Add and verify the number in Meta',
      text: 'Add it with its display name (Meta reviews the name), then verify it with the code Meta sends. Use the SAME WhatsApp Business Account as your main number if you can: the numbers then share templates.',
      path: 'WhatsApp Manager → Phone numbers → Add phone number   (or your app → WhatsApp → API Setup → Add phone number)',
      links: [L.waManager],
    },
    {
      title: 'Give the CRM\'s system user access to it',
      text: 'The system user whose token you saved here must have the number\'s WhatsApp account assigned with full control. Same account as the main number: usually already done. A different account: assign it, or paste a separate token for this number below.',
      path: 'Business settings → Users → System users → your CRM user → Assign assets → WhatsApp accounts → Full control',
      links: [L.systemUsers, L.waAccounts],
    },
    {
      title: 'Copy the Phone number ID',
      text: 'On API Setup, pick the new number in the "From" list: its Phone number ID is shown below it (it is NOT the phone number). If the number is in a different WhatsApp Business Account, copy that account\'s ID too.',
      path: 'Your app → WhatsApp → API Setup → From: the new number',
      links: [L.apps],
    },
    {
      title: 'Add it here and test',
      text: 'Fill in the name your team will see (e.g. "Pharmacy") and the Phone number ID, then press "Add number". The CRM checks it with Meta. Then send "hi" to the new number from another phone: the chat shows "📱 Pharmacy" in the Inbox.',
    },
  ],
  values: [
    { name: 'Phone number ID', where: 'App → WhatsApp → API Setup, under the new number. Also WhatsApp Manager → Phone numbers.', looksLike: '15–16 digits', link: L.waManager },
    { name: 'WhatsApp Business Account ID (only if different)', where: 'App → WhatsApp → API Setup, or Business settings → WhatsApp accounts. Leave empty for the main number\'s account.', looksLike: '15–16 digits', link: L.waAccounts },
    { name: 'Access token (only if needed)', where: 'Only when your saved token can\'t see this number\'s account: Business settings → System users → Generate new token.', looksLike: 'Long text starting with EAA…', link: L.systemUsers },
  ],
  prosTitle: 'What you get',
  pros: [
    'Separate numbers for separate desks (reception, pharmacy, lab, branches) in one inbox, with the number shown on every chat and message.',
    'Filter the inbox by number, and reply from the number the customer used, so the 24-hour window and the customer\'s expectations match.',
    'Templates in the same WhatsApp Business Account are shared by all its numbers.',
  ],
  consTitle: 'Things to know',
  cons: [
    'WhatsApp\'s 24-hour window is per number: replying from a number the customer didn\'t write to needs an approved template.',
    'Broadcasts, automatic follow-ups and ads still go out from the main number for now.',
    'Each number has its own messaging limit and quality rating in Meta.',
    'Removing a number here stops the CRM sending and receiving on it; its chat history stays. You can add it back later.',
  ],
  notes: [
    'Only the Business Admin can add, rename or remove numbers. Managers can see the list.',
    'A separate token is stored encrypted and never shown again.',
  ],
  docs: [
    { label: 'Cloud API: phone numbers', href: 'https://developers.facebook.com/docs/whatsapp/cloud-api/phone-numbers' },
    { label: 'Messaging limits', href: 'https://developers.facebook.com/docs/whatsapp/messaging-limits' },
  ],
};

export const ADS_GUIDE: SetupGuide = {
  id: 'ads',
  title: 'Guide: connect your Meta ad account (where to find the ID and token)',
  intro:
    'This page reads your Click-to-WhatsApp ad results from Meta, using the Marketing API, and puts them next to the chats '
    + 'and conversions in this CRM. You need two things from Meta: the ad account ID and an access token that can read '
    + 'ads (ads_read). To pause ads and change budgets from here, the token also needs ads_management.',
  before: [
    'An ad account in the same Meta Business portfolio as your WhatsApp number, and admin access to both.',
    'The same Meta developer app you use for WhatsApp (or another app in the same business).',
    'Ads that send people to WhatsApp ("Click-to-WhatsApp") on the number connected on the WhatsApp page. Other ads show spend only.',
    'A plan that includes the Ads module (Growth or Pro).',
  ],
  steps: [
    {
      title: 'Find your ad account ID',
      text: 'In Ads Manager, open the account menu at the top left: the number under the account name is the ad account ID. You can paste it with or without "act_". It is also in Business settings under Ad accounts.',
      path: 'Ads Manager → account menu (top left) → Account ID   or   Business settings → Accounts → Ad accounts',
      links: [L.adsManager, L.adAccounts],
    },
    {
      title: 'Allow the Marketing API in your app',
      text: 'In your app, add the "Create & manage ads with Marketing API" use case (older apps: add the Marketing API product). For your own business\'s ad accounts this standard access is normally enough. If Meta asks for business verification or app review before a permission works, complete that first.',
      path: 'developers.facebook.com → your app → Use cases → Add → Create & manage ads with Marketing API',
      links: [L.apps],
    },
    {
      title: 'Give the system user the ad account',
      text: 'Use the same system user as WhatsApp (for example "CRM"), or make a new one. Assign the ad account to it. "View performance" is enough to see results. "Manage campaigns" is needed to pause or resume ads and change budgets from this page.',
      path: 'Business settings → Users → System users → your user → Assign assets → Ad accounts → your account',
      links: [L.systemUsers],
    },
    {
      title: 'Generate the access token',
      text: 'Generate a new token for that system user: choose your app, set the expiry to "Never", and tick ads_read. Also tick ads_management if you want the Pause and Budget buttons to work. Copy the token straight away: Meta shows it only once. A separate token for ads, apart from the WhatsApp one, is safer.',
      path: 'System users → your user → Generate new token → ads_read (+ ads_management)',
      links: [L.systemUsers, L.tokenDebugger],
    },
    {
      title: 'Connect here',
      text: 'Paste the ad account ID and the token below and press Connect. This CRM checks them with Meta and makes sure the token can read results, then loads the last 30 days.',
    },
    {
      title: 'Check your ads send people to WhatsApp',
      text: 'In Ads Manager, the ad\'s destination should be WhatsApp, with the number you connected on the WhatsApp page. Chats that start from these ads are counted per ad in the CRM automatically.',
      links: [L.adsManager],
    },
    {
      title: 'Optional: set cost alerts',
      text: 'After the first results load, set a maximum cost per chat or per conversion. Running ads that cost more are flagged at the top of this page.',
    },
  ],
  values: [
    { name: 'Ad account ID', where: 'Ads Manager → account menu (top left), or Business settings → Accounts → Ad accounts.', looksLike: 'act_1234567890 (or just the digits)', link: L.adsManager },
    { name: 'Access token', where: 'Business settings → Users → System users → Generate new token (ads_read, optionally ads_management).', looksLike: 'Long text starting with EAA…', link: L.systemUsers },
  ],
  prosTitle: 'What you get by connecting the ad account',
  pros: [
    'Spend per ad and campaign next to the real chats and conversions each ad brought into your inbox. Meta can\'t see your bookings or orders, but this page can.',
    'Cost per chat and cost per conversion, so you can see which ads earn their money.',
    'Pause or resume ads, and change daily budgets, without opening Ads Manager (needs ads_management). Every change is recorded in the audit log.',
    'Cost alerts flag running ads that cost more than your limit per chat or per conversion.',
    'Managers can see ad results without being given access to Ads Manager.',
  ],
  consTitle: 'Limits and things to know',
  cons: [
    'Results update about once an hour (Meta limits how often they can be read). "Sync now" works at most every 10 minutes, so today\'s numbers lag a little.',
    'Numbers can differ from Ads Manager. Meta counts conversions with its own attribution windows, uses the ad account\'s time zone, and counts "conversations" its own way. This CRM uses India time and counts chats it actually received.',
    'Conversions are counted when staff move a chat to Booked, Completed or Returning, so recent days can look worse until the team updates stages.',
    'Only Click-to-WhatsApp ads that lead to your connected number bring chats. Other ads show spend only.',
    'A token with ads_management can change how much you spend. Only the Business Admin can connect it; keep it private, and delete it in System users if it is ever exposed.',
    'Simple Click-to-WhatsApp ads can be created here (Create WhatsApp ads tab: one campaign, one ad set and one ad each). Campaigns with several ad sets or ads, video, interests and custom audiences are still made in Ads Manager; their results show here too.',
    'If the system user loses access to the ad account or the token is deleted, syncing stops. This page says so, and you paste a new token.',
  ],
  notes: [
    'The token is stored encrypted and never shown again. Platform Admins never see it.',
    'Business Admins and managers see this page; agents don\'t.',
    'If Connect says the token can\'t read results, open the Access Token Debugger and check it has ads_read and that the ad account is assigned to that system user.',
  ],
  docs: [
    { label: 'Marketing API: get started', href: 'https://developers.facebook.com/docs/marketing-api/get-started' },
    { label: 'Marketing API: authorization', href: 'https://developers.facebook.com/docs/marketing-api/overview/authorization' },
    L.tokenDebugger,
  ],
};
