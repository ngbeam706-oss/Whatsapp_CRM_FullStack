# Pending Implementation List

Arogya Ruchulu WhatsApp CRM · Nov 6, 2026 · @Sai Harshith

## Summary

46 features from Bigin and QuickReply are not built yet; 10 of them are priority P1, and 6 of those are quick wins recommended as the next phase. The core of both products is already live (see the last section). The rest are grouped by area below, each with where it comes from, what it does, a rough size and a priority.

- **Source:** QuickReply, Bigin, or Both (the feature exists in both products).
- **Size** (rough effort for one developer): S = 1–2 days, M = 3–5 days, L = 1–3 weeks.
- **Priority** for Arogya Ruchulu: P1 = next, P2 = soon, P3 = only if the business needs it.

Payments and orders (Phase 5) was deliberately skipped earlier and is listed here as P1, because it turns chats into collected revenue. Six housekeeping items that need no new features are listed separately.

## Recommended next: quick wins

These six are small, useful every day, and need no new outside accounts, so they make a good next phase.

| Feature | Source | What it does | Size | Priority |
| --- | --- | --- | --- | --- |
| Images, PDFs and voice notes in the inbox | QuickReply | Staff send and receive menu cards, kit brochures, photos and voice notes; today the inbox handles text and templates only | S | P1 |
| Office hours and holiday auto-reply | QuickReply | Outside set hours or on holidays, customers get an automatic "we're closed, we'll reply at 9am" message | S | P1 |
| New-chat alerts for staff | Bigin | Browser notification (and optional email) when a new or assigned chat arrives, so nobody has to watch the screen | S | P1 |
| Website widget, wa.me link and QR code | QuickReply | A WhatsApp button for the website, a share link and a printable QR code for food packs, each tagged with its source | S | P1 |
| CSV import and export of contacts | Bigin | Bring in an existing customer list (with opt-in) and download contacts, stages and tags | S | P1 |
| Staff tasks and reminders | Bigin | "Call Lakshmi on Friday": tasks on a contact with a due date, shown in the inbox and as a daily list | M | P1 |

## Payments and orders (Phase 5, skipped earlier)

Today an order is only an enquiry in the chat; these turn it into a tracked, paid order. Needs a payment gateway account (for example Razorpay) in the business's name.

| Feature | Source | What it does | Size | Priority |
| --- | --- | --- | --- | --- |
| Orders module | QuickReply | Each order recorded with items, amount, address, delivery slot and status, visible on the contact and in an Orders list | M | P1 |
| Payment links in chat | Both | Staff (or the bot) send a UPI/card payment link for the order amount | M | P1 |
| Payment status tracking | Both | The gateway tells the server when a link is paid; the order and pipeline stage update automatically | M | P1 |
| Order status updates to customers | QuickReply | Confirmed, out for delivery and delivered messages sent from approved utility templates | S | P1 |
| COD confirmation | QuickReply | Cash-on-delivery orders get a "confirm your order" button before the kitchen prepares them | S | P2 |
| COD-to-prepaid nudge | QuickReply | COD customers are offered a payment link (optionally with a small discount) | S | P2 |
| Invoices and receipts | Bigin | A PDF receipt per paid order, sent on WhatsApp | M | P3 |

## WhatsApp commerce and messaging

| Feature | Source | What it does | Size | Priority |
| --- | --- | --- | --- | --- |
| WhatsApp Flows (in-chat forms) | QuickReply | Customers fill a form inside WhatsApp: delivery address, slot booking, feedback | M | P2 |
| WhatsApp catalog and product messages | QuickReply | Products from a Meta commerce catalog shown as product cards; customers build a cart in WhatsApp | L | P2 |
| Broadcast frequency cap | QuickReply | Limits marketing messages per customer per week, to protect the quality rating | S | P2 |
| Image and video upload for template headers | QuickReply | Upload media in the dashboard instead of pasting a public link | S | P3 |
| Inactive-audience filtering | QuickReply | Leaves out numbers that keep failing or never read broadcasts | S | P3 |
| Area-based targeting | QuickReply | Send campaigns by delivery area or pincode (needs addresses from orders) | S | P3 |
| Missed-call trigger | QuickReply | A missed call to a listed number starts a WhatsApp conversation (needs a telephony provider) | M | P3 |

## Inbox and team operations

