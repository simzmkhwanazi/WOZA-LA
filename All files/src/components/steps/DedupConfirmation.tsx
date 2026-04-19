'use client';

import { useState, useMemo } from 'react';
import type { PendingNameMatch, Cluster } from '@/lib/matcher';
import { SOURCE_LABELS, type SourceType } from '@/lib/schema/sources';
import type { ClientRecord } from '@/lib/schema/datagrows';

interface DedupConfirmationProps {
  sessionId: string;
  pendingNameMatches: PendingNameMatch[];
  autoMergedClusters: Cluster[];
  onConfirm: (approved: string[], rejected: string[], splitClusterIds: string[]) => void;
  onSkip?: () => void;
}

interface DecisionState {
  [orphanId: string]: 'approved' | 'rejected' | null;
}

interface MappedRecord {
  id: string;
  source: SourceType;
  data: ClientRecord;
}

function getSourceColor(source: SourceType): string {
  const colors: Record<SourceType, string> = {
    cipc: 'bg-blue-100 text-blue-700 ring-blue-200',
    sars: 'bg-green-100 text-green-700 ring-green-200',
    sage: 'bg-purple-100 text-purple-700 ring-purple-200',
    xero: 'bg-sky-100 text-sky-700 ring-sky-200',
    excel: 'bg-gray-100 text-gray-700 ring-gray-200',
    employees: 'bg-indigo-100 text-indigo-700 ring-indigo-200',
  };
  return colors[source] || colors.excel;
}

function getSimilarityColor(score: number): string {
  if (score >= 0.9) return 'text-green-700';
  if (score >= 0.85) return 'text-amber-700';
  return 'text-red-700';
}

function getSimilarityBgColor(score: number): string {
  if (score >= 0.9) return 'bg-green-50';
  if (score >= 0.85) return 'bg-amber-50';
  return 'bg-red-50';
}

