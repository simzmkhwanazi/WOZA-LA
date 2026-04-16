import type { Metadata } from 'next';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { LogoutButton } from '@/components/LogoutButton';
import './globals.css';

export const metadata: Metadata = {
  title: 'Woza La — Get In. Stay In. | DataGrows',
  description: 'Internal onboarding tool: consolidate client data into the DataGrows master import template.',
};


export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  return (
    <html lang="en">
      <body>
        {/* ── Header — mirrors DataGrows website: white bg, dark text, teal accents ── */}
        <header className="bg-white border-b border-gray-100 shadow-sm sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">

            {/* Brand lockup */}
            <Link href="/" className="flex items-center gap-2.5 group">
              <div className="leading-tight">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl font-bold text-navy-600 tracking-tight">
                    Woza La
                  </span>
                  <span className="text-[11px] text-gray-400 font-normal hidden sm:inline">
                    by DataGrows
                  </span>
                </div>
                <p className="text-[10px] font-semibold text-teal tracking-widest uppercase leading-none">
                  Get In. Stay In.
                </p>
              </div>
            </Link>

            {/* Nav */}
            <nav className="flex items-center gap-1">
              {user && (
                <>
                  <Link href="/" className="nav-link">Sessions</Link>
                  <Link href="/feature-engine" className="nav-link">Feature Engine</Link>
                  <Link href="/settings" className="nav-link">Settings</Link>
                  <span className="text-gray-200 mx-1">|</span>
                  <span className="text-xs text-navy-400 hidden sm:inline mr-1">{user.email}</span>
                  <LogoutButton />
                </>
              )}
            </nav>
          </div>
        </header>

        {/* ── Hero banner — the DataGrows teal strip ── */}
        <div className="bg-teal">
          <div className="max-w-7xl mx-auto px-6 py-5">
            <h1 className="text-white text-xl font-semibold tracking-tight">
              Client Onboarding
            </h1>
            <p className="text-teal-100 text-sm mt-0.5">
              Consolidate, deduplicate and export client data into the DataGrows master import template.
            </p>
          </div>
        </div>

        <main className="max-w-7xl mx-auto px-6 py-8">{children}</main>

        <footer className="border-t border-gray-100 mt-12">
          <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between text-xs text-gray-400">
            <span>Woza La — internal use only</span>
            <span>
              by{' '}
              <span className="text-teal font-semibold">DataGrows</span>
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
