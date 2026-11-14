// Shared data shapes for the dashboard (what the /api answers contain).
// Mirrors the server: roles in server/tenant.cjs, stages and contacts in server/inbox.cjs.

/** owner = Business Admin, manager, agent. */
export type Role = 'owner' | 'manager' | 'agent';

/** Pipeline stage keys (labels in crmUtils.STAGE_INFO). */
export type Stage = 'new' | 'interested' | 'ordered' | 'completed' | 'repeat' | 'lost';

/** Who is signed in. */
export interface Me {
  email: string;
  role: Role | string;
  id?: string;
}

/** One person on the team (GET /api/team). */
export interface StaffMember {
  user_id?: string;
  email: string;
  role: Role;
  created_at?: string;
  /** From "My profile" (server/staffStats.cjs). */
  full_name?: string | null;
  job_title?: string | null;
}

/** One person's activity in a period (GET /api/me/profile, /api/team/performance, /api/team/members/:id). */
export interface StaffStats {
  userId: string; email: string; role: Role; joinedAt: string | null;
  fullName?: string; jobTitle?: string; languages?: string; phone?: string;
  /** Onboarding details: only for viewers who manage this person (server/staffStats.cjs canSeeFull). */
  employeeCode?: string; joinedOn?: string; workLocation?: string; address?: string; emergencyContactName?: string; emergencyContactPhone?: string;
  repliesSent: number; chatsHandled: number; medianResponseMin: number | null; conversions: number; openChats: number;
  queriesResolved: number; openQueries: number; avgRating: number | null; notes: number; calls: number; talkMin: number;
  activeDays: number; lastActive: string | null; points: number; rank: number;
  daily: Array<{ day: string; replies: number }>;
}
export interface StaffPoints { chats: number; conversions: number; queriesResolved: number; calls: number; notes: number }

/** GET /api/team */
export interface TeamResponse {
  staff: StaffMember[];
  me: Me & { id: string };
}

/** The toast every screen gets from App to show a short message. */
export type ShowToast = (message: string) => void;

/** A customer contact / chat (GET /api/inbox, /api/pipeline, /api/inbox/:phone). */
export interface Contact {
  phone: string;
  name?: string | null;
  /** WhatsApp profile name (updated on every customer message); `name` is the team's saved name when name_set_by is set. */
  wa_name?: string | null;
  name_set_by?: string | null;
  /** Came back after a long silence (server/returningLeads.cjs). */
  returned_at?: string | null;
  returned_after_days?: number | null;
  last_message?: string | null;
  last_contacted_at?: string | null;
  last_inbound_at?: string | null;
  assigned_to?: string | null;
  stage?: Stage | string;
  stage_changed_at?: string | null;
  bot_paused?: boolean;
  bot_paused_until?: string | null;
  botPaused?: boolean;
  unread_count?: number;
  source?: string | null;
  tags?: string[];
  opted_out?: boolean;
  created_at?: string | null;
  first_ad_id?: string | null;
  first_ad_at?: string | null;
  first_ad_headline?: string | null;
  last_ad_id?: string | null;
  last_ad_at?: string | null;
  last_ad_headline?: string | null;
}

/** Whether `me` may work on a chat: unassigned (anyone), mine, or someone else's (view only). */
export type Access = 'unassigned' | 'mine' | 'other';

/** A contact as the Inbox gets it, with the server's computed flags. */
export interface InboxContact extends Contact {
  botPaused?: boolean;
  windowOpen?: boolean;
  windowClosesAt?: string | null;
  /** Business number (Meta phone_number_id) the customer last wrote to. */
  last_phone_number_id?: string | null;
  /** 24-hour window per business number the customer wrote to (open chat only). */
  windows?: NumberWindow[];
  /** Closed with a reason (SQL 20261132); a new message or a staff reply reopens it. */
  closed_at?: string | null;
  closed_reason?: CloseReason | null;
  closed_by?: string | null;
  close_note?: string | null;
}
export type CloseReason = 'booked' | 'resolved' | 'not_interested' | 'no_response' | 'spam' | 'other';
/** A team saved reply (GET /api/saved-replies); "/shortcut" in the reply box. */
export interface SavedReply { id: number; shortcut: string; title: string; body: string; created_by?: string | null; updated_at?: string }

/** One business WhatsApp number (GET /api/inbox-numbers). */
export interface BusinessNumber {
  id: string;
  label: string;
  phoneNumber: string;
  main: boolean;
}

/** The customer's 24-hour window on one business number. */
export interface NumberWindow {
  numberId: string;
  lastInboundAt: string;
  open: boolean;
  closesAt: string | null;
}

