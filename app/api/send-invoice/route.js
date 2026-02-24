// app/api/send-invoice/route.js
// Auth-protected. Verifies the caller owns the invoice before sending.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { renderToBuffer } from "@react-pdf/renderer";
import { InvoicePDF } from "@/lib/InvoicePDF";
import { createElement } from "react";
import { verifySession, AuthError } from "@/lib/auth";

const COMPANY = {
  name: "Noguilt Fitness and Nutrition Private Limited",
  address: "E-190, 2nd Floor, Industrial Area, Sector 74, Sahibzada Ajit Singh Nagar, Pin-140308",
  financeEmail: process.env.NEXT_PUBLIC_FINANCE_EMAIL,
};

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(request) {
  try {
    // 1. Verify session
    const session = await verifySession(request);

    const { invoiceId, accessToken } = await request.json();

    if (!invoiceId || !accessToken) {
      return NextResponse.json({ error: "Missing invoiceId or accessToken" }, { status: 400 });
    }

    // 2. Fetch invoice
    const { data: invoice, error: invoiceError } = await supabaseAdmin
      .from("invoices")
      .select("*")
      .eq("id", invoiceId)
      .single();

    if (invoiceError || !invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    // 3. Verify the caller owns this invoice
    if (invoice.consultant_id !== session.consultantId) {
      return NextResponse.json({ error: "You are not authorized to send this invoice" }, { status: 403 });
    }

    if (invoice.status === "sent") {
      return NextResponse.json({ error: "Invoice already sent" }, { status: 409 });
    }

    // 4. Fetch consultant
    const { data: consultant, error: consultantError } = await supabaseAdmin
      .from("consultants")
      .select("*")
      .eq("consultant_id", invoice.consultant_id)
      .single();

    if (consultantError || !consultant) {
      return NextResponse.json({ error: "Consultant not found" }, { status: 404 });
    }

    // 5. Generate PDF
    const pdfBuffer = await renderToBuffer(
      createElement(InvoicePDF, { invoice, consultant, company: COMPANY })
    );

    // 6. Upload to Supabase Storage
    const pdfPath = `${consultant.consultant_id}/${invoice.invoice_no}.pdf`;
    const { error: uploadError } = await supabaseAdmin.storage
      .from("invoices")
      .upload(pdfPath, pdfBuffer, { contentType: "application/pdf", upsert: true });

    if (uploadError) {
      console.error("Storage upload error:", uploadError);
    }

    // 7. Build and send Gmail message
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

    const encodedEmail = Buffer.from(emailBody)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

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
      await supabaseAdmin.from("invoices").update({ status: "error" }).eq("id", invoiceId);
      return NextResponse.json({ error: "Failed to send email", details: gmailError }, { status: 500 });
    }

    // 8. Mark as sent
    await supabaseAdmin
      .from("invoices")
      .update({ status: "sent", sent_at: new Date().toISOString(), pdf_url: pdfPath })
      .eq("id", invoiceId);

    return NextResponse.json({
      success: true,
      invoiceNo: invoice.invoice_no,
      sentTo: COMPANY.financeEmail,
      sentFrom: consultant.email,
      pdfPath,
    });

  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("Send invoice error:", err);
    return NextResponse.json({ error: "Internal server error", details: err.message }, { status: 500 });
  }
}