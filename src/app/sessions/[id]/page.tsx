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
import { DashboardStep } from '@/components/steps/DashboardStep';
import { FirmDataSlideOver, type FirmTab } from '@/components/FirmDataSlideOver';

// Sub-tabs within each main step
type SubTab = 'upload' | 'mapping' | 'dedup' | 'review' | 'dashboard' | 'export' | 'audit';
type MainStep = 'import' | 'review' | 'export';

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
  review: 'review', dashboard: 'review',
  export: 'export', audit: 'export',
};

const TAB_PARAM_MAP: Record<string, SubTab> = {
  upload: 'upload', mapping: 'mapping', process: 'mapping',
  dedup: 'dedup', review: 'review', dashboard: 'dashboard',
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

const MAIN_STEPS: { key: MainStep; label: string; icon: string; defaultSub: SubTab }[] = [
  { key: 'import', label: 'Import',  icon: '📥', defaultSub: 'upload' },
  { key: 'review', label: 'Review',  icon: '✓',  defaultSub: 'review' },
  { key: 'export', label: 'Export',  icon: '📤', defaultSub: 'export' },
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
          </div>

          {/* Nav */}
          <nav className="flex-1 pt-3">
            {MAIN_STEPS.map((step) => {
              const isActive = step.key === activeMain;
              return (
                <button
                  key={step.key}
                  onClick={() => goToMain(step.key)}
                  className={`w-full flex items-center gap-3 px-5 py-2.5 text-sm font-medium transition-colors border-l-3 border-l-[3px] ${
                    isActive
                      ? 'text-teal-700 bg-teal-50 border-l-teal'
                      : 'text-gray-600 border-l-transparent hover:bg-gray-50 hover:text-gray-900'
                  }`}
                >
                  <span className="text-base leading-none">{step.icon}</span>
                  <span>{step.label}</span>
                </button>
              );
            })}

            {/* Review sub-nav — visible when on review main step */}
            {activeMain === 'review' && (
              <div className="mt-1 ml-11">
                <button
                  onClick={() => goToTab('review')}
                  className={`block w-full text-left px-3 py-1.5 text-xs rounded transition-colors ${
                    subTab === 'review' ? 'text-teal-700 font-medium' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Clients
                </button>
                <button
                  onClick={() => goToTab('dashboard')}
                  className={`block w-full text-left px-3 py-1.5 text-xs rounded transition-colors ${
                    subTab === 'dashboard' ? 'text-teal-700 font-medium' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Dashboard
                </button>
              </div>
            )}

            {/* Export sub-nav — visible when on export main step */}
            {activeMain === 'export' && (
              <div className="mt-1 ml-11">
                <button
                  onClick={() => goToTab('export')}
                  className={`block w-full text-left px-3 py-1.5 text-xs rounded transition-colors ${
                    subTab === 'export' ? 'text-teal-700 font-medium' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Export
                </button>
                <button
                  onClick={() => goToTab('audit')}
                  className={`block w-full text-left px-3 py-1.5 text-xs rounded transition-colors ${
                    subTab === 'audit' ? 'text-teal-700 font-medium' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Audit Log
                </button>
              </div>
            )}
          </nav>
        </aside>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto px-6 py-6">
            {subTab === 'upload' && <UploadStep sessionId={sessionId} onProceed={() => goToTab('mapping')} />}
            {subTab === 'mapping' && (
              <MappingStep
                sessionId={sessionId}
                onComplete={() => goToTab('review')}
                onDedupRequired={() => goToTab('dedup')}
              />
            )}
            {subTab === 'dedup' && (
              <DedupConfirmation
                sessionId={sessionId}
                onComplete={() => goToTab('review')}
              />
            )}
            {subTab === 'review' && (
              <ReviewStep
                sessionId={sessionId}
                operatorName={session.operator_name}
                initialFilter={reviewFilter}
                onOpenFirmSlideOver={openFirmSlideOver}
                onGoToImport={() => goToTab('upload')}
              />
            )}
            {subTab === 'dashboard' && (
              <DashboardStep
                sessionId={sessionId}
                firmName={firmDisplayName}
                operatorName={session.operator_name}
                onOpenFirmSlideOver={openFirmSlideOver}
              />
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

      <FirmDataSlideOver
        sessionId={sessionId}
        open={slideOverOpen}
        initialTab={slideOverTab}
        onClose={() => setSlideOverOpen(false)}
      />
    </>
  );
}
