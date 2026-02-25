// app/api/upload-csv/route.js
// Admin-only. Parses CSV, upserts consultant profiles AND invoice records.
// CSV must include: consultant_id, email, pan, invoice_no, billing_period,
// professional_fee, tds, total_days, working_days, net_payable_days.
// Optional: gstin, incentive, variable, reimbursement, lop_days.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyAdmin, AuthError } from "@/lib/auth";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const REQUIRED_COLUMNS = [
  "consultant_id", "email", "pan",
  "invoice_no", "billing_period",
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
    if (missingCols.length > 0) {
      return NextResponse.json({ error: `Missing required columns: ${missingCols.join(", ")}` }, { status: 400 });
    }

    const rows = lines.slice(1).map((line, index) => {
      const values = line.split(",").map(v => v.trim());
      const row = headers.reduce((obj, h, i) => ({ ...obj, [h]: values[i] || "" }), {});

      return {
        // Consultant profile fields
        consultant_id: row.consultant_id,
        email: row.email,
        pan: row.pan,
        gstin: row.gstin || null,
        // Invoice fields
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

        // Never overwrite a real email — only update profile/bank details.
        // If it's a placeholder, also update the email to the real one from CSV.
        const updateFields = {
          pan: c.pan,
          gstin: c.gstin,
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
              name: c.email.split("@")[0],
            });
        }
      }
    }

    // ── 2. Upsert invoices ───────────────────────────────────────────────────
    const invoiceUpserts = rows.map(r => ({
      consultant_id: r.consultant_id,
      invoice_no: r.invoice_no,
      billing_period: r.billing_period,
      professional_fee: r.professional_fee,
      incentive: r.incentive,
      variable: r.variable,
      tds: r.tds,
      reimbursement: r.reimbursement,
      total_days: r.total_days,
      working_days: r.working_days,
      lop_days: r.lop_days,
      net_payable_days: r.net_payable_days,
      status: "pending",
    }));

    const { data, error } = await supabaseAdmin
      .from("invoices")
      .upsert(invoiceUpserts, { onConflict: "invoice_no" })
      .select();

    if (error) {
      console.error("Invoice upsert error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      count: rows.length,
      rows: data,
    });

  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("CSV upload error:", err);
    return NextResponse.json({ error: "Internal server error", details: err.message }, { status: 500 });
  }
}