'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function ResetPasswordPage() {
  const router = useRouter();
  const supabase = createClient();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    setLoading(true);
    setError(null);
    const { error: err } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (err) { setError(err.message); return; }
    setDone(true);
    setTimeout(() => router.push('/'), 2000);
  }

  return (
    <div className="min-h-[calc(100vh-56px)] bg-gray-50 flex flex-col">
      <div className="bg-teal">
        <div className="max-w-7xl mx-auto px-6 py-5">
          <h1 className="text-white text-xl font-semibold tracking-tight">Set New Password</h1>
          <p className="text-teal-100 text-sm mt-0.5">Choose a new password for your account.</p>
        </div>
      </div>

      <div className="flex-1 flex items-start justify-center pt-12 px-4">
        <div className="w-full max-w-sm">
          {done ? (
            <div className="card p-8 text-center space-y-3">
              <div className="text-4xl">✅</div>
              <h2 className="text-lg font-semibold text-navy-800">Password updated</h2>
              <p className="text-sm text-navy-400">Redirecting you to the app…</p>
            </div>
          ) : (
            <form onSubmit={(e) => void handleSubmit(e)} className="card p-8 space-y-5">
              <div>
                <label className="block text-sm font-medium text-navy-700 mb-1">New Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  placeholder="At least 8 characters"
                  className="input"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-navy-700 mb-1">Confirm Password</label>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  placeholder="Repeat new password"
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
                disabled={loading || !password || !confirm}
                className="btn btn-primary w-full justify-center py-2.5"
              >
                {loading ? 'Updating…' : 'Update Password →'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
