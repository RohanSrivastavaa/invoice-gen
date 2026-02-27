// app/api/upload-csv/route.js
// Admin-only. Parses CSV, upserts consultant profiles AND invoice records.
// CSV columns (in order): invoice_no, billing_period, gstin(optional), consultant_id,
// consultant_name, pan, professional_fee, incentive, variable/bonus/referral,
// total_amount, tds, other_deductions, reimbursement, net_payable,
// total_days, working_days, lop_days, net_payable_days, consultant_email.
// total_amount and net_payable are informational — computed from components.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyAdmin, AuthError } from "@/lib/auth";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const REQUIRED_COLUMNS = [
  "consultant_id", "consultant_email", "consultant_name", "pan",
  "invoice_no", "billing_period",
  "professional_fee", "tds", "total_days", "working_days", "net_payable_days",
];

// Map normalized CSV header names → internal field names
const COLUMN_ALIASES = {
  // "Variable / Bonus / Referral" normalizes to this
  variable_bonus_referral: "variable",
  // "consultant_email" maps to internal "email" field
  consultant_email: "email",
  // strip informational-only columns (computed from components)
  // total_amount and net_payable are accepted but ignored
};

export async function POST(request) {
  try {
    await verifyAdmin(request);

    const formData = await request.formData();
    const file = formData.get("file");
    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

    const text = await file.text();
    const lines = text.trim().split("\n").filter(l => l.trim());
    if (lines.length < 2) return NextResponse.json({ error: "CSV must have a header row and at least one data row" }, { status: 400 });

    const rawHeaders = lines[0].split(",").map(h =>
      h.trim().toLowerCase()
        .replace(/\s*\([^)]*\)/g, "")   // strip (optional), (required), etc.
        .replace(/[^a-z0-9]+/g, "_")    // non-alphanumeric → underscore
        .replace(/^_|_$/g, "")          // trim leading/trailing underscores
    );
    const headers = rawHeaders.map(h => COLUMN_ALIASES[h] ?? h);

    // REQUIRED_COLUMNS are post-alias internal names; headers are already aliased
    const missingCols = REQUIRED_COLUMNS.filter(col => {
      // consultant_email aliases to "email" in headers
      const check = col === "consultant_email" ? "email" : col;
      return !headers.includes(check);
    });
    if (missingCols.length > 0) {
      return NextResponse.json({ error: `Missing required columns: ${missingCols.join(", ")}` }, { status: 400 });
    }

    const rows = lines.slice(1).map((line, index) => {
      const values = line.split(",").map(v => v.trim());
      const row = headers.reduce((obj, h, i) => ({ ...obj, [h]: values[i] || "" }), {});

      return {
        // Consultant profile fields
        consultant_id: row.consultant_id,
        email: row.email,              // aliased from consultant_email
        name: row.consultant_name || null,
        pan: row.pan,
        gstin: row.gstin || null,
        // Invoice fields
        invoice_no: row.invoice_no,
        billing_period: row.billing_period,
        professional_fee: parseFloat(row.professional_fee) || 0,
        incentive: parseFloat(row.incentive) || 0,
        variable: parseFloat(row.variable) || 0,  // aliased from variable_bonus_referral
        other_deductions: parseFloat(row.other_deductions) || 0,
        tds: parseFloat(row.tds) || 0,
        reimbursement: parseFloat(row.reimbursement) || 0,
        total_days: parseInt(row.total_days) || 0,
        working_days: parseInt(row.working_days) || 0,
        lop_days: parseInt(row.lop_days) || 0,
        net_payable_days: parseInt(row.net_payable_days) || 0,
        lineNum: index + 2,
      };
    });

    // Validate required fields per row
    const invalidRows = rows.filter(r => !r.consultant_id || !r.email || !r.pan || !r.invoice_no || !r.billing_period);
    if (invalidRows.length > 0) {
      return NextResponse.json({
        error: `Rows with missing required fields at lines: ${invalidRows.map(r => r.lineNum).join(", ")}`,
      }, { status: 400 });
    }

    // ── 1. Upsert consultant profiles ────────────────────────────────────────
    const consultantUpserts = rows.map(r => ({
      consultant_id: r.consultant_id,
      email: r.email,
      name: r.name,
      pan: r.pan,
      gstin: r.gstin,
    }));

    for (const c of consultantUpserts) {
      const { data: existing } = await supabaseAdmin
        .from("consultants")
        .select("email, consultant_id")
        .eq("consultant_id", c.consultant_id)
        .maybeSingle();

      if (existing) {
        const isPlaceholder = existing.email.startsWith("pending-") &&
          existing.email.endsWith("@placeholder.internal");

        // Never overwrite a real email — only update profile details.
        // If it's a placeholder, also update the email to the real one from CSV.
        const updateFields = {
          pan: c.pan,
          gstin: c.gstin,
          ...(c.name && { name: c.name }),
          ...(isPlaceholder && { email: c.email }),
        };

        await supabaseAdmin
          .from("consultants")
          .update(updateFields)
          .eq("consultant_id", c.consultant_id);

      } else {
        // No row for this consultant_id — check if a row exists for this email
        const { data: byEmail } = await supabaseAdmin
          .from("consultants")
          .select("email, consultant_id")
          .eq("email", c.email)
          .maybeSingle();

        if (byEmail) {
          // Email row exists — update profile but never touch is_admin
          await supabaseAdmin
            .from("consultants")
            .update({
              consultant_id: c.consultant_id,
              pan: c.pan,
              gstin: c.gstin,
              ...(c.name && { name: c.name }),
            })
            .eq("email", c.email);
        } else {
          // Brand new consultant — insert fresh row (no is_admin, defaults to false)
          await supabaseAdmin
            .from("consultants")
            .insert({
              consultant_id: c.consultant_id,
              email: c.email,
              pan: c.pan,
              gstin: c.gstin,
              name: c.name || c.email.split("@")[0],
            });
        }
      }
    }

    // ── 2. Upsert invoices — conflict on (consultant_id, invoice_no) so the same
    //    invoice_no can exist for different consultants without collision ────────
    const invoiceUpserts = rows.map(r => ({
      consultant_id: r.consultant_id,
      invoice_no: r.invoice_no,
      billing_period: r.billing_period,
      professional_fee: r.professional_fee,
      incentive: r.incentive,
      variable: r.variable,
      other_deductions: r.other_deductions,
      tds: r.tds,
      reimbursement: r.reimbursement,
      total_days: r.total_days,
      working_days: r.working_days,
      lop_days: r.lop_days,
      net_payable_days: r.net_payable_days,
      status: "pending",
    }));

    const { data: upsertedRows, error: invError } = await supabaseAdmin
      .from("invoices")
      .upsert(invoiceUpserts, { onConflict: "consultant_id,invoice_no" })
      .select();

    if (invError) {
      console.error("Invoice upsert error:", invError);
      return NextResponse.json({ error: invError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      count: rows.length,
      rows: upsertedRows,
    });

  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("CSV upload error:", err);
    return NextResponse.json({ error: "Internal server error", details: err.message }, { status: 500 });
  }
}