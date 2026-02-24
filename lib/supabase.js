// lib/supabase.js
import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: true,
      detectSessionInUrl: true,
      flowType: "implicit",
    }
  }
);

// ─── Auth helpers ─────────────────────────────────────────────────────────────

export async function signInWithGoogle() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      scopes: "https://www.googleapis.com/auth/gmail.send",
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/`,
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

// email is passed directly from the session to avoid calling getSession()
// inside onAuthStateChange which causes a deadlock
export async function fetchConsultant(email) {
  const { data, error } = await supabase
    .from("consultants")
    .select("*, is_admin")
    .eq("email", email)
    .maybeSingle();

  if (error) throw error;
  return data; // null = new user, send to onboarding
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

export async function completeOnboarding(email, form) {
  const { consultantId, pan, gstin, bankBeneficiary, bankName, bankAccount, bankIfsc, name } = form;

  // Check if a placeholder exists for this consultant_id (created during CSV upload)
  const { data: placeholder } = await supabase
    .from("consultants")
    .select("email, consultant_id")
    .eq("consultant_id", consultantId)
    .maybeSingle();

  if (placeholder) {
    const isPlaceholder = placeholder.email.startsWith("pending-") &&
      placeholder.email.endsWith("@placeholder.internal");

    if (!isPlaceholder && placeholder.email !== email) {
      throw new Error(`Consultant ID ${consultantId} is already registered to another account. Please contact your admin.`);
    }

    // Claim the placeholder row by updating it with real details
    const { error } = await supabase
      .from("consultants")
      .update({ email, name, pan, gstin, bank_beneficiary: bankBeneficiary, bank_name: bankName, bank_account: bankAccount, bank_ifsc: bankIfsc })
      .eq("consultant_id", consultantId);
    if (error) throw error;

    // Clean up the orphaned sign-in row if it exists
    const { data: oldRow } = await supabase.from("consultants").select("email").eq("email", email).maybeSingle();
    if (oldRow && placeholder.email !== email) {
      await supabase.from("consultants").delete().eq("email", email);
    }

  } else {
    // Normal flow — no placeholder, just update their own row
    const { error } = await supabase
      .from("consultants")
      .update({ consultant_id: consultantId, pan, gstin, bank_beneficiary: bankBeneficiary, bank_name: bankName, bank_account: bankAccount, bank_ifsc: bankIfsc })
      .eq("email", email);
    if (error) throw error;
  }

  // Return the final row
  const { data: updated, error: fetchError } = await supabase
    .from("consultants").select("*, is_admin").eq("email", email).maybeSingle();
  if (fetchError) throw fetchError;
  return updated;
}