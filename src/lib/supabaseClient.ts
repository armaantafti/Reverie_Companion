import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const browserKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isDatabaseConfigured = Boolean(url && browserKey);

export const db = isDatabaseConfigured
  ? createClient(url!, browserKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true
      }
    })
  : null;
