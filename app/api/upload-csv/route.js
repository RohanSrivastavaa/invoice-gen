// app/api/upload-csv/route.js
// Admin-only. Verifies admin session before processing CSV.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyAdmin, AuthError } from "@/lib/auth";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const REQUIRED_COLUMNS = [
  "consultant_id", "invoice_no", "billing_period",
  "professional_fee", "tds", "total_days", "working_days", "net_payable_days",
];

export async function POST(request) {
  try {
    await verifyAdmin(request);

    const formData = await request.formData();
    const file = formData.get("file");
    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

    const text = await file.text();
    const lines = text.trim().split("\n").filter(l => l.trim());
    if (lines.length < 2) return NextResponse.json({ error: "CSV must have a header row and at least one data row" }, { status: 400 });

    const headers = lines[0].split(",").map(h => h.trim().toLowerCase().replace(/ /g, "_"));
    const missingCols = REQUIRED_COLUMNS.filter(col => !headers.includes(col));
    if (missingCols.length > 0) return NextResponse.json({ error: `Missing required columns: ${missingCols.join(", ")}` }, { status: 400 });

    const rows = lines.slice(1).map((line) => {
      const values = line.split(",").map(v => v.trim());
      const row = headers.reduce((obj, h, i) => ({ ...obj, [h]: values[i] || "" }), {});
      return {
        consultant_id: row.consultant_id,
        invoice_no: row.invoice_no,
        billing_period: row.billing_period,
        professional_fee: parseFloat(row.professional_fee) || 0,
        incentive: parseFloat(row.incentive) || 0,
        variable: parseFloat(row.variable) || 0,
        tds: parseFloat(row.tds) || 0,
        reimbursement: parseFloat(row.reimbursement) || 0,
        total_days: parseInt(row.total_days) || 0,
        working_days: parseInt(row.working_days) || 0,
        lop_days: parseInt(row.lop_days) || 0,
        net_payable_days: parseInt(row.net_payable_days) || 0,
        bank_beneficiary: row.bank_beneficiary || null,
        bank_name: row.bank_name || null,
        bank_account: row.bank_account || null,
        bank_ifsc: row.bank_ifsc || null,
        status: "pending",
      };
    });

    const invalidRows = rows.map((row, i) => ({ row, lineNum: i + 2 })).filter(({ row }) => !row.consultant_id || !row.invoice_no || !row.billing_period);
    if (invalidRows.length > 0) return NextResponse.json({ error: `Rows with missing required fields at lines: ${invalidRows.map(r => r.lineNum).join(", ")}` }, { status: 400 });

    const consultantIds = [...new Set(rows.map(r => r.consultant_id))];
    const { data: existing } = await supabaseAdmin.from("consultants").select("consultant_id").in("consultant_id", consultantIds);
    const existingIds = new Set(existing?.map(c => c.consultant_id) || []);
    const unknownIds = consultantIds.filter(id => !existingIds.has(id));

    if (unknownIds.length > 0) {
      const placeholders = unknownIds.map(id => ({ consultant_id: id, email: `pending-${id.toLowerCase()}@placeholder.internal`, name: id }));
      const { error: pe } = await supabaseAdmin.from("consultants").insert(placeholders);
      if (pe) return NextResponse.json({ error: "Failed to create placeholder records: " + pe.message }, { status: 500 });
    }

    const { data, error } = await supabaseAdmin.from("invoices").upsert(rows, { onConflict: "invoice_no" }).select();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({
      success: true, count: rows.length, rows: data, placeholdersCreated: unknownIds.length,
      ...(unknownIds.length > 0 && { note: `${unknownIds.length} consultant(s) haven't signed in yet — invoices created and will be visible once they log in: ${unknownIds.join(", ")}` }),
    });

  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Internal server error", details: err.message }, { status: 500 });
  }
}