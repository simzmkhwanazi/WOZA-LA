'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { UploadStep } from '@/components/steps/UploadStep';
import { MappingStep } from '@/components/steps/MappingStep';
import { DedupConfirmation } from '@/components/steps/DedupConfirmation';
import { ReviewStep } from '@/components/steps/ReviewStep';
import { ExportStep } from '@/components/steps/ExportStep';
import { AuditStep } from '@/components/steps/AuditStep';
import { FirmDataSlideOver, type FirmTab } from '@/components/FirmDataSlideOver';
import { StaffStep } from '@/components/steps/StaffStep';
import { ClientsListStep } from '@/components/steps/ClientsListStep';
import { DuplicatesReviewStep } from '@/components/steps/DuplicatesReviewStep';

// Sub-tabs within each main step
type SubTab = 'upload' | 'mapping' | 'dedup' | 'staff' | 'all_clients' | 'duplicates' | 'review' | 'export' | 'audit';
type MainStep = 'import' | 'staff' | 'clients' | 'export';

interface SessionDto {
  id: string;
  firm_id: string;
  status: string;
  operator_name: string | null;
  notes: string | null;
  last_exported_at: string | null;
  exported_at: string | null;
  firms: { name: string } | null;
}

// Which main step each sub-tab belongs to
const SUB_TO_MAIN: Record<SubTab, MainStep> = {
  upload: 'import', mapping: 'import', dedup: 'import',
  staff: 'staff',
  all_clients: 'clients', duplicates: 'clients', review: 'clients',
  export: 'export', audit: 'export',
};

const TAB_PARAM_MAP: Record<string, SubTab> = {
  upload: 'upload', mapping: 'mapping', process: 'mapping',
  dedup: 'dedup', staff: 'staff',
  all_clients: 'all_clients', duplicates: 'duplicates', review: 'review',
  export: 'export', audit: 'audit',
};

// Status label derived from session.status
function statusLabel(status: string): string {
  switch (status) {
    case 'uploading':  return 'Importing';
    case 'mapping':    return 'Processing';
    case 'reviewing':  return 'Reviewing';
    case 'exported':   return 'Exported';
    case 'archived':   return 'Archived';
    default:           return status;
  }
}

function statusColor(status: string): string {
  switch (status) {
    case 'exported': return 'text-green-700 bg-green-50';
    case 'reviewing': return 'text-blue-700 bg-blue-50';
    case 'uploading':
    case 'mapping':  return 'text-amber-700 bg-amber-50';
    default:         return 'text-gray-600 bg-gray-100';
  }
}

const MAIN_STEPS: { key: MainStep; label: string; desc: string; icon: string; defaultSub: SubTab }[] = [
  { key: 'import',  label: 'Import',           desc: 'Upload CIPC, SARS, Sage & Xero files',     icon: '📁', defaultSub: 'upload' },
  { key: 'staff',   label: 'Company & Staff',  desc: 'Add staff, assign roles & accountants',    icon: '🏢', defaultSub: 'staff' },
  { key: 'clients', label: 'Clients',          desc: 'View, add & edit all clients',             icon: '👥', defaultSub: 'all_clients' },
  { key: 'export',  label: 'Export',           desc: 'Generate & download the final export',     icon: '📤', defaultSub: 'export' },
];

type ReviewFilter = 'all' | 'ready' | 'errors' | 'warnings' | 'archived' | 'dormant';

