# Customer data import + custom fields

Status: **D1 + D2 BUILT 2026-11-15, not deployed, not committed.** The user must run SQL
`supabase/migrations/20261142_customer_import.sql` before deploying. D3 / D4 later. Written 2026-11-15.

## Done (D1 + D2, 2026-11-15)
- **SQL `20261142_customer_import.sql`** (safe to re-run, server-only tables):
  - `lead_custom_fields`: key, label, type (text / number / amount / date / choice / yesno), options, private, hidden, order
  - `whatsapp_leads.custom` jsonb (object, ≤ ~9 KB in the database, 8 KB on the server), GIN index; `imported_at`, `import_id`
  - `lead_imports` (one `running` per business by a unique index, consent required) and `lead_import_changes` (old values for Undo)
  - plan columns `max_custom_fields` 10/25/50, `max_import_rows_per_file` 2,000/10,000/25,000, `max_import_file_mb` 2/5/10,
    `max_import_rows_month` 5,000/25,000/100,000 (starting values only when a column is first created)
- **Server**
  - `server/customFields.cjs`: fields CRUD (managers), `cleanValue` per type, `detailsFor` (agents get "hidden" for private),
    `saveDetails` (managers, `ensureCanAct`), `aiFacts` / `aiFactsFor` (normal visible fields only)
  - `server/leadImport.cjs`: `cleanPhone`, `cleanRow`, `changesFor` (fill / overwrite / skip), `check` (dry run), `start`, `batch`,
    `finish`, `list`, `undo`, `limitsFor`
  - `server/importRoutes.cjs`: `/api/customer-fields`, `/api/customer-details` (+ `/save`), `/api/imports…`; rate limit 120/min on
    imports; 6 MB JSON only for `/api/imports`
  - Limits added to `server/limits.cjs` + `server/platform.cjs` (Plans and per-business overrides on the console)
  - Inbox and Pipeline leave out imported people who never chatted (`not.and=(imported_at.not.is.null,last_contacted_at.is.null)`);
    Leads filter `imported`
  - AI: the staff "draft a reply" prompt gets the customer's normal fields; private ones never
- **Browser**
  - Settings → Customer fields (`src/CustomerFieldsScreen.tsx`, `/…/settings/customer-fields`)
  - Customer details card (`src/CustomerDetailsCard.tsx`) in the chat side panel and in a drawer on the Leads page
  - Leads: "Import customers" (`src/ImportCustomers.tsx`, lazy) + filter "Imported, not chatted yet" + "Imported" badge
  - `src/importUtils.ts`: CSV parser, file type by content, column guessing (type, private suggestion), payload rows
  - Excel: `read-excel-file@9.3.14` (MIT, pinned exact; published 2026-10-29), loaded only when an .xlsx is read
- **Tests**: `tests/customerImport.test.cjs` (23 after the cross-check; first 12: phone cleaning, types, private hidden from agents and the AI, fill / overwrite,
  roles, tenancy, limits per file / month / fields / contacts, one at a time, STOP, Inbox exclusion, undo, PGlite migration);
  e2e: CSV and XLSX import, over-limit + continue from row + undo, agent card read-only with "Hidden", Customer fields screen
  + manager edit.

## Decisions made while building
- Row numbers in the wizard and in "continue from row" count customer rows (the header row is not counted).
- Fill mode never changes the status; tags are always added; empty cells never erase anything (both modes).
- Unknown status / an email not in the team / a value of the wrong type: the row is rejected with the reason (not guessed).
- A cell with several numbers: the first good one is used, the rest go to an "Other numbers" field (created when first needed,
  if the field limit allows).
- People who already chatted are matched normally; an imported person who writes in joins the Inbox (last_contacted_at set).
- Undo removes created people who never chatted; created people who have written in since are kept (counted as "kept").
  Changed fields are restored key by key, so other edits made since stay.
