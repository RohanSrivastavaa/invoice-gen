// app/api/send-invoice/route.js
// Server-side API route — handles PDF generation, Gmail send, and Supabase update.
// Called from the frontend when the consultant clicks "Send Invoice".
//
// Why server-side?
//   - The Gmail access token from Supabase OAuth is exchanged here safely
//   - Supabase service role key (for updating invoice status) never touches the browser
//   - PDF generation via @react-pdf/renderer works best in Node environment

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { renderToBuffer } from "@react-pdf/renderer";
import { InvoicePDF } from "@/lib/InvoicePDF";
import { createElement } from "react";

// ─── Config ───────────────────────────────────────────────────────────────────

const COMPANY = {
  name: "Noguilt Fitness and Nutrition Private Limited",
  address: "E-190, 2nd Floor, Industrial Area, Sector 74, Sahibzada Ajit Singh Nagar, Pin-140308",
  financeEmail: process.env.NEXT_PUBLIC_FINANCE_EMAIL,
};

// Admin Supabase client — bypasses RLS for status updates
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ─── Route Handler ────────────────────────────────────────────────────────────

export async function POST(request) {
  try {
    // ── 1. Parse request body ──────────────────────────────────────────────────
    const { invoiceId, accessToken } = await request.json();

    if (!invoiceId || !accessToken) {
      return NextResponse.json(
        { error: "Missing invoiceId or accessToken" },
        { status: 400 }
      );
    }

    // ── 2. Fetch invoice + consultant from Supabase ────────────────────────────
    const { data: invoice, error: invoiceError } = await supabaseAdmin
      .from("invoices")
      .select("*")
      .eq("id", invoiceId)
      .single();

    if (invoiceError || !invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    if (invoice.status === "sent") {
      return NextResponse.json({ error: "Invoice already sent" }, { status: 409 });
    }

    const { data: consultant, error: consultantError } = await supabaseAdmin
      .from("consultants")
      .select("*")
      .eq("consultant_id", invoice.consultant_id)
      .single();

    if (consultantError || !consultant) {
      return NextResponse.json({ error: "Consultant not found" }, { status: 404 });
    }

    // ── 3. Generate PDF buffer ────────────────────────────────────────────────
    const pdfBuffer = await renderToBuffer(
      createElement(InvoicePDF, { invoice, consultant, company: COMPANY })
    );

    // ── 4. Upload PDF to Supabase Storage ────────────────────────────────────
    const pdfPath = `${consultant.consultant_id}/${invoice.invoice_no}.pdf`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from("invoices")
      .upload(pdfPath, pdfBuffer, {
        contentType: "application/pdf",
        upsert: true, // overwrite if re-sending
      });

    if (uploadError) {
      console.error("Storage upload error:", uploadError);
      // Non-fatal — continue with sending even if storage fails
    }

    // ── 5. Build Gmail RFC 2822 email with PDF attachment ─────────────────────
    const boundary = `boundary_${Date.now()}`;
    const pdfBase64 = pdfBuffer.toString("base64");

    const emailBody = [
      `To: ${COMPANY.financeEmail}`,
      `From: ${consultant.name} <${consultant.email}>`,
      `Subject: Invoice ${invoice.invoice_no} - ${consultant.name} - ${invoice.billing_period}`,
      `MIME-Version: 1.0`,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      ``,
      `--${boundary}`,
      `Content-Type: text/plain; charset="UTF-8"`,
      ``,
      `Dear Finance Team,`,
      ``,
      `Please find attached my invoice for the billing period ${invoice.billing_period}.`,
      ``,
      `Invoice No:      ${invoice.invoice_no}`,
      `Consultant:      ${consultant.name} (${consultant.consultant_id})`,
      `Net Payable:     Rs. ${(invoice.professional_fee + invoice.incentive + invoice.variable - invoice.tds + invoice.reimbursement).toLocaleString("en-IN")}`,
      ``,
      `Regards,`,
      `${consultant.name}`,
      ``,
      `--${boundary}`,
      `Content-Type: application/pdf; name="${invoice.invoice_no}.pdf"`,
      `Content-Transfer-Encoding: base64`,
      `Content-Disposition: attachment; filename="${invoice.invoice_no}.pdf"`,
      ``,
      pdfBase64,
      `--${boundary}--`,
    ].join("\r\n");

    // Gmail requires base64url encoding (URL-safe, no padding)
    const encodedEmail = Buffer.from(emailBody)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    // ── 6. Send via Gmail API ─────────────────────────────────────────────────
    const gmailResponse = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ raw: encodedEmail }),
      }
    );

    if (!gmailResponse.ok) {
      const gmailError = await gmailResponse.json();
      console.error("Gmail API error:", gmailError);

      // Mark invoice as error in DB
      await supabaseAdmin
        .from("invoices")
        .update({ status: "error" })
        .eq("id", invoiceId);

      return NextResponse.json(
        { error: "Failed to send email", details: gmailError },
        { status: 500 }
      );
    }

    // ── 7. Mark invoice as sent in Supabase ──────────────────────────────────
    const { error: updateError } = await supabaseAdmin
      .from("invoices")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
        pdf_url: pdfPath,
      })
      .eq("id", invoiceId);

    if (updateError) {
      console.error("Failed to update invoice status:", updateError);
      // Email was sent successfully — don't fail the request, just log
    }

    return NextResponse.json({
      success: true,
      invoiceNo: invoice.invoice_no,
      sentTo: COMPANY.financeEmail,
      sentFrom: consultant.email,
      pdfPath,
    });

  } catch (err) {
    console.error("Send invoice error:", err);
    return NextResponse.json(
      { error: "Internal server error", details: err.message },
      { status: 500 }
    );
  }
}
