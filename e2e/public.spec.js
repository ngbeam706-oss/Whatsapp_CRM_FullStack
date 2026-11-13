// The public website (no login): landing page, pricing from the plans table, the legal pages, and the sign-up
// request form with its checks. The form's POST is answered here, so nothing is saved anywhere.
import { test, expect } from '@playwright/test';

const PLANS = { plans: [
  { id: 'starter', name: 'Starter', priceMonthlyInr: 999, limits: { staff: 3, contacts: 1000, whatsappNumbers: 1 }, aiEnabled: false, adsEnabled: false },
  { id: 'growth', name: 'Growth', priceMonthlyInr: 2999, limits: { staff: 10, contacts: 10000, whatsappNumbers: 2 }, aiEnabled: true, adsEnabled: true },
] };

function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  return errors;
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/public/plans', r => r.fulfill({ json: PLANS }));
});

test('landing page: headline, sign-in link to /app, and every footer page opens without errors', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in' }).first()).toHaveAttribute('href', '/app');
  for (const [name, path, heading] of [['Privacy Policy', '/privacy', /Privacy Policy/], ['Terms and Conditions', '/terms', /Terms/], ['Refund', '/refund-policy', /Refund/], ['Data deletion', '/data-deletion', /delet/i]]) {
    await page.getByRole('contentinfo').getByRole('link', { name: new RegExp(name, 'i') }).first().click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(page.getByRole('heading', { level: 1 })).toContainText(heading);
  }
  expect(errors).toEqual([]);
});

test('privacy policy covers the DPDP Act and shows the draft note while details are placeholders', async ({ page }) => {
  await page.goto('/privacy');
  await expect(page.getByText(/Digital Personal Data Protection Act, 2023/).first()).toBeVisible();
  await expect(page.getByText(/Grievance Officer/).first()).toBeVisible();
  await expect(page.getByText(/Data Protection Board of India/).first()).toBeVisible();
  await expect(page.getByTestId('legal-draft')).toBeVisible();
  await expect(page).toHaveTitle(/Privacy Policy/);
});

test('pricing shows the plans from the server and links to sign-up with the plan chosen', async ({ page }) => {
  await page.goto('/pricing');
  const plans = page.getByTestId('pricing-plans');
  await expect(plans).toContainText('Starter');
  await expect(plans).toContainText('₹2,999');
  await plans.getByRole('link').nth(1).click();
  await expect(page).toHaveURL(/\/signup\?plan=growth$/);
  await expect(page.locator('#su-planInterest')).toHaveValue('growth');
});

