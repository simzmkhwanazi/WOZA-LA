'use client';

import { usePathname } from 'next/navigation';

const AUTH_PATHS = ['/login', '/signup'];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAuth = AUTH_PATHS.some((p) => pathname.startsWith(p));

  if (isAuth) {
    // Auth pages: render with no banner, no footer chrome — just the content
    return <>{children}</>;
  }

  return (
    <>
      {/* ── Hero banner — the DataGrows teal strip ── */}
      <div className="bg-teal">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-5">
          <h1 className="text-white text-lg sm:text-xl font-semibold tracking-tight">
            Client Onboarding
          </h1>
          <p className="text-teal-100 text-xs sm:text-sm mt-0.5">
            Consolidate, deduplicate and export client data into the DataGrows master import template.
          </p>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-5 sm:py-8">{children}</main>

      <footer className="border-t border-gray-100 mt-8 sm:mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between text-xs text-gray-400">
          <span>Woza La — internal use only</span>
          <span>
            by <span className="text-teal font-semibold">DataGrows</span>
          </span>
        </div>
      </footer>
    </>
  );
}
