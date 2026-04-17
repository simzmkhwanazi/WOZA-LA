'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { UploadStep } from '@/components/steps/UploadStep';
import { MappingStep } from '@/components/steps/MappingStep';
import { ReviewStep } from '@/components/steps/ReviewStep';
import { ExportStep } from '@/components/steps/ExportStep';
import { AuditStep } from '@/components/steps/AuditStep';
import { DashboardStep } from '@/components/steps/DashboardStep';
import { FirmDataSlideOver, type FirmTab } from '@/components/FirmDataSlideOver';

type Step = 'upload' | 'mapping' | 'review' | 'dashboard' | 'export' | 'audit';
type ReviewFilter = 'all' | 'ready' | 'errors' | 'warnings' | 'archived' | 'dormant';

interface SessionDto {
  id: string;
  firm_id: string;
  status: string;
  operator_name: string | null;
  notes: string | null;
  last_exported_at: string | null;
  firms: { name: string } | null;
}

const TAB_PARAM_MAP: Record<string, Step> = {
  upload: 'upload', mapping: 'mapping', process: 'mapping',
  review: 'review', dashboard: 'dashboard', export: 'export', audit: 'audit',
};

export default function SessionPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const sessionId = String(params.id);
  // Stabilise the Supabase client — createBrowserClient() returns a new object
  // on every call, which would make loadSession unstable and cause an infinite
  // re-render loop via useCallback/useEffect.
  const supabase = useMemo(() => createClient(), []);

  // Derive current step directly from the URL — no independent state needed.
  // Tab clicks use router.replace(), which updates the URL and re-derives step.
  // This eliminates the URL-sync useEffect that was a source of race conditions.
  const step: Step = TAB_PARAM_MAP[searchParams.get('tab') ?? ''] ?? 'upload';

  const [session, setSession] = useState<SessionDto | null>(null);
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('all');
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState('');
  const [notesSaving, setNotesSaving] = useState(false);
  const [hasPendingReExport, setHasPendingReExport] = useState(false);

  // Slide-over state
  const [slideOverOpen, setSlideOverOpen] = useState(false);
  const [slideOverTab, setSlideOverTab] = useState<FirmTab>('company');

  const loadSession = useCallback(async () => {
    const { data } = await supabase
      .from('sessions')
      .select('id, firm_id, status, operator_name, notes, last_exported_at, firms(name)')
      .eq('id', sessionId)
      .single();
    if (data) {
      const firmObj = Array.isArray(data.firms) ? data.firms[0] : data.firms;
      const dto = { ...data, firms: firmObj ?? null } as SessionDto;
      setSession(dto);
      setNotes(dto.notes ?? '');

      // Check for post-export edits
      if (dto.last_exported_at) {
        const { count } = await supabase
          .from('edits')
          .select('id', { count: 'exact', head: true })
          .gt('created_at', dto.last_exported_at);
        setHasPendingReExport((count ?? 0) > 0);
      }
    }
    setLoading(false);
  }, [sessionId, supabase]);

  useEffect(() => { loadSession(); }, [loadSession]);

  function goToTab(tab: Step) {
    router.replace(`/sessions/${sessionId}?tab=${tab}`, { scroll: false });
  }

  async function saveNotes() {
    if (!session) return;
    setNotesSaving(true);
    await supabase.from('sessions').update({ notes }).eq('id', sessionId);
    setNotesSaving(false);
  }

  function navigateToReview(filter: ReviewFilter) {
    setReviewFilter(filter);
    goToTab('review');
  }

  function openFirmSlideOver(tab: FirmTab) {
    setSlideOverTab(tab);
    setSlideOverOpen(true);
  }

  if (loading) return <p className="text-navy-500">Loading session…</p>;
  if (!session) return <p className="text-rose-600">Session not found.</p>;

  const steps: { key: Step; label: string; tour: string }[] = [
    { key: 'upload',    label: '1. Upload',     tour: 'tab-upload' },
    { key: 'mapping',   label: '2. Process',    tour: 'tab-mapping' },
    { key: 'review',    label: '3. Review',     tour: 'tab-review' },
    { key: 'dashboard', label: '4. Dashboard',  tour: 'tab-dashboard' },
    { key: 'export',    label: '5. Export',     tour: 'tab-export' },
    { key: 'audit',     label: '6. Audit Log',  tour: 'tab-audit' },
  ];

  return (
    <>
      <div className="space-y-4 sm:space-y-6">
        {/* Session header */}
        <div>
          <p className="text-xs text-navy-500 uppercase tracking-wide">Firm</p>
          <h2 className="text-xl sm:text-2xl font-semibold text-navy-800 leading-tight">
            {session.firms?.name ?? 'Unknown firm'}
          </h2>
          {session.operator_name && (
            <p className="text-sm text-navy-500 mt-0.5">Operator: {session.operator_name}</p>
          )}
          <div className="mt-3 flex items-start gap-2">
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

        {/* Re-export banner — soft indigo, non-alarming */}
        {hasPendingReExport && (
          <div className="flex items-center justify-between gap-3 px-4 py-3 bg-indigo-50 border border-indigo-200 rounded-lg text-sm text-indigo-700">
            <span>◷ This session has changes since the last export — consider re-exporting.</span>
            <button
              onClick={() => goToTab('export')}
              className="text-xs font-medium text-indigo-700 hover:text-indigo-900 underline whitespace-nowrap flex-shrink-0"
            >
              Go to Export →
            </button>
          </div>
        )}

        {/* Tabs */}
        <div className="-mx-4 sm:mx-0">
          <div className="flex overflow-x-auto border-b border-navy-100 px-4 sm:px-0 gap-0 scrollbar-none">
            {steps.map((s) => (
              <button
                key={s.key}
                onClick={() => goToTab(s.key)}
                data-tour={s.tour}
                className={`flex-shrink-0 px-3 sm:px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition whitespace-nowrap ${
                  step === s.key
                    ? 'border-teal text-teal-700'
                    : 'border-transparent text-navy-500 hover:text-navy-800'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Step content */}
        <div>
          {step === 'upload' && <UploadStep sessionId={sessionId} />}
          {step === 'mapping' && (
            <MappingStep
              sessionId={sessionId}
              onComplete={() => goToTab('review')}
            />
          )}
          {step === 'review' && (
            <ReviewStep
              sessionId={sessionId}
              operatorName={session.operator_name}
              initialFilter={reviewFilter}
              onOpenFirmSlideOver={openFirmSlideOver}
            />
          )}
          {step === 'dashboard' && (
            <DashboardStep
              sessionId={sessionId}
              firmName={session.firms?.name ?? 'firm'}
              operatorName={session.operator_name}
              onOpenFirmSlideOver={openFirmSlideOver}
            />
          )}
          {step === 'export' && (
            <ExportStep
              sessionId={sessionId}
              firmName={session.firms?.name ?? 'firm'}
              onNavigateToReview={navigateToReview}
              onExportComplete={() => {
                setHasPendingReExport(false);
                void loadSession();
              }}
            />
          )}
          {step === 'audit' && <AuditStep sessionId={sessionId} />}
        </div>
      </div>

      {/* Firm data slide-over — renders outside main flow to avoid layout impact */}
      <FirmDataSlideOver
        sessionId={sessionId}
        open={slideOverOpen}
        initialTab={slideOverTab}
        onClose={() => setSlideOverOpen(false)}
      />
    </>
  );
}
