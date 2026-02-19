// app/api/upload-csv/route.js
// Admin-only route — parses the monthly payroll CSV and upserts invoices.
// Uses service role key to bypass RLS.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Required CSV columns
const REQUIRED_COLUMNS = [
  "consultant_id", "invoice_no", "billing_period",
  "professional_fee", "tds", "total_days", "working_days", "net_payable_days",
];

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Read file content
    const text = await file.text();
    const lines = text.trim().split("\n").filter(l => l.trim());

    if (lines.length < 2) {
      return NextResponse.json({ error: "CSV must have a header row and at least one data row" }, { status: 400 });
    }

    // Parse headers
    const headers = lines[0].split(",").map(h => h.trim().toLowerCase().replace(/ /g, "_"));

    // Validate required columns exist
    const missingCols = REQUIRED_COLUMNS.filter(col => !headers.includes(col));
    if (missingCols.length > 0) {
      return NextResponse.json(
        { error: `Missing required columns: ${missingCols.join(", ")}` },
        { status: 400 }
      );
    }

    // Parse rows
    const rows = lines.slice(1).map((line, index) => {
      const values = line.split(",").map(v => v.trim());
      const row = headers.reduce((obj, h, i) => ({ ...obj, [h]: values[i] || "" }), {});

      return {
        consultant_id:    row.consultant_id,
        invoice_no:       row.invoice_no,
        billing_period:   row.billing_period,
        professional_fee: parseFloat(row.professional_fee) || 0,
        incentive:        parseFloat(row.incentive)        || 0,
        variable:         parseFloat(row.variable)         || 0,
        tds:              parseFloat(row.tds)              || 0,
        reimbursement:    parseFloat(row.reimbursement)    || 0,
        total_days:       parseInt(row.total_days)         || 0,
        working_days:     parseInt(row.working_days)       || 0,
        lop_days:         parseInt(row.lop_days)           || 0,
        net_payable_days: parseInt(row.net_payable_days)   || 0,
        // Bank details from CSV (optional — null if empty)
        bank_beneficiary: row.bank_beneficiary || null,
        bank_name:        row.bank_name        || null,
        bank_account:     row.bank_account     || null,
        bank_ifsc:        row.bank_ifsc        || null,
        status:           "pending",
      };
    });

    // Validate each row has required fields
    const invalidRows = rows
      .map((row, i) => ({ row, lineNum: i + 2 }))
      .filter(({ row }) => !row.consultant_id || !row.invoice_no || !row.billing_period);

    if (invalidRows.length > 0) {
      return NextResponse.json({
        error: `Rows with missing required fields at lines: ${invalidRows.map(r => r.lineNum).join(", ")}`,
      }, { status: 400 });
    }

    // Check all consultant_ids exist in the DB
    const consultantIds = [...new Set(rows.map(r => r.consultant_id))];
    const { data: existingConsultants } = await supabaseAdmin
      .from("consultants")
      .select("consultant_id")
      .in("consultant_id", consultantIds);

    const existingIds = new Set(existingConsultants?.map(c => c.consultant_id) || []);
    const unknownIds = consultantIds.filter(id => !existingIds.has(id));

    if (unknownIds.length > 0) {
      return NextResponse.json({
        error: `Unknown consultant IDs (they must sign in first): ${unknownIds.join(", ")}`,
      }, { status: 400 });
    }

    // Upsert all rows — if invoice_no already exists, update it
    const { data, error } = await supabaseAdmin
      .from("invoices")
      .upsert(rows, { onConflict: "invoice_no" })
      .select();

    if (error) {
      console.error("Supabase upsert error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      count: rows.length,
      rows: data,
    });

  } catch (err) {
    console.error("CSV upload error:", err);
    return NextResponse.json(
      { error: "Internal server error", details: err.message },
      { status: 500 }
    );
  }
}
