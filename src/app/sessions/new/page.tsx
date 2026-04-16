'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function NewSessionPage() {
  const router = useRouter();
  const supabase = createClient();
  const [firmName, setFirmName] = useState('');
  const [operator, setOperator] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const { data: firm, error: firmErr } = await supabase
      .from('firms')
      .insert({ name: firmName.trim() })
      .select()
      .single();

    if (firmErr || !firm) {
      setError(firmErr?.message ?? 'Failed to create firm');
      setSubmitting(false);
      return;
    }

    const { data: session, error: sessErr } = await supabase
      .from('sessions')
      .insert({
        firm_id: firm.id,
        status: 'uploading',
        operator_name: operator.trim() || null,
      })
      .select()
      .single();

    if (sessErr || !session) {
      setError(sessErr?.message ?? 'Failed to create session');
      setSubmitting(false);
      return;
    }

    router.push(`/sessions/${session.id}`);
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
