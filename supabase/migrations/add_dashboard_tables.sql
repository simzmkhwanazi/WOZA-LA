-- ── Dashboard tables & post-export tracking ─────────────────────────────────
-- Adds: firm_profile, firm_employees, firm_contacts, firm_suppliers,
--       generated_documents, and post-export tracking columns.

-- Firm profile (extended company details for the accounting firm itself)
create table if not exists firm_profile (
  id                uuid        primary key default gen_random_uuid(),
  firm_id           uuid        references firms(id) on delete cascade,
  session_id        uuid        references sessions(id) on delete cascade,
  company_name      text,
  registration_nr   text,
  vat_nr            text,
  bbbee_level       text,
  industry_sector   text,
  auditor_name      text,
  physical_address  jsonb,      -- {line1,line2,line3,line4,city,province,postal,country}
  postal_address    jsonb,
  contact_nr        text,
  email             text,
  banking_details   jsonb,      -- {bank,branch_code,account_nr,account_type}
  sources           text[],     -- which source_types contributed each field
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

-- Consolidated employees (HR upload + DataGrows staff assignment columns AA-AH)
create table if not exists firm_employees (
  id          uuid        primary key default gen_random_uuid(),
  session_id  uuid        references sessions(id) on delete cascade,
  name        text        not null,
  email       text,
  id_number   text,
  job_title   text,       -- broad role from HR upload (e.g. "Financial Director")
  department  text,
  phone       text,
  dg_roles    jsonb,      -- {partner:12, manager:5, tax_role:8, ...} from cluster assignments
  source      text,       -- 'employees_upload' | 'dg_assignments' | 'both'
  created_at  timestamptz default now()
);

-- Standalone contacts directory (uploaded separately, not per-client)
create table if not exists firm_contacts (
  id            uuid        primary key default gen_random_uuid(),
  session_id    uuid        references sessions(id) on delete cascade,
  name          text,
  organisation  text,
  email         text,
  phone         text,
  relationship  text,      -- contractor, referral partner, bank contact, etc.
  created_at    timestamptz default now()
);

-- Firm's own suppliers (not client suppliers)
create table if not exists firm_suppliers (
  id               uuid        primary key default gen_random_uuid(),
  session_id       uuid        references sessions(id) on delete cascade,
  supplier_name    text,
  contact_person   text,
  email            text,
  phone            text,
  service_provided text,
  payment_terms    text,
  contract_value   text,
  created_at       timestamptz default now()
);

-- Document generation history (versioned per document_type per session)
create table if not exists generated_documents (
  id            uuid        primary key default gen_random_uuid(),
  session_id    uuid        references sessions(id) on delete cascade,
  document_type text        not null,  -- 'datagrows' | 'archived' | 'firm_excel' | 'firm_pdf' | 'features_pdf'
  version       integer     not null default 1,
  file_name     text,                  -- e.g. "RichAccounts_datagrows_v2_2026-04-17.xlsx"
  storage_path  text,
  generated_by  text,                  -- operator name at time of generation
  created_at    timestamptz default now()
);

-- Track when a DataGrows Masterfile was last generated for post-export marker logic
alter table sessions add column if not exists last_exported_at timestamptz;

-- Indexes for common query patterns
create index if not exists firm_employees_session_idx  on firm_employees(session_id);
create index if not exists firm_contacts_session_idx   on firm_contacts(session_id);
create index if not exists firm_suppliers_session_idx  on firm_suppliers(session_id);
create index if not exists generated_docs_session_idx  on generated_documents(session_id);
create index if not exists generated_docs_type_idx     on generated_documents(session_id, document_type);
