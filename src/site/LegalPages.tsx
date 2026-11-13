import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useBranding, isDraft, isPlaceholder } from '../branding';
import { Container, Link } from './SiteUi';

// Privacy Policy (/privacy), Terms and Conditions (/terms), Cancellation and Refund Policy (/refund-policy) and
// Data Deletion instructions (/data-deletion, the URL Meta asks for). Company details come from the Platform
// Admin's Branding tab (useBranding; defaults in siteConfig.ts).
// The facts here must match the product (retention periods, who sees what, processors); update both together.
// These are a starting point written for the product: have them reviewed by a lawyer before relying on them.

function Legal({ title, intro, sections }: { title: string; intro: ReactNode; sections: Array<[string, string, ReactNode]> }) {
  const SITE = useBranding();
  const SITE_IS_DRAFT = isDraft(SITE);
  return (
    <section className="py-12">
      <Container>
        <div className="grid lg:grid-cols-[220px_1fr] gap-10">
          <nav aria-label="On this page" className="hidden lg:block">
            <div className="sticky top-24 text-sm">
              <div className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">On this page</div>
              <ol className="space-y-1.5">
                {sections.map(([id, heading]) => <li key={id}><a href={`#${id}`} className="text-slate-600 hover:text-emerald-700">{heading}</a></li>)}
              </ol>
            </div>
          </nav>
          <article className="max-w-3xl">
            {SITE_IS_DRAFT && (
              <div role="note" data-testid="legal-draft" className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 flex gap-2">
                <AlertTriangle className="w-5 h-5 flex-shrink-0" />
                <span><strong>Draft.</strong> Some company details on this page are still placeholders in [square brackets]. They are filled in before this policy applies.</span>
              </div>
            )}
            <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">{title}</h1>
            <p className="mt-2 text-sm text-slate-500">Effective {SITE.policyEffectiveDate} · Version {SITE.policyVersion}</p>
            <div className="mt-6 text-slate-700 leading-relaxed space-y-3">{intro}</div>
            {sections.map(([id, heading, body]) => (
              <section key={id} id={id} className="mt-10 scroll-mt-24">
                <h2 className="text-xl font-bold text-slate-900">{heading}</h2>
                <div className="mt-3 text-slate-700 leading-relaxed space-y-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1.5 [&_strong]:text-slate-900">{body}</div>
              </section>
            ))}
          </article>
        </div>
      </Container>
    </section>
  );
}

const Mail = ({ to }: { to: string }) => <a href={`mailto:${to}`} className="text-emerald-700 font-semibold">{to}</a>;

