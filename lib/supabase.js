// lib/supabase.js
import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: true,
      detectSessionInUrl: true,
      flowType: "implicit", // session comes back in URL hash, saved to localStorage automatically
    }
  }
);

// ─── Auth helpers ─────────────────────────────────────────────────────────────

export async function signInWithGoogle() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      scopes: "https://www.googleapis.com/auth/gmail.send",
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/`, // redirect straight to root, no /auth/callback needed
      queryParams: {
        prompt: "select_account",
        access_type: "offline",
      },
    },
  });

  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getSession() {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) throw error;
  return session;
}

// ─── Consultant helpers ───────────────────────────────────────────────────────

export async function fetchConsultant() {
  console.log("fetchConsultant called");

  const { data: { session } } = await supabase.auth.getSession();

  console.log("session in fetchConsultant:", session?.user?.email);

  if (!session?.user) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("consultants")
    .select("*")
    .eq("email", session.user.email)
    .maybeSingle();

  console.log("fetchConsultant result:", data, error);

  if (error) throw error;
  return data;
}

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

export async function updateConsultantProfile(consultantId, fields) {
  const { data, error } = await supabase
    .from("consultants")
    .update(fields)
    .eq("consultant_id", consultantId);

  if (error) throw error;
  return data;
}

// ─── Invoice helpers ──────────────────────────────────────────────────────────

export async function fetchInvoices() {
  const { data, error } = await supabase
    .from("invoices")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data;
}

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

// ─── Admin helpers ────────────────────────────────────────────────────────────

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