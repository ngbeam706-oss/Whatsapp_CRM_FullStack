import { useState, type ReactNode } from 'react';
import {
  ChevronDown, Building2, Flag, Camera, MessageCircle, Megaphone, Users, FolderTree, HelpCircle, CheckCircle2, ExternalLink,
  BookOpen, User, Bot, Handshake, Code2, Smartphone, Wallet, ShieldCheck, LayoutGrid, KeyRound, BookA, Image as ImageIcon,
  Inbox, MousePointerClick, CalendarCheck, Send, Globe, CreditCard, Receipt, UserPlus, ListChecks, Target, Eye, Lock,
} from 'lucide-react';
import { Figure, Flow, OrgTree, RoleLadder, Decision, TwoBoxes, Node } from './guideVisuals';

// Ads page -> Setup guide: "How Meta is organised", a small illustrated booklet for business owners. It explains
// Meta's apps and tools, the hierarchy (person -> business portfolio -> assets), every role and access level, system
// users and tokens, partners/agencies, developer apps, WhatsApp, ads, payments, how this CRM's roles differ from
// Meta's, a setup checklist and a glossary, with flow charts, org charts and decision charts (src/guideVisuals.tsx).
// Shown to every business on the platform, so examples use a made-up business ("Sunrise Clinic"), never a real
// customer's names. Meta renames menus now and then: names are as of late 2026.

const LINKS = {
  business: 'https://business.facebook.com/',
  settings: 'https://business.facebook.com/settings/',
  people: 'https://business.facebook.com/settings/people',
  systemUsers: 'https://business.facebook.com/settings/system-users',
  adAccounts: 'https://business.facebook.com/settings/ad-accounts',
  partners: 'https://business.facebook.com/settings/partners',
  security: 'https://business.facebook.com/settings/security',
  billing: 'https://business.facebook.com/billing_hub/',
  adsManager: 'https://adsmanager.facebook.com/adsmanager/',
  waManager: 'https://business.facebook.com/wa/manage/home/',
  events: 'https://business.facebook.com/events_manager2/',
  commerce: 'https://business.facebook.com/commerce/',
  developers: 'https://developers.facebook.com/apps/',
};

interface Chapter { id: string; title: string; icon: typeof Building2; body: ReactNode }

