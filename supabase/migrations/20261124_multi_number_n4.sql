-- Several WhatsApp numbers per business, phase N4: the rest follows the number. Safe to re-run; only adds.
--   * campaigns.phone_number_id: the business number a broadcast is sent from (null = the main number).
--   * whatsapp_numbers.welcome_message: an optional welcome text for one extra number (null = the bot's welcome).

alter table public.campaigns add column if not exists phone_number_id text
  check (phone_number_id is null or phone_number_id ~ '^\d{5,30}$');

alter table public.whatsapp_numbers add column if not exists welcome_message text
  check (welcome_message is null or char_length(welcome_message) <= 1024);
