'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

export default function SignupPage() {
  const supabase = createClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setLoading(true);
    setError(null);

    const { error: authErr } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (authErr) {
      setError(authErr.message);
      setLoading(false);
      return;
    }

    setSent(true);
    setLoading(false);
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
          <h1 className="text-white text-xl font-semibold tracking-tight">Create Account</h1>
          <p className="text-teal-100 text-sm mt-0.5">
            DataGrows staff only — a verification email will be sent.
          </p>
        </div>
      </div>

      <div className="flex-1 flex items-start justify-center pt-12 px-4">
        <div className="w-full max-w-sm">
          {sent ? (
            <div className="card p-8 text-center space-y-3">
              <div className="text-4xl">📧</div>
              <h2 className="text-lg font-semibold text-navy-800">Check your inbox</h2>
              <p className="text-sm text-navy-500">
                We sent a verification link to <strong>{email}</strong>.
                Click the link to activate your account.
              </p>
              <Link href="/login" className="btn btn-primary w-full justify-center mt-2 inline-flex">
                Back to Sign In
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="card p-8 space-y-5">
              <div>
                <label className="block text-sm font-medium text-navy-700 mb-1">Email</label>
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
                <label className="block text-sm font-medium text-navy-700 mb-1">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                  placeholder="Min. 8 characters"
                  className="input"
                />
                {password.length > 0 && password.length < 8 && (
                  <p className="text-xs text-rose-500 mt-1">
                    {8 - password.length} more character{8 - password.length !== 1 ? 's' : ''} needed
                  </p>
                )}
              </div>

              {error && (
                <div className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !email || password.length < 8}
                className="btn btn-primary w-full justify-center py-2.5"
              >
                {loading ? 'Creating account…' : 'Create Account →'}
              </button>

              <p className="text-xs text-center text-navy-400">
                Already have an account?{' '}
                <Link href="/login" className="text-teal font-medium hover:underline">
                  Sign in
                </Link>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