export default function SessionPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const sessionId = String(params.id);
  const supabase = useMemo(() => createClient(), []);

  const subTab: SubTab = TAB_PARAM_MAP[searchParams.get('tab') ?? ''] ?? 'upload';
  const activeMain: MainStep = SUB_TO_MAIN[subTab];

  const [session, setSession] = useState<SessionDto | null>(null);
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('all');
  const [loading, setLoading] = useState(true);
  const [hasPendingReExport, setHasPendingReExport] = useState(false);

  const [slideOverOpen, setSlideOverOpen] = useState(false);
  const [slideOverTab, setSlideOverTab] = useState<FirmTab>('company');
  const [resetting, setResetting] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetInput, setResetInput] = useState('');

  const loadSession = useCallback(async () => {
    const { data } = await supabase
      .from('sessions')
      .select('id, firm_id, status, operator_name, notes, exported_at, firms(name)')
      .eq('id', sessionId)
      .single();
    if (data) {
      const firmObj = Array.isArray(data.firms) ? data.firms[0] : data.firms;
      const dto = { ...data, firms: firmObj ?? null } as SessionDto;
      setSession(dto);
      const exportedAt = dto.last_exported_at ?? dto.exported_at;
      if (exportedAt) {
        const { count } = await supabase
          .from('edits')
          .select('id', { count: 'exact', head: true })
          .gt('created_at', exportedAt);
        setHasPendingReExport((count ?? 0) > 0);
      }
    }
    setLoading(false);
  }, [sessionId, supabase]);

  useEffect(() => { loadSession(); }, [loadSession]);

  function goToTab(tab: SubTab) {
    router.replace(`/sessions/${sessionId}?tab=${tab}`, { scroll: false });
  }

  function goToMain(step: MainStep) {
    const { defaultSub } = MAIN_STEPS.find((s) => s.key === step)!;
    goToTab(defaultSub);
  }

  function navigateToReview(filter: ReviewFilter) {
    setReviewFilter(filter);
    goToTab('review');
  }

  async function handleResetSession() {
    setResetting(true);
    // Delete in order: raw_records (via uploads), uploads, clusters, firm_staff
    const { data: uploads } = await supabase
      .from('uploads')
      .select('id')
      .eq('session_id', sessionId);
    if (uploads?.length) {
      await Promise.all(
        uploads.map((u) => supabase.from('raw_records').delete().eq('upload_id', u.id))
      );
      await supabase.from('uploads').delete().eq('session_id', sessionId);
    }
    await supabase.from('clusters').delete().eq('session_id', sessionId);
    await supabase.from('firm_staff').delete().eq('firm_id', session!.firm_id);
    await supabase.from('sessions').update({ status: 'uploading' }).eq('id', sessionId);
    setResetting(false);
    setShowResetConfirm(false);
    void loadSession();
    goToTab('upload');
  }

  function openFirmSlideOver(tab: FirmTab) {
    setSlideOverTab(tab);
    setSlideOverOpen(true);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-navy-500 text-sm">Loading session…</p>
      </div>
    );
  }
  if (!session) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-rose-600 text-sm">Session not found.</p>
      </div>
    );
  }

  const firmDisplayName = session.firms?.name ?? 'Unknown Firm';

  return (
    <>
      {/* ── Breadcrumb bar ── */}
      <div className="bg-white border-b border-gray-200 px-4 sm:px-6 py-2.5 flex items-center gap-2">
        {MAIN_STEPS.map((step, idx) => {
          const isActive = step.key === activeMain;
          const isDone = MAIN_STEPS.findIndex((s) => s.key === activeMain) > idx;
          return (
            <div key={step.key} className="flex items-center gap-2">
              {idx > 0 && (
                <span className="text-gray-300 text-sm select-none">→</span>
              )}
              <button
                onClick={() => goToMain(step.key)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-teal-50 text-teal-700'
                    : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold border-2 ${
                  isDone
                    ? 'border-teal bg-teal text-white'
                    : isActive
                    ? 'border-teal bg-teal text-white'
                    : 'border-gray-300 text-gray-400'
                }`}>
                  {isDone ? '✓' : idx + 1}
                </span>
                <span>{step.label}</span>
              </button>
            </div>
          );
        })}

        {/* Re-export indicator */}
        {hasPendingReExport && (
          <div className="ml-auto flex items-center gap-2 text-xs text-indigo-600">
            <span>◷ Changes since last export</span>
            <button
              onClick={() => goToTab('export')}
              className="underline hover:text-indigo-800"
            >
              Re-export →
            </button>
          </div>
        )}
      </div>

      {/* ── Main area: sidebar + content ── */}
      <div className="flex min-h-[calc(100vh-97px)]">
        {/* Sidebar — 260px */}
        <aside className="w-64 flex-shrink-0 bg-white border-r border-gray-200 flex flex-col">
          {/* Firm info */}
          <div className="px-5 pt-5 pb-4 border-b border-gray-100">
            <p className="font-semibold text-navy-800 text-sm leading-tight">{firmDisplayName}</p>
            {session.operator_name && (
              <p className="text-xs text-gray-400 mt-0.5">Operator: {session.operator_name}</p>
            )}
            <span className={`inline-block mt-2 text-xs font-medium px-2.5 py-0.5 rounded-full ${statusColor(session.status)}`}>
              {statusLabel(session.status)}
            </span>

            {/* Pipeline flow — horizontal */}
            <div className="mt-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Pipeline flow</p>
              <div className="flex items-center">
                {MAIN_STEPS.map((step, idx) => {
                  const activeIdx = MAIN_STEPS.findIndex((s) => s.key === activeMain);
                  const stepDone   = activeIdx > idx;
                  const stepActive = step.key === activeMain;
                  return (
                    <div key={step.key} className="flex items-center flex-1 min-w-0">
                      <button
                        onClick={() => goToMain(step.key)}
                        title={step.desc}
                        className="flex flex-col items-center gap-0.5 flex-shrink-0"
                      >
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold border-2 transition-colors ${
                          stepDone    ? 'bg-teal-500 border-teal-500 text-white'
                          : stepActive ? 'bg-teal-50 border-teal-500 text-teal-700'
                          : 'bg-white border-gray-300 text-gray-400'
                        }`}>
                          {stepDone ? '✓' : idx + 1}
                        </div>
                        <span className={`text-[9px] font-medium leading-tight text-center max-w-[40px] truncate ${
                          stepActive ? 'text-teal-700' : stepDone ? 'text-gray-500' : 'text-gray-300'
                        }`}>
                          {step.label.split(' ')[0]}
                        </span>
                      </button>
                      {idx < MAIN_STEPS.length - 1 && (
                        <div className={`flex-1 h-px mx-1 ${stepDone ? 'bg-teal-400' : 'bg-gray-200'}`} />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Nav */}
          <nav className="flex-1 pt-2">
            {MAIN_STEPS.map((step) => {
              const isActive = step.key === activeMain;
              return (
                <button
                  key={step.key}
                  onClick={() => goToMain(step.key)}
                  className={`w-full text-left px-5 py-3 transition-colors border-l-[3px] ${
                    isActive
                      ? 'text-teal-700 bg-teal-50 border-l-teal-500'
                      : 'text-gray-600 border-l-transparent hover:bg-gray-50 hover:text-gray-900'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-base leading-none">{step.icon}</span>
                    <span className="text-sm font-medium">{step.label}</span>
                  </div>
                  <p className={`text-[11px] mt-0.5 ml-7 leading-tight ${isActive ? 'text-teal-600' : 'text-gray-400'}`}>{step.desc}</p>
                </button>
              );
            })}

            {/* Reset — inline warning row */}
            <div className="mx-4 mt-3 mb-1 rounded-lg border border-rose-100 bg-rose-50 px-3 py-2.5">
              <p className="text-xs text-rose-700 font-medium leading-snug">
                ⚠ Resetting will permanently delete all uploads, clients, staff, and export history.
              </p>
              <button
                onClick={() => { setResetInput(''); setShowResetConfirm(true); }}
                className="mt-2 w-full text-xs font-semibold text-white bg-rose-500 hover:bg-rose-600 rounded-md px-3 py-1.5 transition-colors"
              >
                Reset Session
              </button>
            </div>

          </nav>
        </aside>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto px-6 py-6">
            {subTab === 'upload' && <UploadStep sessionId={sessionId} onProceed={() => goToTab('mapping')} onViewClients={() => goToTab(session?.status === 'reviewing' || session?.status === 'exported' ? 'all_clients' : 'mapping')} />}
            {subTab === 'mapping' && (
              <MappingStep
                sessionId={sessionId}
                onComplete={() => goToTab('staff')}
                onDedupRequired={() => goToTab('dedup')}
              />
            )}
            {subTab === 'dedup' && (
              <DedupConfirmation
                sessionId={sessionId}
                onComplete={() => goToTab('staff')}
              />
            )}
            {subTab === 'staff' && (
              <StaffStep
                firmId={session.firm_id}
                onContinue={() => goToTab('review')}
              />
            )}
            {(subTab === 'all_clients' || subTab === 'duplicates' || subTab === 'review') && (
              <div className="space-y-4">
                {/* Sub-tab switcher */}
                <div className="flex gap-1 border-b border-navy-100">
                  {(
                    [
                      { key: 'all_clients', label: 'All Clients' },
                      { key: 'duplicates',  label: 'Duplicates' },
                      { key: 'review',      label: 'Detailed Review' },
                    ] as { key: SubTab; label: string }[]
                  ).map((t) => (
                    <button
                      key={t.key}
                      onClick={() => goToTab(t.key)}
                      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
                        subTab === t.key
                          ? 'border-teal-500 text-teal-700'
                          : 'border-transparent text-navy-500 hover:text-navy-700'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                {subTab === 'all_clients' && (
                  <ClientsListStep
                    sessionId={sessionId}
                    firmId={session.firm_id}
                    onReRunImport={() => goToTab('mapping')}
                    onGoToDetailedReview={() => goToTab('review')}
                  />
                )}

                {subTab === 'duplicates' && (
                  <DuplicatesReviewStep sessionId={sessionId} />
                )}

                {subTab === 'review' && (
                  <ReviewStep
                    sessionId={sessionId}
                    firmId={session.firm_id}
                    operatorName={session.operator_name}
                    initialFilter={reviewFilter}
                    onOpenFirmSlideOver={openFirmSlideOver}
                    onGoToImport={() => goToTab('upload')}
                    onProceedToExport={() => goToTab('export')}
                  />
                )}
              </div>
            )}
            {subTab === 'export' && (
              <ExportStep
                sessionId={sessionId}
                firmName={firmDisplayName}
                onNavigateToReview={navigateToReview}
                onExportComplete={() => {
                  setHasPendingReExport(false);
                  void loadSession();
                }}
              />
            )}
            {subTab === 'audit' && <AuditStep sessionId={sessionId} />}
          </div>
        </div>
      </div>

      {/* ── Reset confirmation modal ── */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={() => setShowResetConfirm(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-rose-100 flex items-center justify-center shrink-0 text-rose-600 font-bold text-lg">!</div>
              <div>
                <h2 className="text-base font-semibold text-navy-800">This cannot be undone</h2>
                <p className="text-sm text-gray-500 mt-1">
                  All uploaded files, client records, staff, and export history for{' '}
                  <span className="font-semibold text-navy-700">{firmDisplayName}</span> will be permanently deleted. The session returns to step 1.
                </p>
              </div>
            </div>
            <div className="rounded-lg bg-rose-50 border border-rose-200 px-4 py-3 text-xs text-rose-700 space-y-0.5">
              <p className="font-semibold">What will be deleted:</p>
              <ul className="list-disc list-inside space-y-0.5 mt-1">
                <li>All uploaded source files &amp; raw records</li>
                <li>All merged client clusters (Review &amp; Export)</li>
                <li>All firm staff &amp; roles</li>
              </ul>
            </div>
            <div>
              <label className="block text-xs font-medium text-navy-600 mb-1.5">
                Type <span className="font-mono font-bold text-rose-600">reset</span> to confirm
              </label>
              <input
                autoFocus
                className="input w-full text-sm"
                placeholder="reset"
                value={resetInput}
                onChange={(e) => setResetInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && resetInput === 'reset') void handleResetSession(); }}
              />
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowResetConfirm(false)} className="btn btn-ghost text-sm">Cancel</button>
              <button
                onClick={() => void handleResetSession()}
                disabled={resetting || resetInput !== 'reset'}
                className="text-sm font-medium text-white bg-rose-600 hover:bg-rose-700 px-4 py-2 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {resetting ? 'Resetting…' : 'Reset everything'}
              </button>
            </div>
          </div>
        </div>
      )}

      <FirmDataSlideOver
        sessionId={sessionId}
        open={slideOverOpen}
        initialTab={slideOverTab}
        onClose={() => setSlideOverOpen(false)}
      />
    </>
  );
}
