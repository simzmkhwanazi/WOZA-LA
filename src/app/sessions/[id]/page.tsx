'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { UploadStep } from '@/components/steps/UploadStep';
import { MappingStep } from '@/components/steps/MappingStep';
import { ReviewStep } from '@/components/steps/ReviewStep';
import { ExportStep } from '@/components/steps/ExportStep';
import { AuditStep } from '@/components/steps/AuditStep';

type Step = 'upload' | 'mapping' | 'review' | 'export' | 'audit';
type ReviewFilter = 'all' | 'errors' | 'warnings' | 'archived' | 'dormant';

interface SessionDto {
  id: string;
  firm_id: string;
  status: string;
  operator_name: string | null;
  notes: string | null;
  firms: { name: string } | null;
}

export default function SessionPage() {
  const params = useParams();
  const sessionId = String(params.id);
  const supabase = createClient();
  const [session, setSession] = useState<SessionDto | null>(null);
  const [step, setStep] = useState<Step>('upload');
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('errors');
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState('');
  const [notesSaving, setNotesSaving] = useState(false);

  const loadSession = useCallback(async () => {
    const { data } = await supabase
      .from('sessions')
      .select('id, firm_id, status, operator_name, notes, firms(name)')
      .eq('id', sessionId)
      .single();
    if (data) {
      const firmObj = Array.isArray(data.firms) ? data.firms[0] : data.firms;
      const dto = { ...data, firms: firmObj ?? null } as SessionDto;
      setSession(dto);
      setNotes(dto.notes ?? '');
    }
    setLoading(false);
  }, [sessionId, supabase]);

  useEffect(() => { loadSession(); }, [loadSession]);

  async function saveNotes() {
    if (!session) return;
    setNotesSaving(true);
    await supabase.from('sessions').update({ notes }).eq('id', sessionId);
    setNotesSaving(false);
  }

  function navigateToReview(filter: ReviewFilter) {
    setReviewFilter(filter);
    setStep('review');
  }

  if (loading) return <p className="text-navy-500">Loading session…</p>;
  if (!session) return <p className="text-rose-600">Session not found.</p>;

  const steps: { key: Step; label: string; tour: string }[] = [
    { key: 'upload',  label: '1. Upload',     tour: 'tab-upload' },
    { key: 'mapping', label: '2. Process',    tour: 'tab-mapping' },
    { key: 'review',  label: '3. Review',     tour: 'tab-review' },
    { key: 'export',  label: '4. Export',     tour: 'tab-export' },
    { key: 'audit',   label: '5. Audit Log',  tour: 'tab-audit' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-navy-500">Firm</p>
        <h2 className="text-2xl font-semibold text-navy-800">
          {session.firms?.name ?? 'Unknown firm'}
        </h2>
        {session.operator_name && (
          <p className="text-sm text-navy-500 mt-1">Operator: {session.operator_name}</p>
        )}
        <div className="mt-3 flex items-start gap-2 max-w-xl">
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={saveNotes}
            placeholder="Session notes… (auto-saves on blur)"
            className="input resize-none text-sm flex-1"
          />
          {notesSaving && (
            <span className="text-xs text-navy-400 mt-2 whitespace-nowrap">Saving…</span>
          )}
        </div>
      </div>

      <div className="flex gap-2 border-b border-navy-100">
        {steps.map((s) => (
          <button
            key={s.key}
            onClick={() => setStep(s.key)}
            data-tour={s.tour}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${
              step === s.key
                ? 'border-teal text-teal-700'
                : 'border-transparent text-navy-500 hover:text-navy-800'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div>
        {step === 'upload' && <UploadStep sessionId={sessionId} />}
        {step === 'mapping' && (
          <MappingStep
            sessionId={sessionId}
            onComplete={() => setStep('review')}
          />
        )}
        {step === 'review' && (
          <ReviewStep
            sessionId={sessionId}
            operatorName={session.operator_name}
            initialFilter={reviewFilter}
          />
        )}
        {step === 'export' && (
          <ExportStep
            sessionId={sessionId}
            firmName={session.firms?.name ?? 'firm'}
            onNavigateToReview={navigateToReview}
          />
        )}
        {step === 'audit' && <AuditStep sessionId={sessionId} />}
      </div>
    </div>
  );
}