| Feature | Source | What it does | Size | Priority |
| --- | --- | --- | --- | --- |
| Saved replies library | Both | Owner-managed quick replies with shortcuts (today the four quick replies are fixed in code) | S | P2 |
| Close chats with a reason | QuickReply | Mark a chat resolved (ordered, not interested, complaint solved) for reporting | S | P2 |
| Automatic chat routing | QuickReply | New chats assigned round-robin or to the least busy agent, optionally by language | M | P2 |
| Support tickets | Bigin | Complaints and issues tracked with status and due time until solved | M | P3 |
| Custom reports and export | QuickReply | Download analytics as CSV and build simple saved reports | S | P3 |

## Lead capture and marketing

| Feature | Source | What it does | Size | Priority |
| --- | --- | --- | --- | --- |
| Web forms that create contacts | Bigin | A sign-up or enquiry form for the website that adds the contact (with consent) and starts a WhatsApp chat | S | P2 |
| Ads module (Click-to-WhatsApp ads) | New | Chats and orders per ad, ad spend, cost per chat and per order, pause and budget changes inside the CRM. Plan: `docs/progress/ads-module.md` (phases A–F; A needs no Meta approval) | M–L | P2 |
| Ads: video ads | Ads Manager gap | Video instead of a picture in the CRM's ad wizard (needs an upload path larger than Netlify's 6 MB request: Meta fetches from a signed storage link) | M | P2 |
| Ads: audiences | Ads Manager gap | Interests, people who already messaged you (custom audiences from CRM contacts: needs a consent decision, phones are hashed) and lookalikes | M–L | P2 |
| Ads: A/B variants and several ads per campaign | Ads Manager gap | Two pictures or texts tested against each other in one campaign (not with WhatsApp Status) | M | P3 |
| Ads: edit a created ad | Ads Manager gap | Change text or picture after creating (Meta needs a new creative swapped into the ad) | S–M | P3 |
| Ads: lifetime budget, schedules, other goals | Ads Manager gap | Total budget for the campaign, day-parting, objectives other than chats | M | P3 |
| Meta and Instagram lead-ad sync | Bigin | Leads from Facebook and Instagram lead forms land in the CRM automatically | M | P2 |
| Instagram DM automation | QuickReply | Bot replies and inbox for Instagram direct messages | L | P2 |
| LinkedIn and TikTok lead-ad sync | Bigin | Same as Meta lead sync, for LinkedIn and TikTok forms | M | P3 |
| Omnichannel inbox | QuickReply | WhatsApp, Instagram, Facebook Messenger and website chat in one inbox | L | P3 |
| Email inbox and campaigns | Bigin | Send and receive email from contacts, plus mass email campaigns | L | P3 |

## CRM features (from Bigin)

| Feature | Source | What it does | Size | Priority |
| --- | --- | --- | --- | --- |
| Bookings and calendar sync | Bigin | Customers book nutritionist consultations or call-backs; slots sync with Google or Outlook calendars | M | P2 |
| Custom fields on contacts | Bigin | Owner-defined fields such as diet goal, area or kit start date, usable in filters and templates | M | P2 |
| Multiple pipelines | Bigin | Separate boards, for example retail customers and bulk or corporate orders | M | P3 |
| Duplicate cleanup | Bigin | Find and merge duplicate contacts | S | P3 |

## Integrations

All P3: worth building only once the business uses the other tool.

| Feature | Source | What it does | Size | Priority |
| --- | --- | --- | --- | --- |
| Public API and outgoing webhooks | Bigin | Other tools (or Zapier) can read contacts and get notified of new leads and orders | M | P3 |
| Shopify | QuickReply | Cart-abandonment messages and order sync for an online store | L | P3 |
| Accounting: QuickBooks or Zoho Books | Bigin | Paid orders become invoices in the accounting tool | M | P3 |
| CRM sync: Zoho, HubSpot, Salesforce, LeadSquared | QuickReply | Two-way contact and stage sync with an external CRM | M | P3 |
| Helpdesk: Zoho Desk or Gorgias | Both | Complaints raised in WhatsApp open helpdesk tickets | M | P3 |
| Calendly | QuickReply | Booking links from Calendly instead of built-in bookings | S | P3 |
| MCP connection for AI tools | Bigin | Lets AI assistants such as Claude read and update the CRM | M | P3 |

## Platform

