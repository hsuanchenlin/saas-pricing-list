// js/supabase-client.js — single shared Supabase browser client.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const SUPABASE_URL = "https://ofitleegdvhbwqebtepk.supabase.co";
// Publishable key is safe in the browser; RLS protects the data.
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_D4MoU3UvGChSoQPWPJNDeg_dcq-38ii";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
