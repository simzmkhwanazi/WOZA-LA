-- Migration: update feature_engine_logs for session-based engine
-- Run this in the Supabase SQL editor.

alter table feature_engine_logs
  add column if not exists session_id       uuid,
  add column if not exists portfolio_profile jsonb,
  alter column source_system drop not null,
  alter column data_types    drop not null;
