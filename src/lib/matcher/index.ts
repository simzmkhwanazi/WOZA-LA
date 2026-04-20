/**
 * Multi-pass matching engine.
 *
 *   Pass 1 — Hard key match (deterministic, auto-merge):
 *     Registration number · ID number · Trust deed · Tax number · VAT number
 *
 *   Pass 1.5 — Semi-hard key match (high-confidence, auto-merge):
 *     Email address · Phone number (normalised to 9-digit SA format) · Bank account
 *     These are strong signals but not government-issued, so a separate key
 *     namespace prevents collisions with hard keys.
 *
 *   Pass 2 — Name-bridge (SUGGESTIONS ONLY, clerk must confirm):
 *     Fuzzy name similarity ≥ 85%, same entity category only.
 *
 *   Pass 3 — Archive remaining orphans.
 */

import { distance as levenshtein } from 'fastest-levenshtein';
import {
  INDIVIDUAL_ENTITY_TYPES,
  TRUST_ENTITY_TYPES,
  type ClientRecord,
} from '../schema/datagrows';
import {
  registrationMatchKey,
  idNumberKey,
  taxNumberKey,
  vatNumberKey,
  emailMatchKey,
  phoneMatchKey,
  bankAccountKey,
  cleanString,
  upperNormalize,
} from '../normalizer';
import type { SourceType } from '../schema/sources';

export interface MappedRecord {
  id: string;                 // mapped_records.id from Supabase
  source: SourceType;
  data: ClientRecord;
}

export interface Cluster {
  id: string;                 // generated locally until persisted
  primaryKeyType: 'reg' | 'id' | 'trust_deed' | 'tax' | 'vat' | 'email' | 'phone' | 'bank' | 'name_bridge' | 'none';
  primaryKeyValue: string;
  members: MappedRecord[];
  sources: SourceType[];
  archived: boolean;
  archiveReason?: string;
}

/**
 * A candidate name-bridge merge pair. Operator must confirm before merging.
 * orphanClusterId and candidateClusterId are the in-memory Cluster.id values
 * (stored as merged._cluster_id in Supabase after pipeline save).
 */
export interface PendingNameMatch {
  orphanClusterId: string;
  candidateClusterId: string;
  orphanName: string;
  candidateName: string;
  orphanSource: SourceType;
  candidateSources: SourceType[];
  score: number;
  /** Which signals contributed — shown to clerk so they understand why it was flagged */
  signals: ('name' | 'address' | 'contact')[];
}

// -----------------------------------------------------------------------------
// Pick primary key from a single record
// -----------------------------------------------------------------------------

function pickPrimaryKey(rec: ClientRecord): { type: Cluster['primaryKeyType']; value: string } {
  const entity = String(rec.entity_type ?? '').toUpperCase();

  if (TRUST_ENTITY_TYPES.includes(entity)) {
    const v = cleanString(rec.trust_deed_number);
    if (v) return { type: 'trust_deed', value: v };
  }

  if (INDIVIDUAL_ENTITY_TYPES.includes(entity)) {
    const v = idNumberKey(rec.id_number);
    if (v) return { type: 'id', value: v };
  }

  // Default: try identifiers in priority order
  const reg = registrationMatchKey(rec.registration_nr);
  if (reg) return { type: 'reg', value: reg };

  const id = idNumberKey(rec.id_number);
  if (id) return { type: 'id', value: id };

  const td = cleanString(rec.trust_deed_number);
  if (td) return { type: 'trust_deed', value: td };

  // Tax and VAT numbers as fallback identifiers (min 9 digits to avoid short garbage)
  const tax = taxNumberKey(rec.tax_nr);
  if (tax && tax.length >= 9) return { type: 'tax', value: tax };

  const vat = vatNumberKey(rec.vat_nr);
  if (vat && vat.length >= 9) return { type: 'vat', value: vat };

  return { type: 'none', value: '' };
}

