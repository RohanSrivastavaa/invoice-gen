// lib/supabase.js
// Initialises the Supabase client for use in the browser (frontend).
// Import this wherever you need to talk to Supabase from React components.

import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// ─── Auth helpers ─────────────────────────────────────────────────────────────

// Sign in with Google — requests Gmail send permission at the same time.
// Supabase redirects the user to Google, then back to /auth/callback.
export async function signInWithGoogle() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      // gmail.send scope — lets the app send email as the consultant
      scopes: "https://www.googleapis.com/auth/gmail.send",
      // After Google auth, redirect here to exchange the code for a session
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`,
      queryParams: {
        // Always show account picker — prevents wrong account being used silently
        prompt: "select_account",
        access_type: "offline", // gets a refresh token so session persists
      },
    },
  });

  if (error) throw error;
  return data;
}

// Sign out
export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

// Get current session (includes the Google access token for Gmail)
export async function getSession() {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) throw error;
  return session;
  // session.provider_token  ← this is the Google access token for Gmail API
  // session.user            ← user profile info
}

// ─── Consultant helpers ───────────────────────────────────────────────────────

// Fetch the consultant profile for the logged-in user
export async function fetchConsultant() {
  const { data, error } = await supabase
    .from("consultants")
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

// Update bank details (fallback)
export async function updateBankDetails(consultantId, bankDetails) {
  const { data, error } = await supabase
    .from("consultants")
    .update({
      bank_beneficiary: bankDetails.beneficiaryName,
      bank_name: bankDetails.bankName,
      bank_account: bankDetails.accountNumber,
      bank_ifsc: bankDetails.ifscCode,
    })
    .eq("consultant_id", consultantId);

  if (error) throw error;
  return data;
}

// Update consultant profile fields (PAN, GSTIN etc)
export async function updateConsultantProfile(consultantId, fields) {
  const { data, error } = await supabase
    .from("consultants")
    .update(fields)
    .eq("consultant_id", consultantId);

  if (error) throw error;
  return data;
}

// ─── Invoice helpers ──────────────────────────────────────────────────────────

// Fetch all invoices for the current consultant, ordered by created_at desc
export async function fetchInvoices() {
  const { data, error } = await supabase
    .from("invoices")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data;
}

// Send invoice — calls the server-side API route
// accessToken comes from session.provider_token (the Google OAuth token)
export async function sendInvoice(invoiceId, accessToken) {
  console.log("Sending invoice:", invoiceId);
  console.log("Access token present:", !!accessToken);

  const response = await fetch("/api/send-invoice", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ invoiceId, accessToken }),
  });

  const result = await response.json();
  console.log("Send result:", result);

  if (!response.ok) {
    throw new Error(result.error || "Failed to send invoice");
  }

  return result;
}
// ─── Admin helpers (use service role server-side, not here) ───────────────────

// CSV upload is handled via /api/upload-csv route (server-side with service role)
// This just triggers that route from the frontend
export async function uploadPaymentCSV(file) {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch("/api/upload-csv", {
    method: "POST",
    body: formData,
  });

  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Upload failed");
  return result;
}
