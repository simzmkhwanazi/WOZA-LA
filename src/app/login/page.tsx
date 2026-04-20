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
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Forgot password state
  const [showForgot, setShowForgot] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

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

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    setResetLoading(true);
    setResetError(null);
    const { error: err } = await supabase.auth.resetPasswordForEmail(resetEmail.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setResetLoading(false);
    if (err) { setResetError(err.message); return; }
    setResetSent(true);
  }

  return (
    <div className="min-h-[calc(100vh-56px)] bg-gray-50 flex flex-col">
      {/* Teal strip */}
      <div className="bg-teal">
        <div className="max-w-7xl mx-auto px-6 py-5">
          <h1 className="text-white text-xl font-semibold tracking-tight">Staff Login</h1>
          <p className="text-teal-100 text-sm mt-0.5">Internal use only — DataGrows staff access.</p>
        </div>
      </div>

      {/* Login form */}
      <div className="flex-1 flex items-start justify-center pt-12 px-4">
        <div className="w-full max-w-sm">
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
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-navy-700">Password</label>
                <button
                  type="button"
                  onClick={() => { setShowForgot(true); setResetEmail(email); setResetSent(false); setResetError(null); }}
                  className="text-xs text-teal hover:underline"
                >
                  Forgot password?
                </button>
              </div>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="input pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-navy-400 hover:text-navy-600"
                  tabIndex={-1}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
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

      {/* ── Forgot password modal ── */}
      {showForgot && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={() => setShowForgot(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            {resetSent ? (
              <div className="text-center space-y-4">
                <div className="text-4xl">📬</div>
                <h2 className="text-lg font-semibold text-navy-800">Check your email</h2>
                <p className="text-sm text-navy-500">
                  We sent a password reset link to <strong>{resetEmail}</strong>.<br />
                  Click the link in the email to set a new password.
                </p>
                <button onClick={() => setShowForgot(false)} className="btn btn-primary w-full justify-center">
                  Back to Login
                </button>
              </div>
            ) : (
              <form onSubmit={(e) => void handleResetPassword(e)} className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-navy-800">Reset your password</h2>
                  <p className="text-sm text-navy-400 mt-0.5">Enter your email and we'll send you a reset link.</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-navy-700 mb-1">Email</label>
                  <input
                    type="email"
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    required
                    autoComplete="email"
                    placeholder="you@datagrows.com"
                    className="input"
                  />
                </div>
                {resetError && <p className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{resetError}</p>}
                <div className="flex gap-3">
                  <button type="button" onClick={() => setShowForgot(false)} className="btn btn-ghost flex-1 justify-center">Cancel</button>
                  <button type="submit" disabled={resetLoading || !resetEmail} className="btn btn-primary flex-1 justify-center">
                    {resetLoading ? 'Sending…' : 'Send Reset Link'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
