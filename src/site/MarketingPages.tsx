import { useEffect, useState, type ReactNode } from 'react';
import {
  MessagesSquare, Bot, Megaphone, Repeat, KanbanSquare, Target, PhoneCall, BarChart3, ShieldCheck, Users, Smartphone, Ticket,
  Sparkles, Stethoscope, UtensilsCrossed, Store, Briefcase, Check, ArrowRight, Mail, Phone, Clock, MapPin, Lock, ChevronDown,
} from 'lucide-react';
import { useBranding } from '../branding';
import { Container, SectionTitle, PrimaryButton, SecondaryButton, Link } from './SiteUi';

// The public marketing pages: Landing (/), Features (/features), Pricing (/pricing), Contact (/contact).
// Everything described here exists in the product today; keep it that way when features change.

const FEATURES: Array<{ icon: typeof Bot; title: string; text: string }> = [
  { icon: MessagesSquare, title: 'Shared team inbox', text: 'Your whole team answers from one WhatsApp number at the same time. Each chat has an owner, notes and tags, so two people never reply to the same customer.' },
  { icon: Bot, title: 'No-code WhatsApp bot', text: 'A welcome menu, your services list and Book / Enquire buttons, built on one page with a live phone preview. Keyword replies for common questions.' },
  { icon: Sparkles, title: 'AI replies (optional)', text: 'Let AI answer typed questions from your own information, and hand over to a person when needed. You choose the AI provider; health and price claims are blocked.' },
  { icon: Megaphone, title: 'Broadcasts', text: 'Send approved WhatsApp templates to chosen customers, and see who received, read and replied. Customers who reply STOP are unsubscribed automatically.' },
  { icon: Repeat, title: 'Automatic follow-ups', text: 'Follow up after an enquiry, a missed booking or a quiet spell, only inside your business hours.' },
  { icon: KanbanSquare, title: 'Sales pipeline', text: 'Every contact moves from New enquiry to Booked and Completed, automatically from the bot and by your team.' },
  { icon: Ticket, title: 'Queries and complaints', text: 'Customers raise a query on WhatsApp and get a reference number; your team tracks it until it is solved.' },
  { icon: Target, title: 'Click-to-WhatsApp ads', text: 'See what each Facebook and Instagram ad cost and how many chats and bookings it brought. Create simple ads, pause costly ones automatically.' },
  { icon: PhoneCall, title: 'WhatsApp calls in the browser', text: 'Answer customers\' WhatsApp voice calls from the dashboard, with recordings your managers can review.' },
  { icon: Smartphone, title: 'Several WhatsApp numbers', text: 'Reception, pharmacy, branches: all numbers in one inbox, with replies going out from the number the customer wrote to.' },
  { icon: BarChart3, title: 'Analytics', text: 'Leads per day and source, busy hours, response times, conversions and results per team member.' },
  { icon: Users, title: 'Roles for your team', text: 'Business Admin, managers and agents. Agents see only their inbox, pipeline and queries.' },
];

const INDUSTRIES: Array<{ icon: typeof Bot; title: string; text: string }> = [
  { icon: Stethoscope, title: 'Hospitals and clinics', text: 'Appointment enquiries, reports, call-backs and patient queries, with call recordings and a clear owner for every chat.' },
  { icon: UtensilsCrossed, title: 'Food and restaurants', text: 'Menus, orders and delivery questions answered instantly by the bot; offers sent as broadcasts.' },
  { icon: Store, title: 'Shops and e-commerce', text: 'Product questions, order status and repeat customers, with follow-ups that bring them back.' },
  { icon: Briefcase, title: 'Services', text: 'Salons, coaching, travel and more: bookings, reminders and a pipeline for every lead.' },
];

