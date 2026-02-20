// app/auth/callback/route.js
// With implicit flow, the session is in the URL hash and handled by the
// browser client automatically. This route just redirects back to the app.
import { NextResponse } from "next/server";

export async function GET(request) {
  const requestUrl = new URL(request.url);
  const origin = requestUrl.origin;
  return NextResponse.redirect(`${origin}/`);
}