/** One chat message (GET /api/inbox/:phone). */
export interface ChatMessage {
  id: string | number;
  message_id?: string;
  direction: 'inbound' | 'outbound';
  sender_name?: string | null;
  body?: string | null;
  type?: string;
  sent_by?: string | null;
  delivery_status?: 'sent' | 'delivered' | 'read' | 'failed' | string | null;
  audio_url?: string | null;
  timestamp: string;
  /** Business number the message went through (several numbers per business). */
  phone_number_id?: string | null;
  /** A photo / document / audio / video (the file itself: GET /api/inbox/:phone/media?id=). */
  media_mime?: string | null;
  media_name?: string | null;
  media_size?: number | null;
}

/** A staff note on a contact. */
export interface ContactNote {
  id: string | number;
  author: string;
  body: string;
  created_at: string;
}

/** GET /api/inbox/:phone */
export interface Conversation {
  contact: InboxContact;
  messages: ChatMessage[];
  notes: ContactNote[];
}

/** PATCH /api/inbox/:phone body (one kind of change at a time; the assignee always on its own). */
export interface ContactPatch {
  assignedTo?: string | null;
  /** A status key of the business (src/leadStatuses.ts). */
  stage?: Stage | string;
  /** Optional booking amount when moving to a booked / done kind of status (Ads funnel revenue). */
  bookingValue?: number | null;
  botPaused?: boolean;
  pauseHours?: number;
  tags?: string[];
  name?: string;
}

/** How one template variable is filled: the customer's name, the item, or fixed text. */
export interface VariableSpec {
  type: 'contact_name' | 'event_item' | 'text' | string;
  value?: string;
  fallback?: string;
}

/** A WhatsApp message template from Meta (GET /api/templates). */
export interface TemplateComponent {
  type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS' | string;
  format?: string;
  text?: string;
  buttons?: Array<{ type: string; text: string; url?: string; phone_number?: string }>;
}
/** One keyword rule of the bot (GET/POST /api/bot-rules; server/botStore.cjs). */
export interface BotRule {
  id: string;
  keyword: string;
  matchType?: 'contains' | 'exact' | string;
  responseType?: 'text' | 'buttons' | string;
  responseText?: string;
  buttons?: Array<{ id?: string; title?: string }>;
  isActive?: boolean;
}

/** One menu item in the bot catalog (a kit, a dish, a service...). */
export interface CatalogItem {
  id: string;
  title: string;
  description?: string;
  price?: number | string;
  details?: string;
  [key: string]: unknown;
}
export interface CatalogButton { id: string; title: string; [key: string]: unknown }
/** One option button of the "next step" (portion, slot, add-on...) and the bot's answer to it. */
export interface StepButton { id: string; title: string; responseMessage?: string }
/** The item "next step" after someone picks a menu item. */
export interface ItemNextStep {
  enabled?: boolean;
  /** Which ready-made preset it started from (flowPresets STEP_PRESETS key). */
  presetKey?: string;
  stepType?: 'direct' | 'buttons' | string;
  name?: string;
  prompt?: string;
  buttons?: StepButton[];
  finalMessage?: string;
}
/**
 * The bot's menus and flow (GET/POST /api/bot-catalog). Free-form JSON saved per business; these are
 * the fields the editor and bot know about. Older catalogs may lack some of them.
 */
export interface BotCatalog {
  welcomeMessage?: string;
  welcomeButtons?: CatalogButton[];
  /** Basic flow (every business except Arogya's food bot): the "Our services" list. */
  menuItems?: CatalogItem[];
  /** Message above the "Our services" list. */
  menuPrompt?: string;
  /** The list's open button (max 20 characters). */
  menuButtonLabel?: string;
  /** The button under an item's details (max 20 characters), e.g. "✅ Book / Enquire". */
  enquireButtonLabel?: string;
  dietKitsPrompt?: string;
  dietKits?: CatalogItem[];
  rteVegItems?: CatalogItem[];
  rteNonVegItems?: CatalogItem[];
  rtcVegItems?: CatalogItem[];
  rtcNonVegItems?: CatalogItem[];
  orderConfirmReply?: string;
  staffNotificationReply?: string;
  itemNextStep?: ItemNextStep;
  foodBuiltIns?: boolean;
  [key: string]: unknown;
}

export interface Template {
  /** Meta's template id. */
  id?: string;
  name: string;
  language: string;
  status: string;
  category: string;
  components?: TemplateComponent[];
  /** Meta's reason when status is REJECTED ('NONE' otherwise). */
  rejected_reason?: string;
}
