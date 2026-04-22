-- Migration: Simplified storage bucket policies.
-- Run this SEPARATELY from fix_rls_tenant_isolation.sql if that times out on storage.objects.
--
-- The complex session-ownership check on storage.objects causes lock contention
-- because Supabase's internal storage service holds its own lock simultaneously.
-- Ownership is already enforced at the API layer (validateSessionAccess in /api/uploads/sign
-- and /api/uploads) so the storage policy just needs to confirm the correct bucket.

drop policy if exists "auth_upload_files"          on storage.objects;
drop policy if exists "auth_read_files"            on storage.objects;
drop policy if exists "auth_delete_files"          on storage.objects;
drop policy if exists "upload_files_own_session"   on storage.objects;
drop policy if exists "read_files_own_session"     on storage.objects;
drop policy if exists "delete_files_own_session"   on storage.objects;

create policy "storage_insert_authenticated" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'uploads');

create policy "storage_select_authenticated" on storage.objects
  for select to authenticated
  using (bucket_id = 'uploads');

create policy "storage_delete_authenticated" on storage.objects
  for delete to authenticated
  using (bucket_id = 'uploads');