test('sign-up: checks every field, explains each problem, and sends a clean request', async ({ page }) => {
  const errors = watchErrors(page);
  let sent = null;
  await page.route('**/api/public/signup-requests', r => { sent = r.request().postDataJSON(); return r.fulfill({ json: { success: true, message: 'Thank you! We will contact you within 1–2 working days.' } }); });
  await page.goto('/signup');

  // Empty form: a summary of problems, focus on the first field, nothing sent.
  await page.getByRole('button', { name: 'Send request' }).click();
  const summary = page.getByTestId('signup-summary');
  await expect(summary).toBeVisible();
  await expect(page.locator('#su-businessName')).toBeFocused();
  await expect(page.locator('#su-businessName')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#su-acceptTerms-msg')).toBeVisible();
  expect(sent).toBeNull();

  // Checked as you leave each field.
  await page.locator('#su-businessName').fill('Sunrise Clinic');
  await page.locator('#su-contactName').fill('Priya Sharma');
  await page.locator('#su-email').fill('priya@gmial.com');
  await page.locator('#su-email').blur();
  await page.getByRole('button', { name: 'priya@gmail.com' }).click();
  await expect(page.locator('#su-email')).toHaveValue('priya@gmail.com');
  await page.locator('#su-phone').fill('12345 67890');
  await page.locator('#su-phone').blur();
  await expect(page.locator('#su-phone')).toHaveAttribute('aria-invalid', 'true');
  await page.locator('#su-phone').fill('98765 43210');
  await expect(page.getByText("We'll use +919876543210")).toBeVisible();
  await page.locator('#su-industry').selectOption('hospital');
  await page.locator('#su-city').fill('Hyd3rabad');
  await page.locator('#su-city').blur();
  await expect(page.locator('#su-city')).toHaveAttribute('aria-invalid', 'true');
  await page.locator('#su-city').fill('Hyderabad');

  // Consent is required.
  await page.getByRole('button', { name: 'Send request' }).click();
  await expect(page.locator('#su-acceptTerms-msg')).toBeVisible();
  expect(sent).toBeNull();
  await page.locator('#su-acceptTerms').check();
  await page.getByRole('button', { name: 'Send request' }).click();

  await expect(page.getByTestId('signup-done')).toContainText('Request received');
  expect(sent).toMatchObject({ businessName: 'Sunrise Clinic', email: 'priya@gmail.com', phone: '98765 43210', industry: 'hospital', city: 'Hyderabad', acceptTerms: true, acceptMarketing: false, website: '' });
  expect(typeof sent.startedAt).toBe('number');
  expect(errors).toEqual([]);
});

test('sign-up: problems found by the server are shown on the right field', async ({ page }) => {
  await page.route('**/api/public/signup-requests', r => r.fulfill({ status: 400, json: { success: false, error: 'Please fix the highlighted fields.', errors: { email: 'Please use a working email address.' } } }));
  await page.goto('/signup');
  await page.locator('#su-businessName').fill('Sunrise Clinic');
  await page.locator('#su-contactName').fill('Priya Sharma');
  await page.locator('#su-email').fill('priya@sunrise.in');
  await page.locator('#su-phone').fill('9876543210');
  await page.locator('#su-industry').selectOption('food');
  await page.locator('#su-acceptTerms').check();
  await page.getByRole('button', { name: 'Send request' }).click();
  await expect(page.getByText('Please use a working email address.').first()).toBeVisible();
  await expect(page.locator('#su-email')).toHaveAttribute('aria-invalid', 'true');
});

test('branding from the console shows everywhere: name, logo, contacts, titles; complete details remove the draft note', async ({ page }) => {
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  await page.route('**/api/public/branding', r => r.fulfill({ json: { branding: {
    brandName: 'ChatDesk', tagline: 'Chats that convert', companyName: 'ChatDesk Technologies Private Limited', companyAddress: 'Plot 1, Madhapur, Hyderabad 500081',
    supportEmail: 'help@chatdesk.in', salesEmail: 'sales@chatdesk.in', privacyEmail: 'privacy@chatdesk.in', phone: '+91 98765 43210',
    grievanceOfficerName: 'Priya Sharma', grievanceOfficerEmail: 'grievance@chatdesk.in', jurisdictionCity: 'Hyderabad', logoUrl: '/api/public/logo?v=abcdef123456',
  } } }));
  await page.route('**/api/public/logo**', r => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.goto('/');
  await expect(page.getByRole('banner').getByText('ChatDesk')).toBeVisible();
  await expect(page.getByRole('banner').getByTestId('brand-logo')).toBeVisible();
  await expect(page).toHaveTitle('ChatDesk: Chats that convert');
  await page.goto('/privacy');
  await expect(page.getByText('ChatDesk Technologies Private Limited').first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'grievance@chatdesk.in' }).first()).toBeVisible();
  await expect(page.getByTestId('legal-draft')).toHaveCount(0);
  await page.goto('/contact');
  await expect(page.getByRole('link', { name: 'sales@chatdesk.in' })).toBeVisible();
  // The staff sign-in page too.
  await page.goto('/app');
  await expect(page.getByRole('heading', { name: 'ChatDesk' })).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('brand-logo')).toBeVisible();
});

test('an invite or password-reset link that lands on the home page opens the dashboard instead', async ({ page }) => {
  await page.goto('/#access_token=fake&type=invite');
  await expect(page).toHaveURL(/\/app#access_token=fake&type=invite$/);
});