export function PrivacyPage() {
  const SITE = useBranding();
  const B = SITE.brandName;
  return (
    <Legal
      title="Privacy Policy"
      intro={<>
        <p>This Privacy Policy explains how <strong>{SITE.companyName}</strong> (&quot;{B}&quot;, &quot;we&quot;, &quot;us&quot;), {SITE.companyAddress}, collects, uses, shares and protects personal data when you use our website and our WhatsApp customer-engagement software (the &quot;Service&quot;).</p>
        <p>We follow the <strong>Digital Personal Data Protection Act, 2023</strong> (&quot;DPDP Act&quot;) and the rules made under it, and the Information Technology Act, 2000 where it applies. Words like <em>personal data</em>, <em>Data Fiduciary</em>, <em>Data Processor</em>, <em>Data Principal</em> and <em>Consent Manager</em> have the meaning given in the DPDP Act.</p>
      </>}
      sections={[
        ['roles', '1. Our two roles', <>
          <p><strong>As a Data Fiduciary</strong>, we decide why and how we process personal data of visitors to our website, people who send us a sign-up request, and the staff of businesses who use the Service (their accounts).</p>
          <p><strong>As a Data Processor</strong>, we process personal data of a business&apos;s own customers (for example their WhatsApp messages, names, phone numbers, notes and call recordings) <strong>only on behalf of that business and on its instructions</strong>. For that data, the business is the Data Fiduciary. If you are a customer of a business that uses {B}, please contact that business about your data; we help the business answer your request.</p>
        </>],
        ['collect', '2. Personal data we collect', <>
          <ul>
            <li><strong>Sign-up requests:</strong> business name, your name, work email, mobile number, type of business, city, team size, plan of interest, your message, and your consent choices with the date and policy version.</li>
            <li><strong>Accounts (business staff):</strong> name, email, role, and the profile details you add (phone, job title, languages); sign-in records; actions in the Service (for example replies sent, chats handled, stage changes) used for the business&apos;s activity reports and our audit log.</li>
            <li><strong>Business customers&apos; data (as Data Processor):</strong> WhatsApp messages and media sent to or from the business, contact names and numbers, notes, tags, pipeline stages, queries, broadcast and follow-up status, ad referral details (which ad a chat came from), and, if the business uses WhatsApp calling, call details and recordings.</li>
            <li><strong>Connection details the business provides:</strong> WhatsApp Business Account and phone number IDs, Meta ad account IDs and access tokens (stored encrypted), and optional AI provider keys (stored encrypted).</li>
            <li><strong>Technical data:</strong> IP address (for security and rate limiting), browser type, error reports (with personal details removed), and items your browser keeps for you (see section 10).</li>
          </ul>
          <p>We do not ask for, and ask you not to send us, sensitive data such as passwords of other services, bank or card numbers, or government ID numbers.</p>
        </>],
        ['purposes', '3. Why we use it (purposes)', <>
          <ul>
            <li>To answer your sign-up request, contact you and set up your account.</li>
            <li>To provide the Service: sending and receiving WhatsApp messages for the business, the inbox, bot and AI replies the business switches on, broadcasts, follow-ups, analytics, calls and ad reports.</li>
            <li>To keep the Service secure: preventing abuse and fraud, rate limits, audit logs and investigating incidents.</li>
            <li>To support you, bill your plan and keep the records the law requires.</li>
            <li>With your separate, optional consent only: to send product news and offers. You can withdraw this at any time.</li>
          </ul>
          <p>We do not sell personal data, and we do not use a business&apos;s customer data for our own marketing or to train AI models.</p>
        </>],
        ['basis', '4. Consent and legitimate uses', <>
          <p>Where we rely on consent, it is free, specific, informed and given by a clear action (for example ticking the box on the sign-up form). The notice is available in English; ask us if you need it in another language listed in the Eighth Schedule of the Constitution of India.</p>
          <p>You may <strong>withdraw consent</strong> at any time, as easily as you gave it, by writing to <Mail to={SITE.privacyEmail} />. Withdrawal does not affect processing done before it. If you withdraw consent that is needed for the Service, we may not be able to keep providing it. Where the DPDP Act allows processing for <em>legitimate uses</em> (for example to comply with law or a court order), we may process data without consent.</p>
          <p>You may also give, manage or withdraw consent through a Consent Manager registered with the Data Protection Board of India, once available.</p>
        </>],
        ['share', '5. Who we share it with', <>
          <p>We share personal data only as needed to provide the Service, with service providers bound by contract to protect it and use it only for us:</p>
          <ul>
            <li><strong>Meta Platforms</strong> (WhatsApp Business Platform, Marketing API): to send and receive WhatsApp messages and calls, and for ad reports and ads the business creates. Meta&apos;s own terms and privacy policy also apply to WhatsApp.</li>
            <li><strong>Supabase</strong> (database, sign-in, file storage) and <strong>Netlify</strong> (hosting and server functions).</li>
            <li><strong>AI providers chosen by the business</strong> (for example Anthropic, OpenAI or Google), only if the business switches on AI features, to generate replies from the conversation and the business&apos;s own information.</li>
            <li>Authorities, when the law requires it, and professional advisers under confidentiality.</li>
          </ul>
          <p>Our platform administrators can see usage counts and settings to run and bill the Service, <strong>never the contents of a business&apos;s chats or its customers&apos; details</strong>; this is enforced in the database, not just on screen.</p>
        </>],
        ['transfer', '6. Where data is stored', <>
          <p>Our service providers may store and process data on servers outside India. The DPDP Act allows this except to countries the Government of India restricts by notification; we will follow any such restriction. We use providers that protect data with security measures at least as strong as those described here.</p>
        </>],
        ['retention', '7. How long we keep it', <>
          <ul>
            <li><strong>Sign-up requests:</strong> deleted 90 days after we decline them, and 30 days after we create your account (the account then holds the details).</li>
            <li><strong>Account and business data:</strong> while the business&apos;s account is active. After the account is closed, we delete or anonymise it within 90 days, unless the business asks for an export first or the law requires us to keep some records longer (for example invoices under tax law).</li>
            <li><strong>Call recordings:</strong> deleted automatically after 90 days.</li>
            <li><strong>Technical logs:</strong> system events after 30 days, job logs after 14 days. Security and audit records may be kept longer where needed to protect the Service or meet legal duties.</li>
          </ul>
          <p>When the purpose is served or consent is withdrawn, we erase the data unless the law requires us to keep it, as the DPDP Act requires.</p>
        </>],
        ['security', '8. How we protect it', <>
          <ul>
            <li>Each business&apos;s data is kept separate by database rules (row-level security), and staff see only what their role allows.</li>
            <li>Access tokens, app secrets and AI keys are stored encrypted and never shown in full again.</li>
            <li>Messages from WhatsApp are accepted only with Meta&apos;s signature; connections use HTTPS.</li>
            <li>Rate limits, a sign-in failure guard, an audit log of important changes, and monitoring of errors.</li>
          </ul>
          <p>If a personal data breach happens, we will inform the affected persons and the Data Protection Board of India as the DPDP Act and its rules require, and the business concerned where we act as its Data Processor.</p>
        </>],
        ['rights', '9. Your rights', <>
          <p>Under the DPDP Act you have the right to:</p>
          <ul>
            <li><strong>Access information:</strong> a summary of your personal data we process and how, and the identities of others we have shared it with.</li>
            <li><strong>Correction, completion, updating and erasure</strong> of your personal data.</li>
            <li><strong>Grievance redressal:</strong> a reply from our Grievance Officer (section 12).</li>
            <li><strong>Nominate</strong> another person to exercise your rights if you die or become unable to.</li>
            <li><strong>Withdraw consent</strong> at any time (section 4).</li>
          </ul>
          <p>To use these rights, write to <Mail to={SITE.privacyEmail} /> from the email address you used with us. We may ask you to confirm your identity. We reply as soon as we can and within the time the law allows. You also have duties under the DPDP Act, such as giving accurate information and not filing false or frivolous complaints.</p>
        </>],
        ['cookies', '10. Cookies and your browser', <>
          <p>We do not use advertising or tracking cookies. Our dashboard keeps your sign-in session and a few display preferences (for example which tab or guide you last opened) in your browser&apos;s local storage, so the app works. You can clear them in your browser at any time; you will then need to sign in again.</p>
        </>],
        ['children', '11. Children', <>
          <p>The Service is for businesses and is not meant for anyone under 18. We do not knowingly collect personal data of children for our own purposes. A business that uses the Service to talk to customers who may be children is responsible, as the Data Fiduciary, for obtaining verifiable parental consent where the DPDP Act requires it. We do not do behavioural monitoring of, or targeted advertising to, children.</p>
        </>],
        ['grievance', '12. Grievance Officer and complaints', <>
          <p><strong>{SITE.grievanceOfficerName}</strong>, Grievance Officer<br />{SITE.companyName}, {SITE.companyAddress}<br />Email: <Mail to={SITE.grievanceOfficerEmail} /></p>
          <p>Please write to the Grievance Officer first. If you are not satisfied with our reply, you may complain to the <strong>Data Protection Board of India</strong> as provided in the DPDP Act.</p>
        </>],
        ['changes', '13. Changes to this policy', <>
          <p>We may update this policy. We will show the new effective date here and, for important changes, tell account holders by email or in the dashboard before the change applies. Where a change needs fresh consent, we will ask for it.</p>
        </>],
      ]}
    />
  );
}