const FAQ: Array<[string, string]> = [
  ['Is this the official WhatsApp Business Platform?', 'Yes. Each business connects its own number through Meta\'s official WhatsApp Business Platform (Cloud API). We guide you through the Meta setup step by step.'],
  ['Can I keep using my number on the WhatsApp app?', 'Usually a number is moved from the app to the platform. For some WhatsApp Business app numbers Meta offers "coexistence" (app and platform together). We help you choose before you switch.'],
  ['Who pays for WhatsApp messages?', 'Meta charges your WhatsApp Business Account directly for template messages (marketing costs more than utility). Replies to customers within 24 hours of their last message are free. Our plan price is separate.'],
  ['Who can see my customers\' chats?', 'Only your own team, by their role. Our platform administrators see counts and usage for support and billing, never your chats or customer details.'],
  ['Is my data safe?', 'Access tokens and secrets are stored encrypted, every business\'s data is kept separate at the database level, and important actions are recorded in an audit log. See our Privacy Policy for details, including your rights under India\'s DPDP Act, 2023.'],
  ['How do I get started?', 'Send a sign-up request. We contact you within 1–2 working days, set up your account on the right plan and help you connect your WhatsApp number.'],
];

function Hero() {
  const SITE = useBranding();
  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-emerald-50 via-white to-white">
      <Container className="pt-14 pb-16 sm:pt-20 sm:pb-24 grid lg:grid-cols-2 gap-12 items-center">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 text-emerald-800 text-xs font-semibold px-3 py-1">
            <ShieldCheck className="w-3.5 h-3.5" /> Built on the official WhatsApp Business Platform
          </span>
          <h1 className="mt-5 text-4xl sm:text-5xl font-extrabold tracking-tight text-slate-900 leading-[1.1]">
            Every WhatsApp conversation of your business, <span className="text-emerald-600">in one place</span>.
          </h1>
          <p className="mt-5 text-lg text-slate-600 leading-relaxed">
            {SITE.brandName} gives your team a shared WhatsApp inbox, a bot that answers instantly, broadcasts, follow-ups and the results of your
            Click-to-WhatsApp ads, so no enquiry is missed and every lead is followed up.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <PrimaryButton to="/signup">Get started <ArrowRight className="w-4 h-4" /></PrimaryButton>
            <SecondaryButton to="/pricing">See pricing</SecondaryButton>
          </div>
          <p className="mt-4 text-sm text-slate-500">For hospitals, restaurants, shops and service businesses across India.</p>
        </div>
        <ProductMock />
      </Container>
    </section>
  );
}

/** A simple drawing of the product (no screenshots of real customers). */
function ProductMock() {
  const chats: Array<[string, string, string, boolean]> = [
    ['Priya S.', 'Can I book a check-up for Saturday?', 'New enquiry', true],
    ['Rahul K.', 'Thanks, the order arrived!', 'Completed', false],
    ['Anita M.', 'What are your timings?', 'Bot replied', false],
    ['Vikram R.', 'Is the offer still on?', 'In discussion', false],
  ];
  return (
    <div className="relative" aria-hidden>
      <div className="absolute -inset-6 bg-emerald-200/40 blur-3xl rounded-full" />
      <div className="relative rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden">
        <div className="flex items-center gap-1.5 px-4 py-2.5 bg-slate-50 border-b border-slate-200">
          <span className="w-2.5 h-2.5 rounded-full bg-rose-300" /><span className="w-2.5 h-2.5 rounded-full bg-amber-300" /><span className="w-2.5 h-2.5 rounded-full bg-emerald-300" />
          <span className="ml-3 text-xs text-slate-500 font-medium">Team inbox</span>
        </div>
        <div className="grid grid-cols-5">
          <ul className="col-span-2 border-r border-slate-100 divide-y divide-slate-100">
            {chats.map(([name, msg, tag, active]) => (
              <li key={name} className={`px-3 py-2.5 ${active ? 'bg-emerald-50' : ''}`}>
                <div className="text-xs font-bold text-slate-800">{name}</div>
                <div className="text-[11px] text-slate-500 truncate">{msg}</div>
                <span className="mt-1 inline-block text-[9px] font-semibold px-1.5 py-px rounded bg-slate-100 text-slate-600">{tag}</span>
              </li>
            ))}
          </ul>
          <div className="col-span-3 bg-[#efeae2] p-3 space-y-2 text-[11px]">
            <div className="flex justify-start"><div className="bg-white rounded-lg px-2.5 py-1.5 shadow-sm max-w-[85%]">Can I book a check-up for Saturday?</div></div>
            <div className="flex justify-end"><div className="bg-[#d9fdd3] rounded-lg px-2.5 py-1.5 shadow-sm max-w-[85%]">Welcome! 👋 Tap an option below:<div className="mt-1.5 border-t border-emerald-200 pt-1 text-sky-700 font-semibold text-center">📅 Book a visit</div></div></div>
            <div className="flex justify-end"><div className="bg-[#d9fdd3] rounded-lg px-2.5 py-1.5 shadow-sm max-w-[85%]">Saturday 10:30 is free. Shall I confirm it? <span className="text-[9px] text-slate-500">– Asha (team)</span></div></div>
            <div className="flex justify-center"><span className="text-[9px] bg-amber-50 border border-amber-200 text-amber-900 rounded px-1.5 py-0.5">Moved to Booked · follow-up set</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}

function FeatureGrid({ items }: { items: typeof FEATURES }) {
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
      {items.map(({ icon: Icon, title, text }) => (
        <div key={title} className="rounded-2xl border border-slate-200 bg-white p-5 hover:shadow-md transition">
          <span className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center"><Icon className="w-5 h-5" /></span>
          <h3 className="mt-3 font-bold text-slate-900">{title}</h3>
          <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">{text}</p>
        </div>
      ))}
    </div>
  );
}

