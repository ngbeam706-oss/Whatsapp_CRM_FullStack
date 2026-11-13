// DEFAULTS for the application's brand and the company's legal details. The real values are set by the Platform
// Admin in the console (Branding tab, server/branding.cjs) and read with useBranding() (src/branding.ts); these are
// only shown for anything not set there yet. Anything in [square brackets] is a placeholder: while required ones
// are left, the legal pages show a "draft" note. Ask a lawyer to review the policies before publishing.

export const SITE = {
  brandName: '[Your Brand]',
  tagline: 'The WhatsApp CRM for growing Indian businesses',

  // Legal entity (Data Fiduciary under the DPDP Act, 2023)
  companyName: '[Registered company name]',
  companyAddress: '[Registered office address, City, State, PIN]',
  cin: '[CIN / registration number, if any]',
  gstin: '[GSTIN, if any]',

  // Contacts
  supportEmail: '[support@yourdomain.com]',
  salesEmail: '[sales@yourdomain.com]',
  privacyEmail: '[privacy@yourdomain.com]',
  phone: '[+91 XXXXX XXXXX]',
  supportHours: 'Monday to Saturday, 10am to 7pm IST',

  // Grievance Officer (DPDP Act, 2023 and IT Rules, 2011)
  grievanceOfficerName: '[Grievance Officer name]',
  grievanceOfficerEmail: '[grievance@yourdomain.com]',

  // Courts for disputes (Terms)
  jurisdictionCity: '[City]',

  // Bump the date when the Privacy Policy or Terms change (also stored with each sign-up consent:
  // keep in step with POLICY_VERSION in server/signupRequests.cjs).
  policyVersion: '2026-11-11',
  policyEffectiveDate: '11 November 2026',
};