export function TermsPage() {
  const SITE = useBranding();
  const B = SITE.brandName;
  return (
    <Legal
      title="Terms and Conditions"
      intro={<>
        <p>These Terms are an agreement between <strong>{SITE.companyName}</strong> (&quot;{B}&quot;, &quot;we&quot;) and the business that signs up for the Service (&quot;you&quot;, the &quot;Customer&quot;), and the people who use it on the Customer&apos;s behalf. By creating an account or using the Service, you agree to these Terms and to our <Link to="/privacy" className="text-emerald-700 font-semibold">Privacy Policy</Link>.</p>
      </>}
      sections={[
        ['service', '1. The Service', <>
          <p>{B} is software that helps a business manage its WhatsApp conversations: a team inbox, bots and optional AI replies, broadcasts, follow-ups, a pipeline, queries, analytics, WhatsApp calling and Click-to-WhatsApp ad reports and tools. The Service uses Meta&apos;s WhatsApp Business Platform and Marketing API through accounts that <strong>you</strong> own and connect.</p>
          <p>We are not WhatsApp or Meta and are not endorsed by them. Meta may change, limit or stop its platforms; parts of the Service that depend on them may change as a result.</p>
        </>],
        ['accounts', '2. Accounts and users', <>
          <ul>
            <li>You must be at least 18 and authorised to act for the business. The information you give must be accurate.</li>
            <li>Your Business Admin adds staff and sets their roles. You are responsible for everything done through your account and for keeping passwords and access tokens safe.</li>
            <li>Tell us at once at <Mail to={SITE.supportEmail} /> if you suspect unauthorised access.</li>
          </ul>
        </>],
        ['meta', '3. WhatsApp and Meta rules', <>
          <p>You must follow the WhatsApp Business Terms, the WhatsApp Business Messaging and Commerce Policies and Meta&apos;s advertising policies. In particular, you must:</p>
          <ul>
            <li>message only people who have agreed to hear from you, honour opt-outs (STOP), and use approved templates outside the 24-hour customer service window;</li>
            <li>not send spam, misleading, illegal or harmful content, or content about restricted goods and services;</li>
            <li>for health businesses, not make cure or guaranteed-result claims, and follow the rules that apply to medical advertising and patient information.</li>
          </ul>
          <p>Meta charges your WhatsApp Business Account and your ad account directly for messages and ads. Those charges are between you and Meta.</p>
        </>],
        ['acceptable', '4. Acceptable use', <>
          <p>You must not misuse the Service, including by: breaking the law; infringing others&apos; rights; uploading malware; trying to access data of other businesses; overloading, probing or reverse-engineering the Service; reselling it without our written permission; or using it to collect or process personal data unlawfully.</p>
        </>],
        ['data', '5. Your data', <>
          <ul>
            <li>You own the data you and your customers put into the Service (&quot;Customer Data&quot;). You give us the right to process it only to provide, secure and support the Service.</li>
            <li>For your customers&apos; personal data, <strong>you are the Data Fiduciary</strong> under the DPDP Act, 2023 and <strong>we are your Data Processor</strong>. You are responsible for having a lawful basis (such as consent) to message your customers and to use features like call recording, for giving them the required notices, and for answering their requests; we will help you do so.</li>
            <li>We process Customer Data only on your instructions (given through the Service), keep it confidential, protect it as described in our Privacy Policy, use only service providers bound by similar duties, and tell you without undue delay about a personal data breach that affects it.</li>
            <li>You can export your data while your account is active. After the account ends, we delete it as described in our Privacy Policy.</li>
          </ul>
        </>],
        ['ai', '6. AI features', <>
          <p>AI replies and drafts are optional and use the AI provider you choose. AI can be wrong: you are responsible for the information you give it and for checking how it answers your customers. The Service blocks certain claims (for example health or cure claims and invented prices), but this does not replace your own review.</p>
        </>],
        ['fees', '7. Plans, fees and taxes', <>
          <ul>
            <li>Fees depend on your plan and are shown on our Pricing page or in your order. Plan limits (team members, contacts, broadcasts, numbers and others) apply as described there.</li>
            <li>Fees are payable in advance for each billing period and are exclusive of GST and other taxes, which are added as applicable.</li>
            <li>If payment is late, the account stays active for a grace period of 7 days, after which we may pause it until payment is received. Data is not deleted because of a pause.</li>
            <li>See our <Link to="/refund-policy" className="text-emerald-700 font-semibold">Cancellation and Refund Policy</Link>.</li>
          </ul>
        </>],
        ['availability', '8. Availability and changes', <>
          <p>We work to keep the Service available, but it may be unavailable at times, for example for maintenance (we try to announce it in advance) or because of problems at Meta or our providers. We may improve or change features; if we remove a major feature you pay for, we will tell you in advance.</p>
        </>],
        ['ip', '9. Intellectual property', <>
          <p>We own the Service, its software and content (other than Customer Data). You get a limited, non-exclusive, non-transferable right to use it during your subscription. Feedback you give us may be used to improve the Service.</p>
        </>],
        ['liability', '10. Disclaimers and limitation of liability', <>
          <p>The Service is provided &quot;as is&quot;. To the extent the law allows, we do not promise that it will be uninterrupted or error-free, and we are not liable for indirect or consequential losses, lost profits or data loss caused by events outside our reasonable control (including actions of Meta or your own providers).</p>
          <p>Our total liability for any claim is limited to the fees you paid us in the 12 months before the claim. Nothing in these Terms limits liability that cannot be limited by law.</p>
        </>],
        ['indemnity', '11. Indemnity', <>
          <p>You will compensate us for claims, penalties and costs arising from your content, your messages to your customers, your breach of these Terms or of WhatsApp or Meta policies, or your breach of data protection law as Data Fiduciary.</p>
        </>],
        ['termination', '12. Suspension and termination', <>
          <p>You may stop using the Service at any time. We may suspend or end an account that seriously or repeatedly breaks these Terms or the law, or that Meta restricts, after notice where reasonable. On termination your right to use the Service ends; you may ask for an export of your data within 30 days, after which it is deleted as described in the Privacy Policy.</p>
        </>],
        ['law', '13. Governing law and disputes', <>
          <p>These Terms are governed by the laws of India. The courts at <strong>{SITE.jurisdictionCity}</strong> have exclusive jurisdiction. Before going to court, both sides will try to settle a dispute in good faith for 30 days after written notice.</p>
        </>],
        ['misc', '14. Other terms', <>
          <p>We may update these Terms; we will give notice of important changes, and continued use after they apply means you accept them. If part of these Terms is unenforceable, the rest still applies. Notices to us: <Mail to={SITE.supportEmail} />, {SITE.companyAddress}. {!isPlaceholder(SITE.cin) ? `CIN: ${SITE.cin}.` : ''}{!isPlaceholder(SITE.gstin) ? ` GSTIN: ${SITE.gstin}.` : ''}</p>
        </>],
      ]}
    />
  );
}

