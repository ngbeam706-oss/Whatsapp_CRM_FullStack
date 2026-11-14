import { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense, type ReactNode } from 'react';
import { Routes, Route, Navigate, NavLink, Link, useLocation, useNavigate } from 'react-router';
import { BrandLogo, useBrandName } from './BrandMark';
import { Plus, Radio, Check, Database, Users, Bot, GitBranch, Megaphone, Inbox, Kanban, BarChart3, Target, Sparkles, Smartphone, ListChecks, LifeBuoy, ClipboardList, UserCircle2, ShieldOff, LogOut, Home as HomeIcon, Tags, Contact, Shuffle } from 'lucide-react';
import { SCREENS, SETTINGS_PATH, urlOf, viewOf, canOpen, type View } from './appRoutes';
import { supabase, saveCallRecording } from './supabaseClient';
import { apiFetch } from './apiClient';
import { SignOutButton } from './AuthGate';
import InboxScreen from './InboxScreen';
import RaiseQueryModal from './RaiseQueryModal';
import AiModeToggle from './AiModeToggle';
import { canManage } from './crmUtils';
import ErrorBoundary, { ScreenLoading } from './ErrorBoundary';
import { SideNav, BottomBar, ProfileMenu, NotificationBell, SearchButton, CommandPalette, LargeTextToggle, useSidebarCollapsed, useNotifications, useCommandShortcut, type ShellItem, type ShellGroup, type BellItem, type PaletteAction } from './AppShell';
import { useApi, refreshApi } from './queryClient';

// The Inbox (the default view) is in the main file; every other screen downloads the first time it
// is opened, so the dashboard starts faster, especially on phones.
const BroadcastsScreen = lazy(() => import('./BroadcastsScreen'));
const PipelineScreen = lazy(() => import('./PipelineScreen'));
const TeamScreen = lazy(() => import('./TeamScreen'));
const ProfileScreen = lazy(() => import('./ProfileScreen'));
const WhatsAppScreen = lazy(() => import('./WhatsAppScreen'));
const SetupScreen = lazy(() => import('./SetupScreen'));
const QueriesScreen = lazy(() => import('./QueriesScreen'));
const HomeScreen = lazy(() => import('./HomeScreen'));
const AnalyticsScreen = lazy(() => import('./AnalyticsScreen'));
const AdsScreen = lazy(() => import('./AdsScreen'));
const AiAssistantScreen = lazy(() => import('./AiAssistantScreen'));
const BotConfigScreen = lazy(() => import('./BotConfigScreen'));
const BotFlowScreen = lazy(() => import('./BotFlowScreen'));
const GenericBotFlow = lazy(() => import('./GenericBotFlow'));
const LeadStatusesScreen = lazy(() => import('./LeadStatusesScreen'));
const LeadsScreen = lazy(() => import('./LeadsScreen'));
const LeadAssignmentScreen = lazy(() => import('./LeadAssignmentScreen'));
import CallModal from './CallModal';
import DbSyncModal from './DbSyncModal';
import WebhookSetupModal from './WebhookSetupModal';
import { startRingtone, stopRingtone, WebRTCCallSession } from './webrtcCallManager';
import { emitWaCallEvent } from './whatsappCall';
import { emitInboxAlert, useInboxAlerts } from './inboxAlerts';
import WhatsAppCallPanel from './WhatsAppCallPanel';
import { MaintenanceScreen, useMaintenanceSignal, type MaintenanceInfo } from './Maintenance';
import { api, ApiError, errorMessage } from './broadcastUtils';
import type { CallTarget } from './InboxScreen';
import type { CallerInfo, CallState } from './CallModal';
import type { Usage } from './SetupScreen';
import type { BotCatalog, BotRule, Role, ShowToast } from './types';

/**
 * The main menu. Agents work with customers only (Inbox, Pipeline, Queries); everything that sets up
 * or runs the business is for managers and the Business Admin, and the server refuses it to agents too.
 * Each item is a link to the screen's own address (src/appRoutes.ts).
 */
const NAV: Array<{ view: View; label: string; icon: typeof Inbox; tint: string }> = [
  // Main menu (work). Home ("My work") is everyone's first screen.
  { view: 'home', label: 'Home', icon: HomeIcon, tint: '' },
  { view: 'chat', label: 'Inbox', icon: Inbox, tint: '' },
  { view: 'pipeline', label: 'Pipeline', icon: Kanban, tint: 'text-violet-300' },
  // Managers and the Business Admin: every lead, export and delete.
  { view: 'leads', label: 'Leads', icon: Contact, tint: 'text-teal-200' },
  { view: 'queries', label: 'Queries', icon: ClipboardList, tint: 'text-rose-200' },
  { view: 'broadcasts', label: 'Broadcasts', icon: Megaphone, tint: 'text-sky-300' },
  { view: 'analytics', label: 'Analytics', icon: BarChart3, tint: 'text-amber-200' },
  { view: 'ads', label: 'Ads', icon: Target, tint: 'text-orange-200' },
  // Everyone: my personal details, my activity and my place in the team.
  { view: 'profile', label: 'My profile', icon: UserCircle2, tint: 'text-teal-100' },
  // Settings area: how the business is configured (managers and the Business Admin).
  { view: 'setup', label: 'Setup', icon: ListChecks, tint: 'text-sky-600' },
  { view: 'whatsapp', label: 'WhatsApp', icon: Smartphone, tint: 'text-emerald-600' },
  { view: 'team', label: 'Team', icon: Users, tint: 'text-pink-600' },
  { view: 'lead_statuses', label: 'Lead statuses', icon: Tags, tint: 'text-violet-600' },
  { view: 'lead_assignment', label: 'Lead assignment', icon: Shuffle, tint: 'text-teal-600' },
  { view: 'flow', label: 'Bot Flow', icon: GitBranch, tint: 'text-emerald-600' },
  { view: 'bot_config', label: 'Auto-replies', icon: Bot, tint: 'text-amber-600' },
  { view: 'ai', label: 'AI assistant', icon: Sparkles, tint: 'text-violet-600' },
];

