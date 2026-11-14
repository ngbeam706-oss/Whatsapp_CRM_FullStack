-- Clinic: how the patient will pay, chosen when booking (docs/progress/clinic.md).
--   razorpay_link = online payment link (Razorpay marks it paid), cash, upi_desk = PhonePe / UPI, card_desk = card,
--   other. Everything except online is marked paid by the staff (with the payment's reference ID, except cash).
-- Server-only like the rest of the clinic tables. Safe to re-run.
alter table public.clinic_appointments add column if not exists payment_method text;
alter table public.clinic_appointments drop constraint if exists clinic_appointments_payment_method_check;
alter table public.clinic_appointments add constraint clinic_appointments_payment_method_check
  check (payment_method is null or payment_method in ('razorpay_link', 'cash', 'upi_desk', 'card_desk', 'other'));

-- Check:
select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'clinic_appointments' and column_name = 'payment_method';
