// app/api/admin-invoices/route.js
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { verifyAdmin, AuthError } from "@/lib/auth";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Mask bank account — only show last 4 digits
function maskAccount(account) {
  if (!account) return null;
  return "••••" + account.slice(-4);
}

export async function GET(request) {
  try {
    await verifyAdmin(request);

    const { data: invoices, error: invError } = await supabaseAdmin
      .from("invoices")
      .select("*")
      .order("created_at", { ascending: false });

    if (invError) throw invError;

    const { data: consultants, error: conError } = await supabaseAdmin
      .from("consultants")
      .select("consultant_id, name, email, pan, gstin, bank_beneficiary, bank_name, bank_account, bank_ifsc, created_at")
      .order("name", { ascending: true });

    if (conError) throw conError;

    const consultantMap = {};
    consultants.forEach(c => { consultantMap[c.consultant_id] = c; });

    const enriched = invoices.map(inv => ({
      ...inv,
      consultant_name: consultantMap[inv.consultant_id]?.name || "—",
      consultant_email: consultantMap[inv.consultant_id]?.email || "—",
      consultant_pan: consultantMap[inv.consultant_id]?.pan || "—",
    }));

    // Mask bank account numbers before sending to client
    const safeConsultants = consultants.map(c => ({
      ...c,
      bank_account: maskAccount(c.bank_account),
    }));

    return NextResponse.json({ invoices: enriched, consultants: safeConsultants });

  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    await verifyAdmin(request);

    const { invoiceId, status } = await request.json();

    if (!invoiceId || !status) {
      return NextResponse.json({ error: "Missing invoiceId or status" }, { status: 400 });
    }

    const allowedStatuses = ["pending", "sent", "paid"];
    if (!allowedStatuses.includes(status)) {
      return NextResponse.json({ error: "Invalid status value" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("invoices")
      .update({ status })
      .eq("id", invoiceId)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ invoice: data });

  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}