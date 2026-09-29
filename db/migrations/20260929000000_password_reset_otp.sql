-- ── Password-reset OTP (forgot-password flow) ────────────────────────────────
-- Broadens otp_codes.purpose to accept 'password_reset' alongside the existing
-- 'signup'/'login' values, and opportunistically removes stale rows.

ALTER TABLE public.otp_codes
  DROP CONSTRAINT IF EXISTS otp_codes_purpose_check;

ALTER TABLE public.otp_codes
  ADD CONSTRAINT otp_codes_purpose_check
  CHECK (purpose IN ('signup', 'login', 'password_reset'));

DELETE FROM public.otp_codes WHERE expires_at < now() - interval '24 hours';
