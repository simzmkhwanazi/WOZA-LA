export default function SettingsPage() {
  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-2xl font-semibold text-navy-800">Settings</h2>
        <p className="text-sm text-navy-500 mt-1">
          Application configuration for Woza La.
        </p>
      </div>

      {/* Environment info */}
      <div className="card p-6 space-y-4">
        <h3 className="text-sm font-semibold text-navy-700 uppercase tracking-widest">
          About
        </h3>
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

      {/* Links */}
      <div className="card p-6 space-y-4">
        <h3 className="text-sm font-semibold text-navy-700 uppercase tracking-widest">
          Resources
        </h3>
        <ul className="space-y-2 text-sm">
          <li>
            <a
              href="https://www.mydatagrows.com/features"
              target="_blank"
              rel="noopener noreferrer"
              className="text-teal font-medium hover:underline"
            >
              DataGrows Feature Catalogue →
            </a>
          </li>
          <li>
            <a
              href="https://supabase.com/dashboard/project/ckzbpxdzounicwhmtdup"
              target="_blank"
              rel="noopener noreferrer"
              className="text-teal font-medium hover:underline"
            >
              Supabase Dashboard →
            </a>
          </li>
        </ul>
      </div>
    </div>
  );
}
