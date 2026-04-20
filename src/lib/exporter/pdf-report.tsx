/**
 * Client Intelligence Report — PDF Generator
 *
 * Produces a polished PDF using @react-pdf/renderer.
 * Charts are rendered as SVG shapes (no text inside SVG — labels
 * are rendered as React-PDF View/Text elements alongside the SVG).
 *
 * SERVER-ONLY — must run in a Node.js environment.
 */

import React from 'react';
import {
  Document, Page, Text, View, StyleSheet, Svg,
  Circle, Rect, Path, G,
} from '@react-pdf/renderer';
import { renderToBuffer } from '@react-pdf/renderer';
import { validateRecord } from '../validator';
import type { ClientRecord } from '../schema/datagrows';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ClusterRow {
  merged: ClientRecord;
  sources: string[] | null;
  archived: boolean;
}

export interface EmployeeRow {
  name: string;
  email?: string;
  job_title?: string;
  department?: string;
  dg_roles?: Record<string, number> | null;
}

export interface ContactRow {
  name?: string;
  organisation?: string;
  email?: string;
  phone?: string;
  relationship?: string;
}

export interface SupplierRow {
  supplier_name?: string;
  contact_person?: string;
  email?: string;
  service_provided?: string;
}

export interface FirmProfileRow {
  company_name?: string;
  registration_nr?: string;
  contact_nr?: string;
  email?: string;
  physical_address?: {
    line1?: string; city?: string; province?: string; postal?: string;
  };
}

export interface PdfReportOptions {
  firmName: string;
  firmProfile: FirmProfileRow | null;
  clusters: ClusterRow[];
  employees: EmployeeRow[];
  contacts: ContactRow[];
  suppliers: SupplierRow[];
  generatedBy?: string;
}

// ── Colours ───────────────────────────────────────────────────────────────────

const C = {
  navy:  '#1E3A5F',
  teal:  '#0D9488',
  teal2: '#14B8A6',
  grey:  '#6B7280',
  light: '#F3F4F6',
  white: '#FFFFFF',
  green: '#16A34A',
  amber: '#D97706',
  rose:  '#E11D48',
  text:  '#1F2937',
  muted: '#9CA3AF',
};

const TEAL_PALETTE = [
  '#0D9488','#14B8A6','#2DD4BF','#5EEAD4','#99F6E4',
  '#0F766E','#115E59','#134E4A','#0E7490','#0EA5E9',
];

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  page:       { fontFamily: 'Helvetica', paddingTop: 40, paddingBottom: 50, paddingHorizontal: 40, backgroundColor: C.white },
  coverPage:  { fontFamily: 'Helvetica', paddingTop: 100, paddingBottom: 60, paddingHorizontal: 60, backgroundColor: C.navy },
  footer:     { position: 'absolute', bottom: 20, left: 40, right: 40, borderTopWidth: 0.5, borderTopColor: C.teal, paddingTop: 6, flexDirection: 'row', justifyContent: 'space-between' },
  footerText: { fontSize: 8, color: C.muted },
  // Cover
  coverTitle: { fontSize: 26, fontFamily: 'Helvetica-Bold', color: C.white, marginBottom: 10 },
  coverSub:   { fontSize: 15, color: C.teal2, marginBottom: 36 },
  coverFirm:  { fontSize: 13, color: C.white, marginBottom: 4 },
  coverDate:  { fontSize: 10, color: C.teal2, marginTop: 20 },
  // Headings
  h1: { fontSize: 17, fontFamily: 'Helvetica-Bold', color: C.navy, marginBottom: 8, marginTop: 14 },
  h2: { fontSize: 12, fontFamily: 'Helvetica-Bold', color: C.teal, marginBottom: 5, marginTop: 10 },
  // Body
  body:  { fontSize: 10, color: C.text, lineHeight: 1.5 },
  muted: { fontSize: 9, color: C.muted },
  // Table
  table:     { marginTop: 6 },
  tHead:     { flexDirection: 'row', backgroundColor: C.navy, paddingVertical: 5, paddingHorizontal: 4 },
  tRow:      { flexDirection: 'row', paddingVertical: 4, paddingHorizontal: 4, borderBottomWidth: 0.5, borderBottomColor: '#E5E7EB' },
  tRowAlt:   { flexDirection: 'row', paddingVertical: 4, paddingHorizontal: 4, borderBottomWidth: 0.5, borderBottomColor: '#E5E7EB', backgroundColor: C.light },
  th:        { fontSize: 9, fontFamily: 'Helvetica-Bold', color: C.white },
  td:        { fontSize: 9, color: C.text },
  // Stat boxes
  statRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  statBox: { flex: 1, backgroundColor: C.light, borderRadius: 5, padding: 8, alignItems: 'center' },
  statNum: { fontSize: 20, fontFamily: 'Helvetica-Bold', color: C.navy, marginBottom: 2 },
  statLbl: { fontSize: 7, color: C.muted },
});

