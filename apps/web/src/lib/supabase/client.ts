'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@ipt/shared';
import { publicEnv } from '@/lib/env';

export function createClient() {
  const { supabaseUrl, supabaseKey } = publicEnv();
  return createBrowserClient<Database>(supabaseUrl, supabaseKey);
}