/** Route guard: a managers' screen opened by an agent (old link, typed address) shows this, never the screen. */
function ManagersOnly({ allowed, inbox, children }: { allowed: boolean; inbox: string; children: ReactNode }) {
  if (allowed) return <>{children}</>;
  return (
    <div className="flex-1 flex items-center justify-center p-6" data-testid="no-access">
      <div className="bg-white rounded-xl shadow p-6 max-w-sm text-center space-y-2">
        <ShieldOff className="w-8 h-8 text-slate-400 mx-auto" />
        <h1 className="text-base font-bold text-slate-800">Not available for your role</h1>
        <p className="text-sm text-slate-600">This page is for managers and the Business Admin.</p>
        <Link to={inbox} className="inline-block mt-2 text-sm font-semibold text-wa-teal">Go to the Inbox</Link>
      </div>
    </div>
  );
}

function ScreenNotFound({ inbox }: { inbox: string }) {
  return (
    <div className="flex-1 flex items-center justify-center p-6" data-testid="screen-not-found">
      <div className="bg-white rounded-xl shadow p-6 max-w-sm text-center space-y-2">
        <h1 className="text-base font-bold text-slate-800">Page not found</h1>
        <p className="text-sm text-slate-600">This address isn&apos;t a page of the dashboard.</p>
        <Link to={inbox} className="inline-block mt-2 text-sm font-semibold text-wa-teal">Go to the Inbox</Link>
      </div>
    </div>
  );
}

/** The Settings area: its own side menu (a row on phones) next to the chosen settings screen. */
function SettingsArea({ base, items, children }: { base: string; items: typeof NAV; children: ReactNode }) {
  return (
    <div className="flex-1 min-h-0 flex flex-col md:flex-row" data-testid="settings-area">
      {/* Phones only: on desktop the side menu lists the settings pages. */}
      <nav aria-label="Settings menu" className="md:hidden bg-white border-b border-slate-200 flex-shrink-0 overflow-x-auto">
        <div className="hidden md:block px-4 pt-4 pb-2 text-xs font-bold uppercase tracking-wider text-slate-400">Settings</div>
        <div className="flex md:flex-col gap-0.5 p-2 w-max md:w-auto">
          {items.map(({ view, label, icon: Icon, tint }) => (
            <NavLink key={view} to={urlOf(base, view)} aria-label={label}
              className={({ isActive }) => `px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-2 whitespace-nowrap ${isActive ? 'bg-teal-50 text-wa-teal font-semibold' : 'text-slate-600 hover:bg-slate-50'}`}>
              <Icon className={`w-4 h-4 ${tint}`} aria-hidden="true" />{label}
            </NavLink>
          ))}
        </div>
      </nav>
      <div className="flex-1 min-w-0 min-h-0 flex flex-col">{children}</div>
    </div>
  );
}
const ROLE_LABEL: Record<string, string> = { owner: 'Business Admin', manager: 'Manager', agent: 'Agent' };
/** GET /api/status (the parts the header and the Webhook pop-up use). */
interface StatusResponse {
  phoneNumber?: string; verifyToken?: string; webhookUrl?: string; business?: { name?: string };
  /** This business's private incoming-call channel (staff only; server/calls.cjs). */
  callChannel?: string | null;
}
/** The person (or caller) a call is with. */
type CallParty = { phone?: string; number?: string; name?: string } | null;

// Old versions kept a copy of the bot in the browser (not tied to a business). Removed on load.
const LEGACY_STORAGE_KEYS = ['wa_bot_keyword_rules_v1', 'wa_bot_catalog_v1'];

// The shape the Bot Flow editor expects. The real menus always come from the server, per business.
const EMPTY_CATALOG: BotCatalog = {
  welcomeMessage: '',
  welcomeButtons: [],
  dietKitsPrompt: '',
  dietKits: [],
  rteVegItems: [],
  rteNonVegItems: [],
  rtcVegItems: [],
  rtcNonVegItems: [],
  orderConfirmReply: '',
  staffNotificationReply: '',
  itemNextStep: { enabled: false, stepType: 'direct', name: 'Next step', prompt: '', buttons: [], finalMessage: '' },
};

/** base: this login's area, '/admin' | '/manager' | '/agent' (src/appRoutes.ts). */
interface AppProps { base: string; userEmail: string; userRole: Role; onSignOut: () => void }

