-- ── Telegram bot user authentication & linking ────────────────────────
-- Lets an owner verify themselves to the bot directly in chat:
--   /start → share phone (Telegram contact button) → account email →
--   app password / verification PIN → is_verified = true.
--
-- The webhook arrives with NO tenant context (Telegram knows nothing
-- about our sessions), so the phone+email → chat_id mapping lives in
-- the public schema, exactly like telegram_link_tokens and
-- store_registry: it must be resolvable from an inbound update alone.
--
-- Two schema changes:
--
--   public.telegram_sessions — the per-chat conversation state AND the
--     verified mapping (chat_id → user, phone, email). `state` tracks
--     which step of the flow the chat is on between webhook calls,
--     because Telegram webhooks are stateless.
--
--   public.users.telegram_chat_id / phone_number — denormalized mirror
--     of the latest verified binding, so a chat id can be resolved to
--     its account (and a phone number is kept on the user record).

create table if not exists public.telegram_sessions (
  chat_id text primary key,
  user_id uuid references public.users (id) on delete set null,
  phone_number text,
  email text,
  is_verified boolean not null default false,
  verified_at timestamptz,
  -- awaiting_phone | awaiting_email | awaiting_pin | verified
  state text not null default 'awaiting_phone',
  -- Failed PIN attempts; AUTH_MAX_ATTEMPTS locks the chat.
  attempts integer not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Resolve a verified chat to its user (callback queries, future authed APIs).
create index if not exists telegram_sessions_user_idx
  on public.telegram_sessions (user_id) where is_verified;

-- One verified binding per phone / per email is the lookup the flow
-- documents: phone_number + email → telegram_chat_id.
create index if not exists telegram_sessions_phone_idx
  on public.telegram_sessions (phone_number) where is_verified;
create index if not exists telegram_sessions_email_idx
  on public.telegram_sessions (email) where is_verified;

-- ── User-side mirror columns ──────────────────────────────────────
alter table public.users add column if not exists telegram_chat_id text;
alter table public.users add column if not exists phone_number text;

-- A chat id can belong to at most one account (latest verification wins).
create unique index if not exists users_telegram_chat_id_key
  on public.users (telegram_chat_id) where telegram_chat_id is not null;
