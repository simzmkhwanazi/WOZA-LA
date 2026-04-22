-- Migration: firm_members — links auth users to firms with a role
-- Run in Supabase SQL editor.
--
-- Every user must belong to at least one firm.
-- Role options: 'admin' (full access), 'operator' (read+write), 'viewer' (read only)

create table if not exists firm_members (
  id          uuid primary key default gen_random_uuid(),
  firm_id     uuid not null references firms(id) on delete cascade,
  user_id     uuid not null,   -- maps to auth.users.id
  role        text not null check (role in ('admin', 'operator', 'viewer')),
  created_at  timestamptz not null default now(),
  unique (firm_id, user_id)    -- one membership record per user per firm
);

alter table firm_members enable row level security;

-- A user can see their own membership records only
create policy "own_memberships" on firm_members
  for select to authenticated
  using (user_id = auth.uid());

-- Only admins of a firm can add/remove members (enforced in app layer too)
create policy "admin_manage_members" on firm_members
  for all to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from firm_members fm
      where fm.firm_id = firm_members.firm_id
        and fm.user_id = auth.uid()
        and fm.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from firm_members fm
      where fm.firm_id = firm_members.firm_id
        and fm.user_id = auth.uid()
        and fm.role = 'admin'
    )
  );

-- ── Audit events table ────────────────────────────────────────────────────────
-- Tracks who did what, when, and from which IP. Required for SOC 2.

create table if not exists audit_events (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null,          -- auth.users.id (never just a name)
  firm_id       uuid references firms(id) on delete set null,
  action        text not null,          -- 'login','view','upload','export','edit','delete'
  resource_type text,                   -- 'session','cluster','upload','document'
  resource_id   uuid,
  detail        jsonb,                  -- extra context (field name, old/new value, etc.)
  ip_address    inet,
  user_agent    text,
  created_at    timestamptz not null default now()
);

alter table audit_events enable row level security;

-- Users can only read audit events for firms they belong to
create policy "firm_audit_read" on audit_events
  for select to authenticated
  using (
    firm_id in (
      select firm_id from firm_members where user_id = auth.uid()
    )
  );

-- Audit events are inserted server-side only (service role) — no direct client inserts
create policy "no_client_insert" on audit_events
  for insert to authenticated
  with check (false);
