-- Add auto_fixed flag to clusters table.
-- Set by /api/auto-fix when Claude corrects one or more fields on a cluster.
-- Allows the UI to show an "AI-fixed" badge on the record.

alter table clusters
  add column if not exists auto_fixed boolean not null default false;
