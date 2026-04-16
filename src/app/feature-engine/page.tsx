'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';

// ── Types ──────────────────────────────────────────────────────────────────────

interface SessionRow {
  id: string;
  status: string;
  operator_name: string | null;
  created_at: string;
  firms: { name: string } | null;
}

interface Feature {
  name: string;
  reason: string;
}

interface EngineResult {
  urgent_features: Feature[];
  nice_to_have_features: Feature[];
  profile: {
    totalClients: number;
    activeClients: number;
    dormantClients: number;
    vatClients: number;
    payeClients: number;
    payrollClients: number;
    cipcClients: number;
    entityTypeCounts: Record<string, number>;
  };
}

// ── DataGrows features URL ─────────────────────────────────────────────────────

const FEATURES_URL = 'https://www.mydatagrows.com/features';

// ── Sub-components ─────────────────────────────────────────────────────────────

function FeatureCard({
  feature,
  tone,
}: {
  feature: Feature;
  tone: 'urgent' | 'nice';
}) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(`${feature.name}: ${feature.reason}`).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div
      className={`relative rounded-xl border p-4 ${
        tone === 'urgent'
          ? 'border-teal-200 bg-teal-50'
          : 'border-gray-100 bg-white'
      }`}
    >
      <div className="pr-24">
        <a
          href={FEATURES_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-semibold text-navy-800 hover:text-teal transition-colors underline decoration-dotted underline-offset-2"
        >
          {feature.name}
        </a>
        <p className="text-xs text-navy-500 mt-1 leading-relaxed">{feature.reason}</p>
      </div>
      <div className="absolute top-3 right-3 flex gap-1.5">
        <a
          href={FEATURES_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-medium text-navy-400 hover:text-teal transition-colors px-2 py-1 rounded border border-gray-200 bg-white hover:border-teal"
        >
          View →
        </a>
        <button
          type="button"
          onClick={handleCopy}
          className="text-xs font-medium text-navy-400 hover:text-teal transition-colors px-2 py-1 rounded border border-gray-200 bg-white hover:border-teal"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

function ProfileStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center">
      <p className="text-2xl font-bold text-navy-800">{value}</p>
      <p className="text-[11px] text-navy-400 uppercase tracking-wide mt-0.5">{label}</p>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function FeatureEnginePage() {
  const supabase = createClient();
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [selectedSession, setSelectedSession] = useState<SessionRow | null>(null);
  const [result, setResult] = useState<EngineResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    const { data } = await supabase
      .from('sessions')
      .select('id, status, operator_name, created_at, firms(name)')
      .order('created_at', { ascending: false });

    const rows: SessionRow[] = (data ?? []).map((s) => {
      const firmRaw = s.firms;
      const firm = Array.isArray(firmRaw) ? firmRaw[0] : firmRaw;
      return { ...s, firms: firm ?? null } as SessionRow;
    });

    setSessions(rows);
    setLoadingSessions(false);
  }, [supabase]);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  async function selectSession(session: SessionRow) {
    setSelectedSession(session);
    setResult(null);
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/feature-engine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.id }),
      });

      const data = await res.json() as EngineResult & { error?: string };

      if (!res.ok) {
        throw new Error(data.error ?? `Engine failed (${res.status})`);
      }

      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Feature engine failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-ZA', {
      day: 'numeric', month: 'short', year: 'numeric',
    });
  }

  return (
    <div className="space-y-4">
      {/* ── Page header ── */}
      <div>
        <h2 className="text-2xl font-semibold text-navy-800">Feature Relevance Engine</h2>
        <p className="text-sm text-navy-500 mt-1">
          Select a completed session — Woza La will analyse the client portfolio and recommend
          the most relevant{' '}
          <a
            href={FEATURES_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-teal font-medium hover:underline"
          >
            DataGrows features
          </a>{' '}
          to activate.
        </p>
      </div>

      {/* ── Two-panel layout ── */}
      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-6 items-start">

        {/* ── Left: Session list ── */}
        <div className="card overflow-hidden">
          <div className="px-5 py-3 border-b border-navy-100">
            <p className="text-xs font-semibold text-navy-400 uppercase tracking-widest">
              Sessions
            </p>
          </div>

          {loadingSessions ? (
            <p className="px-5 py-6 text-sm text-navy-400">Loading sessions…</p>
          ) : sessions.length === 0 ? (
            <p className="px-5 py-6 text-sm text-navy-500 text-center">
              No sessions yet. Create a session first.
            </p>
          ) : (
            <ul className="divide-y divide-navy-50">
              {sessions.map((s) => {
                const isSelected = selectedSession?.id === s.id;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => selectSession(s)}
                      disabled={loading}
                      className={`w-full text-left px-5 py-3.5 transition-colors hover:bg-teal-50 ${
                        isSelected ? 'bg-teal-50 border-l-2 border-teal' : ''
                      }`}
                    >
                      <p className={`text-sm font-semibold leading-tight ${
                        isSelected ? 'text-teal-700' : 'text-navy-800'
                      }`}>
                        {s.firms?.name ?? 'Unknown firm'}
                      </p>
                      <p className="text-xs text-navy-400 mt-0.5">
                        {formatDate(s.created_at)}
                        {s.operator_name ? ` · ${s.operator_name}` : ''}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* ── Right: Results ── */}
        <div className="card p-6 min-h-[400px] flex flex-col">

          {/* Empty state */}
          {!selectedSession && !loading && (
            <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 py-12">
              <div className="text-5xl text-teal-200">⚡</div>
              <p className="text-sm text-navy-400 max-w-xs leading-relaxed">
                Select a session from the list to generate AI-powered DataGrows feature
                recommendations based on the client portfolio.
              </p>
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 py-12">
              <div className="w-8 h-8 border-2 border-teal border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-navy-400">Analysing client portfolio…</p>
            </div>
          )}

          {/* Error */}
          {!loading && error && (
            <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-700">
              <strong className="block mb-1">Engine error</strong>
              {error}
            </div>
          )}

          {/* Results */}
          {!loading && result && selectedSession && (
            <div className="space-y-6">
              {/* Header */}
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-lg font-semibold text-navy-800">
                    {selectedSession.firms?.name ?? 'Unknown firm'}
                  </h3>
                  <p className="text-xs text-navy-400 mt-0.5">
                    Feature recommendations based on {result.profile.totalClients} clients
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => { setResult(null); setSelectedSession(null); setError(null); }}
                  className="btn btn-ghost text-xs shrink-0"
                >
                  Clear
                </button>
              </div>

              {/* Portfolio stats */}
              <div className="grid grid-cols-4 gap-3 p-4 bg-navy-50 rounded-xl border border-navy-100">
                <ProfileStat label="Clients" value={result.profile.totalClients} />
                <ProfileStat label="VAT reg." value={result.profile.vatClients} />
                <ProfileStat label="Payroll" value={result.profile.payrollClients} />
                <ProfileStat label="CIPC" value={result.profile.cipcClients} />
              </div>

              {/* Urgent features */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="badge badge-ok">Priority features</span>
                  <span className="text-xs text-navy-400">
                    {result.urgent_features.length} recommendation{result.urgent_features.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="space-y-2">
                  {result.urgent_features.map((f, i) => (
                    <FeatureCard key={i} feature={f} tone="urgent" />
                  ))}
                </div>
              </div>

              {/* Nice to have */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="badge badge-muted">Worth exploring</span>
                  <span className="text-xs text-navy-400">
                    {result.nice_to_have_features.length} recommendation{result.nice_to_have_features.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="space-y-2">
                  {result.nice_to_have_features.map((f, i) => (
                    <FeatureCard key={i} feature={f} tone="nice" />
                  ))}
                </div>
              </div>

              {/* Footer link */}
              <p className="text-xs text-navy-400 text-center pt-2 border-t border-navy-100">
                All features available at{' '}
                <a
                  href={FEATURES_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-teal font-medium hover:underline"
                >
                  mydatagrows.com/features
                </a>
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
