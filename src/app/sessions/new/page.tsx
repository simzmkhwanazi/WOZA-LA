'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function NewSessionPage() {
  const router = useRouter();
  const [firmName, setFirmName] = useState('');
  const [operator, setOperator] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firmName: firmName.trim(), operatorName: operator.trim() || null }),
      });

      const data = await res.json() as { sessionId?: string; error?: string };

      if (!res.ok) {
        setError(data.error ?? 'Failed to create session');
        setSubmitting(false);
        return;
      }

      router.push(`/sessions/${data.sessionId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create session');
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-xl">
      <h2 className="text-2xl font-semibold text-navy-800">New Onboarding Session</h2>
      <p className="text-sm text-navy-500 mt-1 mb-6">
        Create a new session for a firm (e.g. &quot;Rich Accountants&quot;).
      </p>

      <form onSubmit={handleSubmit} className="card p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-navy-700 mb-1">
            Firm Name *
          </label>
          <input
            type="text"
            value={firmName}
            onChange={(e) => setFirmName(e.target.value)}
            required
            placeholder="Rich Accountants"
            className="input"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-navy-700 mb-1">
            Operator (DataGrows staff running this onboarding)
          </label>
          <input
            type="text"
            value={operator}
            onChange={(e) => setOperator(e.target.value)}
            placeholder="Your name"
            className="input"
          />
        </div>

        {error && <div className="text-sm text-rose-600">{error}</div>}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={() => router.back()}
            className="btn btn-secondary"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || !firmName.trim()}
            className="btn btn-primary"
          >
            {submitting ? 'Creating…' : 'Create Session'}
          </button>
        </div>
      </form>
    </div>
  );
}
