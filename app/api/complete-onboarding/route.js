// app/api/complete-onboarding/route.js
// Verifies the caller is authenticated and that the email matches their session.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifySession, AuthError } from "@/lib/auth";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(request) {
  try {
    const session = await verifySession(request);
    const { email, consultantId, pan, gstin, bankBeneficiary, bankName, bankAccount, bankIfsc, name } = await request.json();

    // Ensure the email in the body matches the authenticated session
    if (email !== session.email) {
      return NextResponse.json({ error: "Email mismatch — unauthorized" }, { status: 403 });
    }

    if (!email || !consultantId || !pan) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const { data: placeholder } = await supabaseAdmin
      .from("consultants")
      .select("email, consultant_id")
      .eq("consultant_id", consultantId)
      .maybeSingle();

    if (placeholder) {
      const isPlaceholder =
        placeholder.email.startsWith("pending-") &&
        placeholder.email.endsWith("@placeholder.internal");

      if (!isPlaceholder && placeholder.email !== email) {
        return NextResponse.json(
          { error: `Consultant ID ${consultantId} is already registered to another account. Please contact your admin.` },
          { status: 409 }
        );
      }

      // Delete orphaned sign-in row first (service role bypasses RLS)
      await supabaseAdmin.from("consultants").delete().eq("email", email);

      // Claim the placeholder
      const { error: updateError } = await supabaseAdmin
        .from("consultants")
        .update({ email, name, pan, gstin: gstin || null, bank_beneficiary: bankBeneficiary, bank_name: bankName, bank_account: bankAccount, bank_ifsc: bankIfsc })
        .eq("consultant_id", consultantId);

      if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

    } else {
      // Normal flow — update their own row
      const { error: updateError } = await supabaseAdmin
        .from("consultants")
        .update({ consultant_id: consultantId, name, pan, gstin: gstin || null, bank_beneficiary: bankBeneficiary, bank_name: bankName, bank_account: bankAccount, bank_ifsc: bankIfsc })
        .eq("email", email);

      if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    const { data: updated, error: fetchError } = await supabaseAdmin
      .from("consultants").select("*, is_admin").eq("email", email).maybeSingle();

    if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 });

    return NextResponse.json({ consultant: updated });

  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}