function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="max-w-3xl mx-auto divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
      {FAQ.map(([q, a], i) => (
        <div key={q}>
          <button onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i} className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left font-semibold text-slate-900 cursor-pointer">
            {q}<ChevronDown className={`w-4 h-4 text-slate-400 flex-shrink-0 transition-transform ${open === i ? 'rotate-180' : ''}`} />
          </button>
          {open === i && <p className="px-5 pb-4 -mt-1 text-sm text-slate-600 leading-relaxed">{a}</p>}
        </div>
      ))}
    </div>
  );
}

function CtaBand() {
  return (
    <section className="py-16">
      <Container>
        <div className="rounded-3xl bg-gradient-to-br from-emerald-600 to-teal-700 text-white px-6 py-12 sm:px-12 text-center">
          <h2 className="text-2xl sm:text-3xl font-extrabold">Ready to answer every customer on time?</h2>
          <p className="mt-3 text-emerald-50 max-w-xl mx-auto">Send a sign-up request: we set up your account and help you connect your WhatsApp number.</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link to="/signup" className="inline-flex items-center gap-2 rounded-xl bg-white text-emerald-700 font-semibold px-5 py-3 hover:bg-emerald-50 transition">Get started <ArrowRight className="w-4 h-4" /></Link>
            <Link to="/contact" className="inline-flex items-center gap-2 rounded-xl border border-white/40 text-white font-semibold px-5 py-3 hover:bg-white/10 transition">Talk to us</Link>
          </div>
        </div>
      </Container>
    </section>
  );
}