const CHAPTERS: Chapter[] = [
  {
    id: 'big-picture', title: 'The big picture: Meta\'s apps and tools', icon: LayoutGrid,
    body: (
      <>
        <P>Meta makes <B>apps people use</B> (Facebook, Instagram, WhatsApp, Messenger) and <B>tools businesses use</B> to run them. This CRM sits on the business side and talks to Meta for you.</P>
        <Figure label="Who talks to whom" caption="Customers use Meta's apps; your business manages them in its portfolio; this CRM connects with a token.">
          <Flow steps={[
            { icon: Users, title: 'Customers', text: 'Use Facebook, Instagram and WhatsApp on their phones.', tone: 'sky' },
            { icon: Globe, title: 'Meta', text: 'Shows your ads, delivers WhatsApp messages.', tone: 'violet' },
            { icon: Building2, title: 'Your business portfolio', text: 'Owns your Page, WhatsApp, Instagram and ad account.', tone: 'amber' },
            { icon: KeyRound, title: 'App + token', text: 'A key from your portfolio that lets software act for you.', tone: 'slate' },
            { icon: Inbox, title: 'This CRM', text: 'Your team chats, runs the bot, sees and creates ads.', tone: 'teal' },
          ]} />
        </Figure>
        <Figure label="Apps people use and tools businesses use">
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wide text-sky-700 mb-1">Apps people use</div>
              <div className="grid grid-cols-2 gap-1.5">
                <Node icon={Flag} title="Facebook" tone="sky" small />
                <Node icon={Camera} title="Instagram" tone="sky" small />
                <Node icon={MessageCircle} title="WhatsApp" tone="sky" small />
                <Node icon={Send} title="Messenger" tone="sky" small />
              </div>
            </div>
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wide text-amber-700 mb-1">Tools businesses use</div>
              <div className="grid grid-cols-2 gap-1.5">
                <Node icon={LayoutGrid} title="Business Suite" tone="amber" small />
                <Node icon={Building2} title="Business settings" tone="amber" small />
                <Node icon={Megaphone} title="Ads Manager" tone="amber" small />
                <Node icon={MessageCircle} title="WhatsApp Manager" tone="amber" small />
                <Node icon={BookA} title="Events Manager" tone="amber" small />
                <Node icon={Code2} title="Meta for Developers" tone="amber" small />
              </div>
            </div>
          </div>
        </Figure>
        <Table head={['Name', 'What it is', 'Where']} rows={[
          ['Facebook', 'The social network. Your business has a Page on it; ads are shown in the Page\'s name.', 'facebook.com'],
          ['Instagram', 'Photo and video app. A professional account can run and show ads.', 'instagram.com'],
          ['WhatsApp', 'Messaging. Customers chat with your business number.', 'Phone app'],
          ['Messenger', 'Facebook\'s chat. Messages to your Page arrive here.', 'Inside Facebook'],
          ['Meta Business Suite', 'One place to manage your Page, Instagram, messages, posts and settings. On phones it is the Meta Business Suite / "Meta Business" app.', <A key="b" href={LINKS.business}>business.facebook.com</A>],
          ['Business settings', 'The control room of your business portfolio: people, assets, partners, system users, security.', <A key="s" href={LINKS.settings}>Business settings</A>],
          ['Ads Manager', 'Create, run and measure ads; billing per ad account.', <A key="a" href={LINKS.adsManager}>Ads Manager</A>],
          ['WhatsApp Manager', 'Your WhatsApp Business Accounts: numbers, display names, message templates, quality, payment.', <A key="w" href={LINKS.waManager}>WhatsApp Manager</A>],
          ['Events Manager', 'Pixels and datasets: measure what happens after an ad (bookings, purchases). Uses the Conversions API.', <A key="e" href={LINKS.events}>Events Manager</A>],
          ['Commerce Manager', 'Catalogues of products or services for shops and catalogue ads.', <A key="c" href={LINKS.commerce}>Commerce Manager</A>],
          ['Meta for Developers', 'Where "apps" are made. An app connects software (like this CRM) to WhatsApp and the Marketing API.', <A key="d" href={LINKS.developers}>developers.facebook.com</A>],
          ['This CRM', 'Uses a token from your business to read and send WhatsApp messages and to read and create ads, so your team works in one place.', 'Here'],
        ]} />
      </>
    ),
  },
  {
    id: 'hierarchy', title: 'The hierarchy: person → portfolio → assets', icon: FolderTree,
    body: (
      <>
        <P>Everything in Meta hangs from a <B>person</B>: a real Facebook profile. A person creates or joins a <B>business portfolio</B> (Meta used to call it &quot;Business Manager&quot;). The portfolio owns the <B>business assets</B>.</P>
        <Figure label="The hierarchy, top to bottom" caption="Read it like a family tree: each box belongs to the one above it.">
          <OrgTree root={{
            icon: User, title: 'Person: Priya (personal Facebook profile)', text: 'Logs in with her own account. Never shared.', tone: 'sky',
            children: [{
              icon: Building2, title: 'Business portfolio: "Sunrise Clinic"', text: 'The company folder. It owns everything below.', tone: 'amber',
              children: [
                { icon: Users, title: 'People and system users', text: 'Who may work here, and with which role (chapters 4 and 6).', tone: 'slate' },
                { icon: Flag, title: 'Facebook Page: Sunrise Clinic', text: 'The public face. Ads run in its name.', tone: 'sky' },
                { icon: Camera, title: 'Instagram: @sunriseclinic', text: 'Connected to the Page.', tone: 'sky' },
                {
                  icon: MessageCircle, title: 'WhatsApp Business Account', text: 'Templates and message payment.', tone: 'emerald',
                  children: [
                    { icon: Smartphone, title: '+91 90000 00001 (reception)', tone: 'emerald' },
                    { icon: Smartphone, title: '+91 90000 00002 (pharmacy)', tone: 'emerald' },
                  ],
                },
                {
                  icon: Megaphone, title: 'Ad account: Sunrise Clinic Ads', text: 'Ads live here; its card or funds pay.', tone: 'violet',
                  children: [{ icon: Target, title: 'Campaigns → ad sets → ads', text: 'Chapter 10.', tone: 'violet' }],
                },
                { icon: Code2, title: 'Apps, datasets, catalogues', text: 'The app the CRM uses, measurement, product lists.', tone: 'slate' },
              ],
            }],
          }} />
        </Figure>
        <Note>A <B>Page is not a portfolio</B>: a Page can exist on its own, but belongs in a portfolio so the business (not one person) owns it.</Note>
      </>
    ),
  },
  {
    id: 'assets', title: 'What sits inside a business portfolio', icon: Building2,
    body: (
      <>
        <P>&quot;Assets&quot; are the things your portfolio <B>owns</B> (or is allowed to use). Each one has its own list of who can access it.</P>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2" aria-label="A business portfolio and what is inside it">
          <Node icon={Flag} title="Facebook Pages" text="The business's public page. Messages, posts, reviews; the name ads appear under." tone="sky" />
          <Node icon={Camera} title="Instagram accounts" text="Professional accounts. Connected to a Page so ads can show as the Instagram account." tone="sky" />
          <Node icon={MessageCircle} title="WhatsApp accounts (WABA)" text="Numbers, display names, templates, quality rating, message payment." tone="emerald" />
          <Node icon={Megaphone} title="Ad accounts" text="Campaigns and ads, with their own payment method and spending limit." tone="violet" />
          <Node icon={BookA} title="Datasets / pixels" text="Measure results (website visits, bookings). The CRM can send WhatsApp bookings back as conversions." tone="slate" />
          <Node icon={LayoutGrid} title="Catalogues" text="Products or services, for shop features and catalogue ads." tone="slate" />
          <Node icon={Code2} title="Apps" text="Developer apps (made in Meta for Developers) that connect software like this CRM." tone="slate" />
          <Node icon={Bot} title="System users" text="Non-human users for software; they hold the CRM's access token." tone="slate" />
          <Node icon={Handshake} title="Partners" text="Other businesses (e.g. your agency) you share assets with, or that share with you." tone="amber" />
        </div>
        <Figure label="Owned or shared" caption="An asset is owned by exactly one portfolio, but can be shared with others.">
          <Flow steps={[
            { icon: Building2, title: 'Owned by one portfolio', text: 'It decides who uses it and pays for it.', tone: 'amber' },
            { icon: Handshake, title: 'Shared with a partner', text: 'Another portfolio gets access, not ownership.', tone: 'sky' },
            { icon: Users, title: 'Assigned to people', text: 'Inside each portfolio, people get it with chosen tasks.', tone: 'teal' },
          ]} />
        </Figure>
      </>
    ),
  },
  {
    id: 'people-roles', title: 'People and their roles in the portfolio', icon: Users,
    body: (
      <>
        <P>Each person added to the portfolio gets a <B>portfolio role</B> (what they can do with the business itself) and then <B>access to specific assets</B> (chapter 5).</P>
        <Figure label="Portfolio roles, from most to least power" caption="Give the smallest role that lets someone do their job.">
          <RoleLadder rungs={[
            { title: 'Full control (formerly Admin)', text: 'Everything, incl. people, partners, tokens, deleting the portfolio', tone: 'rose', width: 100 },
            { title: 'Finance editor / analyst', text: 'Payment methods, invoices and billing (editor) or view only (analyst)', tone: 'amber', width: 82 },
            { title: 'Developer', text: 'Technical settings for integrations', tone: 'violet', width: 66 },
            { title: 'Partial / basic access (formerly Employee)', text: 'Only the assets and tasks they are given', tone: 'emerald', width: 52 },
          ]} />
        </Figure>
        <Figure label="Which role should I give?">
          <Decision items={[
            { q: 'Is it the owner, or someone you trust with the whole business?', yes: 'Full control (keep at least 2 people)', tone: 'rose' },
            { q: 'Do they only handle payments and invoices?', yes: 'Finance role', tone: 'amber' },
            { q: 'Do they build or connect software?', yes: 'Developer (+ a role on the app)', tone: 'violet' },
          ]} otherwise="Partial access: just the assets and tasks they need" />
        </Figure>
        <Figure label="Adding a person to the portfolio">
          <Flow steps={[
            { icon: Building2, title: 'Business settings → People', text: 'Press Add.', tone: 'amber' },
            { icon: UserPlus, title: 'Enter their email', text: 'Choose full control or partial access.', tone: 'sky' },
            { icon: ListChecks, title: 'Assign assets', text: 'Pick the Page, ad account… and the tasks.', tone: 'violet' },
            { icon: CheckCircle2, title: 'They accept the invite', text: 'Then the assets appear for them.', tone: 'emerald' },
          ]} />
        </Figure>
        <Table head={['Role (today)', 'Older name', 'What they can do']} rows={[
          ['Full control', 'Admin', 'Everything: add or remove people, partners and assets, change settings, generate system-user tokens, delete the portfolio. Keep at least two trusted people with full control.'],
          ['Partial / basic access', 'Employee', 'Only the assets they are given, with the tasks they are given. Cannot manage people or settings.'],
          ['Finance roles', 'Finance analyst / editor', 'See (analyst) or also manage (editor) payment methods, invoices and billing for the business.'],
          ['Developer', 'Developer', 'Can see technical settings needed to build integrations (in some portfolios).'],
        ]} />
        <Note>Some sensitive changes (like generating a token or adding a full-control person) may need <B>approval from another person with full control</B>. That is why Meta may show &quot;Someone else needs to approve&quot;.</Note>
      </>
    ),
  },
  {
    id: 'asset-access', title: 'Access to each asset (tasks)', icon: KeyRound,
    body: (
      <>
        <P>Access works in <B>two layers</B>: first the portfolio role, then for every asset <B>full control</B> or <B>partial access</B> with chosen <B>tasks</B>.</P>
        <Figure label="Two layers of access" caption="Example: Ravi can post and answer messages on the Page, but can't touch the ad account.">
          <OrgTree root={{
            icon: User, title: 'Ravi (partial access in the portfolio)', tone: 'sky',
            children: [
              { icon: Flag, title: 'Facebook Page: partial access', text: 'Tasks: Content ✓ · Messages ✓ · Ads ✗ · Insights ✓', tone: 'emerald' },
              { icon: MessageCircle, title: 'WhatsApp account: partial access', text: 'Tasks: Messages ✓ · Templates ✗', tone: 'emerald' },
              { icon: Megaphone, title: 'Ad account: not assigned', text: 'He doesn\'t see it in Ads Manager ("0 ad accounts").', tone: 'rose' },
            ],
          }} />
        </Figure>
        <Table head={['Asset', 'Tasks you can give (examples)', 'What this CRM needs']} rows={[
          ['Facebook Page', 'Content, Messages, Community activity, Ads (advertise for the Page), Insights, Leads', 'Ads: to create ads in the Page\'s name'],
          ['Instagram account', 'Content, Messages, Community activity, Ads, Insights', 'Ads: to show ads as the Instagram account'],
          ['Ad account', 'Manage campaigns, View performance, Manage the ad account (incl. billing)', 'View performance to read results; Manage campaigns to create, pause and edit ads'],
          ['WhatsApp account', 'Full control, or partial: messages, templates, phone numbers, insights', 'Full control for the CRM\'s system user'],
          ['Dataset / pixel', 'Manage events, View', 'Manage, only if you send bookings back to Meta'],
          ['Catalogue', 'Manage catalogue, Advertise', 'Not needed'],
        ]} />
        <Note>Giving someone <B>portfolio full control</B> doesn&apos;t automatically put every asset on their own screen. In Ads Manager, a person sees an ad account only when it is <B>assigned to them</B>. So &quot;0 ad accounts&quot; can just mean your own login isn&apos;t assigned yet.</Note>
      </>
    ),
  },
  {
    id: 'system-users', title: 'System users and access tokens', icon: Bot,
    body: (
      <>
        <P>A <B>system user</B> is a non-human user inside your portfolio, made for software. This CRM never logs in as a person: it uses an <B>access token</B> generated for a system user.</P>
        <Figure label="From system user to a working CRM" caption="The token can only reach the assets assigned in step 2.">
          <Flow steps={[
            { icon: Bot, title: 'Create a system user', text: 'Business settings → System users → Add "CRM" (Employee).', tone: 'slate' },
            { icon: ListChecks, title: 'Assign assets', text: 'Page, WhatsApp account(s), ad account, Instagram.', tone: 'violet' },
            { icon: KeyRound, title: 'Generate token', text: 'Your app + permissions, expiry "Never".', tone: 'amber' },
            { icon: ShieldCheck, title: 'Approval (if asked)', text: 'Another full-control person approves.', tone: 'rose' },
            { icon: Inbox, title: 'Paste in this CRM', text: 'WhatsApp page and Ads page.', tone: 'teal' },
          ]} />
        </Figure>
        <Table head={['Item', 'What it means']} rows={[
          ['Admin system user', 'Can manage all assets of the portfolio (like full control).'],
          ['Employee system user', 'Can use only the assets assigned to it, with the tasks given. Safer; usually enough for the CRM.'],
          ['Assigned assets', 'Pages, WhatsApp accounts, ad accounts, datasets… the system user may use. A token can only reach what is assigned.'],
          ['Access token', 'A long secret starting with "EAA…". Generated for one app, with chosen permissions (e.g. whatsapp_business_messaging, ads_management). Can be set to never expire.'],
          ['Permissions (scopes)', 'What the token may do: send WhatsApp messages, read ads, manage ads, read the business owner of an ad account (business_management).'],
        ]} />
        <Note><Lock className="w-3.5 h-3.5 inline -mt-0.5" /> Treat the token like a password. If it is ever shared by mistake, delete it in <A href={LINKS.systemUsers}>System users</A> and generate a new one.</Note>
      </>
    ),
  },
  {
    id: 'partners', title: 'Partners and agencies (shared assets)', icon: Handshake,
    body: (
      <>
        <P>Businesses often work with an <B>agency</B>. Meta lets portfolios <B>share</B> assets as <B>partners</B>, without handing over ownership.</P>
        <Figure label="Agency runs ads from its own ad account" caption="Ads show as your Page, but the agency's portfolio owns the ad account and its payment.">
          <TwoBoxes
            left={{ title: 'Your portfolio: Sunrise Clinic', tone: 'amber', items: ['Facebook Page (owned)', 'WhatsApp account (owned)', 'Instagram (owned)', 'Ad accounts: 0'] }}
            middle={['Page lets the agency advertise', 'Ads show as Sunrise Clinic']}
            right={{ title: 'Agency portfolio: BrightAds', tone: 'violet', items: ['Ad account "BrightAds – Sunrise" (owned)', 'Agency\'s card pays for ads', 'Agency staff and system users'] }}
          />
        </Figure>
        <Figure label="Recommended: you own the ad account and share it" caption="You keep ownership, payment and history; the agency gets access you can remove.">
          <TwoBoxes
            left={{ title: 'Your portfolio: Sunrise Clinic', tone: 'amber', items: ['Facebook Page', 'WhatsApp account', 'Ad account "Sunrise Clinic Ads" + your card'] }}
            middle={['Shared as partner', 'Access, not ownership']}
            right={{ title: 'Agency portfolio: BrightAds', tone: 'violet', items: ['Uses your ad account', 'Runs and reports your ads'] }}
          />
        </Figure>
        <Table head={['Situation', 'What it looks like', 'Who controls it']} rows={[
          ['Agency runs ads in its own ad account for your Page', 'Your Page allows the agency\'s ad account to advertise for it. The ad account shows "owned by: the agency".', 'The agency: payment method, who can use it, its history'],
          ['You share your ad account with the agency', 'Your portfolio owns it; the agency is listed as a partner with access.', 'You'],
          ['A person\'s own ("personal") ad account', 'Belongs to a Facebook profile, not to a portfolio.', 'That person'],
        ]} />
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <div className="font-semibold text-amber-900 flex items-center gap-1.5"><HelpCircle className="w-4 h-4" /> &quot;My portfolio shows 0 ad accounts, but my ads still show here. Why?&quot;</div>
          <P>Access in Meta is given <B>per ad account</B>, not per portfolio. This CRM reads one specific ad account (its ID is on the bar at the top of this page) with the token you pasted. That ad account can be <B>owned by another portfolio</B> (for example your agency&apos;s) or by <B>a person</B>, and still advertise for your Page, like the first picture above. The line under the account bar on this page shows who owns it. <B>The owner controls the payment method</B> and who may use it.</P>
        </div>
      </>
    ),
  },
  {
    id: 'developer-apps', title: 'Developer apps (Meta for Developers)', icon: Code2,
    body: (
      <>
        <P>An <B>app</B> is how software is allowed to talk to Meta. It is made at <A href={LINKS.developers}>developers.facebook.com</A> and belongs to your portfolio. The CRM&apos;s tokens are generated for this app.</P>
        <Figure label="How a WhatsApp message reaches this CRM" caption="The app secret proves the message really comes from Meta.">
          <Flow steps={[
            { icon: Smartphone, title: 'Customer sends a message', tone: 'sky' },
            { icon: Globe, title: 'Meta receives it', text: 'For your number, through your app.', tone: 'violet' },
            { icon: Send, title: 'Webhook call', text: 'Meta calls the CRM\'s address, signed with the app secret.', tone: 'amber' },
            { icon: Inbox, title: 'CRM inbox', text: 'Bot replies, or your team answers with the token.', tone: 'teal' },
          ]} />
        </Figure>
        <Table head={['Part', 'What it is']} rows={[
          ['App roles', 'Administrator, Developer, Tester: people who may change the app. Separate from portfolio roles.'],
          ['Use cases / products', 'What the app may use: "Connect with customers through WhatsApp", "Create & manage ads with Marketing API"…'],
          ['App mode', 'Development (only the app\'s people) or Live (real customers). WhatsApp for real customers needs Live.'],
          ['App secret', 'Signs the webhook messages Meta sends, so the CRM knows they really come from Meta. Never share it.'],
          ['Webhook', 'The address Meta calls when a customer messages you. Shown on this CRM\'s WhatsApp page.'],
          ['Access levels / App review', 'For your own business, standard access is usually enough. Serving other businesses needs Business verification and "Advanced access".'],
        ]} />
      </>
    ),
  },
  {
    id: 'whatsapp', title: 'WhatsApp for business', icon: MessageCircle,
    body: (
      <>
        <Figure label="Business app or Platform">
          <div className="grid sm:grid-cols-2 gap-2">
            <Node icon={Smartphone} title="WhatsApp Business app" text="On one phone. Chat by hand. Good for a very small shop." tone="slate" />
            <Node icon={Inbox} title="WhatsApp Business Platform (this CRM)" text="In a WhatsApp Business Account. Team inbox, bot, broadcasts, many users, ads tracking." tone="emerald" />
          </div>
        </Figure>
        <Figure label="A customer's journey from an ad to a booking" caption="Chats from Click-to-WhatsApp ads are free to answer for 72 hours.">
          <Flow steps={[
            { icon: Eye, title: 'Sees your ad', text: 'On Facebook, Instagram or Status.', tone: 'violet' },
            { icon: MousePointerClick, title: 'Taps "Send WhatsApp message"', tone: 'sky' },
            { icon: MessageCircle, title: 'Chat opens', text: 'With the number the ad opens.', tone: 'emerald' },
            { icon: Inbox, title: 'CRM inbox', text: 'Bot welcomes; your team answers.', tone: 'teal' },
            { icon: CalendarCheck, title: 'Booked', text: 'Optionally sent back to Meta as a result.', tone: 'amber' },
          ]} />
        </Figure>
        <ul className="mt-2 list-disc pl-5 space-y-1 leading-relaxed">
          <li><B>WABA → phone numbers:</B> one WhatsApp account can hold several numbers (reception, pharmacy). Each has a <B>display name</B> Meta approves.</li>
          <li><B>Message templates:</B> pre-approved messages. Outside 24 hours after the customer&apos;s last message, only templates can be sent.</li>
          <li><B>Quality rating and messaging limits:</B> start low and grow when customers don&apos;t block or report you.</li>
          <li><B>Payment for messages:</B> set on the WABA (WhatsApp Manager → payment), separate from the ad account&apos;s payment.</li>
          <li><B>Business verification</B> (Security Centre) unlocks higher limits and builds trust.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'ads', title: 'Ads: ad account → campaign → ad set → ads', icon: Megaphone,
    body: (
      <>
        <P>Think of a <B>campaign</B> as one event or offer, and the <B>ads</B> as the different posters for it. An ad never runs on its own: it sits inside a campaign and uses its money.</P>
        <Figure label="Campaign, ad set and ads example" caption="Three posters for one eye camp, sharing one budget.">
          <OrgTree root={{
            icon: Wallet, title: 'Ad account: Sunrise Clinic Ads', text: 'Who pays (card or prepaid funds).', tone: 'amber',
            children: [{
              icon: Target, title: 'Campaign: "Free Eye Camp – November"', text: 'The goal: get people to message us on WhatsApp.', tone: 'violet',
              children: [{
                icon: Users, title: 'Ad set: who, where, when, how much', text: 'City + 25 km · ages 30–65 · ₹1,000 a day · opens the reception number', tone: 'sky',
                children: [
                  { icon: ImageIcon, title: 'Ad 1: doctor photo', text: '"Free eye check-up this Sunday"', tone: 'emerald' },
                  { icon: ImageIcon, title: 'Ad 2: clinic photo', text: '"Book your free slot on WhatsApp"', tone: 'emerald' },
                  { icon: ImageIcon, title: 'Ad 3: in Telugu', text: 'The same offer', tone: 'emerald' },
                ],
              }],
            }],
          }} />
        </Figure>
        <ul className="mt-3 list-disc pl-5 space-y-1 leading-relaxed">
          <li>Ads in one ad set <B>share its budget</B>; Meta gives more to the ad that brings the most messages.</li>
          <li>On <B>Ad results</B>, <em>Ad campaigns</em> adds up its ads; <em>Ads</em> shows each poster. (Not the same as <em>Broadcast campaigns</em>, which are WhatsApp messages to your own contacts.)</li>
          <li><B>Pause</B> stops only that ad. <B>Budget</B> changes the ad set (or campaign), so it affects every ad in it.</li>
          <li><B>Create an ad</B> in this CRM makes one campaign, one ad set and one ad together.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'payments', title: 'Who pays for what', icon: Wallet,
    body: (
      <>
        <Figure label="How money flows for ads">
          <Flow steps={[
            { icon: CreditCard, title: 'Your card, UPI or prepaid funds', text: 'Saved on the ad account.', tone: 'amber' },
            { icon: Megaphone, title: 'Ads run', text: 'Within the budget and limits you set.', tone: 'violet' },
            { icon: Wallet, title: 'Meta charges what was spent', text: '+ 18% GST; at the billing threshold or monthly (or from prepaid funds).', tone: 'rose' },
            { icon: Receipt, title: 'Invoice', text: 'In Billing and payments.', tone: 'slate' },
          ]} />
        </Figure>
        <Figure label="How money flows for WhatsApp messages">
          <Flow steps={[
            { icon: CreditCard, title: 'Payment method on the WhatsApp account', text: 'Set in WhatsApp Manager.', tone: 'emerald' },
            { icon: Send, title: 'Template messages sent', text: 'Marketing, utility, authentication.', tone: 'sky' },
            { icon: Wallet, title: 'Meta charges per message', text: 'Replies within 24 h are free; ad chats free for 72 h.', tone: 'rose' },
          ]} />
        </Figure>
        <Table head={['Cost', 'Paid to', 'Set where']} rows={[
          ['Ads', 'Meta, from the ad account\'s payment method (prepaid funds or automatic card/UPI), plus 18% GST', <A key="b" href={LINKS.billing}>Billing and payments</A>],
          ['WhatsApp template messages (marketing, utility…)', 'Meta, from the WhatsApp account\'s payment method. Replies within 24 hours, and chats from Click-to-WhatsApp ads for 72 hours, are free', <A key="w" href={LINKS.waManager}>WhatsApp Manager</A>],
          ['This CRM', 'Your plan, separately', 'Your plan with the platform'],
        ]} />
      </>
    ),
  },
  {
    id: 'crm-roles', title: 'Meta\'s roles vs this CRM\'s roles', icon: ShieldCheck,
    body: (
      <>
        <P>The roles in this CRM are <B>separate</B> from Meta&apos;s. A Business Admin here doesn&apos;t need any access in Meta, and a Meta admin has no access here until invited.</P>
        <Figure label="Two separate worlds" caption="Only the token connects them; nobody's Meta login is used by the CRM.">
          <TwoBoxes
            left={{ title: 'In Meta (Business settings)', tone: 'violet', items: ['Full control / partial access', 'Asset tasks (Page, ad account…)', 'System user "CRM" + its token'] }}
            middle={['Token only']}
            right={{ title: 'In this CRM (Settings → Team)', tone: 'teal', items: ['Business Admin', 'Manager', 'Agent'] }}
          />
        </Figure>
        <Figure label="This CRM's roles, from most to least power">
          <RoleLadder rungs={[
            { title: 'Business Admin', text: 'Everything for your business: WhatsApp, team, bot, ads (connect, create, launch, edit, limits)', tone: 'rose', width: 100 },
            { title: 'Manager', text: 'Inbox, broadcasts, analytics, ad results and controls; settings mostly to view', tone: 'amber', width: 75 },
            { title: 'Agent', text: 'Inbox, pipeline, queries and own profile', tone: 'emerald', width: 52 },
          ]} />
        </Figure>
        <Table head={['Role in this CRM', 'Can do']} rows={[
          ['Business Admin', 'Everything for your business here: WhatsApp connection, team, bot, ads (connect, create, launch, edit, spending limits), settings.'],
          ['Manager', 'Inbox, broadcasts, analytics, ads results and controls, settings to view; no WhatsApp or ad-account connection changes.'],
          ['Agent', 'Inbox, pipeline, queries and their own profile only.'],
          ['Platform Admin', 'Runs the platform (plans, businesses). Never sees your chats or customers.'],
        ]} />
      </>
    ),
  },
  {
    id: 'checklist', title: 'Recommended setup checklist', icon: CheckCircle2,
    body: (
      <>
        <Figure label="A clean setup in six steps">
          <Flow steps={[
            { icon: Building2, title: 'One portfolio', text: '2+ people with full control.', tone: 'amber' },
            { icon: FolderTree, title: 'It owns your assets', text: 'Page, Instagram, WhatsApp, ad account.', tone: 'violet' },
            { icon: CreditCard, title: 'Payment methods', text: 'Ad account and WhatsApp account.', tone: 'rose' },
            { icon: ShieldCheck, title: 'Verify the business', text: 'Security Centre.', tone: 'sky' },
            { icon: Bot, title: 'System user + token', text: 'Assigned all the assets.', tone: 'slate' },
            { icon: Inbox, title: 'Connect this CRM', text: 'WhatsApp page and Ads page.', tone: 'teal' },
          ]} />
        </Figure>
        <Steps items={[
          <>Create (or use) <B>one business portfolio</B> for your business, with at least two people with full control.</>,
          <>Make sure the portfolio <B>owns</B> your Facebook Page, Instagram account, WhatsApp account and <B>ad account</B> (<A href={LINKS.adAccounts}>Ad accounts</A> → Add, or create a new one).</>,
          <>Add payment methods: on the ad account (for ads) and on the WhatsApp account (for template messages).</>,
          <>Verify your business in the <A href={LINKS.security}>Security Centre</A>.</>,
          <>Create an Employee <B>system user</B> &quot;CRM&quot;, assign it the Page, Instagram, WhatsApp account(s) and ad account, then generate a never-expiring token for your app.</>,
          <>If an agency helps you, share assets with it as a <A href={LINKS.partners}>partner</A>, rather than running everything from the agency&apos;s own accounts.</>,
          <>Make your Click-to-WhatsApp ads open a number connected to this CRM, so their chats arrive here. Each ad card shows which number it opens.</>,
        ]} />
      </>
    ),
  },
  {
    id: 'glossary', title: 'Glossary', icon: BookOpen,
    body: (
      <Table head={['Word', 'Meaning']} rows={[
        ['Business portfolio', 'Your company\'s folder in Meta (formerly Business Manager).'],
        ['Asset', 'Anything a portfolio owns or uses: Page, Instagram, WhatsApp account, ad account, dataset, catalogue, app.'],
        ['WABA', 'WhatsApp Business Account: holds your business numbers.'],
        ['Phone number ID', 'Meta\'s ID for one WhatsApp number (not the phone number itself).'],
        ['System user', 'A non-human user for software; holds the CRM\'s token.'],
        ['Access token', 'The secret key software uses to act for your business.'],
        ['Partner', 'Another business you share assets with (e.g. an agency).'],
        ['Ad account ID', 'act_ followed by digits; shown in Ads Manager and on this page.'],
        ['Campaign / ad set / ad', 'Goal / audience + budget + schedule / what people see.'],
        ['Click-to-WhatsApp ad', 'An ad whose button opens a WhatsApp chat with your number.'],
        ['Dataset / pixel', 'Measures results after an ad; the Conversions API sends events to it.'],
        ['Template', 'A message Meta approved in advance, needed outside the 24-hour window.'],
        ['Business verification', 'Proving your business is real to Meta; unlocks limits and features.'],
      ]} />
    ),
  },
];

export default function MetaOrgGuide({ defaultOpen = true }: { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [openChapters, setOpenChapters] = useState<Set<string>>(() => new Set([CHAPTERS[0].id]));
  const toggle = (id: string) => setOpenChapters(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const jump = (id: string) => {
    setOpenChapters(s => new Set(s).add(id));
    setTimeout(() => document.getElementById(`org-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30);
  };
  const allOpen = openChapters.size === CHAPTERS.length;
  return (
    <section className="bg-white border border-teal-200 rounded-xl overflow-hidden" data-testid="meta-org-guide">
      <button onClick={() => setOpen(o => !o)} aria-expanded={open} className="w-full flex items-center gap-2 px-4 py-3 text-left cursor-pointer hover:bg-teal-50/40">
        <BookOpen className="w-4 h-4 text-wa-teal" />
        <span className="text-sm font-semibold text-slate-800 flex-1">How Meta is organised: a short illustrated booklet (apps, portfolio, roles, system users, WhatsApp, ads, payments)</span>
        <ChevronDown className={`w-4 h-4 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-4 pb-5 text-xs text-slate-700 border-t border-teal-100 pt-4 space-y-4">
          <p className="leading-relaxed">Everything you need to know about Meta&apos;s side of things, in plain words and pictures: what each app and tool is, how a business is organised, who can do what, and how this CRM connects to it. The examples use a made-up business, &quot;Sunrise Clinic&quot;. Meta renames menus from time to time; names here are as of late 2026.</p>
          <nav aria-label="Booklet contents" className="rounded-lg bg-slate-50 border border-slate-200 p-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="font-bold text-slate-800">Contents</span>
              <button onClick={() => setOpenChapters(allOpen ? new Set() : new Set(CHAPTERS.map(c => c.id)))} className="ml-auto text-wa-teal font-semibold hover:underline cursor-pointer">{allOpen ? 'Close all' : 'Open all'}</button>
            </div>
            <ol className="grid sm:grid-cols-2 gap-x-4 gap-y-1">
              {CHAPTERS.map((c, i) => (
                <li key={c.id}><button onClick={() => jump(c.id)} className="text-left hover:text-wa-teal cursor-pointer"><span className="text-slate-400 mr-1">{i + 1}.</span>{c.title}</button></li>
              ))}
            </ol>
          </nav>
          <div className="space-y-2">
            {CHAPTERS.map((c, i) => {
              const on = openChapters.has(c.id);
              const Icon = c.icon;
              return (
                <div key={c.id} id={`org-${c.id}`} className="rounded-lg border border-slate-200 scroll-mt-28" data-testid={`org-chapter-${c.id}`}>
                  <button onClick={() => toggle(c.id)} aria-expanded={on} className="w-full flex items-center gap-2 px-3 py-2 text-left cursor-pointer hover:bg-slate-50">
                    <span className="w-6 h-6 rounded-full bg-teal-100 text-wa-teal text-[11px] font-bold flex items-center justify-center flex-shrink-0">{i + 1}</span>
                    <Icon className="w-4 h-4 text-slate-500" />
                    <span className="font-semibold text-slate-800 text-sm flex-1">{c.title}</span>
                    <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${on ? 'rotate-180' : ''}`} />
                  </button>
                  {on && <div className="px-3 pb-3 pt-1 space-y-2 leading-relaxed">{c.body}</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

// ---- Small text building blocks (diagrams are in src/guideVisuals.tsx) ----
function P({ children }: { children: ReactNode }) { return <p className="leading-relaxed">{children}</p>; }
function B({ children }: { children: ReactNode }) { return <strong className="text-slate-900">{children}</strong>; }
function Note({ children }: { children: ReactNode }) { return <p className="rounded-lg bg-sky-50 border border-sky-200 p-2 text-sky-900 leading-relaxed">{children}</p>; }
function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead><tr>{head.map(h => <th key={h} className="border-b border-slate-200 bg-slate-50 px-2 py-1.5 font-semibold text-slate-700 whitespace-nowrap">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="align-top">{r.map((c, j) => <td key={j} className={`border-b border-slate-100 px-2 py-1.5 ${j === 0 ? 'font-semibold text-slate-800 whitespace-nowrap' : ''}`}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
function Steps({ items }: { items: ReactNode[] }) {
  return <ol className="list-decimal pl-5 space-y-1 leading-relaxed">{items.map((it, i) => <li key={i}>{it}</li>)}</ol>;
}
function A({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} target="_blank" rel="noreferrer" className="font-semibold text-wa-teal hover:underline inline-flex items-center gap-0.5">{children} <ExternalLink className="w-3 h-3" /></a>;
}
