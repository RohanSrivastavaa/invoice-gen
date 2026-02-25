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

// ─── Internal helper — gets the current session access token ─────────────────
// Used to attach Authorization: Bearer <token> to every API route call.
async function getAccessToken() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not authenticated");
  return session.access_token;
}

function authHeaders(token) {
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`,
  };
}

// ─── Consultant helpers ───────────────────────────────────────────────────────

export async function fetchUser(email, googleName) {
  // Check admins table first
  const { data: adminRow } = await supabase
    .from("admins")
    .select("email, name")
    .eq("email", email)
    .maybeSingle();

  if (adminRow) {
    return { email, name: adminRow.name || googleName || email, isAdmin: true };
  }

  // Check consultants table
  const { data, error } = await supabase
    .from("consultants")
    .select("*")
    .eq("email", email)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  // Update placeholder name with real Google display name on first login
  if (googleName && data.name === email.split("@")[0]) {
    await supabase.from("consultants").update({ name: googleName }).eq("email", email);
    return { ...data, name: googleName, isAdmin: false };
  }

  return { ...data, isAdmin: false };
}

export async function uploadSignature(consultantId, file) {
  const ext = file.name.split(".").pop();
  const path = `${consultantId}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from("signatures")
    .upload(path, file, { contentType: file.type, upsert: true });
  if (uploadError) throw uploadError;

  const { data: { publicUrl } } = supabase.storage
    .from("signatures")
    .getPublicUrl(path);

  const { error: dbError } = await supabase
    .from("consultants")
    .update({ signature_url: publicUrl })
    .eq("consultant_id", consultantId);
  if (dbError) throw dbError;

  return publicUrl;
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

export async function fetchInvoices(consultantId) {
  // Filter by consultant_id for defense-in-depth (RLS also enforces this)
  const query = supabase
    .from("invoices")
    .select("*")
    .order("created_at", { ascending: false });

  if (consultantId) query.eq("consultant_id", consultantId);

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function sendInvoice(invoiceId, gmailAccessToken) {
  // Uses the Supabase session token for route auth,
  // and the Gmail OAuth token separately for sending email
  const sessionToken = await getAccessToken();

  const response = await fetch("/api/send-invoice", {
    method: "POST",
    headers: authHeaders(sessionToken),
    body: JSON.stringify({ invoiceId, accessToken: gmailAccessToken }),
  });

  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Failed to send invoice");
  return result;
}

// ─── Admin helpers ────────────────────────────────────────────────────────────

export async function uploadPaymentCSV(file) {
  const sessionToken = await getAccessToken();
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch("/api/upload-csv", {
    method: "POST",
    headers: { "Authorization": `Bearer ${sessionToken}` }, // no Content-Type — browser sets multipart boundary
    body: formData,
  });

  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Upload failed");
  return result;
}

export async function fetchAdminInvoices() {
  const sessionToken = await getAccessToken();
  const response = await fetch("/api/admin-invoices", {
    headers: authHeaders(sessionToken),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Failed to fetch invoices");
  return result;
}

export async function markInvoicePaid(invoiceId) {
  const sessionToken = await getAccessToken();
  const response = await fetch("/api/admin-invoices", {
    method: "PATCH",
    headers: authHeaders(sessionToken),
    body: JSON.stringify({ invoiceId, status: "paid" }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Failed to update invoice");
  return result;
}

export async function sendReminder(email, name, period, gmailAccessToken) {
  const sessionToken = await getAccessToken();
  const response = await fetch("/api/send-reminder", {
    method: "POST",
    headers: authHeaders(sessionToken),
    body: JSON.stringify({ email, name, period, accessToken: gmailAccessToken }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Failed to send reminder");
  return result;
}