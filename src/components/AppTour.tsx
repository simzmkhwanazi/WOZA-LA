'use client';

import { useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { driver, type DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';

const STORAGE_KEYS = {
  home: 'wl_tour_home_v1',
  session: 'wl_tour_session_v1',
  featureEngine: 'wl_tour_feature_v1',
};

// ── Home page tour ─────────────────────────────────────────────────────────────

const HOME_STEPS: DriveStep[] = [
  {
    popover: {
      title: '👋 Welcome to Woza La',
      description: `
        <p style="margin:0 0 10px">Woza La is DataGrows' internal client onboarding tool.</p>
        <p style="margin:0 0 10px">When a new accounting firm signs up, they send you their data — Sage exports, SARS records, CIPC filings, Xero files. Woza La consolidates all of it into a single clean <strong>DataGrows master import file</strong>.</p>
        <p style="margin:0">This tour takes about 2 minutes. Use the arrows to navigate, or press <strong>Esc</strong> to skip.</p>
      `,
      side: 'over',
      align: 'center',
    },
  },
  {
    element: '[data-tour="nav-sessions"]',
    popover: {
      title: '📋 Sessions',
      description: `
        <p style="margin:0 0 8px"><strong>One session = one firm.</strong></p>
        <p style="margin:0 0 8px">When you start onboarding a new firm, you create a Session. Everything — uploaded files, mapped columns, client records, edits — is saved inside that session.</p>
        <p style="margin:0">Sessions stay open until you're ready to export. You can pause and come back at any time.</p>
      `,
      side: 'bottom',
    },
  },
  {
    element: '[data-tour="nav-feature-engine"]',
    popover: {
      title: '⚡ Feature Engine',
      description: `
        <p style="margin:0 0 8px">Once a session's data is ready, the <strong>AI-powered Feature Engine</strong> analyses the firm's full client portfolio.</p>
        <p style="margin:0 0 8px">It looks at how many clients are VAT-registered, have payroll, need CIPC filings, etc. — then recommends which of DataGrows' 12 product features will deliver the most value for that firm.</p>
        <p style="margin:0">These recommendations help the sales team have better conversations during onboarding.</p>
      `,
      side: 'bottom',
    },
  },
  {
    element: '[data-tour="btn-new-session"]',
    popover: {
      title: '🚀 Start here',
      description: `
        <p style="margin:0 0 8px">Click <strong>New Session</strong> to begin onboarding a firm. Enter the firm's name — that's all you need to start.</p>
        <p style="margin:0">Your login is automatically recorded as the operator, so there's no need to enter your name manually.</p>
      `,
      side: 'left',
    },
  },
  {
    element: '[data-tour="sessions-table"]',
    popover: {
      title: '📁 Your sessions',
      description: `
        <p style="margin:0 0 8px">All sessions appear here, newest first. The <strong>status</strong> shows where each session is in the process:</p>
        <ul style="margin:0 0 8px;padding-left:18px">
          <li><strong>Uploading</strong> — files being added</li>
          <li><strong>Mapping</strong> — columns being matched</li>
          <li><strong>Review</strong> — records being cleaned</li>
          <li><strong>Done</strong> — exported and complete</li>
        </ul>
        <p style="margin:0">Click any row to open the session and continue working.</p>
      `,
      side: 'top',
    },
  },
  {
    element: '[data-tour="sessions-table"]',
    popover: {
      title: '💡 You can run multiple sessions at once',
      description: `
        <p style="margin:0 0 8px">There's no limit. You might have three firms on the go at the same time:</p>
        <ul style="margin:0 0 8px;padding-left:18px;line-height:1.8">
          <li><strong>Rich Accounts</strong> — Sage uploaded, waiting on SARS data</li>
          <li><strong>ABC Auditors</strong> — paused at Review, firm still sending files</li>
          <li><strong>XYZ Group</strong> — fully exported and done</li>
        </ul>
        <p style="margin:0 0 8px"><strong>Partial data is fine.</strong> If a firm hasn't sent everything yet, start the session with what you have and export a draft masterfile. When the missing files arrive, come back, upload them, re-run the mapping — and the records are rebuilt with the richer data.</p>
        <p style="margin:0">You can export as many times as needed. There's no lock on the Export step.</p>
      `,
      side: 'top',
    },
  },
  {
    element: '[data-tour="nav-settings"]',
    popover: {
      title: '⚙️ Settings',
      description: `
        <p style="margin:0 0 8px">Settings shows app info and useful links — including the DataGrows feature catalogue and the Supabase dashboard for admins.</p>
        <p style="margin:0">You can also restart this tour any time from the Settings page.</p>
      `,
      side: 'bottom',
    },
  },
  {
    popover: {
      title: "✅ You're ready!",
      description: `
        <p style="margin:0 0 10px">That covers the basics. Here's a quick summary of the full onboarding workflow:</p>
        <ol style="margin:0 0 10px;padding-left:18px;line-height:1.8">
          <li>Create a <strong>Session</strong> for the firm</li>
          <li><strong>Upload</strong> all source files (Sage, Xero, SARS, CIPC, Company Details, Employee List)</li>
          <li><strong>Map columns</strong> to the DataGrows schema</li>
          <li><strong>Review</strong> merged records and fix any issues</li>
          <li><strong>Export</strong> the master import Excel</li>
          <li>Run the <strong>Feature Engine</strong> to get AI recommendations</li>
        </ol>
        <p style="margin:0">Open a session to see a tour of those 5 steps in detail.</p>
      `,
      side: 'over',
      align: 'center',
    },
  },
];

// ── Session page tour ─────────────────────────────────────────────────────────

const SESSION_STEPS: DriveStep[] = [
  {
    popover: {
      title: '🗂️ Inside a Session',
      description: `
        <p style="margin:0 0 10px">Each session has <strong>5 tabs</strong>. Work through them left to right — your changes save automatically at every step.</p>
        <p style="margin:0">You don't need to finish in one sitting. The session remembers where you left off.</p>
      `,
      side: 'over',
      align: 'center',
    },
  },
  {
    element: '[data-tour="tab-upload"]',
    popover: {
      title: '1️⃣ Upload',
      description: `
        <p style="margin:0 0 8px">Upload every file the firm sent you. Tag each file with its source type:</p>
        <ul style="margin:0 0 8px;padding-left:18px;line-height:1.8">
          <li><strong>Company Details</strong> — firm's own registration & contacts</li>
          <li><strong>Sage / Xero</strong> — accounting system exports</li>
          <li><strong>SARS</strong> — tax number records</li>
          <li><strong>CIPC</strong> — company registration data</li>
          <li><strong>Employee List</strong> — the firm's staff for role assignments</li>
        </ul>
        <p style="margin:0">Woza La parses the file immediately and shows you the row count and detected columns.</p>
      `,
      side: 'bottom',
    },
  },
  {
    element: '[data-tour="tab-mapping"]',
    popover: {
      title: '2️⃣ Map Columns',
      description: `
        <p style="margin:0 0 8px">Woza La automatically matches the uploaded column headers to the 86-column DataGrows schema.</p>
        <p style="margin:0 0 8px">Review the auto-mappings and correct any that don't look right. Common mismatches happen with custom column names like "Client Ref" vs "Internal Client Code".</p>
        <p style="margin:0">Once you click <strong>Build Clusters</strong>, Woza La merges records from all sources — CIPC data wins for registration fields, SARS wins for tax numbers, etc.</p>
      `,
      side: 'bottom',
    },
  },
  {
    element: '[data-tour="tab-review"]',
    popover: {
      title: '3️⃣ Review',
      description: `
        <p style="margin:0 0 8px">The merged client records appear as a table. This is where you do the bulk of the cleanup work.</p>
        <ul style="margin:0 0 8px;padding-left:18px;line-height:1.8">
          <li><strong>Click any field</strong> to edit it directly</li>
          <li><strong>Conflicts</strong> are flagged where two sources disagreed — you choose which value to keep</li>
          <li><strong>Validation errors</strong> are shown in red — missing required fields, incorrect formats</li>
          <li><strong>Archive</strong> clients that should be excluded from the import</li>
        </ul>
        <p style="margin:0">The goal is zero red flags before you export.</p>
      `,
      side: 'bottom',
    },
  },
  {
    element: '[data-tour="tab-audit"]',
    popover: {
      title: '4️⃣ Audit Log',
      description: `
        <p style="margin:0 0 8px">Every edit made in the Review step is logged here with:</p>
        <ul style="margin:0 0 8px;padding-left:18px;line-height:1.8">
          <li>The <strong>field</strong> that was changed</li>
          <li>The <strong>old value</strong> and <strong>new value</strong></li>
          <li>The <strong>operator name</strong> and <strong>timestamp</strong></li>
        </ul>
        <p style="margin:0">Use this to review what was changed and why — especially useful when multiple people work on the same session.</p>
      `,
      side: 'bottom',
    },
  },
  {
    element: '[data-tour="tab-export"]',
    popover: {
      title: '5️⃣ Export',
      description: `
        <p style="margin:0 0 8px">When the data is clean, export two files:</p>
        <ul style="margin:0 0 8px;padding-left:18px;line-height:1.8">
          <li><strong>DataGrows Master Import</strong> — the final .xlsx ready to upload into DataGrows. Contains all 86 columns in the exact order DataGrows expects.</li>
          <li><strong>Archive Report</strong> — a separate file listing all clients that were excluded and why. Hand this back to the firm for follow-up.</li>
        </ul>
        <p style="margin:0 0 8px">💡 <strong>Don't have all the files yet?</strong> Export a draft now and come back later. When the missing data arrives, upload it, re-run mapping, and export again — the session stays open and you can override the masterfile as many times as needed.</p>
        <p style="margin:0">After exporting, head to the <strong>Feature Engine</strong> to generate feature recommendations for this firm.</p>
      `,
      side: 'bottom',
    },
  },
];

// ── Feature Engine tour ───────────────────────────────────────────────────────

const FEATURE_ENGINE_STEPS: DriveStep[] = [
  {
    popover: {
      title: '⚡ Feature Relevance Engine',
      description: `
        <p style="margin:0 0 10px">The Feature Engine is a tool for the <strong>DataGrows sales and onboarding teams</strong>.</p>
        <p style="margin:0">After you've processed a firm's client data, the engine analyses their full portfolio and recommends which DataGrows features will deliver the most immediate value — saving hours of manual assessment.</p>
      `,
      side: 'over',
      align: 'center',
    },
  },
  {
    element: '[data-tour="session-list"]',
    popover: {
      title: '📋 Pick a session',
      description: `
        <p style="margin:0 0 8px">Select any session from this list. The engine reads the merged client data directly — <strong>no manual input required</strong>.</p>
        <p style="margin:0">Click a firm name and the analysis runs automatically.</p>
      `,
      side: 'right',
    },
  },
  {
    element: '[data-tour="engine-results"]',
    popover: {
      title: '🎯 Recommendations',
      description: `
        <p style="margin:0 0 8px">Results are split into two groups:</p>
        <ul style="margin:0 0 8px;padding-left:18px;line-height:1.8">
          <li><strong>Priority features</strong> — activate these immediately based on the portfolio data (e.g. "47 of 120 clients are VAT-registered → enable Workflow Automation for VAT returns")</li>
          <li><strong>Worth exploring</strong> — beneficial but not immediately critical</li>
        </ul>
        <p style="margin:0">Each card links directly to the DataGrows features page. Use the <strong>Copy</strong> button to paste the recommendation into a proposal or email.</p>
      `,
      side: 'left',
    },
  },
];

// ── Tour runner ───────────────────────────────────────────────────────────────

function waitForElement(selector: string, timeout = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    if (document.querySelector(selector)) return resolve(true);
    const observer = new MutationObserver(() => {
      if (document.querySelector(selector)) {
        observer.disconnect();
        resolve(true);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => { observer.disconnect(); resolve(false); }, timeout);
  });
}

export function AppTour() {
  const pathname = usePathname();

  const runTour = useCallback((
    steps: DriveStep[],
    storageKey: string,
    requiredSelector?: string,
  ) => {
    if (typeof window === 'undefined') return;
    if (localStorage.getItem(storageKey)) return;

    const start = () => {
      // Filter out steps whose element doesn't exist in the DOM
      const safeSteps = steps.map((step) => {
        if (step.element && !document.querySelector(step.element as string)) {
          return { ...step, element: undefined };
        }
        return step;
      });

      const driverObj = driver({
        showProgress: true,
        animate: true,
        allowClose: true,
        overlayOpacity: 0.6,
        stagePadding: 8,
        popoverClass: 'wl-tour-popover',
        nextBtnText: 'Next →',
        prevBtnText: '← Back',
        doneBtnText: 'Done ✓',
        progressText: '{{current}} of {{total}}',
        onDestroyStarted: () => {
          localStorage.setItem(storageKey, '1');
          driverObj.destroy();
        },
        steps: safeSteps,
      });

      driverObj.drive();
    };

    if (requiredSelector) {
      waitForElement(requiredSelector, 2000).then(start);
    } else {
      setTimeout(start, 600);
    }
  }, []);

  useEffect(() => {
    if (pathname === '/') {
      runTour(HOME_STEPS, STORAGE_KEYS.home, '[data-tour="btn-new-session"]');
    } else if (pathname.startsWith('/sessions/') && !pathname.endsWith('/new')) {
      runTour(SESSION_STEPS, STORAGE_KEYS.session, '[data-tour="tab-upload"]');
    } else if (pathname === '/feature-engine') {
      runTour(FEATURE_ENGINE_STEPS, STORAGE_KEYS.featureEngine, '[data-tour="session-list"]');
    }
  }, [pathname, runTour]);

  return null;
}

// Re-export helper to reset tours from Settings
export function resetAllTours() {
  Object.values(STORAGE_KEYS).forEach((k) => localStorage.removeItem(k));
}