export default function App({ base, userEmail, userRole, onSignOut }: AppProps) {
  // This business's keyword rules and bot menus, loaded from the server.
  const [botRules, setBotRules] = useState<BotRule[]>([]);
  const [botCatalog, setBotCatalog] = useState<BotCatalog>(EMPTY_CATALOG);
  const [catalogLoaded, setCatalogLoaded] = useState(false);

  // The screen comes from the address (/app/ads, /app/team, ...), so a refresh stays on it.
  const location = useLocation();
  const routerNavigate = useNavigate();
  const appName = useBrandName();
  const setActiveView = useCallback((view: View) => routerNavigate(urlOf(base, view)), [routerNavigate, base]);
  const isManager = canManage(userRole);
  const allowed = NAV.filter(n => canOpen(n.view, isManager));
  const settingsNav = allowed.filter(n => SCREENS[n.view].group === 'settings');
  const activeView: View | null = viewOf(location.pathname, base);
  const inbox = urlOf(base, 'chat');
  // New-chat alerts for this person (sound; desktop notification while the tab is in the background).
  const openInboxFromAlert = useCallback(() => routerNavigate(inbox), [routerNavigate, inbox]);
  useInboxAlerts(userEmail, openInboxFromAlert);
  const [openPhone, setOpenPhone] = useState<string | null>(null); // conversation to open in the inbox
  const [newChatSignal, setNewChatSignal] = useState(0);  // header "New Chat" -> inbox dialog
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [showDbModal, setShowDbModal] = useState(false);
  const [showRaiseQuery, setShowRaiseQuery] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isSyncingDb, setIsSyncingDb] = useState(false);

  // Business name + number for the header, verify token for the Webhook screen (Business Admin).
  // A paused business answers 403 { paused: true } (counted as an error, never retried).
  const statusQuery = useApi<StatusResponse>('/api/status', { staleTime: 5 * 60000 });
  const s = statusQuery.data;
  const statusInfo = useMemo(() => ({
    phoneNumber: s?.phoneNumber || '',
    verifyToken: s?.verifyToken || '',
    webhookUrl: s?.webhookUrl || '',
    businessName: s?.business?.name || '',
  }), [s]);
  const statusError = statusQuery.error;
  const pausedMessage = statusError instanceof ApiError && statusError.data?.paused ? statusError.data.error || '' : '';
  // Platform maintenance: from the status call, or from any other request (apiClient announces it).
  const [maintenanceSignal] = useMaintenanceSignal();
  const maintenance: MaintenanceInfo | null = maintenanceSignal
    || (statusError instanceof ApiError && statusError.data?.maintenance ? { message: String(statusError.data.error || ''), until: (statusError.data.until as string | null) || null } : null);

  // Ads Meta rejected, or the CRM paused for cost, not yet seen: a badge on the Ads menu (managers).
  // A payment / account problem (Meta pauses every ad) counts too, until it is fixed.
  const adIssues = useApi<{ unread?: number; billingProblem?: { problem: string; label: string } | null }>('/api/ads/issues', { enabled: isManager, staleTime: 5 * 60000 }).data;
  const adIssuesUnread = (adIssues?.unread || 0) + (adIssues?.billingProblem ? 1 : 0);

  // Plan limits near or reached, or a payment due: shown to the Business Admin and managers.
  // (Shared with the Setup page's "Plan and usage" card.)
  const usage = useApi<Usage>('/api/business/usage', { enabled: canManage(userRole) }).data;
  const planNotice = useMemo(() => {
    if (!usage?.metrics) return null;
    const notes: string[] = [];
    if (usage.billing?.state === 'due') notes.push(`Payment due: the plan was paid until ${usage.billing.paidUntil}. The account pauses on ${usage.billing.suspendOn}.`);
    const reached = usage.metrics.filter(m => m.reached).map(m => m.label.toLowerCase());
    const near = usage.metrics.filter(m => m.warning && !m.reached).map(m => m.label.toLowerCase());
    if (reached.length) notes.push(`Plan limit reached: ${reached.join(', ')}.`);
    if (near.length) notes.push(`Over 80% of your plan: ${near.join(', ')}.`);
    return notes.length ? { text: notes.join(' '), urgent: usage.billing?.state === 'due' || reached.length > 0 } : null;
  }, [usage]);


  // WebRTC Audio Call States
  const [callModalOpen, setCallModalOpen] = useState(false);
  const [callState, setCallState] = useState<CallState>('incoming');
  const [callerInfo, setCallerInfo] = useState<CallerInfo | null>(null);
  const [callDuration, setCallDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [recordingBlob, setRecordingBlob] = useState<Blob | null>(null);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [isSavingRecording, setIsSavingRecording] = useState(false);
  const activeCallSessionRef = useRef<WebRTCCallSession | null>(null);
  const callTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Incoming calls from customers ring on THIS business's own channel only. The server sends the alert
  // after checking the signed call link (server/calls.cjs); the channel name comes from /api/status.
  const callChannel = s?.callChannel || null;
  useEffect(() => {
    if (!callChannel) return undefined;
    const incomingCallChannel = supabase.channel(callChannel)
      .on('broadcast', { event: 'incoming_call' }, (message) => {
        const payload = message.payload as { phone?: string; name?: string; roomId?: string } | undefined;
        if (!payload || !payload.phone) return;
        setCallerInfo({
          name: payload.name || `+${payload.phone}`,
          phone: payload.phone,
          roomId: payload.roomId || `room_${payload.phone}`,
          sourceBadge: '📞 Incoming Call'
        });
        setCallState('incoming');
        setCallModalOpen(true);
        startRingtone();
      })
      // WhatsApp voice calls (server/waCalls.cjs): handled by WhatsAppCallPanel.
      .on('broadcast', { event: 'wa_call' }, (m) => emitWaCallEvent('wa_call', m.payload))
      .on('broadcast', { event: 'wa_call_taken' }, (m) => emitWaCallEvent('wa_call_taken', m.payload))
      .on('broadcast', { event: 'wa_call_end' }, (m) => emitWaCallEvent('wa_call_end', m.payload))
      // New-chat alerts (server/inboxAlerts.cjs): handled by useInboxAlerts below.
      .on('broadcast', { event: 'inbox_message' }, (m) => emitInboxAlert('inbox_message', m.payload))
      .on('broadcast', { event: 'inbox_assigned' }, (m) => emitInboxAlert('inbox_assigned', m.payload))
      .subscribe();

    return () => {
      supabase.removeChannel(incomingCallChannel);
    };
  }, [callChannel]);

  // Forget any bot copy an older version left in this browser: it may belong to another business.
  useEffect(() => {
    try { LEGACY_STORAGE_KEYS.forEach(k => localStorage.removeItem(k)); } catch { /* storage blocked */ }
  }, []);

  // This business's bot menus and keyword rules (the server knows which business we are).
  // Managers and the Business Admin only: agents don't see the bot pages.
  useEffect(() => {
    if (!isManager) return;
    apiFetch('/api/bot-catalog')
      .then(res => (res.ok ? res.json() : null))
      .then(data => { if (data?.catalog) setBotCatalog({ ...EMPTY_CATALOG, ...data.catalog }); })
      .catch(() => {})
      .finally(() => setCatalogLoaded(true));
    apiFetch('/api/bot-rules')
      .then(res => (res.ok ? res.json() : null))
      .then(data => { if (Array.isArray(data?.rules)) setBotRules(data.rules); })
      .catch(() => {});
  }, [isManager]);


  const showToast: ShowToast = (text) => {
    setToastMessage(text);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // The chat to open is kept in memory (never in the address: phone numbers stay out of URLs and history).
  const openChatFromPipeline = (phone: string) => { setOpenPhone(phone); setActiveView('chat'); };
  const clearOpenPhone = useCallback(() => setOpenPhone(null), []);
  // A query to open on the Queries screen (from Home or search); its id is not put in the address.
  const [openQueryId, setOpenQueryId] = useState<string | null>(null);
  const openQuery = (id: string) => { setOpenQueryId(id); setActiveView('queries'); };
  const clearOpenQuery = useCallback(() => setOpenQueryId(null), []);
  // Managers: open the Inbox filtered to one person's chats (from Home "Who has what").
  const [inboxAssignee, setInboxAssignee] = useState<string | null>(null);
  const openPersonChats = (email: string) => { setInboxAssignee(email); setActiveView('chat'); };
  const clearInboxAssignee = useCallback(() => setInboxAssignee(null), []);
  const startNewChat = () => { setActiveView('chat'); setNewChatSignal(n => n + 1); };

  // Bot changes go to the server, which saves them for this business only.
  // (Answers: { rules } from /api/bot-rules, { catalog } from /api/bot-catalog.)
  const postJson = async (path: string, body: unknown, method = 'POST'): Promise<{ rules?: BotRule[]; catalog?: BotCatalog; error?: string }> => {
    const res = await apiFetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  };

  const handleSaveBotRule = async (newRule: BotRule) => {
    try {
      const data = await postJson('/api/bot-rules', { rule: newRule });
      setBotRules(data.rules || []);
      showToast(`Rule for "${newRule.keyword}" is now live!`);
    } catch (e) {
      showToast(errorMessage(e));
    }
  };

  const handleDeleteBotRule = async (id: string) => {
    try {
      const data = await postJson(`/api/bot-rules/${encodeURIComponent(id)}`, undefined, 'DELETE');
      setBotRules(data.rules || []);
      showToast('Rule deleted');
    } catch (e) {
      showToast(errorMessage(e));
    }
  };

  const handleToggleBotRule = async (id: string) => {
    const rule = botRules.find(r => r.id === id);
    if (!rule) return;
    try {
      const data = await postJson('/api/bot-rules', { rule: { ...rule, isActive: !rule.isActive } });
      setBotRules(data.rules || []);
    } catch (e) {
      showToast(errorMessage(e));
    }
  };

  // Bot Catalog & Flow Handlers
  const handleSaveCatalog = async (updatedCatalog: BotCatalog) => {
    try {
      const data = await postJson('/api/bot-catalog', { catalog: updatedCatalog });
      setBotCatalog({ ...EMPTY_CATALOG, ...data.catalog });
      showToast('Bot menus and flow saved. The WhatsApp bot uses them now.');
    } catch (e) {
      showToast(errorMessage(e));
    }
  };

  const handleResetCatalog = async () => {
    try {
      const data = await postJson('/api/bot-catalog', { reset: true });
      setBotCatalog({ ...EMPTY_CATALOG, ...data.catalog });
      showToast('Bot menus reset to your starting bot');
    } catch (e) {
      showToast(errorMessage(e));
    }
  };

  // Save the current keyword rules and menus again (e.g. after a connection problem).
  const handleSyncEverythingToDb = async () => {
    setIsSyncingDb(true);
    try {
      await postJson('/api/bot-rules', { rules: botRules });
      await postJson('/api/bot-catalog', { catalog: botCatalog });
      showToast(`✓ Saved ${botRules.length} keyword rules and the bot menus`);
    } catch (err) {
      showToast(errorMessage(err));
    } finally {
      setIsSyncingDb(false);
    }
  };

  // Send the call link (the server logs it to the conversation).
  const sendWhatsAppTextMessage = async (recipientNumber: string, text: string) => {
    try {
      const res = await apiFetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: recipientNumber, message: text })
      });
      if (!res.ok) showToast('Could not send the call link: the customer may need to message you first (24-hour rule).');
    } catch {
      showToast('Could not send the call link');
    }
  };

  const handleStartCall = async (contact: CallTarget) => {
    if (!contact) return;
    // The server makes the link: a random room and a signed token (server/calls.cjs).
    let link: { url: string; roomId: string };
    try {
      link = await api<{ url: string; roomId: string }>('/api/calls/link', { method: 'POST', body: { phone: contact.number, name: contact.name } });
    } catch (e) {
      showToast(errorMessage(e));
      return;
    }
    const { roomId } = link;
    const info: CallerInfo = {
      name: contact.name,
      phone: contact.number,
      roomId: roomId,
      sourceBadge: contact.sourceBadge || '📞 Outbound Call'
    };
    setCallerInfo(info);
    setCallState('connected');
    setCallModalOpen(true);
    setCallDuration(0);
    setIsMuted(false);
    setRecordingBlob(null);
    setRecordingUrl(null);

    const inviteText = `📞 *${statusInfo.businessName || 'Our team'}: voice call*\n\nOur team is calling you! Tap the link below to speak directly with our team on an audio call:\n${link.url}`;
    sendWhatsAppTextMessage(contact.number, inviteText);

    const session = new WebRTCCallSession({
      roomId,
      isInitiator: true,
      onConnected: () => {
        if (callTimerRef.current) clearInterval(callTimerRef.current);
        callTimerRef.current = setInterval(() => setCallDuration(p => p + 1), 1000);
      },
      onCallEnd: (blob) => {
        handleCallFinished(blob, info, roomId);
      }
    });

    activeCallSessionRef.current = session;
    try {
      await session.init();
    } catch (err) {
      console.warn('Microphone error:', err);
      showToast('Please grant microphone permission to call');
    }
  };

  const handleAcceptCall = async () => {
    stopRingtone();
    setCallState('connected');
    setCallDuration(0);
    setIsMuted(false);

    if (callTimerRef.current) clearInterval(callTimerRef.current);
    callTimerRef.current = setInterval(() => setCallDuration(p => p + 1), 1000);

    const session = new WebRTCCallSession({
      // The incoming-call listener always sets a room (or room_<phone>).
      roomId: callerInfo?.roomId || `room_${callerInfo?.phone || ''}`,
      isInitiator: false,
      onCallEnd: (blob) => {
        handleCallFinished(blob, callerInfo, callerInfo?.roomId);
      }
    });

    activeCallSessionRef.current = session;
    try {
      await session.init();
    } catch (err) {
      console.warn('Microphone error:', err);
      showToast('Microphone access required to answer call');
    }
  };

  const handleDeclineCall = () => {
    stopRingtone();
    setCallModalOpen(false);
    setCallState('incoming');
    if (callerInfo?.phone) {
      sendWhatsAppTextMessage(callerInfo.phone,'📞 Sorry we missed your call. Someone from our team will message you right here shortly.');
    }
  };

  const handleHangupCall = async () => {
    if (callTimerRef.current) {
      clearInterval(callTimerRef.current);
      callTimerRef.current = null;
    }
    if (activeCallSessionRef.current) {
      const blob = await activeCallSessionRef.current.endCall(true);
      handleCallFinished(blob, callerInfo, callerInfo?.roomId);
    }
  };

  const handleCallFinished = async (blob: Blob | null, contactOrCaller: CallParty, roomId: string | undefined) => {
    if (callTimerRef.current) {
      clearInterval(callTimerRef.current);
      callTimerRef.current = null;
    }
    setCallState('ended');
    setRecordingBlob(blob);

    if (blob) {
      try {
        setRecordingUrl(URL.createObjectURL(blob));
      } catch { /* no local preview: the saved link below still works */ }

      setIsSavingRecording(true);
      try {
        const savedUrl = await saveCallRecording({
          phone: contactOrCaller?.phone || contactOrCaller?.number || '',
          callerName: contactOrCaller?.name,
          duration: callDuration,
          blob,
          roomId
        });
        if (savedUrl) setRecordingUrl(savedUrl);

        showToast('Call ended & audio recording saved to Supabase!');
      } catch (e) {
        console.warn('Call recording save exception:', e);
      } finally {
        setIsSavingRecording(false);
      }
    }
  };

  const handleToggleMute = () => {
    if (activeCallSessionRef.current) {
      const muted = activeCallSessionRef.current.toggleMute();
      setIsMuted(muted);
    }
  };

  /** One screen's route (path relative to the area, or to /settings); managers' screens behind the role guard. */
  const screenRoute = (view: View, element: ReactNode) => {
    const path = SCREENS[view].group === 'settings' ? SCREENS[view].path.slice(SETTINGS_PATH.length + 1) : SCREENS[view].path;
    return <Route key={view} path={`${path}/*`} element={<ManagersOnly allowed={canOpen(view, isManager)} inbox={inbox}>{element}</ManagersOnly>} />;
  };

  // ---- The frame: side menu (desktop), tab bar (phones), bell, search (src/AppShell.tsx) ----
  const item = (view: View, extra: Partial<ShellItem> = {}): ShellItem | null => {
    const n = allowed.find(x => x.view === view);
    return n ? { key: view, label: n.label, to: urlOf(base, view), icon: n.icon, active: activeView === view, ...extra } : null;
  };
  const pick = (items: Array<ShellItem | null>) => items.filter((x): x is ShellItem => !!x);
  const notices = useNotifications(useCallback((v: 'chat' | 'queries') => urlOf(base, v), [base]));
  const countOf = (keys: string[]) => notices.filter(n => keys.includes(n.key)).reduce((s, n) => s + (n.count || 0), 0);
  const workItems = pick([
    item('home'),
    item('chat', { badge: countOf(['myChats', 'newChats']) }),
    item('pipeline'),
    item('leads'),
    item('queries', { badge: countOf(['overdueQueries', 'newQueries', 'teamQueries']) }),
  ]);
  const growItems = pick([
    item('broadcasts'),
    item('ads', { badge: adIssuesUnread }),
    item('analytics'),
  ]);
  // Settings in two plain groups (U4): the business itself, and how the bot / AI answer customers.
  const settingsBusiness = pick((['setup', 'whatsapp', 'team', 'lead_statuses', 'lead_assignment'] as View[]).filter(v => settingsNav.some(n => n.view === v)).map(v => item(v)));
  const settingsBot = pick((['flow', 'bot_config', 'ai'] as View[]).filter(v => settingsNav.some(n => n.view === v)).map(v => item(v)));
  const youItems = pick([item('profile')]);
  const groups: ShellGroup[] = [
    { title: 'Work', items: workItems },
    { title: 'Grow', items: growItems },
    { title: 'Business settings', items: settingsBusiness },
    { title: 'Bot & AI', items: settingsBot },
    { title: 'You', items: youItems },
  ];
  const [sideCollapsed, toggleSide] = useSidebarCollapsed();
  const bellItems: BellItem[] = [
    ...notices,
    ...(adIssuesUnread > 0 ? [{ key: 'ads', count: adIssuesUnread, label: `${adIssuesUnread} ${adIssuesUnread === 1 ? 'ad needs' : 'ads need'} attention`, to: urlOf(base, 'ads'), level: 'urgent' as const }] : []),
    ...(planNotice ? [{ key: 'plan', label: planNotice.text, to: urlOf(base, 'setup'), level: planNotice.urgent ? 'urgent' as const : 'normal' as const }] : []),
  ];
  // Search (Ctrl+K): every page this role may open, plus the everyday actions.
  const [showSearch, setShowSearch] = useState(false);
  const openSearch = useCallback(() => setShowSearch(true), [setShowSearch]);
  useCommandShortcut(openSearch);
  const paletteActions: PaletteAction[] = [
    { key: 'new-chat', label: 'Start a new chat', hint: 'Action', icon: Plus, run: () => startNewChat() },
    { key: 'raise', label: 'Raise a query', hint: 'Action', icon: LifeBuoy, run: () => setShowRaiseQuery(true) },
    ...allowed.map(n => ({ key: n.view, label: n.label, hint: SCREENS[n.view].group === 'settings' ? 'Settings' : 'Page', icon: n.icon, run: () => setActiveView(n.view) })),
    ...(isManager ? [
      { key: 'webhook', label: 'Webhook details (callback URL, verify token)', hint: 'Settings', icon: Radio, run: () => setShowSetupModal(true) },
      { key: 'data', label: 'Data and sync', hint: 'Settings', icon: Database, run: () => setShowDbModal(true) },
    ] : []),
  ];
  const moreExtra = (
    <div className="space-y-1">
      <button data-closes onClick={() => setShowRaiseQuery(true)} className="w-full flex items-center gap-3 rounded-lg px-3 py-3 text-base text-slate-700 cursor-pointer"><LifeBuoy className="w-5 h-5" aria-hidden="true" /> Raise a query</button>
      <LargeTextToggle />
      <button data-closes onClick={onSignOut} className="w-full flex items-center gap-3 rounded-lg px-3 py-3 text-base text-red-700 cursor-pointer"><LogOut className="w-5 h-5" aria-hidden="true" /> Sign out</button>
    </div>
  );

  if (maintenance) {
    // Back to normal: reload, so every screen fetches fresh data.
    return <MaintenanceScreen info={maintenance} onBack={() => window.location.reload()} footer={<SignOutButton email={userEmail} onSignOut={onSignOut} />} />;
  }

  if (pausedMessage) {
    return (
      <div className="min-h-screen bg-slate-200 flex items-center justify-center px-4">
        <div className="bg-white rounded-xl shadow-lg w-full max-w-sm p-6 space-y-3">
          <h1 className="text-lg font-bold text-slate-800">Account paused</h1>
          <p className="text-sm text-slate-600">{pausedMessage}</p>
          <p className="text-xs text-slate-500">Your data is safe. Everything comes back as soon as the platform resumes the account.</p>
          <SignOutButton email={userEmail} onSignOut={onSignOut} />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-200 h-screen flex flex-col font-sans text-wa-textPrimary overflow-hidden">
      
      {/* Top Header */}
      <header className="bg-wa-teal text-white shadow z-20 text-xs">
        <div className="px-3 sm:px-4 h-14 flex items-center gap-3">
          {/* Business and who is signed in */}
          <div className="flex items-center gap-2.5 min-w-0 flex-shrink-0">
            {/* The application's logo (Platform Admin -> Branding); the business's own name next to it. */}
            <span title={appName}><BrandLogo size={32} tone="bg-wa-green" /></span>
            <div className="min-w-0 leading-tight">
              <div className="font-bold text-sm truncate max-w-[110px] sm:max-w-[220px]">{statusInfo.businessName || appName}</div>
              <div className="flex items-center gap-1.5 text-xs text-teal-100">
                {statusInfo.phoneNumber && <span className="hidden sm:inline">+{String(statusInfo.phoneNumber).replace(/^\+/, '')}</span>}
                <span className="bg-white/15 rounded px-1.5 py-px font-semibold text-white">{ROLE_LABEL[userRole] || userRole}</span>
              </div>
            </div>
          </div>

          {/* Search: contacts, pages and actions (Ctrl+K). */}
          <div className="flex-1 flex justify-end md:justify-center min-w-0"><SearchButton onOpen={openSearch} /></div>

          {/* Everyday actions only; setup tools (webhook, data) are in Settings and in search. */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {/* AI replies: managers switch it; agents just see whether it's on. */}
            <AiModeToggle variant="header" showToast={showToast} />
            <NotificationBell items={bellItems} />
            {/* Phones: the Inbox has its own "+" (and search has "Start a new chat"), so the bar stays uncrowded. */}
            <button onClick={startNewChat} aria-label="New chat"
              className="hidden sm:flex bg-white text-wa-teal hover:bg-slate-100 font-semibold px-3 h-9 rounded-lg shadow items-center gap-1 transition cursor-pointer">
              <Plus className="w-4 h-4" /><span className="hidden sm:inline text-sm">New chat</span>
            </button>
            <ProfileMenu email={userEmail} role={userRole} profileTo={urlOf(base, 'profile')} onRaiseQuery={() => setShowRaiseQuery(true)} onSignOut={onSignOut} />
          </div>
        </div>
      </header>
      {planNotice && (
        <button onClick={() => setActiveView('setup')} className={`text-left border-b px-4 py-2 text-xs cursor-pointer ${planNotice.urgent ? 'bg-red-50 border-red-200 text-red-800' : 'bg-amber-50 border-amber-200 text-amber-900'}`}>
          {planNotice.text} <span className="underline font-semibold">See plan and usage</span>
        </button>
      )}

      {/* Side menu (desktop) + the screen; on phones the tab bar is at the bottom (room kept with pb-16). */}
      <div className="flex-1 min-h-0 flex">
      <SideNav groups={groups} collapsed={sideCollapsed} onToggle={toggleSide} />
      <div className="flex-1 min-w-0 min-h-0 flex flex-col pb-16 md:pb-0">

      {/* The screens: one route each under /app (src/appRoutes.ts). Managers' screens are guarded here and on the
          server. One crash stays inside its screen (the key resets it when the screen changes). */}
      <ErrorBoundary key={activeView || 'none'} name={activeView || 'route'}>
      <Suspense fallback={<ScreenLoading />}>
      <Routes>
        <Route index element={<Navigate to={urlOf(base, 'home')} replace />} />
        {screenRoute('home', <HomeScreen me={{ email: userEmail, role: userRole }} onOpenChat={openChatFromPipeline} onOpenQuery={openQuery} onOpenPersonChats={isManager ? openPersonChats : undefined} showToast={showToast} onGo={(view) => { if (view in SCREENS) setActiveView(view as View); }} />)}
        {screenRoute('chat', (
          <InboxScreen
            me={{ email: userEmail, role: userRole }}
            onStartCall={handleStartCall}
            showToast={showToast}
            openPhone={openPhone}
            onOpenPhoneHandled={clearOpenPhone}
            openAssignee={inboxAssignee}
            onOpenAssigneeHandled={clearInboxAssignee}
            newChatSignal={newChatSignal}
          />
        ))}
        {screenRoute('pipeline', <PipelineScreen onOpenChat={openChatFromPipeline} showToast={showToast} />)}
        {screenRoute('leads', <LeadsScreen me={{ email: userEmail, role: userRole }} showToast={showToast} onOpenChat={openChatFromPipeline} />)}
        {screenRoute('queries', <QueriesScreen me={{ email: userEmail, role: userRole }} showToast={showToast} onOpenChat={openChatFromPipeline} onRaise={() => setShowRaiseQuery(true)} openQueryId={openQueryId} onOpenQueryHandled={clearOpenQuery} />)}
        {screenRoute('broadcasts', <BroadcastsScreen showToast={showToast} />)}
        {screenRoute('analytics', <AnalyticsScreen />)}
        {screenRoute('ads', <AdsScreen userRole={userRole} showToast={showToast} basePath={urlOf(base, 'ads')} />)}
        {screenRoute('profile', <ProfileScreen showToast={showToast} />)}
        {/* Settings area: how the business is configured. */}
        <Route path={`${SETTINGS_PATH}/*`} element={(
          <ManagersOnly allowed={isManager} inbox={inbox}>
            <SettingsArea base={base} items={settingsNav}>
              <Routes>
                <Route index element={<Navigate to={urlOf(base, 'setup')} replace />} />
                {screenRoute('setup', <SetupScreen userRole={userRole} showToast={showToast} onGo={(view) => { if (view in SCREENS) setActiveView(view as View); }} onProfileSaved={() => refreshApi('/api/status')} />)}
                {screenRoute('whatsapp', <WhatsAppScreen showToast={showToast} onShowWebhook={() => setShowSetupModal(true)} onShowData={() => setShowDbModal(true)} />)}
                {screenRoute('team', <TeamScreen showToast={showToast} />)}
                {screenRoute('lead_statuses', <LeadStatusesScreen showToast={showToast} />)}
                {screenRoute('lead_assignment', <LeadAssignmentScreen showToast={showToast} />)}
                {screenRoute('flow', (
                  // Arogya Ruchulu's food bot has its own editor; every other business gets the basic flow.
                  // (Wait for the catalog: until then we don't know which bot this business has.)
                  !catalogLoaded ? <ScreenLoading /> : botCatalog.foodBuiltIns
                    ? <BotFlowScreen catalog={botCatalog} onSaveCatalog={handleSaveCatalog} onResetCatalog={handleResetCatalog} />
                    : <GenericBotFlow catalog={botCatalog} onSaveCatalog={handleSaveCatalog} onResetCatalog={handleResetCatalog} />
                ))}
                {screenRoute('bot_config', <BotConfigScreen botRules={botRules} onSaveRule={handleSaveBotRule} onDeleteRule={handleDeleteBotRule} onToggleRule={handleToggleBotRule} />)}
                {screenRoute('ai', <AiAssistantScreen showToast={showToast} />)}
                <Route path="*" element={<ScreenNotFound inbox={inbox} />} />
              </Routes>
            </SettingsArea>
          </ManagersOnly>
        )} />
        {/* Addresses from before the Settings area (/admin/team, old /app/team links) open the new place. */}
        {(['setup', 'whatsapp', 'team', 'flow', 'bot_config', 'ai'] as View[]).map(v => (
          <Route key={`old-${v}`} path={`${SCREENS[v].path.slice(SETTINGS_PATH.length + 1)}/*`} element={<Navigate to={urlOf(base, v)} replace />} />
        ))}
        <Route path="*" element={<ScreenNotFound inbox={inbox} />} />
      </Routes>
      </Suspense>
      </ErrorBoundary>
      </div>
      </div>

      {/* Phones: tab bar with the daily screens; everything else under "More". */}
      <BottomBar main={workItems} more={[{ title: 'Grow', items: growItems }, { title: 'Business settings', items: settingsBusiness }, { title: 'Bot & AI', items: settingsBot }, { title: 'You', items: youItems }]} extra={moreExtra} />

      {showSearch && <CommandPalette actions={paletteActions} onOpenContact={openChatFromPipeline} onOpenQuery={openQuery} onClose={() => setShowSearch(false)} />}

      {/* Data and sync (managers; opened from Settings -> WhatsApp or search) */}
      <DbSyncModal
        isOpen={showDbModal}
        onClose={() => setShowDbModal(false)}
        onSyncEverything={handleSyncEverythingToDb}
        isSyncingDb={isSyncingDb}
        showToast={showToast}
      />

      {/* Meta Webhook Setup Modal */}
      <WebhookSetupModal
        isOpen={showSetupModal}
        onClose={() => setShowSetupModal(false)}
        statusInfo={statusInfo}
        showToast={showToast}
      />

      {/* WebRTC Live Audio Call Modal */}
      <CallModal
        isOpen={callModalOpen}
        callState={callState}
        callerInfo={callerInfo}
        callDuration={callDuration}
        isMuted={isMuted}
        recordingBlob={recordingBlob}
        recordingUrl={recordingUrl}
        isSavingRecording={isSavingRecording}
        onAccept={handleAcceptCall}
        onDecline={handleDeclineCall}
        onHangup={handleHangupCall}
        onToggleMute={handleToggleMute}
        onClose={() => setCallModalOpen(false)}
      />

      {/* Incoming WhatsApp voice calls (customer pressed call in WhatsApp) */}
      <WhatsAppCallPanel showToast={showToast} />

      {/* Toast Notification */}
      {showRaiseQuery && <RaiseQueryModal role={userRole} onClose={() => setShowRaiseQuery(false)} showToast={showToast} />}

      {toastMessage && (
        <div role="status" className="fixed bottom-20 md:bottom-4 right-4 left-4 sm:left-auto bg-slate-900 text-white text-sm px-4 py-2.5 rounded-lg shadow-xl z-50 flex items-center gap-2">
          <Check className="w-4 h-4 text-wa-green" />
          <span>{toastMessage}</span>
        </div>
      )}

    </div>
  );
}
