-- ── Telegram user authentication & linking (users + telegram_sessions) ─────────
-- Adds Telegram bot user authentication fields to public.users and creates a new
-- public.telegram_sessions table that tracks the multi-step auth flow:
--   Step 1: user sends /start → bot requests contact (phone)
--   Step 2: bot asks for Gmail / account email
--   Step 3: bot asks for App Password / Verification PIN
--   Step 4: bot verifies phone+email+PIN against Supabase, sets is_verified=true
--           and stores the mapping (phone_number + email → telegram_chat_id).
--
-- The telegram_sessions table is the "scratchpad" for an in-progress flow; once
-- verified it also becomes the permanent mapping record (is_verified=true,
-- user_id set). A user row's telegram_chat_id is denormalized from here for
-- fast lookups.

-- ── 1. Extend public.users with Telegram auth columns ─────────────────────────
alter table public.users
  add column if not exists telegram_chat_id text,
  add column if not exists phone_number text,
  add column if not exists is_verified boolean not null default false;

create unique index if not exists users_telegram_chat_id_idx
  on public.users (telegram_chat_id) where telegram_chat_id is not null;

comment on column public.users.telegram_chat_id is
  'Telegram chat id bound to this user account (numeric string).';
comment on column public.users.phone_number is
  'Phone number shared via Telegram contact request (E.164, e.g. +966501234567).';
comment on column public.users.is_verified is
  'Whether the user has completed the Telegram verification flow.';

-- ── 2. Create public.telegram_sessions ─────────────────────────────────────────
create table if not exists public.telegram_sessions (
  id              uuid primary key default gen_random_uuid(),
  telegram_chat_id  text not null unique,   -- Telegram numeric chat id (primary contact channel)
  phone_number      text,                    -- E.164 phone from request_contact (e.g. +966501234567)
  email             text,                    -- Gmail / account email entered in step 2
  verification_pin_hash text,                -- bcrypt hash of the app password / PIN (step 3)
  is_verified       boolean not null default false, -- true once PIN verified against Supabase
  user_id           uuid references public.users (id) on delete cascade, -- FK once linked
  updated_at        timestamptz not null default now(),  -- last bot interaction
  linked_at         timestamptz             -- when the session was fully verified & linked
);

comment on table public.telegram_sessions is
  'Multi-step Telegram bot auth flow state + verified chat→user mapping.';
comment on column public.telegram_sessions.telegram_chat_id is
  'Telegram numeric chat id — the primary key for the bot interaction.';
comment on column public.telegram_sessions.phone_number is
  'E.164 phone number from Telegram contact request (e.g. +966501234567).';
comment on column public.telegram_sessions.email is
  'Gmail / account email entered by the user in step 2.';
comment on column public.telegram_sessions.verification_pin_hash is
  'bcrypt hash of the app password / verification PIN (step 3).';
comment on column public.telegram_sessions.is_verified is
  'Whether the PIN has been verified against the Supabase database.';
comment on column public.telegram_sessions.user_id is
  'FK to the verified user account, once linked.';
comment on column public.telegram_sessions.linked_at is
  'When the session was fully verified & linked to a user account.';

create index if not exists telegram_sessions_chat_idx
  on public.telegram_sessions (telegram_chat_id);

create index if not exists telegram_sessions_phone_email_idx
  on public.telegram_sessions (phone_number, email)
  where phone_number is not null and email is not null;