// ── SVG chart helpers (labels outside SVG using View+Text) ────────────────────

interface PieSlice { label: string; value: number; color: string; }

/** Donut chart SVG + legend as a View row */
function DonutChart({ data }: { data: PieSlice[] }) {
  const cx = 70; const cy = 70; const r = 55; const ir = 30;
  const total = data.reduce((s, d) => s + d.value, 0);

  const paths: React.ReactElement[] = [];
  let angle = -Math.PI / 2;

  if (total > 0) {
    for (let i = 0; i < data.length; i++) {
      const slice = data[i];
      const sweep = (slice.value / total) * 2 * Math.PI;
      const x1 = cx + r * Math.cos(angle);
      const y1 = cy + r * Math.sin(angle);
      const x2 = cx + r * Math.cos(angle + sweep);
      const y2 = cy + r * Math.sin(angle + sweep);
      const xi1 = cx + ir * Math.cos(angle);
      const yi1 = cy + ir * Math.sin(angle);
      const xi2 = cx + ir * Math.cos(angle + sweep);
      const yi2 = cy + ir * Math.sin(angle + sweep);
      const large = sweep > Math.PI ? 1 : 0;
      const d = `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${xi2} ${yi2} A ${ir} ${ir} 0 ${large} 0 ${xi1} ${yi1} Z`;
      paths.push(<Path key={i} d={d} fill={slice.color} />);
      angle += sweep;
    }
  } else {
    paths.push(<Circle key="empty" cx={cx} cy={cy} r={r} fill={C.light} />);
  }

  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 16, marginBottom: 8 }}>
      <Svg width={140} height={140}>
        <G>{paths}</G>
        <Circle cx={cx} cy={cy} r={ir} fill={C.white} />
      </Svg>
      <View style={{ flex: 1, paddingTop: 8 }}>
        {data.map((slice, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 5 }}>
            <View style={{ width: 10, height: 10, backgroundColor: slice.color, borderRadius: 2, marginRight: 6 }} />
            <Text style={{ fontSize: 9, color: C.text, flex: 1 }}>{slice.label}</Text>
            <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: C.navy }}>{slice.value}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

interface BarData { label: string; value: number; color?: string; }

/** Horizontal bar chart rendered as View+SVG rows */
function HBarChart({ data, maxBarWidth = 160 }: { data: BarData[]; maxBarWidth?: number }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <View style={{ marginBottom: 8 }}>
      {data.map((d, i) => {
        const w = Math.max(2, (d.value / max) * maxBarWidth);
        const color = d.color ?? C.teal;
        return (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 5 }}>
            <Text style={{ fontSize: 9, color: C.grey, width: 100 }}>
              {d.label.length > 16 ? d.label.slice(0, 15) + '…' : d.label}
            </Text>
            <Svg width={maxBarWidth + 30} height={14}>
              <Rect x={0} y={2} width={w} height={10} fill={color} rx={3} />
            </Svg>
            <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: C.navy, width: 24 }}>{d.value}</Text>
          </View>
        );
      })}
    </View>
  );
}

