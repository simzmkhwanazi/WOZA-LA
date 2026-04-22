-- Migration: Replace permissive RLS policies with tenant-scoped policies.
-- Run AFTER add_firm_members.sql.
--
-- Pattern: every table is scoped to firms the current user belongs to,
-- traced through the foreign-key chain:
--   firm_members.firm_id = firms.id
--   sessions.firm_id     = firms.id
--   uploads.session_id   → sessions.firm_id
--   clusters.session_id  → sessions.firm_id
--   raw_records.upload_id → uploads.session_id → sessions.firm_id

-- Helper: reusable set of firm_ids the current user belongs to
-- (used inline in each policy below)

-- ── firms ────────────────────────────────────────────────────────────────────

drop policy if exists "auth_all_firms" on firms;

create policy "firms_member_access" on firms
  for all to authenticated
  using (
    id in (select firm_id from firm_members where user_id = auth.uid())
  )
  with check (
    id in (select firm_id from firm_members where user_id = auth.uid())
  );

-- ── sessions ─────────────────────────────────────────────────────────────────

drop policy if exists "auth_all_sessions" on sessions;

create policy "sessions_member_access" on sessions
  for all to authenticated
  using (
    firm_id in (select firm_id from firm_members where user_id = auth.uid())
  )
  with check (
    firm_id in (select firm_id from firm_members where user_id = auth.uid())
  );

-- ── uploads ──────────────────────────────────────────────────────────────────

drop policy if exists "auth_all_uploads" on uploads;

create policy "uploads_member_access" on uploads
  for all to authenticated
  using (
    session_id in (
      select s.id from sessions s
      join firm_members fm on fm.firm_id = s.firm_id
      where fm.user_id = auth.uid()
    )
  )
  with check (
    session_id in (
      select s.id from sessions s
      join firm_members fm on fm.firm_id = s.firm_id
      where fm.user_id = auth.uid()
    )
  );

-- ── raw_records ───────────────────────────────────────────────────────────────

drop policy if exists "auth_all_raw_records" on raw_records;

create policy "raw_records_member_access" on raw_records
  for all to authenticated
  using (
    upload_id in (
      select u.id from uploads u
      join sessions s on s.id = u.session_id
      join firm_members fm on fm.firm_id = s.firm_id
      where fm.user_id = auth.uid()
    )
  )
  with check (
    upload_id in (
      select u.id from uploads u
      join sessions s on s.id = u.session_id
      join firm_members fm on fm.firm_id = s.firm_id
      where fm.user_id = auth.uid()
    )
  );

-- ── clusters ─────────────────────────────────────────────────────────────────

drop policy if exists "auth_all_clusters" on clusters;

create policy "clusters_member_access" on clusters
  for all to authenticated
  using (
    session_id in (
      select s.id from sessions s
      join firm_members fm on fm.firm_id = s.firm_id
      where fm.user_id = auth.uid()
    )
  )
  with check (
    session_id in (
      select s.id from sessions s
      join firm_members fm on fm.firm_id = s.firm_id
      where fm.user_id = auth.uid()
    )
  );

-- ── staff (firm_staff / firm_employees) ───────────────────────────────────────

drop policy if exists "auth_all_staff" on staff;

create policy "staff_member_access" on staff
  for all to authenticated
  using (
    firm_id in (select firm_id from firm_members where user_id = auth.uid())
  )
  with check (
    firm_id in (select firm_id from firm_members where user_id = auth.uid())
  );

-- ── feature_engine_logs ───────────────────────────────────────────────────────

drop policy if exists "auth_all_feature_engine_logs" on feature_engine_logs;

create policy "logs_member_access" on feature_engine_logs
  for all to authenticated
  using (
    session_id in (
      select s.id from sessions s
      join firm_members fm on fm.firm_id = s.firm_id
      where fm.user_id = auth.uid()
    )
  )
  with check (
    session_id in (
      select s.id from sessions s
      join firm_members fm on fm.firm_id = s.firm_id
      where fm.user_id = auth.uid()
    )
  );

-- ── Storage bucket: scope to sessions the user belongs to ────────────────────
-- Storage paths are: uploads/{sessionId}/{filename}
-- We extract the sessionId from the object name and check membership.

drop policy if exists "auth_upload_files"  on storage.objects;
drop policy if exists "auth_read_files"    on storage.objects;
drop policy if exists "auth_delete_files"  on storage.objects;

create policy "upload_files_own_session" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'uploads'
    and (split_part(name, '/', 1))::uuid in (
      select s.id from sessions s
      join firm_members fm on fm.firm_id = s.firm_id
      where fm.user_id = auth.uid()
    )
  );

create policy "read_files_own_session" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'uploads'
    and (split_part(name, '/', 1))::uuid in (
      select s.id from sessions s
      join firm_members fm on fm.firm_id = s.firm_id
      where fm.user_id = auth.uid()
    )
  );

create policy "delete_files_own_session" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'uploads'
    and (split_part(name, '/', 1))::uuid in (
      select s.id from sessions s
      join firm_members fm on fm.firm_id = s.firm_id
      where fm.user_id = auth.uid()
    )
  );
