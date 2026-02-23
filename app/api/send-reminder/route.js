// app/api/send-reminder/route.js
import { NextResponse } from "next/server";

export async function POST(request) {
  try {
    const { email, name, period, accessToken } = await request.json();

    if (!email || !name || !period) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    if (!accessToken) {
      return NextResponse.json({ error: "No Gmail access token. Please sign out and sign in again." }, { status: 401 });
    }

    // Build the email body
    const subject = `Reminder: Please submit your invoice for ${period}`;

    const bodyText = [
      `Hi ${name},`,
      "",
      `This is a friendly reminder that your invoice for ${period} is still pending.`,
      "",
      `Please log in to the Invoice Portal and submit your invoice at your earliest convenience:`,
      `${process.env.NEXT_PUBLIC_APP_URL}`,
      "",
      `If you've already submitted it, please ignore this message.`,
      "",
      `Thanks,`,
      `Finance Team`,
      `Noguilt Fitness and Nutrition Pvt. Ltd.`,
    ].join("\n");

    const bodyHtml = `
<!DOCTYPE html>
<html>
  <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
  <body style="margin:0;padding:0;background:#F8F8F8;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#F8F8F8;padding:40px 20px;">
      <tr><td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.06);">

          <!-- Header -->
          <tr>
            <td style="background:#111111;padding:28px 40px;">
              <table cellpadding="0" cellspacing="0"><tr>
                <td style="background:#E85D04;border-radius:6px;width:28px;height:28px;text-align:center;vertical-align:middle;">
                  <span style="color:#ffffff;font-size:10px;font-weight:700;font-family:monospace;line-height:28px;">NG</span>
                </td>
                <td style="padding-left:10px;">
                  <span style="color:rgba(255,255,255,0.45);font-size:13px;">Invoice Portal</span>
                </td>
              </tr></table>
            </td>
          </tr>

          <!-- Orange bar -->
          <tr><td style="background:#E85D04;height:3px;"></td></tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 32px;">
              <p style="margin:0 0 6px;color:#777777;font-size:13px;">Hi ${name},</p>
              <h1 style="margin:0 0 24px;color:#111111;font-size:26px;font-weight:400;font-family:Georgia,serif;letter-spacing:-0.3px;line-height:1.2;">
                Your invoice for<br /><span style="color:#E85D04;">${period}</span> is pending.
              </h1>
              <p style="margin:0 0 24px;color:#444444;font-size:14px;line-height:1.7;">
                We noticed your invoice for <strong>${period}</strong> hasn't been submitted yet.
                Please log in to the Invoice Portal, review your pre-filled invoice, and send it to finance at your earliest convenience.
              </p>

              <!-- CTA -->
              <table cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
                <tr>
                  <td style="background:#E85D04;border-radius:7px;">
                    <a href="${process.env.NEXT_PUBLIC_APP_URL}"
                      style="display:inline-block;padding:13px 24px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">
                      Submit Invoice →
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0;color:#999999;font-size:12px;line-height:1.6;">
                If you've already submitted your invoice, please disregard this email.<br />
                For any questions, reach out to your finance team.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#F8F8F8;padding:20px 40px;border-top:1px solid #F0F0F0;">
              <p style="margin:0;color:#AAAAAA;font-size:11px;font-family:monospace;">
                Noguilt Fitness and Nutrition Private Limited
              </p>
            </td>
          </tr>

        </table>
      </td></tr>
    </table>
  </body>
</html>`;

    // Encode email in RFC 2822 format for Gmail API
    const messageParts = [
      `To: ${email}`,
      `Subject: ${subject}`,
      `MIME-Version: 1.0`,
      `Content-Type: text/html; charset=utf-8`,
      ``,
      bodyHtml,
    ];

    const rawMessage = Buffer.from(messageParts.join("\n"))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    // Send via Gmail API using admin's OAuth token
    const gmailRes = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ raw: rawMessage }),
      }
    );

    if (!gmailRes.ok) {
      const errBody = await gmailRes.json();
      console.error("Gmail API error:", errBody);
      throw new Error(errBody?.error?.message || "Gmail API failed");
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Send reminder error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
