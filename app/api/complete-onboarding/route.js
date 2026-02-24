// app/api/complete-onboarding/route.js
// Handles the onboarding merge server-side using the service role key
// so RLS doesn't block the orphaned row deletion.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(request) {
  try {
    const { email, consultantId, pan, gstin, bankBeneficiary, bankName, bankAccount, bankIfsc, name } = await request.json();

    if (!email || !consultantId || !pan) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Check if a placeholder exists for this consultant_id
    const { data: placeholder } = await supabaseAdmin
      .from("consultants")
      .select("email, consultant_id")
      .eq("consultant_id", consultantId)
      .maybeSingle();

    if (placeholder) {
      const isPlaceholder =
        placeholder.email.startsWith("pending-") &&
        placeholder.email.endsWith("@placeholder.internal");

      // If this consultant_id is already owned by a different real account, block it
      if (!isPlaceholder && placeholder.email !== email) {
        return NextResponse.json(
          { error: `Consultant ID ${consultantId} is already registered to another account. Please contact your admin.` },
          { status: 409 }
        );
      }

      // Step 1: Delete the orphaned sign-in row FIRST (RLS bypassed by service role)
      await supabaseAdmin
        .from("consultants")
        .delete()
        .eq("email", email);

      // Step 2: Claim the placeholder by updating it with real details
      const { error: updateError } = await supabaseAdmin
        .from("consultants")
        .update({
          email,
          name,
          pan,
          gstin: gstin || null,
          bank_beneficiary: bankBeneficiary,
          bank_name: bankName,
          bank_account: bankAccount,
          bank_ifsc: bankIfsc,
        })
        .eq("consultant_id", consultantId);

      if (updateError) {
        console.error("Placeholder claim error:", updateError);
        return NextResponse.json({ error: updateError.message }, { status: 500 });
      }

    } else {
      // No placeholder — normal new hire, just update their own row
      const { error: updateError } = await supabaseAdmin
        .from("consultants")
        .update({
          consultant_id: consultantId,
          name,
          pan,
          gstin: gstin || null,
          bank_beneficiary: bankBeneficiary,
          bank_name: bankName,
          bank_account: bankAccount,
          bank_ifsc: bankIfsc,
        })
        .eq("email", email);

      if (updateError) {
        console.error("Onboarding update error:", updateError);
        return NextResponse.json({ error: updateError.message }, { status: 500 });
      }
    }

    // Return the final consultant row
    const { data: updated, error: fetchError } = await supabaseAdmin
      .from("consultants")
      .select("*, is_admin")
      .eq("email", email)
      .maybeSingle();

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }

    return NextResponse.json({ consultant: updated });

  } catch (err) {
    console.error("Complete onboarding error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