export function RefundPage() {
  const SITE = useBranding();
  const B = SITE.brandName;
  return (
    <Legal
      title="Cancellation and Refund Policy"
      intro={<p>This policy explains how plan subscriptions to {B} can be cancelled and when fees are refunded. It forms part of our <Link to="/terms" className="text-emerald-700 font-semibold">Terms and Conditions</Link>.</p>}
      sections={[
        ['cancel', '1. Cancelling', <>
          <p>You can cancel your plan at any time by writing to <Mail to={SITE.supportEmail} /> from your Business Admin email. Cancellation takes effect at the end of the current billing period; the account stays usable until then, and you can export your data.</p>
        </>],
        ['refunds', '2. Refunds', <>
          <ul>
            <li>Fees for a billing period that has started are generally not refundable.</li>
            <li>If you cancel within 7 days of your <strong>first</strong> payment and have not used the Service beyond setup, we refund that payment in full.</li>
            <li>If we charge you twice or by mistake, or cannot provide the Service for reasons within our control for a large part of a billing period, we refund the amount concerned.</li>
            <li>Approved refunds are made to the original payment method within 7–10 working days.</li>
          </ul>
        </>],
        ['meta', '3. Meta charges', <p key="meta">WhatsApp message charges and ad spend are billed to you by Meta and are not refundable by us. Contact Meta for those.</p>],
        ['contact', '4. Contact', <p key="contact">Questions about billing: <Mail to={SITE.supportEmail} />, {SITE.supportHours}.</p>],
      ]}
    />
  );
}

