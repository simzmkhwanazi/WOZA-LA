'use client';

import { useState } from 'react';

// ── Constants ──────────────────────────────────────────────────────────────

const SOURCE_SYSTEMS = ['Xero', 'Sage', 'SARS', 'CIPC', 'Manual Excel'] as const;

const DATA_TYPES = [
  'VAT Records',
  'Invoices',
  'Payroll',
  'Financial Statements',
  'Tax Returns',
  'CIPC Filings',
  'Bank Statements',
  'Trial Balance',
] as const;

// ── Types ──────────────────────────────────────────────────────────────────

interface Feature {
  name: string;
  reason: string;
}

interface EngineResult {
  urgent_features: Feature[];
  nice_to_have_features: Feature[];
}

// ── Sub-components ─────────────────────────────────────────────────────────

function TogglePill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-all ${
        active
          ? 'bg-teal text-white border-teal shadow-sm'
          : 'bg-white border-gray-200 text-navy-600 hover:border-teal hover:text-teal'
      }`}
    >
      {label}
    </button>
  );
}

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
      <div className="pr-14">
        <p className="text-sm font-semibold text-navy-800">{feature.name}</p>
        <p className="text-xs text-navy-500 mt-1 leading-relaxed">{feature.reason}</p>
      </div>
      <button
        type="button"
        onClick={handleCopy}
        className="absolute top-3 right-3 text-xs font-medium text-navy-400 hover:text-teal transition-colors px-2 py-1 rounded border border-gray-200 bg-white hover:border-teal"
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function FeatureEnginePage() {
  const [sourceSystem, setSourceSystem] = useState<string | null>(null);
  const [dataTypes, setDataTypes] = useState<string[]>([]);
  const [result, setResult] = useState<EngineResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleDataType(type: string) {
    setDataTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    );
  }

  async function runEngine() {
    if (!sourceSystem || dataTypes.length === 0) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch('/api/feature-engine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceSystem, dataTypes }),
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

  const canRun = !!sourceSystem && dataTypes.length > 0 && !loading;

  return (
    <div className="space-y-4">
      {/* ── Page header ── */}
      <div>
        <h2 className="text-2xl font-semibold text-navy-800">Feature Relevance Engine</h2>
        <p className="text-sm text-navy-500 mt-1">
          Select a client&apos;s source system and data types to get AI-powered DataGrows feature
          recommendations.
        </p>
      </div>

      {/* ── Two-panel layout ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">

        {/* ── Left: Selections ── */}
        <div className="card p-6 space-y-6">

          {/* 01 — Source System */}
          <div>
            <p className="text-xs font-semibold text-navy-400 uppercase tracking-widest mb-3">
              01 — Source System
            </p>
            <div className="flex flex-wrap gap-2">
              {SOURCE_SYSTEMS.map((s) => (
                <TogglePill
                  key={s}
                  label={s}
                  active={sourceSystem === s}
                  onClick={() => setSourceSystem(sourceSystem === s ? null : s)}
                />
              ))}
            </div>
          </div>

          {/* 02 — Data Types */}
          <div>
            <p className="text-xs font-semibold text-navy-400 uppercase tracking-widest mb-3">
              02 — Data Types Imported
            </p>
            <div className="flex flex-wrap gap-2">
              {DATA_TYPES.map((t) => (
                <TogglePill
                  key={t}
                  label={t}
                  active={dataTypes.includes(t)}
                  onClick={() => toggleDataType(t)}
                />
              ))}
            </div>
          </div>

          {/* Run button */}
          <button
            type="button"
            onClick={runEngine}
            disabled={!canRun}
            className="btn btn-primary w-full justify-center py-3"
          >
            {loading ? 'Running engine…' : 'Run Feature Engine →'}
          </button>

          {!sourceSystem && (
            <p className="text-xs text-navy-400 text-center -mt-2">
              Select a source system to continue
            </p>
          )}
          {sourceSystem && dataTypes.length === 0 && (
            <p className="text-xs text-navy-400 text-center -mt-2">
              Select at least one data type
            </p>
          )}
        </div>

        {/* ── Right: Results ── */}
        <div className="card p-6 min-h-[320px] flex flex-col">
          {!result && !loading && !error && (
            <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 py-8">
              <div className="text-4xl text-teal-200">⚡</div>
              <p className="text-sm text-navy-400 max-w-xs leading-relaxed">
                Select a source system and data types to generate feature recommendations
              </p>
            </div>
          )}

          {loading && (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 py-8">
              <div className="w-8 h-8 border-2 border-teal border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-navy-400">Analysing data profile…</p>
            </div>
          )}

          {error && (
            <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-700">
              <strong className="block mb-1">Engine error</strong>
              {error}
            </div>
          )}

          {result && (
            <div className="space-y-6">
              {/* Urgent */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="badge badge-ok">Urgent</span>
                  <span className="text-xs text-navy-400">
                    {result.urgent_features.length} feature{result.urgent_features.length !== 1 ? 's' : ''}
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
                  <span className="badge badge-muted">Nice to have</span>
                  <span className="text-xs text-navy-400">
                    {result.nice_to_have_features.length} feature{result.nice_to_have_features.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="space-y-2">
                  {result.nice_to_have_features.map((f, i) => (
                    <FeatureCard key={i} feature={f} tone="nice" />
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={() => { setResult(null); setSourceSystem(null); setDataTypes([]); }}
                className="btn btn-ghost text-xs w-full justify-center"
              >
                Clear results
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
