import { Database, Users, X } from 'lucide-react';
import type { ShowToast } from './types';

interface DbSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSyncEverything: () => void;
  isSyncingDb: boolean;
  showToast: ShowToast;
}

export default function DbSyncModal({
  isOpen,
  onClose,
  onSyncEverything,
  isSyncingDb,
  showToast
}: DbSyncModalProps) {
  if (!isOpen) return null;

  const copySqlScript = () => {
    const sql = `-- Staff-only access. Run supabase/migrations/20261106_phase1_lockdown.sql first:
-- it creates staff_members and public.is_staff() used below.

-- 1. WhatsApp Leads (with Marketing Attribution)
CREATE TABLE IF NOT EXISTS whatsapp_leads (
  phone TEXT PRIMARY KEY,
  name TEXT,
  last_message TEXT,
  source TEXT DEFAULT 'Direct WhatsApp',
  referral JSONB,
  last_contacted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  status TEXT DEFAULT 'active'
);
ALTER TABLE whatsapp_leads ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'Direct WhatsApp';
ALTER TABLE whatsapp_leads ADD COLUMN IF NOT EXISTS referral JSONB;
ALTER TABLE whatsapp_leads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "staff full access" ON whatsapp_leads;
CREATE POLICY "staff full access" ON whatsapp_leads FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

-- 2. WhatsApp Messages & Audio Call Recordings
CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id BIGSERIAL PRIMARY KEY,
  message_id TEXT,
  direction TEXT,
  sender TEXT,
  sender_name TEXT,
  recipient TEXT,
  body TEXT,
  type TEXT,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "staff full access" ON whatsapp_messages;
CREATE POLICY "staff full access" ON whatsapp_messages FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

-- 3. WhatsApp Bot Rules
CREATE TABLE IF NOT EXISTS whatsapp_bot_rules (
  id TEXT PRIMARY KEY,
  keyword TEXT NOT NULL,
  match_type TEXT DEFAULT 'contains',
  response_type TEXT DEFAULT 'text',
  response_text TEXT NOT NULL,
  buttons JSONB DEFAULT '[]'::jsonb,
  is_active BOOLEAN DEFAULT true,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
ALTER TABLE whatsapp_bot_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "staff full access" ON whatsapp_bot_rules;
CREATE POLICY "staff full access" ON whatsapp_bot_rules FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

-- 4. WhatsApp Bot Catalog & Menu Flow
CREATE TABLE IF NOT EXISTS whatsapp_catalog (
  id TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
ALTER TABLE whatsapp_catalog ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "staff full access" ON whatsapp_catalog;
CREATE POLICY "staff full access" ON whatsapp_catalog FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());`;

    navigator.clipboard.writeText(sql);
    showToast('Copied Supabase SQL Setup Script!');
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
      <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full overflow-hidden border border-slate-200">
        <div className="bg-wa-teal text-white px-5 py-3.5 flex items-center justify-between">
          <h3 className="font-bold text-sm flex items-center gap-2">
            <Database className="w-4 h-4 text-emerald-300" /> Supabase Cloud Database Connected
          </h3>
          <button onClick={onClose} className="text-teal-200 hover:text-white cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-3.5 text-xs text-slate-600">
          <div>
            <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">Supabase Project URL</label>
            <div className="bg-slate-50 border border-slate-300 rounded p-2 font-mono text-emerald-800 select-all break-all">
              https://fgflvtxqdlchclrfybca.supabase.co
            </div>
          </div>

          <div>
            <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">Leads Table</label>
            <div className="bg-slate-50 border border-slate-300 rounded p-2 text-slate-700">
              <code className="text-emerald-700 font-bold">whatsapp_leads</code>
              <p className="text-xs text-slate-500 mt-1">Stores contact phone number, name, marketing source (Instagram Ad, Bio, Web), and last contact timestamp.</p>
            </div>
          </div>

          <div>
            <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">Messages & Call Recordings Table</label>
            <div className="bg-slate-50 border border-slate-300 rounded p-2 text-slate-700">
              <code className="text-emerald-700 font-bold">whatsapp_messages</code>
              <p className="text-xs text-slate-500 mt-1">Logs every inbound, outbound, and completed audio call recording with timestamp.</p>
            </div>
          </div>

          <div>
            <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">Bot Rules & Catalog Tables</label>
            <div className="bg-slate-50 border border-slate-300 rounded p-2 text-slate-700">
              <code className="text-emerald-700 font-bold">whatsapp_bot_rules & whatsapp_catalog</code>
              <p className="text-xs text-slate-500 mt-1">Stores trigger keywords, your bot menus and services list, and the flow messages.</p>
            </div>
          </div>

          <div className="bg-emerald-50 border border-emerald-200 rounded p-3 text-xs text-emerald-800 space-y-2">
            <div className="font-bold flex items-center justify-between">
              <span>⚡ Automatic Real-Time Cloud Sync:</span>
              <button
                type="button"
                onClick={copySqlScript}
                className="bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold px-2 py-1 rounded transition cursor-pointer"
              >
                📋 Copy Supabase SQL Script
              </button>
            </div>
            <p>Every customer message, bot reply, call recording, and menu item updates live in your cloud database.</p>
          </div>
        </div>

        <div className="bg-slate-50 px-5 py-3 border-t border-slate-200 flex flex-wrap gap-2 justify-between items-center">
          <button 
            type="button"
            onClick={onSyncEverything}
            disabled={isSyncingDb}
            className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-3.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer flex items-center gap-1.5 shadow-sm transition"
          >
            <Users className={`w-3.5 h-3.5 ${isSyncingDb ? 'animate-spin' : ''}`} />
            <span>{isSyncingDb ? 'Pushing Data to Supabase...' : '🚀 Push All Current App Data to Supabase Now'}</span>
          </button>
          <button 
            type="button"
            onClick={onClose} 
            className="bg-slate-700 hover:bg-slate-800 text-white px-4 py-1.5 rounded-lg text-xs font-medium cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

