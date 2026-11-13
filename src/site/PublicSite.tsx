import { useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { Menu, X } from 'lucide-react';
import { useBranding, type Branding } from '../branding';
import { BrandLogo } from '../BrandMark';
import { Container, Link, PrimaryButton } from './SiteUi';
import { LandingPage, FeaturesPage, PricingPage, ContactPage } from './MarketingPages';
import SignupPage from './SignupPage';
import { PrivacyPage, TermsPage, RefundPage, DataDeletionPage } from './LegalPages';

// The public website (no login): /, /features, /pricing, /contact, /signup, /privacy, /terms, /refund-policy,
// /data-deletion. The dashboard lives at /app (main.tsx decides which to show).

// Page titles use the app's name from the Branding tab.
const PAGES: Record<string, { title: (b: Branding) => string; description: string; render: () => ReactNode }> = {
  '/': { title: b => `${b.brandName}: ${b.tagline}`, description: 'Shared WhatsApp inbox, bot, broadcasts, follow-ups and Click-to-WhatsApp ad results for your business.', render: () => <LandingPage /> },
  '/features': { title: b => `Features · ${b.brandName}`, description: 'Everything your team needs to answer, sell and follow up on WhatsApp.', render: () => <FeaturesPage /> },
  '/pricing': { title: b => `Pricing · ${b.brandName}`, description: 'Simple monthly plans for every size of team.', render: () => <PricingPage /> },
  '/contact': { title: b => `Contact · ${b.brandName}`, description: 'Talk to our team about plans, setup or your account.', render: () => <ContactPage /> },
  '/signup': { title: b => `Get started · ${b.brandName}`, description: 'Send a sign-up request and we will set up your account.', render: () => <SignupPage /> },
  '/privacy': { title: b => `Privacy Policy · ${b.brandName}`, description: 'How we handle personal data under the DPDP Act, 2023.', render: () => <PrivacyPage /> },
  '/terms': { title: b => `Terms and Conditions · ${b.brandName}`, description: 'The terms for using our service.', render: () => <TermsPage /> },
  '/refund-policy': { title: b => `Cancellation and Refund Policy · ${b.brandName}`, description: 'How cancellations and refunds work.', render: () => <RefundPage /> },
  '/data-deletion': { title: b => `Data Deletion · ${b.brandName}`, description: 'How to ask us to delete your data.', render: () => <DataDeletionPage /> },
};

const NOT_FOUND = {
  title: (b: Branding) => `Page not found · ${b.brandName}`, description: 'This page does not exist.',
  render: () => (
    <Container className="py-24 text-center" >
      <div data-testid="site-not-found">
        <h1 className="text-3xl font-extrabold text-slate-900">Page not found</h1>
        <p className="mt-3 text-slate-600">The address may be mistyped, or the page has moved.</p>
        <div className="mt-6"><PrimaryButton to="/">Go to the home page</PrimaryButton></div>
      </div>
    </Container>
  ),
};
const YEAR = new Date().getFullYear();

export default function PublicSite() {
  const { pathname, hash } = useLocation();
  const path = pathname.replace(/\/+$/, '') || '/';
  // The mobile menu closes when the page changes (remembered per page, so no effect is needed).
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const menu = menuFor === path;
  const setMenu = (f: (open: boolean) => boolean) => setMenuFor(f(menu) ? path : null);

  const SITE = useBranding();
  const page = PAGES[path] || NOT_FOUND;
  const title = page.title(SITE);
  useEffect(() => {
    document.title = title;
    let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (!meta) { meta = document.createElement('meta'); meta.name = 'description'; document.head.appendChild(meta); }
    meta.content = page.description;
  }, [title, page]);
  useEffect(() => {
    // A new page starts at the top, or at its section when the address has one (e.g. /privacy#rights).
    const target = hash ? document.getElementById(hash.slice(1)) : null;
    if (target) target.scrollIntoView(); else window.scrollTo({ top: 0 });
  }, [page, hash]);

  const nav: Array<[string, string]> = [['/features', 'Features'], ['/pricing', 'Pricing'], ['/contact', 'Contact']];
  return (
    <div className="min-h-screen bg-white text-slate-800 flex flex-col" data-testid="public-site">
      <header className="sticky top-0 z-40 bg-white/90 backdrop-blur border-b border-slate-200">
        <Container className="h-16 flex items-center gap-6">
          <Link to="/" className="flex items-center gap-2 font-extrabold text-slate-900 text-lg">
            <BrandLogo size={32} />
            {SITE.brandName}
          </Link>
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium" aria-label="Main">
            {nav.map(([to, label]) => <Link key={to} to={to} className={path === to ? 'text-emerald-700' : 'text-slate-600 hover:text-slate-900'}>{label}</Link>)}
          </nav>
          <div className="ml-auto hidden md:flex items-center gap-3 text-sm">
            <a href="/app" className="font-semibold text-slate-700 hover:text-slate-900">Sign in</a>
            <Link to="/signup" className="rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-4 py-2">Get started</Link>
          </div>
          <button onClick={() => setMenu(m => !m)} className="ml-auto md:hidden p-2 text-slate-700 cursor-pointer" aria-label={menu ? 'Close menu' : 'Open menu'} aria-expanded={menu}>
            {menu ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </Container>
        {menu && (
          <nav className="md:hidden border-t border-slate-200 bg-white" aria-label="Mobile">
            <Container className="py-3 flex flex-col gap-1 text-sm">
              {nav.map(([to, label]) => <Link key={to} to={to} className="py-2 font-medium text-slate-700">{label}</Link>)}
              <a href="/app" className="py-2 font-medium text-slate-700">Sign in</a>
              <Link to="/signup" className="mt-1 rounded-xl bg-emerald-600 text-white font-semibold px-4 py-2.5 text-center">Get started</Link>
            </Container>
          </nav>
        )}
      </header>

      <main className="flex-1">{page.render()}</main>

      <footer className="bg-slate-950 text-slate-400 text-sm">
        <Container className="py-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
          <div>
            <div className="flex items-center gap-2 font-extrabold text-white text-base"><BrandLogo size={28} />{SITE.brandName}</div>
            <p className="mt-3 leading-relaxed">{SITE.tagline}.</p>
          </div>
          <div>
            <div className="text-white font-semibold mb-3">Product</div>
            <ul className="space-y-2"><li><Link to="/features" className="hover:text-white">Features</Link></li><li><Link to="/pricing" className="hover:text-white">Pricing</Link></li><li><Link to="/signup" className="hover:text-white">Get started</Link></li><li><a href="/app" className="hover:text-white">Sign in</a></li></ul>
          </div>
          <div>
            <div className="text-white font-semibold mb-3">Legal</div>
            <ul className="space-y-2"><li><Link to="/privacy" className="hover:text-white">Privacy Policy</Link></li><li><Link to="/terms" className="hover:text-white">Terms and Conditions</Link></li><li><Link to="/refund-policy" className="hover:text-white">Cancellation and Refunds</Link></li><li><Link to="/data-deletion" className="hover:text-white">Data Deletion</Link></li></ul>
          </div>
          <div>
            <div className="text-white font-semibold mb-3">Company</div>
            <ul className="space-y-2"><li><Link to="/contact" className="hover:text-white">Contact us</Link></li><li><a href={`mailto:${SITE.supportEmail}`} className="hover:text-white">{SITE.supportEmail}</a></li><li className="whitespace-pre-line">{SITE.companyAddress}</li></ul>
          </div>
        </Container>
        <div className="border-t border-slate-800">
          <Container className="py-5 flex flex-wrap items-center justify-between gap-3 text-xs">
            <span>© {YEAR} {SITE.companyName}. All rights reserved.</span>
            <span>WhatsApp is a trademark of WhatsApp LLC. {SITE.brandName} is not affiliated with or endorsed by Meta.</span>
          </Container>
        </div>
      </footer>
    </div>
  );
}
