// The Content Security Policy from netlify.toml, ENFORCED, on both pages: the dashboard and the
// customer's voice-call page. Netlify adds the header in production; vite preview doesn't, so these
// tests add it themselves. Any script, style or connection the policy would block fails the test.
//
// The call page is opened with a fake microphone and its Supabase connection is cut off, so it never
// rings a real dashboard.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const toml = readFileSync(new URL('../netlify.toml', import.meta.url), 'utf8');
const CSP = (toml.match(/^\s*Content-Security-Policy\s*=\s*"([^"]+)"/m) || [])[1];

test.use({
  permissions: ['microphone'],
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
});

/** Serve this page with the policy enforced, and record every violation the browser reports. */
async function withEnforcedCsp(page, pagePath, { blockRealtime = true } = {}) {
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__cspViolations.push(`${e.violatedDirective} blocked ${e.blockedURI || 'inline'}`);
    });
  });
  await page.route((url) => url.pathname === pagePath, async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': CSP } });
  });
  // Normally the real Supabase Realtime is cut off. (Ringing goes through our API, never the socket.)
  if (blockRealtime) await page.routeWebSocket(/supabase\.co/, () => { /* accept nothing, send nothing */ });
}

test('netlify.toml enforces the CSP (not report-only)', () => {
  expect(CSP, 'netlify.toml must set Content-Security-Policy').toBeTruthy();
  expect(toml).not.toMatch(/Content-Security-Policy-Report-Only/);
  expect(CSP).toContain("script-src 'self'");
});

test('dashboard sign-in page runs with the CSP enforced', async ({ page }) => {
  await withEnforcedCsp(page, '/app');
  await page.goto('/app');
  await expect(page.getByText('Staff sign-in')).toBeVisible({ timeout: 20000 });
  expect(await page.evaluate(() => window.__cspViolations)).toEqual([]);
});

test('public landing page and sign-up page run with the CSP enforced', async ({ page }) => {
  await withEnforcedCsp(page, '/');
  await page.route('**/api/public/plans', r => r.fulfill({ json: { plans: [] } }));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20000 });
  await page.getByRole('link', { name: 'Get started' }).first().click();
  await expect(page.getByTestId('signup-form')).toBeVisible();
  expect(await page.evaluate(() => window.__cspViolations)).toEqual([]);
});

test('customer call page runs with the CSP enforced: bundled script, styles and business name', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await withEnforcedCsp(page, '/call.html');
  await page.goto('/call.html?room=room_e2e_csp&name=Ravi&phone=919000000001&business=E2E%20Test%20Kitchen');

  // The business's own name (not another business's brand).
  await expect(page.locator('#businessName')).toHaveText('E2E Test Kitchen');
  await expect(page).toHaveTitle('E2E Test Kitchen: voice call');
  // The bundled script ran: microphone (fake) granted, now ringing this business's team.
  await expect(page.locator('#callStatus')).toHaveText('Ringing the E2E Test Kitchen team...', { timeout: 15000 });
  // The bundled Tailwind stylesheet loaded (slate-900 page background).
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(15, 23, 42)');
  // Mute works.
  await page.locator('#muteBtn').click();
  await expect(page.locator('#muteBtn span')).toHaveText('Muted');

  expect(await page.evaluate(() => window.__cspViolations)).toEqual([]);
  expect(errors).toEqual([]);
});

// The page rings only after joining its (random) Supabase room, so this test lets it really connect:
// it joins an empty throwaway room, and the forged token means the server rings nobody.
test('call page with a forged link: the server refuses to ring, and the customer is told', async ({ page }) => {
  await withEnforcedCsp(page, '/call.html', { blockRealtime: false });
  const ring = page.waitForResponse(r => r.url().endsWith('/api/call-ring'));
  await page.goto(`/call.html?room=room_e2e_forged_${Date.now()}&t=forged.token&business=E2E%20Test%20Kitchen`);
  expect((await ring).status()).toBe(400);
  await expect(page.locator('#callStatus')).toContainText('not valid or has expired', { timeout: 15000 });
  expect(await page.evaluate(() => window.__cspViolations)).toEqual([]);
});

test('call page without a business name stays neutral', async ({ page }) => {
  await withEnforcedCsp(page, '/call.html');
  await page.goto('/call.html?room=room_e2e_csp2&name=Ravi&phone=919000000001');
  await expect(page.locator('#businessName')).toHaveText('Voice call');
  await expect(page.locator('#callStatus')).toHaveText('Ringing our team...', { timeout: 15000 });
  await expect(page.getByText(/Arogya/)).toHaveCount(0);
});