- The month's new-people count is the sum of `created_count` of this month's imports that were not undone.
- A `running` import with no batch for 30 minutes is closed as `stopped` (the browser was closed).
- Existing customers are written with one bulk upsert per batch (500 single PATCHes would be too slow for Netlify).
- **File size is checked only by the size the browser reports** (the server never receives the file). Rows per file
  (each import's row range, enforced on every batch) and new people per month are the real server-side limits.

## Cross-check fixes (2026-11-15, second pass; each has a test in `tests/customerImport.test.cjs` Part 4 or e2e)
1. **Rows per file can't be skipped:** every batch is refused when `rows_done + rows` would pass the import's row range.
2. **One part at a time + atomic counts:** SQL `lead_import_claim_batch` (claims the import; refused while another part is being
   saved, released after 2 minutes if a request died, or past the range) and `lead_import_end_batch` (adds the counts in SQL and
   releases). The month / contacts allowance is computed after the claim, so parallel parts can't each get the full allowance.
3. **Excel scientific notation:** `9.18765E+11` is refused with "The number was shortened by Excel. Format the phone column as
   Text…"; accepted only when there are as many decimals as the exponent (`9.876543210E+9`).
4. **Undo never overwrites later edits:** `lead_import_changes.after` keeps what the import wrote; Undo puts a column / custom value
   back only while it still holds that value. People changed since are counted (`changedSince`) and shown ("changed since and left
   as they are"). Two imports on one person: undoing the first leaves the second's values.
5. **One rule for "contacted":** an imported person is contacted once any message goes either way: their own message, a staff
   reply or call (as before, `last_contacted_at`), and now also a broadcast or follow-up (`markContacted`, which only touches
   imported never-contacted people, so nobody else moves in the Inbox). Inbox / Pipeline and Undo use the same rule. Undo also keeps
   anyone with a message, broadcast row, note, query or call, and removes the rest **with all their data** through the shared
   `purgeLeads` (`server/leadsTools.cjs`, also used by the Leads page delete). Undo deletes its `lead_import_changes` too.
6. **Undo data pruned:** hourly worker step `importUndoPrune` deletes `lead_import_changes` of imports older than 7 days and sets
   `changes_pruned_at` (no longer undoable). Hourly, inside the existing every-5-minutes worker: no new schedule.
7. **An imported person's first message is a new chat** (`isNewChat` in `server/webhook.cjs`: imported + never contacted): the
   `new_contact` follow-up event, the new-chat alert, the STOP re-check; the "returning" rule doesn't run for it.
8. **Statuses set by an import** (overwrite mode, or the status column for new people): `stage_changed_at` and status history with
   source `import` (SQL allows it). Not reported to Meta as bookings (they don't come from ads).
9. **Wide files:** the browser splits parts by size too (≤ 4 MB of JSON and ≤ 500 rows; `splitParts` in `src/importUtils.ts`).
10. Smaller: "98765 43210 91234 56789" splits into two numbers when clearly two mobiles; Excel date serials (20000–80000) are
    accepted for date fields; the dry run warns when the field limit leaves no room for "Other numbers"; new fields are mapped by
    the server's saved key (`keyMap`, keyed by the browser's draft key; the import stops if a field is missing), and the dry run
    renames a draft key the same way.
- SQL `20261142` gained: `lead_import_changes.after`, `lead_imports.batch_started_at` / `changes_pruned_at`, the two functions
  (service role only), and `import` in the status-history sources. Still safe to re-run; still not run.

## Next
- [ ] User runs SQL `20261142_customer_import.sql`, then deploy (ask first).
- [x] CLAUDE.md: key files row + latest migration `20261142` (done in the cross-check, 2026-11-15).
- [x] Cross-check fix: deleting a lead permanently (Leads page) now also removes its `lead_import_changes` rows
      (old values kept for Undo are personal data); test in `tests/leadsTools.test.cjs`.
- [ ] D3 (matching badge, existing vs new in the Ads Funnel), D4 (filters, audiences, export with custom fields).

**User's decisions (2026-11-15):**
1. Plan limits in section 4: yes, as written.
2. Agents **only see** normal custom fields; they can't edit them. Managers and the Business Admin edit.
3. Undo window: 7 days.
4. Imported people who never chatted **count towards the contacts limit**.
5. **Both Excel (.xlsx) and CSV** from the start.

## 1. The goal
Any business (loans, hospitals, real estate, education, retail…) uploads its existing customers / patients from an
Excel or CSV file, with **whatever columns it has** (for a loan business: CIBIL score, loan amount, EMI date, branch…).
Later, when one of those people writes on WhatsApp (for example after clicking an ad), the CRM recognises them by
phone number and the agent sees their uploaded details at once ("existing customer · CIBIL 742 · loan ₹3 L").

## 2. How the data is stored (no table per business)
| What | Where | Example |
|---|---|---|
| Phone, name, status, source, owner… | **existing columns** of `whatsapp_leads` | `919876543210`, Ravi Kumar |
| Everything else from the file | **new JSON column `whatsapp_leads.custom`** (indexed for filters) | `{"cibil_score": 742, "loan_amount": 300000, "emi_date": "2026-12-05"}` |
| What each JSON key means | **new table `lead_custom_fields`** (per business) | `cibil_score` → "CIBIL score", number, private |
| Each upload | **new table `lead_imports`** (per business) | file name, rows, row range, counts, who, when, undo status |

- **Matching is by the phone column** (cleaned to one format, already unique per business). Never by name.
- The JSON is only for storing, showing and filtering the extra data.
- Same rules as today: every row is scoped by `business_id`, and the Platform Admin never sees any of it.

## 3. Phases

### D1: Custom fields + customer details card
- Settings → **Customer fields** (Business Admin + managers): add / rename / reorder / hide fields.
  - Types: text, number, amount (₹), date, choice (list), yes/no.
  - **Private** flag: only the Business Admin and managers see it; agents see "hidden".
- Every chat's side panel and the Leads page get a **Customer details** card that shows and edits these fields (with lead ownership, as today).
- Private fields are never sent to the AI assistant or put in alerts or notifications.
- Plan limit: `max_custom_fields` (number of fields).
- SQL: `lead_custom_fields` table, `whatsapp_leads.custom` jsonb + index, imported markers.
- Tests: types and validation, private fields hidden from agents, tenancy, the AI never receives private fields.

### D2: Import wizard (upload → map → check → import → undo)
1. **Upload** CSV / XLSX on the Leads page ("Import customers"; Business Admin + managers). The file is read **in the browser**: the server never receives the file, only clean rows.
2. **Map columns:** a preview of the first rows. Each column → Phone (required) / Name / Status / Source / Tags / Assigned to / **an existing custom field** / **a new custom field** (type guessed: number, date…) / Skip.
3. **Options:**
   - For people already in the CRM: *fill empty fields only* (default) / *overwrite* / *skip*
   - Tag for this import (e.g. "Loans list Nov")
   - A **consent tick**: "these people agreed to hear from us"
4. **Dry run, nothing saved yet:** new / already in CRM / invalid numbers / duplicates in the file / opted out (STOP) / over the plan limit, with sample rows of each.
5. **Import** in batches of 500 with a progress bar.
   - It can be stopped.
   - A file of the rejected rows (with the reason) can be downloaded.
   - The server re-checks every batch.
6. **History + Undo:** the list of imports with their counts. **Undo** removes the people that import *created* and puts back the fields it *changed*, for 7 days. Audited.
7. **Bigger than the plan allows:** "This file has 18,000 rows; your plan allows 10,000 per upload. Rows 1–10,000 now. Upload the same file again and choose *Continue from row 10,001*." Re-uploading is safe: people already imported are matched by phone and not counted twice.
8. **Imported people who haven't chatted:**
   - They stay **out of the Inbox** and appear on the Leads page (filter "Imported, not chatted yet").
   - Broadcasts to them use approved templates only, as now; STOP is respected, and the STOP list is re-applied on import.
- **Phone cleaning:**
  - Indian 10-digit numbers → `91…`
  - "+91 98765-43210" → `919876543210`
  - Other countries need the country code
  - Landline and invalid numbers are rejected with a reason
  - Several numbers in one cell: the first one is used, and the rest are kept in a custom field

### D3: Matching when people write in
- An imported person who writes on WhatsApp (ad or not) is attached to their **existing record**. Nothing they uploaded is overwritten, and ad source / ad details are added as today.
- A chat badge **"Imported customer · Loans list Nov"**, plus a timeline note "First message after import".
- **Ads Funnel + Analytics:** a new split, **existing customers vs new people** per campaign / ad set / ad.
- Lead assignment: no change by default. Option: "imported customers go to the agent named in the file".

### D4: Use the data
- **Filters** on Leads and in the Inbox by custom fields: number ranges ("CIBIL ≥ 750"), dates ("EMI due this week"), choices, yes/no.
- **Broadcast audiences** from those filters (template messages only).
- **Export** includes custom fields; private fields only if the Business Admin ticks them (audited).
- Pipeline cards can show 1–2 chosen fields.

### D5 (optional, later)
- "Possible match" suggestions (same name, a different number) for a person to confirm. Never automatic.
- A scheduled re-import from a Google Sheet.

## 4. Limits

### Set by the plan (Platform Owner → Plans; per-business overrides, as for today's limits)
| Limit | Starter | Growth | Pro |
|---|---|---|---|
| `max_import_rows_per_file` (rows per upload) | 2,000 | 10,000 | 25,000 |
| `max_import_file_mb` (file size) | 2 MB | 5 MB | 10 MB |
| `max_import_rows_month` (new people imported per month) | 5,000 | 25,000 | 100,000 |
| `max_custom_fields` | 10 | 25 | 50 |
| `max_contacts` (**already exists**, the total ceiling) | plan | plan | plan |

### Fixed, to protect the server and database (same for everyone)
- 500 rows per request (a Netlify function has ~10 s and 6 MB per request).
- One import at a time per business, and a rate limit on the import route.
- At most 60 columns per file and 500 characters per cell.
- At most ~8 KB of custom data per person.
- CSV / XLSX only, checked by content.
- **Every limit is enforced on the server**; the browser only shows them.

## 5. Privacy and rules
- **Financial and health data:**
  - Sensitive columns (CIBIL, income, loan amounts, insurance) should be marked *private*.
  - The wizard suggests *private* for columns whose names look sensitive.
  - Hospitals get a warning not to upload diagnoses or medicines.
- **Consent:** importing ≠ permission to message. Meta requires opt-in, so the consent tick is required, recorded on the import and audited.
- **Audit:**
  - imports (who, file name, counts; never the data)
  - undo
  - field changes
  - exports of private fields
- **Retention:** deleting a lead (Leads page) also deletes its custom data. Undo removes an import's new people.
- **Platform Admin:** sees import counts in usage only, never the data.

## 6. Who can do what
| Action | Business Admin | Manager | Agent |
|---|---|---|---|
| Define custom fields | ✅ | ✅ | ❌ |
| Import / undo an import | ✅ | ✅ | ❌ |
| See private fields | ✅ | ✅ | ❌ ("hidden") |
| See / edit normal custom fields on own chats | ✅ | ✅ | ✅ (lead ownership as today) |
| Export with private fields | ✅ | ❌ | ❌ |

## 7. Tests (each phase)
- **Unit:**
  - phone cleaning
  - type checks
  - limits: per file, per month, total contacts, fields
  - matching an imported person when they write in
  - undo
  - private fields hidden from agents and from the AI
  - tenancy: another business never sees or matches the data
  - STOP re-applied
- **SQL (PGlite):** new tables server-only, migrations safe to re-run.
- **Browser (e2e):**
  - upload a sample file → map → dry run → import → rows on the Leads page
  - an imported person writes in → badge + details card
  - over-limit message + "continue from row"
  - undo

## 8. Order and size
| Phase | Depends on | SQL | Rough size |
|---|---|---|---|
| D1 Custom fields + details card | – | 1 migration | medium |
| D2 Import wizard + limits + undo | D1 | 1 migration (imports table, plan limit columns) | large |
| D3 Matching badge + existing-vs-new | D2 | none (uses the import markers) | small–medium |
| D4 Filters, audiences, export | D1 | none | medium |
| D5 Possible matches, sheet sync | D3 | later | – |

Suggested: **D1 + D2 together** (the core), then D3, then D4. One deploy per finished phase (saves Netlify credits).

## 9. Questions for the user
1. Are the plan limits in section 4 right?
2. Should agents be able to **edit** normal custom fields, or only see them?
3. Undo window: 7 days OK?
4. Should imported people who never chatted count towards the **contacts** limit? (Recommended: yes, they are stored contacts.)
5. Excel (.xlsx) support from day one, or CSV first? (Recommended: both; the Excel reader is loaded only on the import screen.)
