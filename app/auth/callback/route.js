// app/auth/callback/route.js
// Google redirects here after OAuth login.
// Supabase exchanges the code for a session, then we redirect to the dashboard.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET(request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const origin = requestUrl.origin;

  if (code) {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );

    // Exchange the code for a session
    // This also triggers the handle_new_user DB trigger if first login
    await supabase.auth.exchangeCodeForSession(code);
  }

  // Redirect to dashboard after successful login
  return NextResponse.redirect(`${origin}/`);
}
