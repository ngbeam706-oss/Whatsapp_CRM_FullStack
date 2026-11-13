// What the Platform console's /api/platform/* calls return (server/platform.cjs, server/monitor.cjs).
// Counts, statuses and settings only: nothing here holds a business's customers, chats or messages.
import type { Usage } from './SetupScreen';

/** A plan's limits (null = unlimited). */
export interface PlanLimits {
  max_staff: number | null;
  max_contacts: number | null;
  max_broadcasts_month: number | null;
  max_automations: number | null;
  max_ai_replies_month: number | null;
  max_keyword_rules: number | null;
  analytics_days: number | null;
  /** Main + extra WhatsApp numbers (null = unlimited). Missing before SQL 20261123. */
  max_whatsapp_numbers?: number | null;
  ai_enabled?: boolean;
  ads_enabled?: boolean;
}
export type LimitKey = Exclude<keyof PlanLimits, 'ai_enabled' | 'ads_enabled'>;

export interface Plan extends PlanLimits {
  id: string;
  name: string;
  price_monthly_inr?: number | null;
  sort_order?: number;
}

export interface Billing { state: 'ok' | 'due' | 'overdue' | 'none' | string; paidUntil?: string | null; suspendOn?: string | null }

/** One business in GET /api/platform/overview. */
export interface PlatformBusiness {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'suspended' | string;
  plan_id: string;
  limit_overrides?: Partial<PlanLimits> | null;
  paid_until?: string | null;
  created_at: string;
  whatsapp: { connected: boolean; source: 'saved' | 'env' | 'none'; phoneNumber?: string; numbers?: number };
  counts: { staff: number | null; contacts: number | null; messagesThisMonth: number | null };
  limits?: PlanLimits;
  billing?: Billing;
  usage: { broadcastsSent: number; aiReplies: number; period: string };
}
export interface PlatformOverview { businesses: PlatformBusiness[]; plans: Plan[] }

// ---- Monitoring (server/monitor.cjs) ----
export type AlertLevel = 'critical' | 'warn' | 'info';
export type EventLevel = 'critical' | 'error' | 'warn' | 'info';
export interface Alert { level: AlertLevel; code: string; message: string; businessId: string | null; businessName: string | null }

export interface WorkerRunRow {
  id: number;
  started_at: string;
  finished_at?: string;
  duration_ms: number;
  ok: boolean;
  error_count: number;
  /** step -> { result, ms, skipped, failed } as the worker recorded it. */
  steps?: Record<string, { result?: Record<string, unknown>; ms?: number; skipped?: boolean; failed?: boolean }>;
  errors?: Array<{ step: string; message: string }>;
}
export interface WorkerStatus {
  tableMissing?: boolean;
  last: WorkerRunRow | null;
  minutesAgo: number | null;
  runsLastHour: number;
  runsLastDay: number;
  failedLastDay: number;
  avgDurationMs: number | null;
  maxDurationMs?: number | null;
  stale: boolean;
}

export interface HealthBusiness {
  id: string;
  name: string;
  slug: string;
  status: string;
  plan_id: string;
  whatsapp: {
    connected: boolean; source: string; tokenReadable: boolean; hasAppSecret: boolean;
    qualityRating: string | null; messagingTier: string | null; checkedAt: string | null; checkError: string | null;
    tokenErrors24h: number; sendErrors24h: number;
  };
  webhook: { lastReceivedAt: string | null; lastSignatureFailAt: string | null; signatureFailsLastHour: number };
  ads: { connected: boolean; lastSyncAt?: string | null; lastSyncError?: string | null };
  ai: { configured: boolean; provider: string | null; model: string | null; keyReadable: boolean | null; errors24h: number };
  events24h: { total: number; errors: number; lastErrorAt: string | null };
  paid_until?: string | null;
  limit_overrides?: Partial<PlanLimits> | null;
}
export interface Health {
  checkedAt: string;
  api: { ok: boolean; node: string; uptimeSec: number; memoryMb: number; missingConfig: string[]; encryptionReady: boolean; unsignedWebhooksAllowed: boolean };
  database: { ok: boolean; latencyMs: number | null; error?: string };
  worker: WorkerStatus;
  events24h: { byLevel: Record<string, number>; bySource: Record<string, number>; tableMissing: boolean };
  businesses: HealthBusiness[];
}
export interface HealthWithAlerts { health: Health; alerts: Alert[] }

export interface SystemEvent {
  id: number;
  created_at: string;
  level: EventLevel;
  source: string;
  business_id: string | null;
  code: string | null;
  message: string;
  count: number;
  details?: Record<string, unknown> | null;
}
export interface AuditEntry {
  id: number;
  created_at: string;
  business_id?: string | null;
  actor_email: string;
  actor_role: string;
  action: string;
  details?: Record<string, unknown> | null;
}
export interface DeliveryRow {
  id: string; name: string; status: string;
  outbound: number | null; failedMessages: number | null; failureRate: number | null;
  campaignSent: number | null; campaignFailed: number | null; campaignSkipped: number | null;
  optedOutTotal: number | null; optOutsInPeriod: number | null; metaSendErrors: number;
}

/** GET /api/platform/businesses/:id */
export interface BusinessDetail {
  business: {
    id: string; name: string; slug: string; status: string; industry?: string; plan_id: string;
    limit_overrides?: Partial<PlanLimits> | null; paid_until?: string | null; created_at: string; created_by?: string | null;
  };
  usage: Usage & { period: string; billing: Billing };
  whatsapp: {
    connected: boolean; source: string; phoneNumber?: string; phoneNumberId?: string; wabaId?: string;
    tokenLast4?: string | null; tokenReadable: boolean; hasAppSecret?: boolean; connectedAt?: string | null;
    qualityRating?: string | null; messagingTier?: string | null; checkedAt?: string | null; checkError?: string | null;
    sendErrors24h?: number; tokenErrors24h?: number;
  };
  webhook: HealthBusiness['webhook'] | null;
  ads: HealthBusiness['ads'];
  ai: Partial<HealthBusiness['ai']> & { configured: boolean };
  staff: { owner: number | null; manager: number | null; agent: number | null };
  delivery: DeliveryRow | null;
  recentEvents: SystemEvent[];
  recentAudit: AuditEntry[];
  alerts: Alert[];
}
