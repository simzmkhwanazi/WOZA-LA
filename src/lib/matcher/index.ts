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
  registrationMatchKey,
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
  // Use canonical match key so "2004876646" and "2004/876646/07" resolve to the same cluster
  const reg = registrationMatchKey(rec.registration_nr);
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

  // Standard Levenshtein similarity
  const d = levenshtein(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  const levSim = 1 - d / maxLen;

  // Token sort ratio: split on word boundaries, sort tokens, rejoin, compare.
  // Handles "ABC Trading Pty Ltd" vs "ABC TRADING PTYLTD" → much higher score.
  const tokensA = na.split(/[^A-Z0-9]+/).filter(Boolean).sort().join('');
  const tokensB = nb.split(/[^A-Z0-9]+/).filter(Boolean).sort().join('');
  const td = levenshtein(tokensA, tokensB);
  const tokenMaxLen = Math.max(tokensA.length, tokensB.length);
  const tokenSim = tokenMaxLen > 0 ? 1 - td / tokenMaxLen : 0;

  // Use the higher of the two scores
  return Math.max(levSim, tokenSim);
}

/** Returns true if the record has at least one valid primary identifier. */
export function hasPrimaryIdentifier(rec: ClientRecord): boolean {
  const reg = registrationMatchKey(rec.registration_nr);
  if (reg && reg.length >= 10) return true;
  const id = idNumberKey(rec.id_number);
  if (id && id.length === 13) return true;
  const td = cleanString(rec.trust_deed_number);
  if (td) return true;
  return false;
}

const NAME_MATCH_THRESHOLD = 0.85;

// -----------------------------------------------------------------------------
// Main matcher
// -----------------------------------------------------------------------------

export interface MatchResult {
  clusters: Cluster[];
  stats: {
    inputRecords: number;
    clusters: number;
    nameBridged: number;
    archived: number;
  };
}

export function matchRecords(records: MappedRecord[]): MatchResult {
  const clusterMap = new Map<string, Cluster>();
  const orphans: MappedRecord[] = [];
  let nameBridged = 0;

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

  // Pass 2 — name bridge for orphans
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
      best.cluster.members.push(orphan);
      if (!best.cluster.sources.includes(orphan.source)) {
        best.cluster.sources.push(orphan.source);
      }
      nameBridged++;
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
        'No primary identifier found (registration number, SA ID number, or trust deed number). ' +
        'Cannot file or report for this client. Return to firm for clarification.',
    });
  }

  const clusters = Array.from(clusterMap.values());
  return {
    clusters,
    stats: {
      inputRecords: records.length,
      clusters: clusters.length,
      nameBridged,
      archived: clusters.filter((c) => c.archived).length,
    },
  };
}
