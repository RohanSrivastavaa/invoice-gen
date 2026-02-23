// app/api/download-invoice/route.js
// Generates and returns a PDF for any invoice (including pending).
// For sent invoices, fetches from Supabase Storage.
// For pending invoices, generates on the fly using the same InvoicePDF component.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { renderToBuffer } from "@react-pdf/renderer";
import { InvoicePDF } from "@/lib/InvoicePDF";
import { createElement } from "react";

const COMPANY = {
  name: "Noguilt Fitness and Nutrition Private Limited",
  address: "E-190, 2nd Floor, Industrial Area, Sector 74, Sahibzada Ajit Singh Nagar, Pin-140308",
  financeEmail: process.env.NEXT_PUBLIC_FINANCE_EMAIL,
};

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const invoiceId = searchParams.get("invoiceId");

    if (!invoiceId) {
      return NextResponse.json({ error: "Missing invoiceId" }, { status: 400 });
    }

    // Fetch invoice
    const { data: invoice, error: invoiceError } = await supabaseAdmin
      .from("invoices")
      .select("*")
      .eq("id", invoiceId)
      .single();

    if (invoiceError || !invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    // Fetch consultant
    const { data: consultant, error: consultantError } = await supabaseAdmin
      .from("consultants")
      .select("*")
      .eq("consultant_id", invoice.consultant_id)
      .single();

    if (consultantError || !consultant) {
      return NextResponse.json({ error: "Consultant not found" }, { status: 404 });
    }

    let pdfBuffer;

    // For sent/paid invoices, try fetching from storage first
    if ((invoice.status === "sent" || invoice.status === "paid") && invoice.pdf_url) {
      const { data: fileData, error: storageError } = await supabaseAdmin.storage
        .from("invoices")
        .download(invoice.pdf_url);

      if (!storageError && fileData) {
        const arrayBuffer = await fileData.arrayBuffer();
        pdfBuffer = Buffer.from(arrayBuffer);
      }
    }

    // Fall back to generating fresh (covers pending + any storage misses)
    if (!pdfBuffer) {
      pdfBuffer = await renderToBuffer(
        createElement(InvoicePDF, { invoice, consultant, company: COMPANY })
      );
    }

    return new Response(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${invoice.invoice_no}.pdf"`,
        "Content-Length": pdfBuffer.length.toString(),
      },
    });

  } catch (err) {
    console.error("Download invoice error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
