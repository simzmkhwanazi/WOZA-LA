import type { Metadata } from 'next';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { LogoutButton } from '@/components/LogoutButton';
import { AppShell } from '@/components/AppShell';
import { AppTour } from '@/components/AppTour';
import './globals.css';

export const metadata: Metadata = {
  title: 'Woza La — Get In. Stay In. | DataGrows',
  description: 'Internal onboarding tool: consolidate client data into the DataGrows master import template.',
  viewport: 'width=device-width, initial-scale=1, viewport-fit=cover',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  return (
    <html lang="en">
      <body>
        {/* ── Header — safe-area aware, always visible ── */}
        <header className="bg-white border-b border-gray-100 shadow-sm sticky top-0 z-50"
          style={{ paddingTop: 'env(safe-area-inset-top)' }}>
          <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2.5 group">
              <div className="leading-tight">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl font-bold text-navy-600 tracking-tight">Woza La</span>
                  <span className="text-[11px] text-gray-400 font-normal">by DataGrows</span>
                </div>
                <p className="text-[10px] font-semibold text-teal tracking-widest uppercase leading-none">
                  Get In. Stay In.
                </p>
              </div>
            </Link>

            <nav className="flex items-center gap-1">
              {user && (
                <>
                  <Link href="/" className="nav-link" data-tour="nav-sessions">Sessions</Link>
                  <Link href="/feature-engine" className="nav-link hidden sm:inline-flex" data-tour="nav-feature-engine">Feature Engine</Link>
                  <Link href="/settings" className="nav-link hidden sm:inline-flex" data-tour="nav-settings">Settings</Link>
                  <span className="text-gray-200 mx-1 hidden sm:inline">|</span>
                  <span className="text-xs text-navy-400 hidden md:inline mr-1">{user.email}</span>
                  <LogoutButton />
                </>
              )}
            </nav>
          </div>
        </header>

        {/* AppShell hides the teal banner and footer on /login and /signup */}
        <AppShell>{children}</AppShell>
        {user && <AppTour />}
      </body>
    </html>
  );
}
