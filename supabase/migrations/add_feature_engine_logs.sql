-- Migration: add feature_engine_logs
-- Run this in the Supabase SQL editor.

create table if not exists feature_engine_logs (
  id                    uuid primary key default gen_random_uuid(),
  staff_id              text,
  source_system         text not null,
  data_types            text[] not null,
  urgent_features       jsonb not null,
  nice_to_have_features jsonb not null,
  created_at            timestamptz not null default now()
);