| Feature | Source | What it does | Size | Priority |
| --- | --- | --- | --- | --- |
| Installable phone app (PWA) | Both | The dashboard installs on phones like an app, with notifications; a cheaper step before native apps | S | P2 |
| AI agents that take actions | Bigin | The assistant creates orders, books slots or updates stages itself, with staff approval | M | P3 |
| Native iOS and Android apps | Both | Store apps for staff on the move | L | P3 |
| White-label, multi-business | QuickReply | Run the platform for other businesses, each with its own number, data and billing (needs Meta Tech Provider approval) | L | P3 |

## Open housekeeping (no new features)

The first two are P1 and should be done before broadcasting widely or switching AI auto-replies on.

- [ ] **Rotate the WhatsApp token (P1).** The old token was in two deploy zip files. Generate a new one in Meta Business Settings, update Netlify and `.env`, redeploy, revoke the old token, change `VERIFY_TOKEN`, and delete `deploy.zip` and `whatsapp-react-deploy.zip`.
- [ ] **Reword health claims in the bot menu (P1).** Lines such as "diabetes & blood sugar control kit", "glycemic control and diabetes care", "blood pressure support" and "resolves acidity" should describe ingredients and routine instead.
- [ ] **Custom email (SMTP) for Supabase (P2).** The built-in mailer sends only a few invite and password emails per hour.
- [ ] **Business information for the AI (P2).** Fill in delivery areas, timings, payment and kit details on the AI page before switching auto-replies on.
- [ ] **Rename the duplicate "Vishwaksen" WhatsApp account (P3)** in WhatsApp Manager, so the bot's account is easy to find.
- [ ] **Meta business verification (P3).** Raises trust and helps the daily messaging limit (currently 250 new conversations) grow.
- [ ] **Voice calls probably don't connect (P3, calls are not a priority for now; noted 2026-11-09).** Each
      side sends its WebRTC "offer" once, the moment it joins the call room, and Supabase Realtime doesn't keep
      messages for whoever joins later. Customer calls in: staff join after pressing Accept and miss the offer.
      Staff call out: the dashboard's offer is sent before the customer opens the link, then it ignores the
      customer's offer. Fix: a short "ready" handshake (whoever joins second says "ready", then the caller sends
      the offer) in `src/webrtcCallManager.ts` and `src/call/callPage.ts`, tested with two browser pages and fake
      microphones. Never tested with two real devices. Details: `docs/progress/hardening.md`. (The call ALERT
      leak between businesses is already fixed: signed links, `server/calls.cjs`.)
- [x] **WhatsApp voice calls: LIVE 2026-11-10 (deploy 6af2c569, SQL run). Still to do: subscribe the "calls"
      webhook field in Meta and make one real test call.** `server/waCalls.cjs`, `src/WhatsAppCallPanel.tsx`. Original note: Mayura
      enabled calling in Meta; a customer's WhatsApp call rings on their phone but nothing reaches the dashboard:
      `server/webhook.cjs` only reads `value.messages` and `value.statuses`, so Meta's `calls` events (with the
      call's WebRTC offer) are dropped silently. Needs: the Meta app's webhook subscribed to the `calls` field; a
      calls table; webhook handling of connect/terminate; an incoming-call popup on the business's private
      Realtime channel; Accept (browser makes the WebRTC answer -> server sends pre_accept + accept to
      `/{phone-number-id}/calls`), Decline (reject) and Hang up (terminate); lead ownership rules for who answers.

## Already built (for reference)

All live at monumental-semolina-e9f403.netlify.app as of 6 Nov 2026.

| Phase | What is live |
| --- | --- |
| 1. Security | Staff login and roles, staff-only database, signed Meta webhooks, no secrets in code, encrypted AI keys |
| 2. Broadcasts | Template manager, targeted campaigns, test sends, delivery, read and reply tracking, STOP and START opt-out |
| 3. Follow-ups | Automations for reorder reminders, browse abandonment, order feedback, win-backs and welcome; sent only 9am–8pm |
| 4. Inbox and CRM | Shared team inbox, 24-hour reply rule, bot pause and human takeover, notes, tags, pipeline board, team invites, password reset |
| Ownership rules | First action claims a lead, others view only, transfer by the assignee or an owner |
| 5b. Analytics | Leads by source, busiest hours, pipeline, product interest, staff response times, campaign and follow-up results |
| 6. AI assistant | Choice of Claude, OpenAI, Gemini or any OpenAI-compatible provider; auto-answers, safe handover, suggested replies |
