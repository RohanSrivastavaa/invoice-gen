// app/api/admin-invoices/route.js
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function GET() {
  try {
    // Fetch all invoices with consultant details
    const { data: invoices, error: invError } = await adminSupabase
      .from("invoices")
      .select("*")
      .order("created_at", { ascending: false });

    if (invError) throw invError;

    // Fetch all consultants
    const { data: consultants, error: conError } = await adminSupabase
      .from("consultants")
      .select("consultant_id, name, email, pan");

    if (conError) throw conError;

    // Join consultant name/email into each invoice
    const consultantMap = {};
    consultants.forEach(c => { consultantMap[c.consultant_id] = c; });

    const enriched = invoices.map(inv => ({
      ...inv,
      consultant_name: consultantMap[inv.consultant_id]?.name || "—",
      consultant_email: consultantMap[inv.consultant_id]?.email || "—",
      consultant_pan: consultantMap[inv.consultant_id]?.pan || "—",
    }));

    return NextResponse.json({ invoices: enriched, consultants });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const { invoiceId, status } = await request.json();

    const { data, error } = await adminSupabase
      .from("invoices")
      .update({ status })
      .eq("id", invoiceId)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ invoice: data });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
