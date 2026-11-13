# Inbox essentials (agents' daily work)

## Goal
These are the four gaps found in the 2026-11-12 review that agents feel every day:
- photos, PDFs and voice notes in chats
- alerts for new or assigned chats
- the team's own saved replies
- closing a chat with a reason

## Done: LIVE 2026-11-12, deploy 6af5a81299184a3012a236bd (SQL `20261132_inbox_essentials.sql` run by the user)

### Mark a chat done with a reason
- **Where:** `server/inbox.cjs` (`closeChat`, `reopenChat`). Routes: `POST /api/inbox/:phone/close {reason, note}`
  and `/reopen`.
- **Reasons:** booked, resolved, not_interested, no_response, spam, other. A note of up to 300 characters is optional.
- **Rules:** the same as any change (`ensureCanAct`). Marking an unassigned chat claims it; someone else's chat is
  refused (403). Unread is cleared.
- **Reopening:** the chat comes back automatically when the customer writes (`onInbound`) or staff reply
  (`afterStaffSend`).
- **Views:** every view (All / Mine / Unassigned / Unread) shows open chats only. The "Done" view shows closed ones.
- **Naming:** called **"Done"** in the UI, because the pipeline already has a "Closed" stage (a lost customer). The
  API and columns still say closed_*. Marking a chat done does **not** change its stage.
- **Before the SQL is run:** reads fall back to the old columns (`leadQuery`, rechecked every 5 minutes), so the inbox
  keeps working. Closing a chat then says to run the SQL.

### Saved replies
- **Where:** `server/savedReplies.cjs`, table `saved_replies` (server-only). Unique shortcut per business; up to 100.
  Audited by shortcut.
- **Who:** `GET /api/saved-replies` for everyone. POST / PUT / DELETE for managers and the Business Admin.
- **In the inbox:**
  - The first 6 replies show as chips.
  - Typing `/tim` opens a picker; Enter fills in the first match (the Send button is off while a `/` is typed).
  - `{name}` becomes the customer's first name.
  - Managers get an "Edit" link that opens `SavedRepliesManager`.
- **Starters:** until a business adds its own, 3 neutral starters show. The old food-specific quick replies were
  removed from the code.

### Photos, documents, audio, video
- **Where:** `server/inboxMedia.cjs` and `meta.cjs` (`uploadMedia`, `sendMediaMessage`).
- **Incoming:**
  - `webhook.cjs` (`mediaOf`) saves Meta's media id, type and file name. The body is the caption, or a label like
    "📷 Photo", "📄 name", "🎤 Voice note".
  - `GET /api/inbox/:phone/media?id=<wamid>`: on the first open, the server fetches the file from Meta with the
    business's token. Only Meta file hosts are accepted, up to 16 MB. The file is copied into the private bucket
    `inbox-media` at `<biz>/in/<hash>`. The browser gets a 1-hour signed link, plus a download link. Later opens use
    the copy.
  - Only this business's own messages (404 otherwise).
- **Outgoing:**
  1. `POST …/media/upload-url` gives a signed upload link for `<biz>/out/<uuid>.<ext>`.
  2. The browser PUTs the file to it.
  3. `POST …/media {path, caption, name}` checks the path is this business's, the 24-hour window and
     `ensureCanAct`, then does Meta upload → send → record (with `media_path`).
  - Allowed: JPG and PNG up to 5 MB; PDF, Word, Excel and text documents, MP3 / M4A / AAC / OGG audio and MP4 video
    up to 16 MB.
- **UI** (`src/inboxExtras.tsx`):
  - photos load by themselves; audio, video and documents load on click
  - the paperclip button opens a send dialog with a caption
  - automatic labels aren't repeated under the file
- **Not built:** recording voice notes in the browser. WhatsApp needs OGG/Opus, and Chrome records WebM, so staff send
  audio files instead.

### New-chat alerts
- **Server:** `server/inboxAlerts.cjs` sends on the business's existing Realtime channel (`calls.staffChannel`):
  - `inbox_message {assignedTo, newChat, at}` after each customer message
  - `inbox_assigned {to}` when a chat is handed to someone else

  There is no name, number or text in the alert (test checks this).
- **Browser:**
  - `App.tsx` passes the events to `src/inboxAlerts.ts`. It alerts only for unassigned chats or the person's own.
  - What happens: a sound; with the tab in the background, "(n) …" in the tab title, plus a desktop notification if
    allowed.
  - Each person's settings live under the bell in the inbox (on, sound, desktop), saved in localStorage.
- **Cost:** no polling and no extra Netlify cost. Hidden tabs still don't refresh (e2e "Netlify credits…" passes).

### Tests
- `tests/inboxEssentials.test.cjs` (8): ownership, tenancy, window, path checks, Meta-host check, the alert payload,
  the fallback before the SQL is run.
- e2e: "Inbox essentials…" and "Inbox alerts…".

## Next
- [x] User ran SQL `20261132_inbox_essentials.sql`; deployed 6af5a81299184a3012a236bd.
- [ ] Try on the live site: a real photo / PDF in and out, a voice note in, and a desktop notification.
- [ ] Retention for `inbox-media` copies (for example delete after 90 days, like call recordings), to be decided
      with the privacy policy. Not built yet.
- [ ] Optional: "Done" reasons in Analytics; Enter-to-pick using arrow keys in the `/` picker.

## Decisions
- Alerts reuse the call channel instead of a new connection or polling.
- "Done", not "Closed", in the UI, to avoid a clash with the pipeline stage.
- Media is copied on first open (not for every incoming message), so files nobody opens aren't stored.
