/**
 * Cross-field leakage correction.
 *
 * Firms often put values in wrong columns. This module detects and corrects
 * those misplacements BEFORE normalizeRecord() runs, so all downstream logic
 * (inference, matching, merging) works with clean field assignments.
 *
 * Corrections made:
 *   1. Status value leaked into comment → move to status
 *   2. Trust deed number pattern in registration_nr → move to trust_deed_number
 *   3. Registration number pattern in id_number → move to registration_nr
 *   4. Status value in entity_type field → move to status
 *   5. Entity type value in status field → move to entity_type
 */

import { STATUS_VALUES, ENTITY_TYPES } from '../schema/datagrows';

// Trust deed number patterns: IT1234/2001 or IT 1234/2001 or T1234/2001
const TRUST_DEED_PATTERN = /^(IT\s*\d+\/\d{4}|T\s*\d+\/\d{4}|\d+\/\d{4}\/IT)$/i;

// Registration number pattern: YYYY/NNNNNN/TT or 10+ digits
const REG_NR_PATTERN = /^(\d{4}\/\d{6}\/\d{2}|\d{10,12})$/;

// SA ID number: exactly 13 digits
const SA_ID_PATTERN = /^\d{13}$/;

const STATUS_SET = new Set(STATUS_VALUES.map((s) => s.toLowerCase()));
const ENTITY_SET = new Set(ENTITY_TYPES.map((e) => e.toLowerCase()));

export function correctFieldLeakage(
  record: Record<string, unknown>,
): Record<string, unknown> {
  // Shallow clone — do not mutate the input
  const r = { ...record };

  // ── 1. Status value in comment field ──────────────────────────────────────
  const comment = String(r.comment ?? '').trim();
  const commentLower = comment.toLowerCase();
  if (comment && STATUS_SET.has(commentLower) && !r.status) {
    // Find the correctly-cased status value
    const correctStatus = STATUS_VALUES.find(
      (s) => s.toLowerCase() === commentLower,
    );
    if (correctStatus) {
      r.status = correctStatus;
      r.comment = '';
    }
  }

  // ── 2. Status value in entity_type field ──────────────────────────────────
  const entityRaw = String(r.entity_type ?? '').trim();
  const entityLower = entityRaw.toLowerCase();
  if (entityRaw && STATUS_SET.has(entityLower) && !r.status) {
    const correctStatus = STATUS_VALUES.find(
      (s) => s.toLowerCase() === entityLower,
    );
    if (correctStatus) {
      r.status = correctStatus;
      r.entity_type = '';
    }
  }

  // ── 3. Entity type value in status field ──────────────────────────────────
  const statusRaw = String(r.status ?? '').trim();
  const statusLower = statusRaw.toLowerCase();
  if (statusRaw && ENTITY_SET.has(statusLower) && !r.entity_type) {
    const correctEntity = ENTITY_TYPES.find(
      (e) => e.toLowerCase() === statusLower,
    );
    if (correctEntity) {
      r.entity_type = correctEntity;
      r.status = '';
    }
  }

  // ── 4. Trust deed pattern in registration_nr ──────────────────────────────
  const regNr = String(r.registration_nr ?? '').trim();
  if (regNr && TRUST_DEED_PATTERN.test(regNr.replace(/\s+/g, '')) && !r.trust_deed_number) {
    r.trust_deed_number = regNr;
    r.registration_nr = '';
  }

  // ── 5. Registration number pattern in id_number ───────────────────────────
  const idNr = String(r.id_number ?? '').trim();
  const idDigits = idNr.replace(/\D+/g, '');
  if (idNr && !SA_ID_PATTERN.test(idDigits) && REG_NR_PATTERN.test(idDigits) && !r.registration_nr) {
    r.registration_nr = idNr;
    r.id_number = '';
  }

  return r;
}