/** Progress bar rendered as SVG */
function ProgressBar({ pct, color = C.teal }: { pct: number; color?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
      <Svg width={200} height={12}>
        <Rect x={0} y={0} width={200} height={12} fill={C.light} rx={6} />
        <Rect x={0} y={0} width={Math.max(4, pct * 2)} height={12} fill={color} rx={6} />
      </Svg>
      <Text style={{ fontSize: 10, fontFamily: 'Helvetica-Bold', color: C.navy }}>{pct}%</Text>
    </View>
  );
}

// ── Footer ────────────────────────────────────────────────────────────────────

function Footer({ firmName, page }: { firmName: string; page: string }) {
  return (
    <View style={s.footer} fixed>
      <Text style={s.footerText}>{firmName} — Client Intelligence Report</Text>
      <Text style={s.footerText}>{page}</Text>
    </View>
  );
}

// ── Main PDF Document ─────────────────────────────────────────────────────────

function PdfReport({ opts }: { opts: PdfReportOptions }) {
  const now = new Date();
  const monthYear = now.toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' });
  const dateStr = now.toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' });

  const active = opts.clusters.filter((c) => !c.archived);
  const total = active.length;

  // Quality stats
  let withErrors = 0;
  let withWarnings = 0;
  for (const row of active) {
    const v = validateRecord(row.merged);
    if (!v.ok) {
      if (v.issues.some((i) => i.severity === 'error')) withErrors++;
      if (v.issues.some((i) => i.severity === 'warning')) withWarnings++;
    }
  }
  const readyPct = total > 0 ? Math.round(((total - withErrors) / total) * 100) : 0;

  // Status distribution
  const statusCounts: Record<string, number> = {};
  for (const row of active) {
    const st = String(row.merged.status ?? 'Unknown');
    statusCounts[st] = (statusCounts[st] ?? 0) + 1;
  }
  const statusData: BarData[] = Object.entries(statusCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({
      label,
      value,
      color: label === 'Active' ? C.green : label === 'Dormant' ? C.amber : C.grey,
    }));

  // Entity types
  const entityCounts: Record<string, number> = {};
  for (const row of active) {
    const e = String(row.merged.entity_type ?? 'Unknown');
    entityCounts[e] = (entityCounts[e] ?? 0) + 1;
  }
  const entityData: PieSlice[] = Object.entries(entityCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 9)
    .map(([label, value], i) => ({ label, value, color: TEAL_PALETTE[i % TEAL_PALETTE.length] }));

  // Year-end
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const yeCounts: Record<string, number> = {};
  for (const row of active) {
    const m = String(row.merged.year_end ?? '').slice(0, 3);
    if (MONTHS.includes(m)) yeCounts[m] = (yeCounts[m] ?? 0) + 1;
  }
  const yeData: BarData[] = MONTHS.map((m) => ({ label: m, value: yeCounts[m] ?? 0 }));

  // Services
  const SERVICE_KEYS = [
    { key: 'financials', label: 'Financials' },
    { key: 'audit', label: 'Audit' },
    { key: 'income_tax', label: 'Income Tax' },
    { key: 'provisional_tax', label: 'Prov. Tax' },
    { key: 'vat', label: 'VAT' },
    { key: 'payroll', label: 'Payroll' },
    { key: 'uif', label: 'UIF' },
    { key: 'workmans', label: "Workman's" },
    { key: 'cipc_annual_return', label: 'CIPC Return' },
    { key: 'documents_folder', label: 'Docs Folder' },
  ] as const;

  const servicesData: BarData[] = SERVICE_KEYS
    .map(({ key, label }) => ({
      label,
      value: active.filter((c) => (c.merged as Record<string, unknown>)[key] === true).length,
    }))
    .sort((a, b) => b.value - a.value);

  // Top errors
  const errFields: Record<string, number> = {};
  for (const row of active) {
    const v = validateRecord(row.merged);
    for (const issue of v.issues) {
      if (issue.severity === 'error') errFields[issue.field] = (errFields[issue.field] ?? 0) + 1;
    }
  }
  const topErrors = Object.entries(errFields).sort((a, b) => b[1] - a[1]).slice(0, 3);

  // Source coverage: clients per source system
  const sourceCounts: Record<string, number> = {};
  for (const row of active) {
    for (const src of row.sources ?? []) {
      sourceCounts[src] = (sourceCounts[src] ?? 0) + 1;
    }
  }
  const sourceData: BarData[] = Object.entries(sourceCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({ label, value, color: C.teal }));

  const fp = opts.firmProfile;
  const firmAddress = fp?.physical_address
    ? [fp.physical_address.line1, fp.physical_address.city, fp.physical_address.province].filter(Boolean).join(', ')
    : '';

  return (
    <Document>
      {/* ── Cover ─────────────────────────────────────────────────────────── */}
      <Page size="A4" style={s.coverPage}>
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <Text style={s.coverTitle}>Client Intelligence{'\n'}Report</Text>
          <Text style={s.coverSub}>{monthYear}</Text>
          <View style={{ width: 50, height: 3, backgroundColor: C.teal, marginBottom: 28 }} />
          <Text style={s.coverFirm}>{opts.firmName}</Text>
          {fp?.company_name && fp.company_name !== opts.firmName && (
            <Text style={s.coverFirm}>{fp.company_name}</Text>
          )}
          {firmAddress ? <Text style={[s.coverFirm, { fontSize: 10, opacity: 0.6 }]}>{firmAddress}</Text> : null}
          {fp?.contact_nr ? <Text style={[s.coverFirm, { fontSize: 10, opacity: 0.6 }]}>{fp.contact_nr}</Text> : null}
          {fp?.email ? <Text style={[s.coverFirm, { fontSize: 10, opacity: 0.6 }]}>{fp.email}</Text> : null}
          <Text style={s.coverDate}>Generated {dateStr} by DataGrows</Text>
        </View>
        <Text style={{ fontSize: 8, color: C.teal2, opacity: 0.4, textAlign: 'center' }}>
          Confidential
        </Text>
      </Page>

      {/* ── Executive Summary ─────────────────────────────────────────────── */}
      <Page size="A4" style={s.page}>
        <Text style={s.h1}>Executive Summary</Text>
        <View style={s.statRow}>
          <View style={s.statBox}><Text style={s.statNum}>{total}</Text><Text style={s.statLbl}>Total Clients</Text></View>
          <View style={s.statBox}><Text style={[s.statNum, { color: C.green }]}>{statusCounts['Active'] ?? 0}</Text><Text style={s.statLbl}>Active</Text></View>
          <View style={s.statBox}><Text style={[s.statNum, { color: C.amber }]}>{statusCounts['Dormant'] ?? 0}</Text><Text style={s.statLbl}>Dormant</Text></View>
          <View style={s.statBox}><Text style={[s.statNum, { color: C.grey }]}>{opts.clusters.length - active.length}</Text><Text style={s.statLbl}>Archived</Text></View>
        </View>

        <Text style={s.h2}>Data Quality</Text>
        <Text style={[s.body, { marginBottom: 4 }]}>
          {total - withErrors} of {total} records export-ready ({readyPct}%).
          {withErrors > 0 ? `  ${withErrors} error${withErrors > 1 ? 's' : ''}.` : '  No errors.'}
          {withWarnings > 0 ? `  ${withWarnings} warning${withWarnings > 1 ? 's' : ''}.` : ''}
          {' See page 5 for full breakdown.'}
        </Text>

        {opts.employees.length > 0 && (
          <Text style={[s.body, { marginTop: 8 }]}>
            {opts.employees.length} staff members managing {total} clients.
          </Text>
        )}

        <Footer firmName={opts.firmName} page="Executive Summary" />
      </Page>

      {/* ── Client Portfolio ──────────────────────────────────────────────── */}
      <Page size="A4" style={s.page}>
        <Text style={s.h1}>Client Portfolio</Text>

        <Text style={s.h2}>Entity Type Breakdown</Text>
        <DonutChart data={entityData} />

        <Text style={s.h2}>Client Status Distribution</Text>
        <HBarChart data={statusData} />

        <Footer firmName={opts.firmName} page="Client Portfolio" />
      </Page>

      {/* ── Workload Planning ─────────────────────────────────────────────── */}
      <Page size="A4" style={s.page}>
        <Text style={s.h1}>Workload Planning</Text>
        <Text style={[s.body, { marginBottom: 10 }]}>
          Year-end distribution shows your busiest months for financial work. Peaks indicate when most client financials and tax returns will be due.
        </Text>
        <Text style={s.h2}>Year-End Distribution by Month</Text>
        <HBarChart data={yeData} maxBarWidth={200} />

        <Text style={[s.h2, { marginTop: 16 }]}>Services Overview</Text>
        <Text style={[s.muted, { marginBottom: 6 }]}>Number of clients with each service active</Text>
        <HBarChart data={servicesData} />

        <Footer firmName={opts.firmName} page="Workload Planning" />
      </Page>

      {/* ── Data Quality & Source Coverage ────────────────────────────────── */}
      <Page size="A4" style={s.page}>
        <Text style={s.h1}>Data Quality</Text>

        <Text style={s.h2}>Record Status</Text>
        <HBarChart data={[
          { label: 'Export Ready', value: total - withErrors, color: C.green },
          { label: 'Warnings',     value: withWarnings,       color: C.amber },
          { label: 'Errors',       value: withErrors,         color: C.rose  },
        ]} />
        <ProgressBar pct={readyPct} />
        <Text style={[s.body, { marginBottom: 12 }]}>
          {total - withErrors} of {total} records are export-ready ({readyPct}%).
          {withErrors > 0
            ? `  ${withErrors} record${withErrors > 1 ? 's' : ''} have errors that will be skipped in the DataGrows export.`
            : '  All records are clean and ready.'}
        </Text>

        {topErrors.length > 0 && (
          <>
            <Text style={s.h2}>Top Fields to Fix</Text>
            {topErrors.map(([field, count], i) => (
              <Text key={i} style={[s.body, { marginBottom: 3 }]}>
                {`${i + 1}. `}
                {field.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                {` — ${count} record${count > 1 ? 's' : ''} missing or invalid`}
              </Text>
            ))}
          </>
        )}

        {sourceData.length > 0 && (
          <>
            <Text style={[s.h2, { marginTop: 18 }]}>Source Coverage</Text>
            <Text style={[s.muted, { marginBottom: 8 }]}>
              Number of clients present in each source system
            </Text>
            <HBarChart data={sourceData} maxBarWidth={200} />
          </>
        )}

        <Footer firmName={opts.firmName} page="Data Quality" />
      </Page>

      {/* ── Employees ─────────────────────────────────────────────────────── */}
      {opts.employees.length > 0 && (
        <Page size="A4" style={s.page}>
          <Text style={s.h1}>Staff Overview</Text>
          <View style={s.table}>
            <View style={s.tHead}>
              <Text style={[s.th, { flex: 1 }]}>Name</Text>
              <Text style={[s.th, { flex: 1 }]}>Title</Text>
              <Text style={[s.th, { flex: 2 }]}>DG Role Summary</Text>
            </View>
            {opts.employees.slice(0, 30).map((emp, i) => {
              const rolesStr = emp.dg_roles
                ? Object.entries(emp.dg_roles).filter(([, c]) => c > 0)
                    .map(([r, c]) => `${r.replace(/_/g, ' ')}: ${c}`).join(', ')
                : '—';
              return (
                <View key={i} style={i % 2 === 0 ? s.tRow : s.tRowAlt}>
                  <Text style={[s.td, { flex: 1 }]}>{emp.name}</Text>
                  <Text style={[s.td, { flex: 1 }]}>{emp.job_title ?? '—'}</Text>
                  <Text style={[s.td, { flex: 2 }]}>{rolesStr}</Text>
                </View>
              );
            })}
          </View>
          <Footer firmName={opts.firmName} page="Staff Overview" />
        </Page>
      )}

      {/* ── Contacts & Suppliers ──────────────────────────────────────────── */}
      {(opts.contacts.length > 0 || opts.suppliers.length > 0) && (
        <Page size="A4" style={s.page}>
          <Text style={s.h1}>Contacts &amp; Suppliers</Text>

          {opts.contacts.length > 0 && (
            <>
              <Text style={s.h2}>Contacts ({opts.contacts.length})</Text>
              <View style={s.table}>
                <View style={s.tHead}>
                  <Text style={[s.th, { flex: 1 }]}>Name</Text>
                  <Text style={[s.th, { flex: 1 }]}>Organisation</Text>
                  <Text style={[s.th, { flex: 1 }]}>Relationship</Text>
                </View>
                {opts.contacts.slice(0, 15).map((c, i) => (
                  <View key={i} style={i % 2 === 0 ? s.tRow : s.tRowAlt}>
                    <Text style={[s.td, { flex: 1 }]}>{c.name ?? '—'}</Text>
                    <Text style={[s.td, { flex: 1 }]}>{c.organisation ?? '—'}</Text>
                    <Text style={[s.td, { flex: 1 }]}>{c.relationship ?? '—'}</Text>
                  </View>
                ))}
              </View>
            </>
          )}

          {opts.suppliers.length > 0 && (
            <>
              <Text style={[s.h2, { marginTop: 14 }]}>Suppliers ({opts.suppliers.length})</Text>
              <View style={s.table}>
                <View style={s.tHead}>
                  <Text style={[s.th, { flex: 1 }]}>Supplier</Text>
                  <Text style={[s.th, { flex: 1 }]}>Contact</Text>
                  <Text style={[s.th, { flex: 1 }]}>Service</Text>
                </View>
                {opts.suppliers.slice(0, 15).map((s2, i) => (
                  <View key={i} style={i % 2 === 0 ? s.tRow : s.tRowAlt}>
                    <Text style={[s.td, { flex: 1 }]}>{s2.supplier_name ?? '—'}</Text>
                    <Text style={[s.td, { flex: 1 }]}>{s2.contact_person ?? '—'}</Text>
                    <Text style={[s.td, { flex: 1 }]}>{s2.service_provided ?? '—'}</Text>
                  </View>
                ))}
              </View>
            </>
          )}

          <Footer firmName={opts.firmName} page="Contacts & Suppliers" />
        </Page>
      )}

      {/* ── Appendix ──────────────────────────────────────────────────────── */}
      <Page size="A4" style={s.page}>
        <Text style={s.h1}>Appendix — Full Client List</Text>
        <View style={s.table}>
          <View style={s.tHead}>
            <Text style={[s.th, { flex: 2 }]}>Client Name</Text>
            <Text style={[s.th, { flex: 1 }]}>Entity Type</Text>
            <Text style={[s.th, { flex: 1 }]}>Status</Text>
            <Text style={[s.th, { flex: 1 }]}>Reg Nr</Text>
            <Text style={[s.th, { flex: 1 }]}>Sources</Text>
          </View>
          {active.map((c, i) => (
            <View key={i} style={i % 2 === 0 ? s.tRow : s.tRowAlt}>
              <Text style={[s.td, { flex: 2 }]}>{String(c.merged.client_name ?? '—')}</Text>
              <Text style={[s.td, { flex: 1 }]}>{String(c.merged.entity_type ?? '—')}</Text>
              <Text style={[s.td, { flex: 1 }]}>{String(c.merged.status ?? '—')}</Text>
              <Text style={[s.td, { flex: 1 }]}>{String(c.merged.registration_nr ?? '—')}</Text>
              <Text style={[s.td, { flex: 1 }]}>{(c.sources ?? []).join(', ')}</Text>
            </View>
          ))}
        </View>
        <Footer firmName={opts.firmName} page="Appendix" />
      </Page>
    </Document>
  );
}

// ── Export function ───────────────────────────────────────────────────────────

export async function generatePdfReport(opts: PdfReportOptions): Promise<Buffer> {
  // Invoke the component function directly to get the Document element.
  const doc = PdfReport({ opts });
  const buffer = await renderToBuffer(doc);
  return Buffer.from(buffer);
}