export function DataDeletionPage() {
  const SITE = useBranding();
  const B = SITE.brandName;
  return (
    <Legal
      title="Data Deletion Instructions"
      intro={<p>How to ask {B} to delete personal data, including data received through Meta&apos;s platforms (WhatsApp, Facebook, Instagram).</p>}
      sections={[
        ['business', '1. If you are a business using ' + B, <>
          <ul>
            <li>Remove a WhatsApp number or ad account connection any time from the WhatsApp or Ads page (your Business Admin).</li>
            <li>To delete your whole account and its data, email <Mail to={SITE.privacyEmail} /> from your Business Admin email with the subject &quot;Delete my account&quot;. We confirm the request, offer an export, and delete the data within 30 days (records the law requires us to keep, such as invoices, are kept only for that purpose).</li>
          </ul>
        </>],
        ['customer', '2. If you messaged a business that uses ' + B, <>
          <p>The business you messaged controls that data. Please ask that business to delete it; they can delete your contact and chat history. If you cannot reach them, email <Mail to={SITE.privacyEmail} /> with the business&apos;s name and your phone number, and we will pass your request to them and help them act on it.</p>
          <p>Replying <strong>STOP</strong> to a business on WhatsApp stops its broadcasts to you at once.</p>
        </>],
        ['visitor', '3. If you sent us a sign-up request', <p key="visitor">Email <Mail to={SITE.privacyEmail} /> and we delete your request within 7 days. Requests are also deleted automatically (see our <Link to="/privacy" className="text-emerald-700 font-semibold">Privacy Policy</Link>).</p>],
        ['confirm', '4. Confirmation', <p key="confirm">We reply to confirm when deletion is complete. For complaints, contact our Grievance Officer, {SITE.grievanceOfficerName}, at <Mail to={SITE.grievanceOfficerEmail} />.</p>],
      ]}
    />
  );
}
