-- Card payments through Stripe Checkout. Run this once in the Supabase SQL editor; it is idempotent, so
-- re-running it changes nothing.
--
-- It adds no way to move a coin. Granting is still public.grant_purchase and refunding is still
-- public.refund_purchase, both from supabase/paid-tries.sql, both already safe to call twice. What this file
-- adds is what Stripe calls a purchase, and a record of every webhook event already acted on:
--
--   purchases.provider_ref           the Checkout Session the player paid on (cs_...), shown on the admin page
--   purchases.provider_payment_ref   the payment behind it (pi_...), which is how a refund or a dispute —
--                                    which arrive as a charge, not as a session — is traced back to a purchase
--   payment_events                   one row per Stripe event id, so an event delivered twice is acted on once
--
-- Coins are granted only by /api/stripe, from an event whose signature has been checked against the raw body
-- with the endpoint's signing secret. The success redirect the player comes back on grants nothing at all.
--
-- Until this has run, a Stripe deployment keeps working without it: the shop stays hidden rather than taking
-- a payment that could not be accounted for, the admin page says which file to run, and the webhook answers
-- 503 so Stripe retries it (for three days) once it has been run. Coins already granted can still be spent,
-- and a deployment on bank transfer never needs this file at all.
--
-- Environment variables (Vercel, Production and Preview) — values never live in the repo:
--   ARCADE_PAYMENT_PROVIDER=stripe   turns the Stripe shop on; `manual` keeps bank transfer, unset hides the shop
--   STRIPE_SECRET_KEY                sk_test_... or sk_live_..., to create and read Checkout Sessions
--   STRIPE_WEBHOOK_SECRET            whsec_..., the signing secret of the endpoint at /api/stripe
--   STRIPE_API_VERSION               optional; unset uses the account's own default API version
--   ARCADE_SITE_URL                  optional; the address to send the player back to, when the host the
--                                    request arrived on is not the one the arcade is served from

-- What Stripe calls a purchase of ours. Both are null for a bank transfer, and both are unique where they are
-- set: one Checkout Session and one payment belong to exactly one purchase, which is what makes the lookup a
-- webhook does unambiguous.
alter table public.purchases add column if not exists provider_ref text;
alter table public.purchases add column if not exists provider_payment_ref text;
create unique index if not exists purchases_provider_ref on public.purchases (provider_ref) where provider_ref is not null;
create unique index if not exists purchases_provider_payment_ref on public.purchases (provider_payment_ref) where provider_payment_ref is not null;

-- Every payment event already acted on, by the provider's own id for it ('stripe:evt_...'). The primary key is
-- the guarantee: two deliveries of one event cannot both leave a row, so the second is answered "already
-- handled" without touching a coin.
--
-- The webhook acts first and writes the row afterwards, deliberately. Writing first and then failing would
-- leave an event marked as handled with the coins never granted, and Stripe's retry would be told there was
-- nothing to do. Acting first can at worst act twice, and acting twice is already harmless: grant_purchase
-- allows one grant per purchase, refund_purchase only acts on a paid one, cancel_purchase only on a pending
-- one. So this table is the fast path and the audit trail; the unique index on coin_ledger is the guarantee.
create table if not exists public.payment_events (
  id text primary key,                          -- '<provider>:<event id>', as the provider numbers them
  provider text not null default 'stripe',
  type text not null,                           -- 'checkout.session.completed', 'charge.refunded', ...
  purchase_id uuid references public.purchases(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists payment_events_purchase on public.payment_events (purchase_id, created_at);

-- Nothing in a browser has any business here: every read and write goes through /api with the service role.
-- Row-level security is on with no policy at all, which is what closes the table to anybody else even if a
-- grant is ever handed back by mistake, and it is the shape run_achievements already has.
alter table public.payment_events enable row level security;
do $$
declare grantees text;
begin
  select string_agg(quote_ident(rolname), ', ') into grantees
    from pg_roles where rolname in ('anon', 'authenticated');
  -- PUBLIC always exists; anon and authenticated only on a real Supabase project, so they are named
  -- conditionally and this still runs against a plain Postgres (the verification harness, a local copy).
  execute format('revoke all on public.payment_events from %s', concat_ws(', ', 'public', grantees));
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant select, insert on public.payment_events to service_role';
  end if;
end $$;

-- The two new columns need no grant of their own: they are on `purchases`, where a signed-in player already
-- reads their own rows through purchases_own_read and holds nothing but select. A Checkout Session id is not a
-- secret, and it is their own.

-- What to expect afterwards:
--   select count(*) from public.payment_events;                                              -- 0 on a fresh install
--   select relrowsecurity from pg_class where oid = 'public.payment_events'::regclass;       -- t
--   select count(*) from pg_policies where tablename = 'payment_events';                     -- 0
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_schema = 'public' and table_name = 'payment_events' order by 1, 2;
--                                                  -- service_role (and the owner) only; no anon,
--                                                  -- no authenticated, no PUBLIC
--
--   Card purchases waiting:  select reference, provider_ref, created_at from public.purchases
--                             where provider = 'stripe' and status = 'pending' order by created_at;
--   One purchase in Stripe:  select reference, status, provider_ref, provider_payment_ref, resolved_by
--                             from public.purchases where reference = 'PHA-XXXX';
--   Events acted on:         select created_at, type, purchase_id from public.payment_events order by created_at desc limit 20;
--   Granted by the webhook:  select created_at, delta, note, admin_email from public.coin_ledger
--                             where admin_email = 'stripe' order by created_at desc limit 20;
