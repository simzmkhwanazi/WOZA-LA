'use client';

import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  // The ?? fallbacks are only reached during `next build` when .env.local is
  // absent. Real requests are browser-side where the NEXT_PUBLIC_* vars are
  // compiled into the bundle from .env.local at build time.
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder',
  );
}
