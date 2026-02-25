// lib/auth.js
// Server-side helper to verify the Supabase session token on API routes.

import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Extracts and verifies the Bearer token from the Authorization header.
 * Returns { user, email, consultantId, isAdmin } on success, throws on failure.
 */
export async function verifySession(request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new AuthError("Missing or invalid authorization header", 401);
  }

  const token = authHeader.slice(7);

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) {
    throw new AuthError("Invalid or expired session", 401);
  }

  // Check admins table
  const { data: adminRow } = await supabaseAdmin
    .from("admins")
    .select("email")
    .eq("email", user.email)
    .maybeSingle();

  // Check consultants table for consultant_id
  const { data: consultant } = await supabaseAdmin
    .from("consultants")
    .select("consultant_id")
    .eq("email", user.email)
    .maybeSingle();

  return {
    user,
    email: user.email,
    consultantId: consultant?.consultant_id || null,
    isAdmin: !!adminRow,
  };
}

/**
 * Same as verifySession but also enforces admin — throws 403 if not admin.
 */
export async function verifyAdmin(request) {
  const session = await verifySession(request);
  if (!session.isAdmin) {
    throw new AuthError("Admin access required", 403);
  }
  return session;
}

export class AuthError extends Error {
  constructor(message, status = 401) {
    super(message);
    this.status = status;
  }
}