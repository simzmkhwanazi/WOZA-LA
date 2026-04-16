-- Migration: RLS policies for authenticated staff access
-- Run this in the Supabase SQL editor.

-- ── Application tables ─────────────────────────────────────────────────────

alter table if exists firms                enable row level security;
alter table if exists sessions             enable row level security;
alter table if exists uploads              enable row level security;
alter table if exists raw_records          enable row level security;
alter table if exists clusters             enable row level security;
alter table if exists audit_log            enable row level security;
alter table if exists staff                enable row level security;
alter table if exists feature_engine_logs  enable row level security;

-- Drop old policies if they exist, then recreate
do $$ declare t text;
begin
  foreach t in array array['firms','sessions','uploads','raw_records','clusters','audit_log','staff','feature_engine_logs']
  loop
    execute format('drop policy if exists "auth_all_%s" on %s', t, t);
    execute format('create policy "auth_all_%s" on %s for all to authenticated using (true) with check (true)', t, t);
  end loop;
end $$;

-- ── Storage: uploads bucket ────────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit)
values ('uploads', 'uploads', false, 52428800)
on conflict (id) do update set file_size_limit = 52428800;

drop policy if exists "auth_upload_files"    on storage.objects;
drop policy if exists "auth_read_files"      on storage.objects;
drop policy if exists "auth_delete_files"    on storage.objects;

create policy "auth_upload_files" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'uploads');

create policy "auth_read_files" on storage.objects
  for select to authenticated
  using (bucket_id = 'uploads');

create policy "auth_delete_files" on storage.objects
  for delete to authenticated
  using (bucket_id = 'uploads');
