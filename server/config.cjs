// @ts-check
// Central configuration. Every secret comes from environment variables only:
// never hard-code tokens here (they end up in zips, git and deploy bundles).
require('dotenv').config();

/** @param {string} key @param {string} [fallback] */
const env = (key, fallback = '') => (process.env[key] || fallback).trim();

const config = {
  port: Number(env('PORT', '3000')),

  // Meta / WhatsApp Cloud API
  whatsappToken: env('WHATSAPP_TOKEN'),
  phoneNumber: env('PHONE_NUMBER'),
  phoneNumberId: env('PHONE_NUMBER_ID'),
  // WhatsApp Business Account ID (Meta app -> WhatsApp -> API Setup). Needed for templates.
  wabaId: env('WABA_ID'),
  verifyToken: env('VERIFY_TOKEN'),
  appSecret: env('APP_SECRET'), // Meta App Dashboard -> App settings -> Basic -> App secret
  graphApiVersion: env('GRAPH_API_VERSION', 'v26.0'),
  // Escape hatch for local testing with hand-written webhook payloads. Never enable in production.
  allowUnsignedWebhooks: env('ALLOW_UNSIGNED_WEBHOOKS') === 'true',

  // Supabase
  supabaseUrl: env('SUPABASE_URL') || env('VITE_SUPABASE_URL'),
  // Public (anon / publishable) key: only used to validate staff login tokens.
  supabaseAnonKey: env('SUPABASE_ANON_KEY') || env('VITE_SUPABASE_ANON_KEY'),
  // Secret (service_role / sb_secret_...) key: server-side only, bypasses RLS for webhook writes.
  supabaseServiceKey: env('SUPABASE_SERVICE_ROLE_KEY'),

  // Public site URL used in customer-facing links (call page).
  publicSiteUrl: env('PUBLIC_SITE_URL', 'https://monumental-semolina-e9f403.netlify.app').replace(/\/$/, ''),
};

function missingConfig() {
  const required = {
    WHATSAPP_TOKEN: config.whatsappToken,
    PHONE_NUMBER_ID: config.phoneNumberId,
    VERIFY_TOKEN: config.verifyToken,
    APP_SECRET: config.appSecret,
    SUPABASE_URL: config.supabaseUrl,
    SUPABASE_ANON_KEY: config.supabaseAnonKey,
    SUPABASE_SERVICE_ROLE_KEY: config.supabaseServiceKey,
  };
  return Object.entries(required).filter(([, v]) => !v).map(([k]) => k);
}

module.exports = { config, missingConfig };