export function LandingPage() {
  return (
    <>
      <Hero />
      <section className="py-16 sm:py-20" id="features">
        <Container>
          <SectionTitle eyebrow="Everything in one place" title="Built for teams that sell and serve on WhatsApp" text="From the first 'hi' to the booking and the follow-up, without anyone keeping a phone online." />
          <FeatureGrid items={FEATURES.slice(0, 6)} />
          <div className="text-center mt-8"><SecondaryButton to="/features">See all features <ArrowRight className="w-4 h-4" /></SecondaryButton></div>
        </Container>
      </section>

      <section className="py-16 bg-slate-50 border-y border-slate-200">
        <Container>
          <SectionTitle eyebrow="How it works" title="Up and running in three steps" />
          <ol className="grid md:grid-cols-3 gap-6">
            {[
              ['Send a sign-up request', 'Tell us about your business. We contact you within 1–2 working days and set up your account on the right plan.'],
              ['Connect your WhatsApp number', 'Our step-by-step guide covers the Meta setup: your number, the webhook and a permanent access token.'],
              ['Set up your bot and team', 'Build your welcome menu on one page, add your team with their roles, and start answering.'],
            ].map(([title, text], i) => (
              <li key={title} className="rounded-2xl bg-white border border-slate-200 p-6">
                <span className="w-9 h-9 rounded-full bg-emerald-600 text-white font-bold flex items-center justify-center">{i + 1}</span>
                <h3 className="mt-3 font-bold text-slate-900">{title}</h3>
                <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">{text}</p>
              </li>
            ))}
          </ol>
        </Container>
      </section>

      <section className="py-16 sm:py-20">
        <Container>
          <SectionTitle eyebrow="Made for your business" title="One platform, many kinds of businesses" />
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {INDUSTRIES.map(({ icon: Icon, title, text }) => (
              <div key={title} className="rounded-2xl border border-slate-200 p-5">
                <Icon className="w-6 h-6 text-emerald-600" />
                <h3 className="mt-3 font-bold text-slate-900">{title}</h3>
                <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">{text}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <section className="py-16 bg-slate-900 text-white">
        <Container className="grid md:grid-cols-2 gap-10 items-center">
          <div>
            <div className="text-xs font-bold uppercase tracking-widest text-emerald-400 mb-2">Privacy and security</div>
            <h2 className="text-2xl sm:text-3xl font-extrabold">Your customers&apos; data stays yours</h2>
            <p className="mt-3 text-slate-300 leading-relaxed">We process your customers&apos; data only to run the service for you, in line with India&apos;s Digital Personal Data Protection Act, 2023.</p>
            <div className="mt-5"><Link to="/privacy" className="text-emerald-400 font-semibold hover:underline">Read our Privacy Policy →</Link></div>
          </div>
          <ul className="space-y-3">
            {[
              'Each business\'s data is kept separate at the database level.',
              'Access tokens and secrets are stored encrypted, and never shown again.',
              'Platform staff see counts and usage only, never your chats.',
              'Customers who reply STOP stop getting broadcasts automatically.',
              'Important changes are recorded in an audit log.',
            ].map(t => <li key={t} className="flex gap-2.5"><Lock className="w-5 h-5 text-emerald-400 flex-shrink-0" /><span className="text-slate-200">{t}</span></li>)}
          </ul>
        </Container>
      </section>

      <section className="py-16 sm:py-20">
        <Container>
          <SectionTitle eyebrow="Questions" title="Frequently asked questions" />
          <Faq />
        </Container>
      </section>
      <CtaBand />
    </>
  );
}

export function FeaturesPage() {
  const SITE = useBranding();
  return (
    <>
      <section className="bg-gradient-to-b from-emerald-50 to-white py-14">
        <Container>
          <SectionTitle eyebrow="Features" title={`What you get with ${SITE.brandName}`} text="Everything your team needs to answer, sell and follow up on WhatsApp, in one dashboard." />
        </Container>
      </section>
      <section className="pb-16">
        <Container><FeatureGrid items={FEATURES} /></Container>
      </section>
      <section className="py-14 bg-slate-50 border-y border-slate-200">
        <Container className="grid md:grid-cols-3 gap-6 text-sm">
          {[
            ['WhatsApp rules built in', 'The 24-hour rule (free replies, templates after that), opt-outs (STOP/START) and sending only within your business hours are handled for you.'],
            ['Guided Meta setup', 'Step-by-step guides on every setup page: your number, webhook, tokens, ad account and Page links, in plain words.'],
            ['Plans that grow with you', 'Start small and move up as your team, contacts and broadcasts grow. Limits are shown in your dashboard before you reach them.'],
          ].map(([t, x]) => <div key={t} className="rounded-2xl bg-white border border-slate-200 p-5"><h3 className="font-bold text-slate-900">{t}</h3><p className="mt-1.5 text-slate-600 leading-relaxed">{x}</p></div>)}
        </Container>
      </section>
      <CtaBand />
    </>
  );
}

interface PublicPlan {
  id: string; name: string; priceMonthlyInr: number; aiEnabled: boolean; adsEnabled: boolean;
  limits: { staff: number | null; contacts: number | null; broadcastsMonth: number | null; automations: number | null; aiRepliesMonth: number | null; keywordRules: number | null; analyticsDays: number | null; whatsappNumbers: number | null };
}
const fmt = (n: number | null | undefined, unit = '') => (n == null ? 'Unlimited' : `${n.toLocaleString('en-IN')}${unit}`);

export function PricingPage() {
  const [plans, setPlans] = useState<PublicPlan[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let off = false;
    fetch('/api/public/plans').then(r => (r.ok ? r.json() : Promise.reject(new Error('plans'))))
      .then((d: { plans?: PublicPlan[] }) => { if (!off) setPlans((d.plans || []).map(p => ({ ...p, limits: { ...p.limits } }))); })
      .catch(() => { if (!off) setFailed(true); });
    return () => { off = true; };
  }, []);
  const popular = plans && plans.length >= 2 ? plans[1].id : null;
  return (
    <>
      <section className="bg-gradient-to-b from-emerald-50 to-white py-14">
        <Container><SectionTitle eyebrow="Pricing" title="Simple plans, no surprises" text="Pick a plan for your team today and change it any time. Prices are per business, per month." /></Container>
      </section>
      <section className="pb-12">
        <Container>
          {!plans && !failed && <p className="text-center text-slate-500">Loading plans…</p>}
          {failed && <p className="text-center text-slate-600">Plans could not be loaded just now. <Link to="/contact" className="text-emerald-700 font-semibold">Contact us</Link> for prices.</p>}
          {plans && (
            <div className={`grid gap-6 ${plans.length >= 3 ? 'lg:grid-cols-3' : 'md:grid-cols-2'}`} data-testid="pricing-plans">
              {plans.map(p => (
                <div key={p.id} className={`relative rounded-2xl border bg-white p-6 flex flex-col ${p.id === popular ? 'border-emerald-500 shadow-xl' : 'border-slate-200'}`}>
                  {p.id === popular && <span className="absolute -top-3 left-6 text-[11px] font-bold uppercase tracking-wide bg-emerald-600 text-white rounded-full px-2.5 py-0.5">Most popular</span>}
                  <h3 className="text-lg font-bold text-slate-900">{p.name}</h3>
                  <div className="mt-2">
                    {p.priceMonthlyInr > 0
                      ? <><span className="text-3xl font-extrabold text-slate-900">₹{p.priceMonthlyInr.toLocaleString('en-IN')}</span><span className="text-slate-500"> / month + GST</span></>
                      : <span className="text-2xl font-extrabold text-slate-900">Talk to us</span>}
                  </div>
                  <ul className="mt-5 space-y-2 text-sm text-slate-700 flex-1">
                    <PlanLine>{fmt(p.limits.staff)} team members</PlanLine>
                    <PlanLine>{fmt(p.limits.whatsappNumbers)} WhatsApp number{p.limits.whatsappNumbers === 1 ? '' : 's'}</PlanLine>
                    <PlanLine>{fmt(p.limits.contacts)} contacts</PlanLine>
                    <PlanLine>{fmt(p.limits.broadcastsMonth)} broadcast messages a month</PlanLine>
                    <PlanLine>{fmt(p.limits.automations)} active follow-ups</PlanLine>
                    <PlanLine>{fmt(p.limits.keywordRules)} keyword replies</PlanLine>
                    <PlanLine>{p.limits.analyticsDays == null ? 'Full' : `${p.limits.analyticsDays} days of`} analytics history</PlanLine>
                    <PlanLine off={!p.aiEnabled}>{p.aiEnabled ? `AI replies (${fmt(p.limits.aiRepliesMonth)} a month)` : 'AI replies'}</PlanLine>
                    <PlanLine off={!p.adsEnabled}>Click-to-WhatsApp ads module</PlanLine>
                  </ul>
                  <div className="mt-6"><Link to={`/signup?plan=${encodeURIComponent(p.id)}`} className={`block text-center rounded-xl font-semibold px-4 py-2.5 transition ${p.id === popular ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'border border-slate-300 text-slate-800 hover:bg-slate-50'}`}>Choose {p.name}</Link></div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-10 max-w-3xl mx-auto rounded-2xl bg-slate-50 border border-slate-200 p-5 text-sm text-slate-600 space-y-1.5">
            <p><strong className="text-slate-800">WhatsApp message charges are separate.</strong> Meta bills your WhatsApp Business Account directly for template messages (marketing, utility, authentication). Replies within 24 hours of a customer&apos;s message are free.</p>
            <p>Ad spend for Click-to-WhatsApp ads is paid to Meta from your own ad account. AI usage, if switched on, uses your own AI provider key.</p>
            <p>See our <Link to="/refund-policy" className="text-emerald-700 font-semibold">Cancellation and Refund Policy</Link>.</p>
          </div>
        </Container>
      </section>
      <CtaBand />
    </>
  );
}

function PlanLine({ children, off = false }: { children: ReactNode; off?: boolean }) {
  return <li className={`flex gap-2 ${off ? 'text-slate-400 line-through' : ''}`}><Check className={`w-4 h-4 flex-shrink-0 mt-0.5 ${off ? 'text-slate-300' : 'text-emerald-600'}`} />{children}</li>;
}

export function ContactPage() {
  const SITE = useBranding();
  const rows: Array<[typeof Mail, string, ReactNode]> = [
    [Mail, 'Sales', <a key="s" href={`mailto:${SITE.salesEmail}`} className="text-emerald-700 font-semibold">{SITE.salesEmail}</a>],
    [Mail, 'Support (existing customers)', <a key="u" href={`mailto:${SITE.supportEmail}`} className="text-emerald-700 font-semibold">{SITE.supportEmail}</a>],
    [Phone, 'Phone', SITE.phone],
    [Clock, 'Hours', SITE.supportHours],
    [MapPin, 'Address', <span key="a">{SITE.companyName}<br />{SITE.companyAddress}</span>],
  ];
  return (
    <>
      <section className="bg-gradient-to-b from-emerald-50 to-white py-14">
        <Container><SectionTitle eyebrow="Contact" title="Talk to us" text="Questions about plans, setup or your account? We usually reply within one working day." /></Container>
      </section>
      <section className="pb-16">
        <Container className="grid md:grid-cols-2 gap-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-6">
            <ul className="space-y-4">
              {rows.map(([Icon, label, value]) => (
                <li key={label} className="flex gap-3"><Icon className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" /><div><div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</div><div className="text-slate-800">{value}</div></div></li>
              ))}
            </ul>
          </div>
          <div className="space-y-4">
            <div className="rounded-2xl bg-emerald-600 text-white p-6">
              <h3 className="text-lg font-bold">New to {SITE.brandName}?</h3>
              <p className="mt-1.5 text-emerald-50">Send a sign-up request and we&apos;ll set up your account and help you connect WhatsApp.</p>
              <div className="mt-4"><Link to="/signup" className="inline-flex items-center gap-2 rounded-xl bg-white text-emerald-700 font-semibold px-4 py-2.5">Get started <ArrowRight className="w-4 h-4" /></Link></div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
              <h3 className="font-bold text-slate-900">Grievance Officer</h3>
              <p className="mt-1.5">For privacy requests and complaints under the DPDP Act, 2023: <strong className="text-slate-800">{SITE.grievanceOfficerName}</strong>, <a href={`mailto:${SITE.grievanceOfficerEmail}`} className="text-emerald-700 font-semibold">{SITE.grievanceOfficerEmail}</a>. See the <Link to="/privacy" className="text-emerald-700 font-semibold">Privacy Policy</Link>.</p>
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}
