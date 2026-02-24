// app/api/send-reminder/route.js
// Admin-only. Verifies admin before sending reminder emails.

import { NextResponse } from "next/server";
import { verifyAdmin, AuthError } from "@/lib/auth";

export async function POST(request) {
  try {
    await verifyAdmin(request);

    const { email, name, period, accessToken } = await request.json();

    if (!email || !name || !period) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    if (!accessToken) {
      return NextResponse.json({ error: "No Gmail access token" }, { status: 401 });
    }

    const subject = `Reminder: Please submit your invoice for ${period}`;

    const bodyHtml = `
<!DOCTYPE html>
<html>
  <head><meta charset="utf-8" /></head>
  <body style="margin:0;padding:0;background:#F9F4F1;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#F9F4F1;padding:40px 20px;">
      <tr><td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.06);">
          <tr><td style="background:#2F313B;padding:28px 40px;">
            <span style="color:rgba(255,255,255,0.5);font-size:13px;letter-spacing:1px;">Invoice Portal</span>
          </td></tr>
          <tr><td style="background:#FF8643;height:3px;"></td></tr>
          <tr><td style="padding:40px 40px 32px;">
            <p style="margin:0 0 6px;color:#A8ACB8;font-size:13px;">Hi ${name},</p>
            <h1 style="margin:0 0 24px;color:#2F313B;font-size:26px;font-weight:600;line-height:1.2;">
              Your invoice for <span style="color:#FF8643;">${period}</span> is pending.
            </h1>
            <p style="margin:0 0 24px;color:#6B6F7A;font-size:14px;line-height:1.7;">
              We noticed your invoice for <strong>${period}</strong> hasn't been submitted yet.
              Please log in and send it to finance at your earliest convenience.
            </p>
            <table cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
              <tr><td style="background:#FF8643;border-radius:8px;">
                <a href="${process.env.NEXT_PUBLIC_APP_URL}"
                  style="display:inline-block;padding:13px 24px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">
                  Submit Invoice →
                </a>
              </td></tr>
            </table>
            <p style="margin:0;color:#A8ACB8;font-size:12px;line-height:1.6;">
              If you've already submitted your invoice, please disregard this email.
            </p>
          </td></tr>
          <tr><td style="background:#F9F4F1;padding:20px 40px;border-top:1px solid #EDE8E4;">
            <p style="margin:0;color:#A8ACB8;font-size:11px;">Noguilt Fitness and Nutrition Private Limited</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

    const rawMessage = Buffer.from([
      `To: ${email}`,
      `Subject: ${subject}`,
      `MIME-Version: 1.0`,
      `Content-Type: text/html; charset=utf-8`,
      ``,
      bodyHtml,
    ].join("\n"))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const gmailRes = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ raw: rawMessage }),
      }
    );

    if (!gmailRes.ok) {
      const errBody = await gmailRes.json();
      throw new Error(errBody?.error?.message || "Gmail API failed");
    }

    return NextResponse.json({ success: true });

  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}