'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error: authErr } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (authErr) {
      setError(authErr.message);
      setLoading(false);
      return;
    }

    router.push('/');
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center">
          <div className="leading-tight">
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-bold text-navy-600 tracking-tight">Woza La</span>
              <span className="text-[11px] text-gray-400 font-normal hidden sm:inline">by DataGrows</span>
            </div>
            <p className="text-[10px] font-semibold text-teal tracking-widest uppercase leading-none">
              Get In. Stay In.
            </p>
          </div>
        </div>
      </div>

      {/* Teal strip */}
      <div className="bg-teal">
        <div className="max-w-7xl mx-auto px-6 py-5">
          <h1 className="text-white text-xl font-semibold tracking-tight">Staff Login</h1>
          <p className="text-teal-100 text-sm mt-0.5">
            Internal use only — DataGrows staff access.
          </p>
        </div>
      </div>

      {/* Login form */}
      <div className="flex-1 flex items-start justify-center pt-12 px-4">
        <div className="w-full max-w-sm">
          <form onSubmit={handleSubmit} className="card p-8 space-y-5">
            <div>
              <label className="block text-sm font-medium text-navy-700 mb-1">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="you@datagrows.com"
                className="input"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-navy-700 mb-1">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                placeholder="••••••••"
                className="input"
              />
            </div>

            {error && (
              <div className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !email || !password}
              className="btn btn-primary w-full justify-center py-2.5"
            >
              {loading ? 'Signing in…' : 'Sign In →'}
            </button>
          </form>

          <p className="text-xs text-center text-navy-400 mt-4">
            New staff member?{' '}
            <Link href="/signup" className="text-teal font-medium hover:underline">
              Create an account
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
