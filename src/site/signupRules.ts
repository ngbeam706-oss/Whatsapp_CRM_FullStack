// Sign-up form checks, shown as you type. They mirror server/signupRequests.cjs validateSignup (the server checks
// again; keep both in step — tests/signupRequests.test.cjs runs the same cases against both).

export interface SignupForm {
  businessName: string; contactName: string; email: string; phone: string; industry: string;
  city: string; teamSize: string; planInterest: string; hasWhatsappApi: string; message: string;
  acceptTerms: boolean; acceptMarketing: boolean;
}
export type SignupErrors = Partial<Record<keyof SignupForm, string>>;

export const INDUSTRIES: Array<[string, string]> = [
  ['hospital', 'Hospital / clinic / healthcare'], ['food', 'Food / restaurant / bakery'], ['retail', 'Shop / retail / e-commerce'],
  ['services', 'Services (salon, education, travel…)'], ['general', 'Something else'],
];
export const TEAM_SIZES = ['1-5', '6-20', '21-50', '50+'];

const tidy = (v: string) => v.replace(/\s+/g, ' ').trim();

/** Digits with the country code, or null (same rules as the server). */
export function normalizePhone(raw: string): string | null {
  const s = raw.trim();
  if (!/^\+?[\d\s\-().]{8,22}$/.test(s)) return null;
  const d = s.replace(/\D/g, '');
  if (/^[6-9]\d{9}$/.test(d)) return `91${d}`;
  if (/^0[6-9]\d{9}$/.test(d)) return `91${d.slice(1)}`;
  if (/^91[6-9]\d{9}$/.test(d)) return d;
  if (d.startsWith('91')) return null;
  if (s.startsWith('+') && /^[1-9]\d{7,14}$/.test(d)) return d;
  return null;
}

const EMAIL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,}$/;

/** Common typos in email domains: a gentle "did you mean …?" (never blocks). */
const DOMAIN_FIXES: Record<string, string> = {
  'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gmail.co': 'gmail.com', 'gamil.com': 'gmail.com', 'gmail.con': 'gmail.com', 'gnail.com': 'gmail.com',
  'yahoo.co': 'yahoo.com', 'yaho.com': 'yahoo.com', 'hotmial.com': 'hotmail.com', 'outlok.com': 'outlook.com', 'rediffmail.co': 'rediffmail.com',
};
export function emailSuggestion(email: string): string | null {
  const [user, domain] = email.trim().toLowerCase().split('@');
  return user && domain && DOMAIN_FIXES[domain] ? `${user}@${DOMAIN_FIXES[domain]}` : null;
}

/** One field's problem, or '' (used on blur and on submit). */
export function checkField(field: keyof SignupForm, f: SignupForm, planIds: string[] = []): string {
  switch (field) {
    case 'businessName': {
      const v = tidy(f.businessName);
      if (v.length < 2 || v.length > 80) return 'Enter your business name (2 to 80 characters).';
      if (!/\p{L}/u.test(v)) return 'The business name needs at least one letter.';
      return '';
    }
    case 'contactName': {
      const v = tidy(f.contactName);
      if (v.length < 2 || v.length > 80) return 'Enter your full name (2 to 80 characters).';
      if (!/^[\p{L}][\p{L}\p{M} .'-]*$/u.test(v)) return 'Use letters, spaces, dots, apostrophes or hyphens only.';
      return '';
    }
    case 'email': {
      const v = f.email.trim().toLowerCase();
      if (!v) return 'Enter your work email.';
      if (v.length > 254 || !EMAIL_RE.test(v) || v.includes('..')) return 'Enter a valid email address, like name@business.com.';
      return '';
    }
    case 'phone':
      if (!f.phone.trim()) return 'Enter a mobile number we can call or WhatsApp.';
      return normalizePhone(f.phone) ? '' : 'Enter a valid mobile number: 10 digits for India (e.g. 98765 43210), or + and the country code.';
    case 'industry':
      return INDUSTRIES.some(([id]) => id === f.industry) ? '' : 'Choose your type of business.';
    case 'city': {
      const v = tidy(f.city);
      return v && (v.length > 60 || !/^[\p{L}][\p{L}\p{M} .,'-]*$/u.test(v)) ? 'Enter a city name (letters only, up to 60 characters).' : '';
    }
    case 'teamSize':
      return f.teamSize && !TEAM_SIZES.includes(f.teamSize) ? 'Choose a team size.' : '';
    case 'planInterest':
      return f.planInterest && planIds.length && !planIds.includes(f.planInterest) ? 'Choose a plan.' : '';
    case 'message':
      return f.message.trim().length > 1000 ? 'Keep the message to 1,000 characters.' : '';
    case 'acceptTerms':
      return f.acceptTerms ? '' : 'Please accept the Terms and the Privacy Policy to continue.';
    default:
      return '';
  }
}

export const REQUIRED: Array<keyof SignupForm> = ['businessName', 'contactName', 'email', 'phone', 'industry', 'acceptTerms'];
const ALL: Array<keyof SignupForm> = [...REQUIRED, 'city', 'teamSize', 'planInterest', 'message'];

/** Every problem in the form (empty object = fine). */
export function checkAll(f: SignupForm, planIds: string[] = []): SignupErrors {
  const out: SignupErrors = {};
  for (const k of ALL) { const e = checkField(k, f, planIds); if (e) out[k] = e; }
  return out;
}
