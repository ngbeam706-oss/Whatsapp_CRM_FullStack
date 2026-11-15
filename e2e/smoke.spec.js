// Smoke tests: the dashboard loads, signs in, and every tab opens without crashing.
// Read-only by default. The one test that sends a WhatsApp message only runs when E2E_SEND_TO is set.
import { test, expect } from '@playwright/test';
import 'dotenv/config';

const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const SEND_TO = process.env.E2E_SEND_TO; // a TEST contact's number that has messaged within 24h

const CRASH_TEXT = /Something went wrong/;

/** Collects page crashes and console errors so each test can assert there were none. */
function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // A refused API call in a role-restricted screen is expected, not a crash.
    if (/status of 40[13]/.test(t)) return;
    errors.push(`console: ${t}`);
  });
  return errors;
}

test('the sign-in page loads with no errors', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/app');
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByLabel('Password')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByText(CRASH_TEXT)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('"Forgot password?" goes through our server (agents get no reset email), never straight to Supabase', async ({ page }) => {
  let asked = null;
  let direct = false;
  // Answered here, so the test never sends a real email.
  await page.route('**/api/auth/forgot-password', r => { asked = r.request().postDataJSON(); return r.fulfill({ json: { message: 'If this login can reset its own password, a reset link is on its way. Agents: ask your manager or Business Admin to reset your password.' } }); });
  await page.route('**/auth/v1/recover**', r => { direct = true; return r.abort(); });
  await page.goto('/app');
  await page.getByLabel('Email').fill('ravi@shop.test');
  await page.getByRole('button', { name: 'Forgot password?' }).click();
  await expect(page.getByText(/Agents: ask your manager/).first()).toBeVisible();
  expect(asked).toEqual({ email: 'ravi@shop.test' });
  expect(direct).toBe(false);
});

test('the API refuses requests without a login', async ({ request }) => {
  const r = await request.get('/api/inbox');
  expect(r.status()).toBe(401);
  // Security headers from server/security.cjs.
  expect(r.headers()['x-content-type-options']).toBe('nosniff');
  expect(r.headers()['cache-control']).toBe('no-store');
});

test.describe('signed in', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set E2E_EMAIL and E2E_PASSWORD (a test login) in .env to run these.');

  test.beforeEach(async ({ page }) => {
    await page.goto('/app');
    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('link', { name: 'Inbox' })).toBeVisible({ timeout: 20000 });
  });

  test('every tab opens without crashing', async ({ page }) => {
    const errors = watchErrors(page);
    // Every page in the side menu (settings pages only for managers and the Business Admin).
    const tabs = ['Home', 'Inbox', 'Pipeline', 'Queries', 'Broadcasts', 'Ads', 'Analytics', 'Setup', 'WhatsApp', 'Team', 'Bot Flow', 'Auto-replies', 'AI assistant', 'My profile'].map(n => ['Main menu', n]);
    const opened = [];
    for (const [menu, name] of tabs) {
      const tab = page.getByRole('navigation', { name: menu }).getByRole('link', { name, exact: true });
      if (!(await tab.count())) continue; // e.g. Ads and Settings are hidden for agents
      await tab.first().click();
      await expect(page.getByText('Loading…')).toHaveCount(0, { timeout: 15000 });
      await expect(page.getByTestId('skeleton'), `"${name}" kept loading`).toHaveCount(0, { timeout: 15000 });
      await expect(page.getByText(CRASH_TEXT), `"${name}" crashed`).toHaveCount(0);
      opened.push(name);
    }
    expect(opened.length).toBeGreaterThan(5);
    expect(errors).toEqual([]);
  });

  test('the inbox lists chats and opens one', async ({ page }) => {
    const errors = watchErrors(page);
    await page.getByRole('link', { name: 'Inbox', exact: true }).click();
    const firstChat = page.locator('[data-testid="chat-row"]').first();
    if (!(await firstChat.count())) test.skip(true, 'The test business has no chats yet.');
    const phone = await firstChat.getAttribute('data-phone');
    await firstChat.click();
    // The reply box only shows inside WhatsApp's 24-hour window, so check the chat header instead.
    await expect(page.locator('[data-testid="chat-header"]')).toContainText(phone);
    await expect(page.getByText(CRASH_TEXT)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('a reply can be sent (only with E2E_SEND_TO: sends a real WhatsApp message)', async ({ page }) => {
    test.skip(!SEND_TO, 'Set E2E_SEND_TO to a test contact\'s number to run the sending test.');
    await page.getByRole('link', { name: 'Inbox', exact: true }).click();
    await page.locator(`[data-testid="chat-row"][data-phone="${SEND_TO}"]`).click();
    const text = `Automated check ${new Date().toISOString()}`;
    await page.locator('[data-testid="chat-composer"] textarea').fill(text);
    await page.keyboard.press('Enter');
    await expect(page.getByText(text)).toBeVisible({ timeout: 20000 });
  });
});
