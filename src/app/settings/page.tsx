'use client';

import { resetAllTours } from '@/components/AppTour';
import { useState } from 'react';

export default function SettingsPage() {
  const [tourReset, setTourReset] = useState(false);

  function handleResetTour() {
    resetAllTours();
    setTourReset(true);
    setTimeout(() => setTourReset(false), 2500);
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-2xl font-semibold text-navy-800">Settings</h2>
        <p className="text-sm text-navy-500 mt-1">Application configuration for Woza La.</p>
      </div>

      {/* About */}
      <div className="card p-6 space-y-4">
        <h3 className="text-sm font-semibold text-navy-700 uppercase tracking-widest">About</h3>
        <dl className="space-y-3 text-sm">
          <div className="flex justify-between border-b border-navy-50 pb-3">
            <dt className="text-navy-500">Application</dt>
            <dd className="font-medium text-navy-800">Woza La</dd>
          </div>
          <div className="flex justify-between border-b border-navy-50 pb-3">
            <dt className="text-navy-500">Purpose</dt>
            <dd className="font-medium text-navy-800">Client onboarding — DataGrows import</dd>
          </div>
          <div className="flex justify-between border-b border-navy-50 pb-3">
            <dt className="text-navy-500">Built by</dt>
            <dd className="font-medium text-teal">DataGrows</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-navy-500">Internal use only</dt>
            <dd className="font-medium text-navy-800">Yes</dd>
          </div>
        </dl>
      </div>

      {/* Walkthrough */}
      <div className="card p-6 space-y-4">
        <h3 className="text-sm font-semibold text-navy-700 uppercase tracking-widest">Walkthrough</h3>
        <p className="text-sm text-navy-500">
          The guided tour runs automatically the first time you visit each section.
          Reset it here to replay the full walkthrough — useful for training new staff.
        </p>
        <button
          type="button"
          onClick={handleResetTour}
          className="btn btn-secondary"
        >
          {tourReset ? '✓ Tour reset — navigate to Sessions to start' : 'Restart Guided Tour'}
        </button>
      </div>

    </div>
  );
}
