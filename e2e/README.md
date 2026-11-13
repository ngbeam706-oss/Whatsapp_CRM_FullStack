# End-to-end smoke tests

```
npm run e2e
```

Starts the API (`npm run server`, using `.env`) and the production build (`vite preview` on :4173),
then drives Microsoft Edge (comes with Windows, nothing to download).

| Test | Needs | Changes anything? |
|---|---|---|
| `mocked.spec.js`: Inbox, Pipeline, Queries, Analytics, Ads, Team render signed in | nothing (fake login + fake API in the browser) | no |
| `mocked.spec.js`: screens share cached data (team list fetched once) | nothing | no |
| `mocked.spec.js`: refresh every 15s while visible, none while hidden, once on return | nothing (fake clock) | no |
| Sign-in page loads with no errors | nothing | no |
| API refuses requests without a login (+ security headers) | nothing | no |
| Every tab opens without crashing | `E2E_EMAIL`, `E2E_PASSWORD` | no (read-only) |
| Inbox lists chats and opens one | same | no |
| A reply can be sent | same + `E2E_SEND_TO` | **yes: sends a real WhatsApp message** |

Put these in `.env` (never commit them, never use a real staff member's password):

```
E2E_EMAIL=e2e-test@yourdomain        # a test staff login (Team page -> invite), role owner or manager
E2E_PASSWORD=...
E2E_SEND_TO=9198xxxxxxxx             # optional: a test phone that messaged the business in the last 24h
```

Other options: `E2E_BASE_URL=https://<deploy-preview>.netlify.app` tests a deployed copy instead of the
local one; `E2E_BROWSER_CHANNEL=chrome` uses Google Chrome instead of Edge.

On failure, a screenshot and trace are saved in `test-results/` (open a trace with
`npx playwright show-trace test-results/<folder>/trace.zip`).
