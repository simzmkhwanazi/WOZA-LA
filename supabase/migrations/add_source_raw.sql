-- Migration: add source_raw column and extend uploads source_type constraint
-- Run this in the Supabase SQL editor.

-- 1. Add source_raw column to store original user input
alter table uploads
  add column if not exists source_raw text;

-- 2. Drop the existing check constraint and recreate it with 'company' added
--    (constraints in Postgres must be dropped and recreated to change allowed values)
alter table uploads
  drop constraint if exists uploads_source_type_check;

alter table uploads
  add constraint uploads_source_type_check
    check (source_type in ('cipc','sars','sage','xero','excel','employees','company'));
