/**
 * Two-pass matching engine.
 *
 *   Pass 1 — Primary key match (deterministic):
 *     - Registered entities: Registration Number (digits only)
 *     - Individuals/Sole Props: ID Number (digits only)
 *     - Trusts/Estates: Trust Deed Number
 *
 *   Pass 2 — Name-bridge:
 *     - For records with NO primary key, try fuzzy-matching against the
 *       NAMES of records that DO have a primary key. If a close match is
 *       found in another source, borrow that primary key and merge.
 *
 *   Pass 3 — Archive orphans:
 *     - Anything still without a primary key gets archived.
 */

import { distance as levenshtein } from 'fastest-levenshtein';
import {
  INDIVIDUAL_ENTITY_TYPES,
  TRUST_ENTITY_TYPES,
  type ClientRecord,
} from '../schema/datagrows';
import {
  registrationKey,
  idNumberKey,
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
  primaryKeyType: 'reg' | 'id' | 'trust_deed' | 'name_bridge' | 'none';
  primaryKeyValue: string;
  members: MappedRecord[];
  sources: SourceType[];
  archived: boolean;
  archiveReason?: string;
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

  // Default: try registration number first (works for most entity types)
  const reg = registrationKey(rec.registration_nr);
  if (reg) return { type: 'reg', value: reg };

  // Then fall back to ID number (for unclassified)
  const id = idNumberKey(rec.id_number);
  if (id) return { type: 'id', value: id };

  // Then trust deed (for unclassified)
  const td = cleanString(rec.trust_deed_number);
  if (td) return { type: 'trust_deed', value: td };

  return { type: 'none', value: '' };
}

// -----------------------------------------------------------------------------
// Name similarity (for pass 2)
// -----------------------------------------------------------------------------

/** 0..1 similarity where 1 = identical. */
function nameSimilarity(a: string, b: string): number {
  const na = upperNormalize(a);
  const nb = upperNormalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const d = levenshtein(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  return 1 - d / maxLen;
}

const NAME_MATCH_THRESHOLD = 0.85;

// -----------------------------------------------------------------------------
// Main matcher
// -----------------------------------------------------------------------------

export interface PendingNameMatch {
  orphanId: string;
  orphanName: string;
  candidateClusterId: string;
  candidateName: string;
  score: number;
}

export interface MatchResult {
  clusters: Cluster[];
  pendingNameMatches: PendingNameMatch[];
  stats: {
    inputRecords: number;
    clusters: number;
    nameBridged: number;
    archived: number;
    pendingConfirmation: number;
  };
}

export function matchRecords(records: MappedRecord[]): MatchResult {
  const clusterMap = new Map<string, Cluster>();
  const orphans: MappedRecord[] = [];
  const pendingNameMatches: PendingNameMatch[] = [];

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

  // Pass 2 — name bridge for orphans (collect matches for confirmation instead of auto-merging)
  const stillOrphaned: MappedRecord[] = [];
  for (const orphan of orphans) {
    const orphanName = cleanString(orphan.data.client_name);
    if (!orphanName) { stillOrphaned.push(orphan); continue; }

    let best: { cluster: Cluster; score: number } | null = null;
    for (const cluster of clusterMap.values()) {
      for (const member of cluster.members) {
        const memberName = cleanString(member.data.client_name);
        if (!memberName) continue;
        const score = nameSimilarity(orphanName, memberName);
        if (score >= NAME_MATCH_THRESHOLD && (!best || score > best.score)) {
          best = { cluster, score };
        }
      }
    }

    if (best) {
      // Instead of merging directly, collect as pending confirmation
      pendingNameMatches.push({
        orphanId: orphan.id,
        orphanName,
        candidateClusterId: best.cluster.id,
        candidateName: cleanString(best.cluster.members[0]?.data.client_name ?? ''),
        score: best.score,
      });
    } else {
      stillOrphaned.push(orphan);
    }
  }

  // Pass 3 — archive what's left
  for (const o of stillOrphaned) {
    const id = `archive:${o.id}`;
    clusterMap.set(id, {
      id,
      primaryKeyType: 'none',
      primaryKeyValue: '',
      members: [o],
      sources: [o.source],
      archived: true,
      archiveReason:
        'No registration number, ID number, or trust deed number found. ' +
        'Unable to cross-reference in other sources by name.',
    });
  }

  const clusters = Array.from(clusterMap.values());
  return {
    clusters,
    pendingNameMatches,
    stats: {
      inputRecords: records.length,
      clusters: clusters.length,
      nameBridged: 0, // Will be incremented when operator confirms matches
      archived: clusters.filter((c) => c.archived).length,
      pendingConfirmation: pendingNameMatches.length,
    },
  };
}

/**
 * Applies operator-confirmed name matches to clusters.
 *
 * After the operator has reviewed pending name matches and decided which to approve/reject,
 * this function merges approved orphans into their candidate clusters and archives rejected ones.
 *
 * @param clusters - Current cluster map from matchRecords()
 * @param orphans - Original orphan records from Pass 2
 * @param pendingMatches - Array of pending matches from matchRecords() result
 * @param approved - Array of orphan IDs that operator approved for merge
 * @param rejected - Array of orphan IDs that operator rejected (archive separately)
 * @returns Updated clusters with merges applied
 */
export function applyNameMatches(
  clusters: Cluster[],
  orphans: MappedRecord[],
  pendingMatches: PendingNameMatch[],
  approved: string[],
  rejected: string[],
): Cluster[] {
  const clusterMap = new Map(clusters.map((c) => [c.id, c]));
  const approvedSet = new Set(approved);
  const rejectedSet = new Set(rejected);
  const orphanMap = new Map(orphans.map((o) => [o.id, o]));
  const matchMap = new Map(pendingMatches.map((m) => [m.orphanId, m]));

  // Apply approved merges: move orphan from pending into target cluster
  for (const orphanId of approvedSet) {
    const match = matchMap.get(orphanId);
    const orphan = orphanMap.get(orphanId);
    if (!match || !orphan) continue;

    const targetCluster = clusterMap.get(match.candidateClusterId);
    if (targetCluster) {
      targetCluster.members.push(orphan);
      if (!targetCluster.sources.includes(orphan.source)) {
        targetCluster.sources.push(orphan.source);
      }
    }
  }

  // Archive rejected orphans: create new archive clusters for them
  for (const orphanId of rejectedSet) {
    const orphan = orphanMap.get(orphanId);
    if (!orphan) continue;

    const archiveId = `archive:${orphan.id}`;
    clusterMap.set(archiveId, {
      id: archiveId,
      primaryKeyType: 'none',
      primaryKeyValue: '',
      members: [orphan],
      sources: [orphan.source],
      archived: true,
      archiveReason: 'Operator rejected name-based merge suggestion.',
    });
  }

  return Array.from(clusterMap.values());
}
