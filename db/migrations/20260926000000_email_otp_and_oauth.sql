-- ── Email OTP + OAuth users ───────────────────────────────────────────────────
-- Adds the 6-digit one-time-passcode table for the email verification flow
-- (signup + sign-in), and relaxes `users.password_hash` to nullable so
-- Google-OAuth accounts (no local password) can be stored in the same table.

-- 1. password_hash becomes nullable (OAuth users have no local credential).
ALTER TABLE public.users
  ALTER COLUMN password_hash DROP NOT NULL;

-- 2. OTP codes: one row per issued code. Codes are stored as a bcrypt hash —
--    the plaintext exists only in the verification email.
CREATE TABLE IF NOT EXISTS public.otp_codes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email        text        NOT NULL,
  code_hash    text        NOT NULL,
  purpose      text        NOT NULL DEFAULT 'signup'
               CHECK (purpose IN ('signup', 'login')),
  attempts     integer     NOT NULL DEFAULT 0,
  consumed     boolean     NOT NULL DEFAULT false,
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Fast lookup of the newest active code for an email (+ cleanup sweeps).
CREATE INDEX IF NOT EXISTS otp_codes_email_created_idx
  ON public.otp_codes (email, created_at DESC);

-- NextAuth account linking (provider ↔ user). Created on first Google login;
-- used by the signIn callback to attach OAuth identities to existing accounts.
CREATE TABLE IF NOT EXISTS public.accounts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  provider          text        NOT NULL,
  provider_account_id text      NOT NULL,
  access_token      text,
  token_type        text,
  scope             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_account_id)
);

CREATE INDEX IF NOT EXISTS accounts_user_id_idx ON public.accounts (user_id);