export function DedupConfirmation({
  sessionId,
  pendingNameMatches,
  autoMergedClusters,
  onConfirm,
  onSkip,
}: DedupConfirmationProps) {
  const [decisions, setDecisions] = useState<DecisionState>({});
  const [splitClusterIds, setSplitClusterIds] = useState<string[]>([]);

  const hasMultiSourceMerges = useMemo(() => {
    return autoMergedClusters.some((c) => c.members.length > 1);
  }, [autoMergedClusters]);

  const isEmpty = pendingNameMatches.length === 0 && !hasMultiSourceMerges;

  const decisionsSummary = useMemo(() => {
    const approved = Object.entries(decisions)
      .filter(([, v]) => v === 'approved')
      .map(([k]) => k);
    const rejected = Object.entries(decisions)
      .filter(([, v]) => v === 'rejected')
      .map(([k]) => k);
    return { approved, rejected };
  }, [decisions]);

  const allDecisionsComplete = useMemo(() => {
    return pendingNameMatches.every((match) => decisions[match.orphanId] !== null);
  }, [pendingNameMatches, decisions]);

  function setDecision(orphanId: string, decision: 'approved' | 'rejected') {
    setDecisions((prev) => ({
      ...prev,
      [orphanId]: decision,
    }));
  }

  function toggleSplit(clusterId: string) {
    setSplitClusterIds((prev) =>
      prev.includes(clusterId)
        ? prev.filter((id) => id !== clusterId)
        : [...prev, clusterId]
    );
  }

  function handleMergeAll() {
    const newDecisions = { ...decisions };
    for (const match of pendingNameMatches) {
      newDecisions[match.orphanId] = 'approved';
    }
    setDecisions(newDecisions);
  }

  function handleKeepAllSeparate() {
    const newDecisions = { ...decisions };
    for (const match of pendingNameMatches) {
      newDecisions[match.orphanId] = 'rejected';
    }
    setDecisions(newDecisions);
  }

  function handleConfirm() {
    onConfirm(decisionsSummary.approved, decisionsSummary.rejected, splitClusterIds);
  }

  if (isEmpty) {
    return (
      <div className="space-y-6">
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-[#2D3748] mb-2">
            No Possible Duplicates Found
          </h2>
          <p className="text-sm text-gray-600 mb-4">
            All records matched on primary keys. No duplicate pairs found.
          </p>
          <button
            onClick={onSkip}
            className="btn btn-primary"
          >
            Continue to Review
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="card p-6 border-l-4 border-l-[#2BBCBC]">
        <h2 className="text-lg font-semibold text-[#2D3748] mb-1">
          Possible Duplicates Found ({pendingNameMatches.length} pairs)
        </h2>
        <p className="text-sm text-gray-600">
          Review each potential duplicate and decide whether to merge or keep separate.
        </p>
      </div>

      {/* Bulk actions */}
      {pendingNameMatches.length > 0 && (
        <div className="flex gap-2 px-6">
          <button
            onClick={handleMergeAll}
            className="text-sm text-[#2BBCBC] hover:text-[#1E9898] font-medium underline"
          >
            Merge All
          </button>
          <span className="text-gray-300">·</span>
          <button
            onClick={handleKeepAllSeparate}
            className="text-sm text-[#2BBCBC] hover:text-[#1E9898] font-medium underline"
          >
            Keep All Separate
          </button>
        </div>
      )}

      {/* Pending name matches */}
      {pendingNameMatches.length > 0 && (
        <div className="space-y-3 px-6">
          {pendingNameMatches.map((match) => {
            const decision = decisions[match.orphanId];
            const score = Math.round(match.score * 100);

            return (
              <div
                key={match.orphanId}
                className={`card p-4 transition-colors ${
                  getSimilarityBgColor(match.score)
                }`}
              >
                {!decision ? (
                  <>
                    {/* Names and sources */}
                    <div className="flex items-center gap-3 mb-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-[#2D3748]">
                            {match.orphanName}
                          </span>
                          <span
                            className={`badge ring-1 text-xs ${getSourceColor(
                              'excel'
                            )}`}
                          >
                            Excel
                          </span>
                        </div>
                      </div>
                      <div className="text-2xl text-gray-400">↔</div>
                      <div className="flex-1 text-right">
                        <div className="flex items-center gap-2 justify-end mb-1">
                          <span
                            className={`badge ring-1 text-xs ${getSourceColor(
                              'sage'
                            )}`}
                          >
                            Sage
                          </span>
                          <span className="font-medium text-[#2D3748]">
                            {match.candidateName}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Similarity + metadata */}
                    <div className="flex items-center gap-2 mb-3 text-sm">
                      <span className={`font-medium ${getSimilarityColor(match.score)}`}>
                        Similarity: {score}%
                      </span>
                      <span className="text-gray-400">·</span>
                      <span className="text-gray-600">
                        No shared Registration Nr
                      </span>
                    </div>

                    {/* Decision buttons */}
                    <div className="flex gap-2">
                      <button
                        onClick={() => setDecision(match.orphanId, 'approved')}
                        className="flex-1 btn bg-[#2BBCBC] text-white hover:bg-[#1E9898] active:bg-[#177373]"
                      >
                        Merge
                      </button>
                      <button
                        onClick={() => setDecision(match.orphanId, 'rejected')}
                        className="flex-1 btn border border-gray-300 bg-white text-[#2D3748] hover:bg-gray-50"
                      >
                        Keep Separate
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    {/* Decision made - show summary */}
                    <div className="flex items-center gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-[#2D3748]">
                            {match.orphanName}
                          </span>
                          <span className={`badge ring-1 text-xs ${getSourceColor('excel')}`}>
                            Excel
                          </span>
                        </div>
                      </div>
                      <div className="text-2xl text-gray-400">↔</div>
                      <div className="flex-1 text-right">
                        <div className="flex items-center gap-2 justify-end mb-1">
                          <span className={`badge ring-1 text-xs ${getSourceColor('sage')}`}>
                            Sage
                          </span>
                          <span className="font-medium text-[#2D3748]">
                            {match.candidateName}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 text-sm">
                      <span className="font-medium text-[#2D3748]">
                        {decision === 'approved' ? 'Will merge' : 'Will keep separate'}
                      </span>
                      <button
                        onClick={() => setDecisions((prev) => { const copy = { ...prev }; delete copy[match.orphanId]; return copy; })}
                        className="ml-3 text-[#2BBCBC] hover:text-[#1E9898] underline text-xs"
                      >
                        Undo
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Auto-merged pairs */}
      {autoMergedClusters.filter((c) => c.members.length > 1).length > 0 && (
        <div className="space-y-3 px-6">
          <h3 className="text-sm font-semibold text-[#2D3748] mt-6 mb-2">
            Auto-Merged Pairs (Primary Key Matches)
          </h3>
          {autoMergedClusters
            .filter((c) => c.members.length > 1)
            .map((cluster) => {
              const isSplit = splitClusterIds.includes(cluster.id);
              const keyTypeLabel =
                cluster.primaryKeyType === 'reg'
                  ? 'Registration Nr'
                  : cluster.primaryKeyType === 'id'
                    ? 'ID'
                    : cluster.primaryKeyType === 'trust_deed'
                      ? 'Trust Deed Nr'
                      : 'Primary Key';

              return (
                <div key={cluster.id} className="card p-4 bg-gray-50">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="flex-1">
                      <p className="text-sm text-gray-600 mb-2">
                        <span className="font-medium">
                          Auto-merged ({keyTypeLabel}: {cluster.primaryKeyValue})
                        </span>
                      </p>
                      <div className="space-y-1">
                        {cluster.members.map((member, idx) => (
                          <div key={idx} className="flex items-center gap-2">
                            <span className="text-sm text-[#2D3748]">
                              {String(member.data.client_name || '(No name)')}
                            </span>
                            <span className={`badge ring-1 text-xs ${getSourceColor(member.source)}`}>
                              {SOURCE_LABELS[member.source]}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <button
                      onClick={() => toggleSplit(cluster.id)}
                      className={`text-sm font-medium underline transition-colors ${
                        isSplit
                          ? 'text-red-600 hover:text-red-700'
                          : 'text-red-500 hover:text-red-600'
                      }`}
                    >
                      {isSplit ? 'Will split' : 'Split if incorrect'}
                    </button>
                  </div>
                </div>
              );
            })}
        </div>
      )}

      {/* Confirm button */}
      <div className="flex justify-end px-6 pt-4 border-t border-gray-200">
        <button
          onClick={handleConfirm}
          disabled={!allDecisionsComplete}
          className={`btn ${
            allDecisionsComplete
              ? 'bg-[#2BBCBC] text-white hover:bg-[#1E9898] active:bg-[#177373]'
              : 'bg-gray-200 text-gray-500 cursor-not-allowed'
          }`}
        >
          Confirm All Decisions
        </button>
      </div>
    </div>
  );
}
