-- =====================================================================
-- Woza La — Supabase schema
-- Run this once in the Supabase SQL editor after creating a new project.
-- No auth/RLS for MVP (internal staff only).
-- =====================================================================

-- Firms = DataGrows' customers. One onboarding session = one firm.
create table if not exists firms (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

-- Staff at a firm — the people who appear in Partner/Manager/Accountant/Role
-- columns on the exported DataGrows file. Populated either from a Settings
-- screen or extracted from the uploaded employee list.
create table if not exists firm_staff (
  id          uuid primary key default gen_random_uuid(),
  firm_id     uuid not null references firms(id) on delete cascade,
  name        text not null,
  roles       text[] default '{}',
  created_at  timestamptz not null default now()
);

-- An onboarding session. Produces exactly one DataGrows master export.
create table if not exists sessions (
  id              uuid primary key default gen_random_uuid(),
  firm_id         uuid not null references firms(id) on delete cascade,
  status          text not null default 'uploading' check (status in (
                    'uploading','mapping','reviewing','exported','archived')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  exported_at     timestamptz,
  operator_name   text,
  notes           text
);

-- Uploaded source files for a session.
create table if not exists uploads (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references sessions(id) on delete cascade,
  source_type     text not null check (source_type in (
                    'cipc','sars','sage','xero','excel','employees')),
  file_name       text not null,
  storage_path    text not null,
  row_count       int,
  detected_columns jsonb,
  column_mapping  jsonb,
  created_at      timestamptz not null default now()
);

-- Raw rows parsed from uploaded files.
-- Kept so we can re-process without re-uploading.
create table if not exists raw_records (
  id          uuid primary key default gen_random_uuid(),
  upload_id   uuid not null references uploads(id) on delete cascade,
  row_index   int  not null,
  data        jsonb not null
);

create index if not exists raw_records_upload_idx on raw_records(upload_id);

-- Canonical (post-mapping) records — one row per input row, but with
-- canonical DataGrows field keys.
create table if not exists mapped_records (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references sessions(id) on delete cascade,
  upload_id     uuid not null references uploads(id) on delete cascade,
  source_type   text not null,
  row_index     int  not null,
  data          jsonb not null
);

create index if not exists mapped_records_session_idx on mapped_records(session_id);

-- Clusters = deduplicated end-clients. One cluster per real end-client.
-- Built by the matcher (two-pass: primary key → name-bridge).
create table if not exists clusters (
  id                uuid primary key default gen_random_uuid(),
  session_id        uuid not null references sessions(id) on delete cascade,
  primary_key_type  text,            -- 'reg' | 'id' | 'trust_deed' | 'name_bridge'
  primary_key_value text,
  merged            jsonb not null,  -- canonical ClientRecord after merge
  flags             jsonb default '[]',
  conflicts         jsonb default '{}',
  sources           text[] default '{}',
  archived          boolean not null default false,
  archive_reason    text,
  created_at        timestamptz not null default now()
);

create index if not exists clusters_session_idx on clusters(session_id);

-- Which mapped_records belong to which cluster (many-to-one).
create table if not exists cluster_members (
  cluster_id        uuid not null references clusters(id) on delete cascade,
  mapped_record_id  uuid not null references mapped_records(id) on delete cascade,
  primary key (cluster_id, mapped_record_id)
);

-- Audit log of edits made by clerks during review.
create table if not exists edits (
  id          uuid primary key default gen_random_uuid(),
  cluster_id  uuid not null references clusters(id) on delete cascade,
  field_key   text not null,
  old_value   jsonb,
  new_value   jsonb,
  operator    text,
  created_at  timestamptz not null default now()
);

-- Storage bucket for the original uploaded files.
-- Run this in the Supabase dashboard Storage section:
-- create bucket "uploads" (public = false)