// -----------------------------------------------------------------------------
// Entity category — prevents cross-type false matches (PTY vs TRUST etc.)
// -----------------------------------------------------------------------------

type EntityCategory = 'company' | 'individual' | 'trust' | 'other';

function entityCategory(entityType: unknown): EntityCategory | null {
  const t = String(entityType ?? '').toUpperCase().trim();
  if (!t) return null;
  if (INDIVIDUAL_ENTITY_TYPES.includes(t)) return 'individual';
  if (TRUST_ENTITY_TYPES.includes(t)) return 'trust';
  if (t === 'SOLE PROP') return 'individual';
  if (t) return 'company'; // PTY LTD, CC, NPC, NPO, etc.
  return 'other';
}

// -----------------------------------------------------------------------------
// Soft matching helpers (Pass 2 — fuzzy layer)
// -----------------------------------------------------------------------------

/**
 * Strip SA legal-entity suffixes before comparing names.
 * "Ace Trading (Pty) Ltd" → "ace trading"
 * "Bushveld Growers CC"   → "bushveld growers"
 */
function stripLegalSuffix(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(pty\)\s*ltd\.?/gi, '')
    .replace(/\bpty\s*ltd\.?/gi, '')
    .replace(/\bprivate\s+company\b/gi, '')
    .replace(/\bltd\.?\b/gi, '')
    .replace(/\bcc\b/gi, '')
    .replace(/\bnpc\b/gi, '')
    .replace(/\bnpo\b/gi, '')
    .replace(/\binc\.?\b/gi, '')
    .replace(/\btrust\b/gi, '')
    .replace(/\bestate\b/gi, '')
    .replace(/\bsole\s*prop\.?\b/gi, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 0..1 similarity — raw strings, no suffix stripping. */
function stringSimilarity(a: string, b: string): number {
  const na = a.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const nb = b.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const d = levenshtein(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  const levSim = 1 - d / maxLen;
  // Token sort: "ABC Trading" vs "Trading ABC" → same
  const tokensA = na.split(/[^A-Z0-9]+/).filter(Boolean).sort().join('');
  const tokensB = nb.split(/[^A-Z0-9]+/).filter(Boolean).sort().join('');
  const td2 = levenshtein(tokensA, tokensB);
  const tokenMaxLen = Math.max(tokensA.length, tokensB.length);
  const tokenSim = tokenMaxLen > 0 ? 1 - td2 / tokenMaxLen : 0;
  return Math.max(levSim, tokenSim);
}

/**
 * Name similarity — compares both raw and suffix-stripped versions, takes best.
 * "Ace Trading (Pty) Ltd" vs "Ace Pty Ltd" → strips both → "ace trading" vs "ace" → low
 * "Ace Trading (Pty) Ltd" vs "Ace Trading"  → strips both → "ace trading" vs "ace trading" → 1.0
 */
function nameSimilarity(a: string, b: string): number {
  const raw = stringSimilarity(a, b);
  const stripped = stringSimilarity(stripLegalSuffix(a), stripLegalSuffix(b));
  return Math.max(raw, stripped);
}

/**
 * Best name similarity across all 4 combinations of client_name and trading_name.
 * Catches "Ace" in Sage (trading name) matching "Ace Trading (Pty) Ltd" in CIPC (legal name).
 */
export function bestNameSimilarity(a: ClientRecord, b: ClientRecord): number {
  const aN = String(a.client_name ?? '');
  const aT = String(a.trading_name ?? '');
  const bN = String(b.client_name ?? '');
  const bT = String(b.trading_name ?? '');
  const scores = [
    aN && bN ? nameSimilarity(aN, bN) : 0,
    aN && bT ? nameSimilarity(aN, bT) : 0,
    aT && bN ? nameSimilarity(aT, bN) : 0,
    aT && bT ? nameSimilarity(aT, bT) : 0,
  ];
  return Math.max(...scores);
}

/** Address similarity — suburb + city partial overlap. */
function addressSimilarity(a: ClientRecord, b: ClientRecord): number {
  const parts = (r: ClientRecord) =>
    [r.physical_city, r.physical_line2, r.physical_line1]
      .map((v) => String(v ?? '').toLowerCase().trim())
      .filter(Boolean)
      .join(' ');
  const pa = parts(a);
  const pb = parts(b);
  if (!pa || !pb) return 0;
  return stringSimilarity(pa, pb);
}

/** Contact person similarity — strips titles (Mr/Mrs/Dr/Ms) before comparing. */
function contactSimilarity(a: ClientRecord, b: ClientRecord): number {
  const clean = (v: unknown) =>
    String(v ?? '')
      .toLowerCase()
      .replace(/\b(mr|mrs|ms|dr|prof|rev)\.?\s*/gi, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const ca = clean(a.primary_contact);
  const cb = clean(b.primary_contact);
  if (!ca || !cb) return 0;
  return stringSimilarity(ca, cb);
}

/**
 * Combined soft-match confidence score (0..1).
 * Rules (cast a wide net — clerk reviews everything):
 *   - Name ≥ 0.90                                  → 0.90  (strong name alone)
 *   - Name ≥ 0.75 + address ≥ 0.70                → 0.85
 *   - Name ≥ 0.75 + contact ≥ 0.80                → 0.82
 *   - Name ≥ 0.65 + address ≥ 0.70 + contact ≥ 0.80 → 0.80  (three signals)
 *   - Name ≥ 0.75 alone                            → 0.75
 */
function softScore(
  orphan: ClientRecord,
  candidate: ClientRecord,
): number {
  const ns = bestNameSimilarity(orphan, candidate);
  const as_ = addressSimilarity(orphan, candidate);
  const cs = contactSimilarity(orphan, candidate);

  if (ns >= 0.90) return ns;
  if (ns >= 0.75 && as_ >= 0.70) return 0.85;
  if (ns >= 0.75 && cs >= 0.80) return 0.82;
  if (ns >= 0.65 && as_ >= 0.70 && cs >= 0.80) return 0.80;
  if (ns >= 0.75) return ns;
  return 0;
}

// Minimum combined score to suggest a match to the clerk
const SOFT_THRESHOLD = 0.75;

/** Returns true if the record has at least one valid hard or semi-hard identifier. */
export function hasPrimaryIdentifier(rec: ClientRecord): boolean {
  const reg = registrationMatchKey(rec.registration_nr);
  if (reg && reg.length >= 10) return true;
  const id = idNumberKey(rec.id_number);
  if (id && id.length === 13) return true;
  const td = cleanString(rec.trust_deed_number);
  if (td) return true;
  const tax = taxNumberKey(rec.tax_nr);
  if (tax && tax.length >= 9) return true;
  const vat = vatNumberKey(rec.vat_nr);
  if (vat && vat.length >= 9) return true;
  // Semi-hard keys
  if (emailMatchKey(rec.contact_email)) return true;
  if (phoneMatchKey(rec.contact_nr)) return true;
  const bank = bankAccountKey(rec.bank_details);
  if (bank && bank.length >= 6) return true;
  return false;
}

const NAME_MATCH_THRESHOLD = 0.85;

// -----------------------------------------------------------------------------
// Main matcher
// -----------------------------------------------------------------------------

export interface MatchResult {
  clusters: Cluster[];
  pendingNameMatches: PendingNameMatch[];
  stats: {
    inputRecords: number;
    clusters: number;
    pendingNameMatches: number;
    archived: number;
  };
}

export function matchRecords(records: MappedRecord[]): MatchResult {
  const clusterMap = new Map<string, Cluster>();
  const orphans: MappedRecord[] = [];

  // Pass 1 — primary key match
  for (const r of records) {
    const { type, value } = pickPrimaryKey(r.data);
    if (type === 'none' || !value) {
      orphans.push(r);
      continue;
    }
    const k = `${type}:${value}`;
    const existing = clusterMap.get(k);
    if (existing) {
      existing.members.push(r);
      if (!existing.sources.includes(r.source)) existing.sources.push(r.source);
    } else {
      clusterMap.set(k, {
        id: k,
        primaryKeyType: type,
        primaryKeyValue: value,
        members: [r],
        sources: [r.source],
        archived: false,
      });
    }
  }

  // Pass 1.3 — Cross-cluster semi-hard dedup
  // Problem: a Sage record has tax_nr (→ cluster "tax:XXX") and a CIPC record has reg_nr
  // (→ cluster "reg:YYY"). Both have primary keys so they never become orphans, yet they're
  // the same entity. Shared email/phone reveals this — merge the two clusters.
  {
    const emailIdx = new Map<string, Cluster>();
    const phoneIdx = new Map<string, Cluster>();

    // Build index from first occurrence of each email/phone across all clusters
    for (const cluster of new Set(clusterMap.values())) {
      for (const m of cluster.members) {
        const e = emailMatchKey(m.data.contact_email);
        if (e && !emailIdx.has(e)) emailIdx.set(e, cluster);
        const p = phoneMatchKey(m.data.contact_nr);
        if (p && !phoneIdx.has(p)) phoneIdx.set(p, cluster);
      }
    }

    // Find clusters sharing an email/phone and merge the later one into the earlier
    const keysToDelete: string[] = [];
    for (const [key, cluster] of clusterMap.entries()) {
      if (keysToDelete.includes(key)) continue;
      let merged = false;
      for (const m of cluster.members) {
        if (merged) break;
        const e = emailMatchKey(m.data.contact_email);
        if (e) {
          const other = emailIdx.get(e);
          if (other && other !== cluster) {
            for (const mem of cluster.members) {
              if (!other.members.includes(mem)) other.members.push(mem);
              if (!other.sources.includes(mem.source)) other.sources.push(mem.source);
            }
            keysToDelete.push(key);
            merged = true;
            break;
          }
        }
        if (!merged) {
          const p = phoneMatchKey(m.data.contact_nr);
          if (p) {
            const other = phoneIdx.get(p);
            if (other && other !== cluster) {
              for (const mem of cluster.members) {
                if (!other.members.includes(mem)) other.members.push(mem);
                if (!other.sources.includes(mem.source)) other.sources.push(mem.source);
              }
              keysToDelete.push(key);
              merged = true;
            }
          }
        }
      }
    }
    for (const k of keysToDelete) clusterMap.delete(k);
  }

  // Pass 1.5 — semi-hard key match: email, phone, bank account (auto-merge, high-confidence)
  // Use a separate namespace prefix ("em:", "ph:", "bk:") to avoid any collision with hard keys.
  const remainingOrphans: typeof orphans = [];
  for (const orphan of orphans) {
    let matched = false;

    const tryMatch = (key: string) => {
      if (!key || matched) return;
      const existing = clusterMap.get(key);
      if (existing) {
        existing.members.push(orphan);
        if (!existing.sources.includes(orphan.source)) existing.sources.push(orphan.source);
        matched = true;
      }
    };

    const email = emailMatchKey(orphan.data.contact_email);
    if (email) tryMatch(`em:${email}`);

    const phone = phoneMatchKey(orphan.data.contact_nr);
    if (phone) tryMatch(`ph:${phone}`);

    const bank = bankAccountKey(orphan.data.bank_details);
    if (bank && bank.length >= 6) tryMatch(`bk:${bank}`);

    if (matched) continue;

    // No semi-hard match — register this orphan's own semi-hard keys so future
    // orphans can match against it, then keep it for name-bridge.
    const orphanKey = `semihard:${orphan.id}`;
    const orphanCluster: Cluster = {
      id: orphanKey,
      primaryKeyType: 'none',
      primaryKeyValue: '',
      members: [orphan],
      sources: [orphan.source],
      archived: false,
    };
    if (email) clusterMap.set(`em:${email}`, orphanCluster);
    if (phone) clusterMap.set(`ph:${phone}`, orphanCluster);
    if (bank && bank.length >= 6) clusterMap.set(`bk:${bank}`, orphanCluster);
    if (!email && !phone && !(bank && bank.length >= 6)) {
      remainingOrphans.push(orphan);
    } else {
      // Store the cluster under its own id too so name-bridge can find it
      clusterMap.set(orphanKey, orphanCluster);
      // Update primaryKeyType to reflect the semi-hard key used
      orphanCluster.primaryKeyType = email ? 'email' : phone ? 'phone' : 'bank';
      orphanCluster.primaryKeyValue = email || phone || bank;
    }
  }
  // Replace orphans with only those that have no semi-hard keys at all
  orphans.length = 0;
  orphans.push(...remainingOrphans);

  // Pass 2 — name bridge: collect SUGGESTIONS, do NOT auto-merge
  const pendingNameMatches: PendingNameMatch[] = [];
  const matchedOrphanIds = new Set<string>();

  for (const orphan of orphans) {
    // 2a: Second attempt at reg/id match — catches unusual formats that Pass 1
    //     missed (e.g. CK-prefix CC, mangled spacing). If matched, merge directly.
    const orphanReg = registrationMatchKey(orphan.data.registration_nr);
    if (orphanReg) {
      const regKey = `reg:${orphanReg}`;
      const regCluster = clusterMap.get(regKey);
      if (regCluster) {
        regCluster.members.push(orphan);
        if (!regCluster.sources.includes(orphan.source)) regCluster.sources.push(orphan.source);
        matchedOrphanIds.add(orphan.id);
        continue;
      }
    }
    const orphanId = idNumberKey(orphan.data.id_number);
    if (orphanId) {
      const idKey = `id:${orphanId}`;
      const idCluster = clusterMap.get(idKey);
      if (idCluster) {
        idCluster.members.push(orphan);
        if (!idCluster.sources.includes(orphan.source)) idCluster.sources.push(orphan.source);
        matchedOrphanIds.add(orphan.id);
        continue;
      }
    }

    const orphanTax = taxNumberKey(orphan.data.tax_nr);
    if (orphanTax && orphanTax.length >= 9) {
      const taxKey = `tax:${orphanTax}`;
      const taxCluster = clusterMap.get(taxKey);
      if (taxCluster) {
        taxCluster.members.push(orphan);
        if (!taxCluster.sources.includes(orphan.source)) taxCluster.sources.push(orphan.source);
        matchedOrphanIds.add(orphan.id);
        continue;
      }
    }

    const orphanVat = vatNumberKey(orphan.data.vat_nr);
    if (orphanVat && orphanVat.length >= 9) {
      const vatKey = `vat:${orphanVat}`;
      const vatCluster = clusterMap.get(vatKey);
      if (vatCluster) {
        vatCluster.members.push(orphan);
        if (!vatCluster.sources.includes(orphan.source)) vatCluster.sources.push(orphan.source);
        matchedOrphanIds.add(orphan.id);
        continue;
      }
    }

    // 2b: Soft fuzzy matching — name + address + contact signals, same entity category only
    const orphanName = cleanString(orphan.data.client_name);
    if (!orphanName) continue;
    const orphanCategory = entityCategory(orphan.data.entity_type);

    let best: { cluster: Cluster; score: number; signals: PendingNameMatch['signals'] } | null = null;

    for (const cluster of clusterMap.values()) {
      // Never suggest a match across different entity categories (PTY vs TRUST, etc.)
      const candidateCategory = entityCategory(cluster.members[0]?.data.entity_type);
      if (orphanCategory && candidateCategory && orphanCategory !== candidateCategory) continue;

      for (const member of cluster.members) {
        const score = softScore(orphan.data, member.data);
        if (score < SOFT_THRESHOLD) continue;
        if (best && score <= best.score) continue;

        // Record which signals fired (for clerk context)
        const ns = bestNameSimilarity(orphan.data, member.data);
        const as_ = addressSimilarity(orphan.data, member.data);
        const cs = contactSimilarity(orphan.data, member.data);
        const signals: PendingNameMatch['signals'] = [];
        if (ns >= 0.65) signals.push('name');
        if (as_ >= 0.70) signals.push('address');
        if (cs >= 0.80) signals.push('contact');

        best = { cluster, score, signals };
      }
    }

    if (best) {
      const orphanClusterId = `orphan:${orphan.id}`;
      const candidateName = cleanString(best.cluster.members[0]?.data.client_name);
      const signalLabel = best.signals.join(' + ');
      pendingNameMatches.push({
        orphanClusterId,
        candidateClusterId: best.cluster.id,
        orphanName,
        candidateName,
        orphanSource: orphan.source,
        candidateSources: [...best.cluster.sources],
        score: best.score,
        signals: best.signals,
      });
      clusterMap.set(orphanClusterId, {
        id: orphanClusterId,
        primaryKeyType: 'none',
        primaryKeyValue: '',
        members: [orphan],
        sources: [orphan.source],
        archived: true,
        archiveReason: `Possible duplicate of "${candidateName}" (matched on: ${signalLabel}) — awaiting operator confirmation.`,
      });
      matchedOrphanIds.add(orphan.id);
    }
  }

  // Pass 3 — archive remaining orphans (no name match found)
  for (const o of orphans) {
    if (matchedOrphanIds.has(o.id)) continue;
    const id = `archive:${o.id}`;
    clusterMap.set(id, {
      id,
      primaryKeyType: 'none',
      primaryKeyValue: '',
      members: [o],
      sources: [o.source],
      archived: true,
      archiveReason:
        'No primary identifier found (registration number, SA ID number, or trust deed number). ' +
        'Cannot file or report for this client. Return to firm for clarification.',
    });
  }

  const clusters = Array.from(clusterMap.values());
  return {
    clusters,
    pendingNameMatches,
    stats: {
      inputRecords: records.length,
      clusters: clusters.length,
      pendingNameMatches: pendingNameMatches.length,
      archived: clusters.filter((c) => c.archived).length,
    },
  };
}

// -----------------------------------------------------------------------------
// Apply operator decisions from DedupConfirmation
// -----------------------------------------------------------------------------

/**
 * Merge approved orphan clusters into their candidate clusters.
 * Rejected orphans remain as separate archived clusters.
 * Returns a new clusters array with decisions applied.
 */
export function applyNameMatches(
  clusters: Cluster[],
  pendingMatches: PendingNameMatch[],
  approvedOrphanClusterIds: string[],
  rejectedOrphanClusterIds: string[],
): Cluster[] {
  const approvedSet = new Set(approvedOrphanClusterIds);
  const rejectedSet = new Set(rejectedOrphanClusterIds);
  const clusterMap = new Map(clusters.map((c) => [c.id, c]));

  for (const match of pendingMatches) {
    const orphan = clusterMap.get(match.orphanClusterId);
    const candidate = clusterMap.get(match.candidateClusterId);
    if (!orphan || !candidate) continue;

    if (approvedSet.has(match.orphanClusterId)) {
      // Merge orphan members into candidate
      for (const m of orphan.members) {
        candidate.members.push(m);
        if (!candidate.sources.includes(m.source)) candidate.sources.push(m.source);
      }
      clusterMap.delete(match.orphanClusterId);
    } else if (rejectedSet.has(match.orphanClusterId)) {
      // Keep separate — update archive reason to indicate operator decision
      orphan.archiveReason =
        `Operator kept separate from "${match.candidateName}". ` +
        'No primary identifier found — return to firm for clarification.';
    }
    // If neither approved nor rejected (shouldn't happen after confirmation), leave as-is
  }

  return Array.from(clusterMap.values());
}
