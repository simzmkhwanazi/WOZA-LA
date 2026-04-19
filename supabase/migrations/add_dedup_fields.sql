-- Add dedup confirmation fields to sessions table.
-- pending_name_matches stores name-bridge candidate pairs awaiting operator review.
-- dedup_confirmed marks whether the operator has reviewed all pending pairs.

alter table sessions
  add column if not exists pending_name_matches jsonb default '[]'::jsonb,
  add column if not exists dedup_confirmed      boolean not null default false;
