"use client";

import { useState, useEffect, useRef } from "react";
import { supabase, signInWithGoogle, fetchUser, fetchInvoices, updateBankDetails, sendInvoice, uploadPaymentCSV, fetchAdminInvoices, markInvoicePaid, sendReminder } from "@/lib/supabase";

const COMPANY = {
  name: "Noguilt Fitness and Nutrition Private Limited",
  address: "E-190, 2nd Floor, Industrial Area, Sector 74, Sahibzada Ajit Singh Nagar, Pin-140308",
  financeEmail: process.env.NEXT_PUBLIC_FINANCE_EMAIL || "finance@noguiltfitness.com",
};

const CSV_TEMPLATE = [
  "consultant_id,email,pan,gstin,invoice_no,billing_period,professional_fee,incentive,variable,tds,reimbursement,total_days,working_days,lop_days,net_payable_days,bank_beneficiary,bank_name,bank_account,bank_ifsc",
  "C0096,krishna@fitelo.co,ABCDE1234F,,JAN26-0001,Jan'26,7000,0,0,700,0,31,31,0,31,Krishna V,HDFC Bank,1234567890,HDFC0001234",
  "C0097,priya@fitelo.co,FGHIJ5678K,,JAN26-0002,Jan'26,8500,500,0,900,0,31,30,1,30,Priya S,SBI,9876543210,SBIN0010913",
].join("\n");

function toWords(n) {
  if (n === 0) return "Zero";
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  if (n < 20) return ones[n];
  if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? " " + ones[n % 10] : "");
  if (n < 1000) return ones[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " " + toWords(n % 100) : "");
  if (n < 100000) return toWords(Math.floor(n / 1000)) + " Thousand" + (n % 1000 ? " " + toWords(n % 1000) : "");
  if (n < 10000000) return toWords(Math.floor(n / 100000)) + " Lakh" + (n % 100000 ? " " + toWords(n % 100000) : "");
  return toWords(Math.floor(n / 10000000)) + " Crore" + (n % 10000000 ? " " + toWords(n % 10000000) : "");
}

const inr = n => "₹" + Number(n).toLocaleString("en-IN");
const calcNet = inv => (inv.professional_fee || 0) + (inv.incentive || 0) + (inv.variable || 0) - (inv.tds || 0) + (inv.reimbursement || 0);

function downloadCSVTemplate() {
  const blob = new Blob([CSV_TEMPLATE], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "payment_upload_template.csv";
  a.click();
}

// ── Fitelo brand tokens ──────────────────────────────────────────────────────
const C = {
  // Primary
  orange: "#FF8643",
  orangeHover: "#F07030",
  orangeLight: "#FFF4EE",
  orangeBorder: "#FFD4B8",
  mint: "#99E8D3",
  mintLight: "#F0FDFB",
  mintBorder: "#C0F0E4",
  greyBlue: "#2F313B",
  // Neutral
  seashell: "#F9F4F1",
  peachCream: "#FFE6CF",
  pearl: "#F4EAE1",
  white: "#FFFFFF",
  // Text
  textPrimary: "#2F313B",
  textSecondary: "#6B6F7A",
  textMuted: "#A8ACB8",
  // Borders
  border: "#EDE8E4",
  borderLight: "#F3EEE9",
  // Status
  green: "#05A8AA",
  greenLight: "#F0FDFB",
  greenBorder: "#C0F0E4",
  red: "#EE7674",
  redLight: "#FFF5F5",
  redBorder: "#FCCACA",
  blue: "#2274A5",
  blueLight: "#EFF6FF",
  blueBorder: "#BFDBFE",
};

const satoshi = { fontFamily: "'Satoshi', 'DM Sans', 'Inter', sans-serif" };
const mono = { fontFamily: "'JetBrains Mono', 'Fira Code', 'IBM Plex Mono', monospace" };

const HR = ({ my = 0 }) => <div style={{ height: "1px", background: C.border, margin: `${my}px 0` }} />;

const Label = ({ children }) => (
  <div style={{ fontSize: "10px", fontWeight: "600", letterSpacing: "1.2px", color: C.textMuted, textTransform: "uppercase", marginBottom: "10px", ...satoshi }}>
    {children}
  </div>
);

function Badge({ status }) {
  const styles = {
    pending: { bg: C.orangeLight, color: C.orange, border: C.orangeBorder, text: "Pending" },
    sent: { bg: C.greenLight, color: C.green, border: C.greenBorder, text: "Sent" },
    paid: { bg: C.blueLight, color: C.blue, border: C.blueBorder, text: "Paid" },
    error: { bg: C.redLight, color: C.red, border: C.redBorder, text: "Error" },
  };
  const s = styles[status] || styles.pending;
  return (
    <span style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}`, borderRadius: "20px", padding: "3px 10px", fontSize: "11px", fontWeight: "600", ...satoshi, letterSpacing: "0.3px" }}>
      {s.text}
    </span>
  );
}

function OrangeBtn({ onClick, disabled, children, full }) {
  const [hover, setHover] = useState(false);
  return (
    <button onClick={onClick} disabled={disabled}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        width: full ? "100%" : "auto",
        background: disabled ? C.border : hover ? C.orangeHover : C.orange,
        color: C.white, border: "none", borderRadius: "10px",
        padding: "12px 22px", fontSize: "13px", fontWeight: "600",
        cursor: disabled ? "not-allowed" : "pointer", ...satoshi, transition: "all 0.15s",
        letterSpacing: "0.2px",
      }}
    >{children}</button>
  );
}

function GhostBtn({ onClick, children }) {
  return (
    <button onClick={onClick} style={{ background: "none", border: "none", color: C.textMuted, fontSize: "13px", cursor: "pointer", padding: "0", ...satoshi, display: "flex", alignItems: "center", gap: "4px", transition: "color 0.15s" }}
      onMouseEnter={e => e.currentTarget.style.color = C.textPrimary}
      onMouseLeave={e => e.currentTarget.style.color = C.textMuted}>
      {children}
    </button>
  );
}

function PDFBtn({ invoiceId, invoiceNo }) {
  const [loading, setLoading] = useState(false);
  async function handle() {
    setLoading(true);
    try {
      const res = await fetch(`/api/download-invoice?invoiceId=${invoiceId}`);
      if (!res.ok) throw new Error("Failed to generate PDF");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `Invoice-${invoiceNo}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch (err) { alert("Could not download PDF: " + err.message); }
    setLoading(false);
  }
  return (
    <button onClick={handle} disabled={loading}
      style={{ background: C.seashell, border: `1px solid ${C.border}`, borderRadius: "8px", padding: "6px 14px", fontSize: "11px", fontWeight: "600", color: loading ? C.textMuted : C.textPrimary, cursor: loading ? "wait" : "pointer", ...satoshi, transition: "all 0.15s" }}
      onMouseEnter={e => { if (!loading) e.currentTarget.style.borderColor = C.orange; }}
      onMouseLeave={e => e.currentTarget.style.borderColor = C.border}>
      {loading ? "Generating…" : "↓ PDF"}
    </button>
  );
}

// Fitelo logo mark SVG (two overlapping shapes from brand book)
function FiteloMark({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none">
      <ellipse cx="10" cy="17" rx="8" ry="10" fill={C.orange} />
      <circle cx="17" cy="11" r="8" fill={C.mint} />
      <ellipse cx="13.5" cy="14" rx="5" ry="6" fill="white" opacity="0.7" />
    </svg>
  );
}

function InvoiceDocument({ invoice, user }) {
  const net = calcNet(invoice);
  const total = (invoice.professional_fee || 0) + (invoice.incentive || 0) + (invoice.variable || 0);
  const bank = {
    beneficiaryName: invoice.bank_beneficiary || user.bank_beneficiary || "",
    bankName: invoice.bank_name || user.bank_name || "",
    accountNumber: invoice.bank_account || user.bank_account || "",
    ifscCode: invoice.bank_ifsc || user.bank_ifsc || "",
  };

  return (
    <div style={{ background: C.white, width: "620px", padding: "48px 52px", boxShadow: "0 1px 4px rgba(47,49,59,0.06), 0 8px 32px rgba(47,49,59,0.08)", borderRadius: "16px", color: C.textPrimary, fontSize: "12px", ...satoshi }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "28px" }}>
        <div>
          <div style={{ fontSize: "32px", fontWeight: "700", color: C.textPrimary, lineHeight: 1, letterSpacing: "-0.5px" }}>Invoice</div>
          <div style={{ color: C.textMuted, fontSize: "12px", ...mono, marginTop: "6px" }}>{invoice.invoice_no}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ display: "inline-block", background: C.orangeLight, color: C.orange, border: `1px solid ${C.orangeBorder}`, borderRadius: "20px", padding: "5px 14px", fontSize: "12px", fontWeight: "600", marginBottom: "4px" }}>{invoice.billing_period}</div>
          <div style={{ color: C.textMuted, fontSize: "11px" }}>Billing Period</div>
        </div>
      </div>
      <HR />
      <div style={{ height: "20px" }} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "32px", marginBottom: "24px" }}>
        <div>
          <Label>From</Label>
          <div style={{ fontWeight: "600", marginBottom: "6px", fontSize: "13px" }}>{user.name}</div>
          <div style={{ color: C.textSecondary, lineHeight: "1.7", fontSize: "12px" }}>
            <div>PAN: <span style={{ ...mono, color: C.textPrimary }}>{user.pan}</span></div>
            {user.gstin && <div>GSTIN: <span style={{ ...mono, color: C.textPrimary }}>{user.gstin}</span></div>}
            <div>ID: <span style={{ ...mono, color: C.orange }}>{user.consultant_id || invoice.consultant_id}</span></div>
          </div>
        </div>
        <div>
          <Label>Bill To</Label>
          <div style={{ fontWeight: "600", marginBottom: "6px", fontSize: "13px" }}>{COMPANY.name}</div>
          <div style={{ color: C.textSecondary, lineHeight: "1.7", fontSize: "12px" }}>{COMPANY.address}</div>
        </div>
      </div>
      <div style={{ background: C.seashell, border: `1px solid ${C.borderLight}`, borderRadius: "10px", padding: "16px 20px", marginBottom: "24px" }}>
        <Label>Service Days Summary</Label>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", textAlign: "center" }}>
          {[["Total Days", invoice.total_days], ["Working Days", invoice.working_days], ["LOP Days", invoice.lop_days], ["Net Payable Days", invoice.net_payable_days]].map(([l, v]) => (
            <div key={l}>
              <div style={{ fontSize: "22px", fontWeight: "700", color: C.textPrimary }}>{v || 0}</div>
              <div style={{ fontSize: "10px", color: C.textMuted, marginTop: "2px" }}>{l}</div>
            </div>
          ))}
        </div>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "12px" }}>
        <thead>
          <tr style={{ borderBottom: `1.5px solid ${C.textPrimary}` }}>
            <th style={{ textAlign: "left", padding: "8px 0", fontSize: "10px", fontWeight: "600", letterSpacing: "1px", color: C.textMuted, textTransform: "uppercase" }}>Description</th>
            <th style={{ textAlign: "right", padding: "8px 0", fontSize: "10px", fontWeight: "600", letterSpacing: "1px", color: C.textMuted, textTransform: "uppercase" }}>Amount (₹)</th>
          </tr>
        </thead>
        <tbody>
          {[["Professional Fee", invoice.professional_fee || 0], ["Incentive", invoice.incentive || 0], ["Variable / Bonus / Referral", invoice.variable || 0]].map(([l, v]) => (
            <tr key={l} style={{ borderBottom: `1px solid ${C.borderLight}` }}>
              <td style={{ padding: "10px 0", color: C.textSecondary }}>{l}</td>
              <td style={{ padding: "10px 0", textAlign: "right", ...mono }}>{v.toLocaleString("en-IN")}</td>
            </tr>
          ))}
          <tr style={{ borderBottom: `1px solid ${C.borderLight}` }}>
            <td style={{ padding: "10px 0", fontWeight: "600" }}>Total Amount</td>
            <td style={{ padding: "10px 0", textAlign: "right", fontWeight: "600", ...mono }}>{total.toLocaleString("en-IN")}</td>
          </tr>
          <tr style={{ borderBottom: `1px solid ${C.borderLight}` }}>
            <td style={{ padding: "10px 0", color: C.red }}>TDS @ 10%</td>
            <td style={{ padding: "10px 0", textAlign: "right", color: C.red, ...mono }}>({(invoice.tds || 0).toLocaleString("en-IN")})</td>
          </tr>
          <tr style={{ borderBottom: `1px solid ${C.borderLight}` }}>
            <td style={{ padding: "10px 0", color: C.textSecondary }}>Reimbursement</td>
            <td style={{ padding: "10px 0", textAlign: "right", ...mono }}>{(invoice.reimbursement || 0).toLocaleString("en-IN")}</td>
          </tr>
        </tbody>
      </table>
      <div style={{ background: C.greyBlue, color: C.white, padding: "16px 20px", borderRadius: "10px", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
        <span style={{ fontWeight: "600", fontSize: "14px" }}>Net Payable</span>
        <span style={{ fontWeight: "700", fontSize: "20px", ...mono }}>{net.toLocaleString("en-IN")}</span>
      </div>
      <div style={{ color: C.textMuted, fontSize: "11px", fontStyle: "italic", marginBottom: "24px" }}>{toWords(net)} Rupees Only</div>
      <HR />
      <div style={{ height: "20px" }} />
      <Label>Bank Details</Label>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", marginBottom: "32px" }}>
        {[["Beneficiary Name", bank.beneficiaryName], ["Bank Name", bank.bankName], ["Account Number", bank.accountNumber], ["IFSC Code", bank.ifscCode]].map(([l, v]) => (
          <div key={l}>
            <div style={{ fontSize: "10px", color: C.textMuted, marginBottom: "2px" }}>{l}</div>
            <div style={{ fontWeight: "600", ...mono, fontSize: "12px" }}>{v || "—"}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ width: "150px", height: "52px", borderBottom: `1px solid ${C.border}` }} />
          <div style={{ fontSize: "10px", color: C.textMuted, marginTop: "6px" }}>Consultant Signature</div>
        </div>
      </div>
    </div>
  );
}

function LoginScreen({ onLogin }) {
  const [hover, setHover] = useState(false);
  return (
    <div style={{ minHeight: "100vh", display: "flex", background: C.seashell, ...satoshi }}>
      {/* Left panel */}
      <div style={{ width: "420px", background: C.greyBlue, display: "flex", flexDirection: "column", justifyContent: "center", padding: "48px", flexShrink: 0, position: "relative", overflow: "hidden" }}>
        {/* Subtle brand orb */}
        <div style={{ position: "absolute", top: "-60px", right: "-60px", width: "220px", height: "220px", background: C.orange, borderRadius: "50%", opacity: 0.12, filter: "blur(40px)" }} />
        <div style={{ position: "absolute", bottom: "80px", left: "-40px", width: "160px", height: "160px", background: C.mint, borderRadius: "50%", opacity: 0.15, filter: "blur(30px)" }} />
        <div style={{ position: "relative", zIndex: 1 }}>
          <div style={{ fontSize: "40px", fontWeight: "700", color: C.white, lineHeight: "1.15", marginBottom: "16px", letterSpacing: "-0.5px" }}>
            Your invoices,<br />done in<br /><span style={{ color: C.orange }}>seconds.</span>
          </div>
          <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "14px", lineHeight: "1.7" }}>
            Log in each month, review your pre-filled invoice, and send it to finance with one click.
          </div>
        </div>
        <div />
      </div>
      {/* Right panel */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "48px" }}>
        <div style={{ width: "340px" }}>
          <div style={{ fontSize: "26px", fontWeight: "700", color: C.textPrimary, marginBottom: "6px", letterSpacing: "-0.3px" }}>Sign in</div>
          <div style={{ color: C.textMuted, fontSize: "14px", marginBottom: "32px" }}>Use your work Google account to continue.</div>
          <button onClick={onLogin} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
            style={{ width: "100%", background: C.white, border: `1.5px solid ${hover ? C.orange : C.border}`, borderRadius: "12px", padding: "13px 20px", display: "flex", alignItems: "center", justifyContent: "center", gap: "12px", fontSize: "14px", fontWeight: "500", color: C.textPrimary, cursor: "pointer", ...satoshi, transition: "all 0.15s", boxShadow: hover ? `0 0 0 3px ${C.orangeLight}` : "none" }}>
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Continue with Google
          </button>
          <div style={{ marginTop: "20px", padding: "14px 16px", background: C.orangeLight, border: `1px solid ${C.orangeBorder}`, borderRadius: "10px", fontSize: "12px", color: C.textSecondary, lineHeight: "1.6" }}>
            <strong style={{ color: C.orange }}>Note:</strong> This app will request Gmail permission to send invoices on your behalf.
          </div>
        </div>
      </div>
    </div>
  );
}

function NotSetUpScreen({ user, onSignOut }) {
  return (
    <div style={{ minHeight: "100vh", background: C.seashell, display: "flex", alignItems: "center", justifyContent: "center", ...satoshi }}>
      <div style={{ width: "100%", maxWidth: "420px", textAlign: "center", padding: "32px 24px" }}>
        <FiteloMark size={40} />
        <div style={{ fontSize: "22px", fontWeight: "700", color: C.textPrimary, marginTop: "20px", marginBottom: "8px", letterSpacing: "-0.3px" }}>Account not set up yet</div>
        <div style={{ fontSize: "14px", color: C.textMuted, lineHeight: "1.7", marginBottom: "28px" }}>
          Your account hasn&#39;t been configured in the system yet. Please contact your admin — once they upload your details, your invoice will be ready on your next login.
        </div>
        <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: "10px", padding: "12px 16px", marginBottom: "24px", fontSize: "12px", color: C.textMuted, ...mono }}>
          Signed in as <span style={{ color: C.textPrimary }}>{user?.email}</span>
        </div>
        <button onClick={onSignOut} style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: "10px", padding: "10px 20px", fontSize: "13px", color: C.textSecondary, cursor: "pointer", ...satoshi, transition: "all 0.15s" }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = C.orange; e.currentTarget.style.color = C.orange; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.textSecondary; }}>
          Sign out
        </button>
      </div>
    </div>
  );
}

function Topbar({ user, isAdmin, onProfile, darkMode, onToggleDark }) {
  return (
    <div style={{ height: "56px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 32px", background: C.white, position: "sticky", top: 0, zIndex: 50 }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <FiteloMark size={26} />
        <span style={{ color: C.textSecondary, fontSize: "13px", fontWeight: "500", ...satoshi }}>Invoice Portal</span>
        {isAdmin && <span style={{ background: C.greyBlue, color: C.white, fontSize: "10px", borderRadius: "20px", padding: "2px 8px", ...satoshi, letterSpacing: "0.5px", fontWeight: "600" }}>ADMIN</span>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        {user && !isAdmin && <span style={{ fontSize: "12px", color: C.textMuted, ...mono }}>{user.consultant_id}</span>}
        <button onClick={onToggleDark} title="Toggle dark mode"
          style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: "8px", padding: "5px 10px", cursor: "pointer", fontSize: "13px", lineHeight: 1, transition: "border-color 0.15s" }}
          onMouseEnter={e => e.currentTarget.style.borderColor = C.orange}
          onMouseLeave={e => e.currentTarget.style.borderColor = C.border}>
          {darkMode ? "☀️" : "🌙"}
        </button>
        {user && (
          <button onClick={onProfile} style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}>
            <div style={{ width: "32px", height: "32px", background: `linear-gradient(135deg, ${C.orange}, ${C.mint})`, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ color: C.white, fontSize: "12px", fontWeight: "700", ...satoshi }}>{user.name?.charAt(0) || "?"}</span>
            </div>
          </button>
        )}
      </div>
    </div>
  );
}

function Dashboard({ user, invoices, onOpen }) {
  const [tab, setTab] = useState("pending");
  const pending = invoices.filter(i => i.status === "pending");
  const sent = invoices.filter(i => i.status === "sent");
  const list = tab === "pending" ? pending : sent;

  return (
    <div style={{ maxWidth: "700px", margin: "0 auto", padding: "44px 24px", ...satoshi }}>
      <div style={{ marginBottom: "36px" }}>
        <div style={{ color: C.textMuted, fontSize: "13px", marginBottom: "4px" }}>Good day,</div>
        <div style={{ fontSize: "36px", fontWeight: "700", color: C.textPrimary, letterSpacing: "-0.5px" }}>{user.name}</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px", marginBottom: "36px" }}>
        {[{ label: "Pending", value: pending.length, highlight: pending.length > 0 }, { label: "Sent", value: sent.length }, { label: "Consultant ID", value: user.consultant_id, isMono: true }].map(({ label, value, highlight, isMono }) => (
          <div key={label} style={{ border: `1px solid ${highlight ? C.orangeBorder : C.border}`, background: highlight ? C.orangeLight : C.white, borderRadius: "12px", padding: "18px 20px" }}>
            <div style={{ fontSize: "10px", fontWeight: "600", letterSpacing: "1px", color: highlight ? C.orange : C.textMuted, textTransform: "uppercase", marginBottom: "6px" }}>{label}</div>
            <div style={{ fontSize: isMono ? "14px" : "26px", fontWeight: "700", color: highlight ? C.orange : C.textPrimary, ...(isMono ? mono : {}) }}>{value}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", borderBottom: `1px solid ${C.border}`, marginBottom: "20px" }}>
        {[["pending", "Pending"], ["sent", "History"]].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} style={{ background: "none", border: "none", cursor: "pointer", padding: "10px 16px", fontSize: "13px", fontWeight: "600", color: tab === key ? C.textPrimary : C.textMuted, borderBottom: `2px solid ${tab === key ? C.orange : "transparent"}`, marginBottom: "-1px", ...satoshi, transition: "color 0.15s" }}>{label}</button>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {list.length === 0 && (
          <div style={{ textAlign: "center", padding: "60px 0", color: C.textMuted, fontSize: "14px" }}>
            {tab === "pending" ? "No pending invoices — you're all caught up." : "No invoices sent yet."}
          </div>
        )}
        {list.map(inv => {
          const net = calcNet(inv);
          return (
            <div key={inv.id} onClick={() => onOpen(inv)}
              style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: "12px", padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", transition: "all 0.15s" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = C.orange; e.currentTarget.style.boxShadow = `0 0 0 3px ${C.orangeLight}`; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.boxShadow = "none"; }}>
              <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                <div style={{ width: "40px", height: "40px", background: inv.status === "pending" ? C.orangeLight : C.seashell, borderRadius: "10px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px", flexShrink: 0 }}>
                  {inv.status === "pending" ? "📄" : "✓"}
                </div>
                <div>
                  <div style={{ fontWeight: "600", fontSize: "14px", color: C.textPrimary, marginBottom: "2px" }}>{inv.billing_period}</div>
                  <div style={{ fontSize: "11px", color: C.textMuted, ...mono }}>{inv.invoice_no}{inv.sent_at ? ` · Sent ${inv.sent_at.slice(0, 10)}` : ""}</div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontWeight: "700", fontSize: "15px", color: C.textPrimary, ...mono }}>{inr(net)}</div>
                  <div style={{ fontSize: "10px", color: C.textMuted }}>net payable</div>
                </div>
                <Badge status={inv.status} />
                <span style={{ color: C.orange, fontSize: "16px" }}>→</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function InvoiceScreen({ invoice, user, onBack, onSent, onUpdate }) {
  const [state, setState] = useState("idle");
  const [isEditing, setIsEditing] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [draft, setDraft] = useState(invoice);
  useEffect(() => { setDraft(invoice); }, [invoice]);
  const net = calcNet(draft);

  async function handleSend() {
    setState("sending");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await sendInvoice(draft.id, session?.provider_token);
      setState("sent"); setTimeout(onSent, 2000);
    } catch (err) { console.error("Send error:", err); setState("error"); }
  }

  async function saveEdits() {
    setSavingEdit(true);
    try {
      const updates = { professional_fee: Number(draft.professional_fee) || 0, incentive: Number(draft.incentive) || 0, variable: Number(draft.variable) || 0, tds: Number(draft.tds) || 0, reimbursement: Number(draft.reimbursement) || 0, working_days: Number(draft.working_days) || 0, lop_days: Number(draft.lop_days) || 0, net_payable_days: (Number(draft.working_days) || 0) - (Number(draft.lop_days) || 0) };
      const { error } = await supabase.from("invoices").update(updates).eq("id", draft.id);
      if (error) throw error;
      setIsEditing(false);
      if (onUpdate) onUpdate({ ...draft, ...updates });
    } catch (err) { alert("Error saving edits: " + err.message); }
    setSavingEdit(false);
  }

  const inputStyle = { width: "70px", padding: "5px 8px", border: `1px solid ${C.border}`, borderRadius: "7px", fontSize: "12px", ...mono, textAlign: "right", outline: "none", transition: "border-color 0.15s" };

  return (
    <div style={{ display: "flex", minHeight: "calc(100vh - 56px)", background: C.seashell, ...satoshi }}>
      <div style={{ flex: 1, overflow: "auto", padding: "36px 32px", display: "flex", justifyContent: "center", alignItems: "flex-start" }}>
        <div id="invoice-document"><InvoiceDocument invoice={draft} user={user} /></div>
      </div>
      <div style={{ width: "320px", background: C.white, borderLeft: `1px solid ${C.border}`, padding: "28px 24px", display: "flex", flexDirection: "column", flexShrink: 0, overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <GhostBtn onClick={onBack}>← Back</GhostBtn>
          <PDFBtn invoiceId={draft.id} invoiceNo={draft.invoice_no} />
        </div>
        <div style={{ marginTop: "20px", marginBottom: "4px", fontSize: "20px", fontWeight: "700", color: C.textPrimary, letterSpacing: "-0.3px" }}>{draft.billing_period}</div>
        <div style={{ fontSize: "11px", color: C.textMuted, ...mono, marginBottom: "24px" }}>{draft.invoice_no}</div>
        <HR /><div style={{ height: "20px" }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
          <Label>Summary</Label>
          {invoice.status === "pending" && !isEditing && (
            <button onClick={() => setIsEditing(true)} style={{ background: "none", border: "none", color: C.orange, fontSize: "11px", fontWeight: "600", cursor: "pointer", ...satoshi }}>Edit</button>
          )}
        </div>
        {isEditing ? (
          <div style={{ background: C.orangeLight, padding: "16px", borderRadius: "12px", border: `1px solid ${C.orangeBorder}`, marginBottom: "24px" }}>
            {[["Prof. Fee", "professional_fee"], ["Incentive", "incentive"], ["Variable", "variable"], ["TDS Deducted", "tds"], ["Reimbursement", "reimbursement"], ["Working Days", "working_days"], ["LOP Days", "lop_days"]].map(([l, key]) => (
              <div key={key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                <span style={{ fontSize: "11px", color: C.textSecondary, fontWeight: "500" }}>{l}</span>
                <input type="number" value={draft[key] || ""} onChange={e => setDraft({ ...draft, [key]: e.target.value })} style={inputStyle} onFocus={e => e.target.style.borderColor = C.orange} onBlur={e => e.target.style.borderColor = C.border} />
              </div>
            ))}
            <div style={{ display: "flex", gap: "8px", marginTop: "16px" }}>
              <button onClick={() => { setDraft(invoice); setIsEditing(false); }} style={{ flex: 1, padding: "8px", background: C.white, border: `1px solid ${C.border}`, borderRadius: "8px", cursor: "pointer", fontSize: "12px", ...satoshi }}>Cancel</button>
              <button onClick={saveEdits} disabled={savingEdit} style={{ flex: 1, padding: "8px", background: C.orange, color: C.white, border: "none", borderRadius: "8px", cursor: savingEdit ? "wait" : "pointer", fontSize: "12px", fontWeight: "600", ...satoshi }}>{savingEdit ? "Saving…" : "Save"}</button>
            </div>
          </div>
        ) : (
          <div style={{ marginBottom: "24px" }}>
            {[["Professional Fee", inr(draft.professional_fee || 0)], ["Incentive", inr(draft.incentive || 0)], ["Variable / Bonus", inr(draft.variable || 0)], ["TDS Deducted", `- ${inr(draft.tds || 0)}`], ["Reimbursement", inr(draft.reimbursement || 0)]].map(([l, v]) => (
              <div key={l} style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                <span style={{ fontSize: "12px", color: C.textMuted }}>{l}</span>
                <span style={{ fontSize: "12px", color: C.textPrimary, ...mono }}>{v}</span>
              </div>
            ))}
            <HR my={12} />
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontWeight: "700", fontSize: "14px" }}>Net Payable</span>
              <span style={{ fontWeight: "700", fontSize: "14px", color: C.orange, ...mono }}>{inr(net)}</span>
            </div>
          </div>
        )}
        {invoice.status === "pending" && (
          <>
            <HR /><div style={{ height: "20px" }} />
            {[["Sending to", COMPANY.financeEmail, "Finance Team"], ["Sending from", user.email, "Your Gmail"]].map(([label, email, sub]) => (
              <div key={label} style={{ marginBottom: "14px" }}>
                <Label>{label}</Label>
                <div style={{ background: C.seashell, border: `1px solid ${C.border}`, borderRadius: "8px", padding: "10px 12px" }}>
                  <div style={{ fontSize: "10px", color: C.textMuted, marginBottom: "2px" }}>{sub}</div>
                  <div style={{ fontSize: "12px", color: C.textPrimary, ...mono }}>{email}</div>
                </div>
              </div>
            ))}
            <div style={{ marginTop: "auto" }}>
              {state === "sent" ? (
                <div style={{ background: C.greenLight, border: `1px solid ${C.greenBorder}`, borderRadius: "10px", padding: "16px", textAlign: "center", color: C.green, fontWeight: "600", fontSize: "14px" }}>✓ Invoice Sent!</div>
              ) : state === "error" ? (
                <div style={{ background: C.redLight, border: `1px solid ${C.redBorder}`, borderRadius: "10px", padding: "16px", textAlign: "center", color: C.red, fontSize: "13px" }}>
                  Failed to send. Please try again.
                  <div style={{ marginTop: "10px" }}><OrangeBtn onClick={() => setState("idle")} full>Retry</OrangeBtn></div>
                </div>
              ) : (
                <OrangeBtn onClick={handleSend} disabled={state === "sending" || isEditing} full>{state === "sending" ? "Sending…" : "Send Invoice →"}</OrangeBtn>
              )}
              <div style={{ fontSize: "11px", color: C.textMuted, textAlign: "center", marginTop: "10px" }}>Stored in your history after sending</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ProfileDrawer({ user, onClose, onSignOut }) {
  const [form, setForm] = useState({ beneficiaryName: user.bank_beneficiary || "", bankName: user.bank_name || "", accountNumber: user.bank_account || "", ifscCode: user.bank_ifsc || "" });
  const [saved, setSaved] = useState(false);
  async function handleSave() { await updateBankDetails(user.consultant_id, form); setSaved(true); setTimeout(() => setSaved(false), 2500); }

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(47,49,59,0.2)", zIndex: 99, backdropFilter: "blur(2px)" }} />
      <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: "340px", background: C.white, borderLeft: `1px solid ${C.border}`, zIndex: 100, padding: "28px 24px", display: "flex", flexDirection: "column", ...satoshi }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
          <div>
            <div style={{ fontWeight: "700", fontSize: "16px", color: C.textPrimary }}>{user.name}</div>
            <div style={{ fontSize: "12px", color: C.textMuted, marginTop: "2px" }}>{user.email}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: "8px", cursor: "pointer", color: C.textMuted, fontSize: "16px", lineHeight: 1, width: "32px", height: "32px", display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
        </div>
        <div style={{ display: "flex", gap: "8px", marginBottom: "24px" }}>
          {[["ID", user.consultant_id], ["PAN", user.pan]].map(([l, v]) => (
            <div key={l} style={{ flex: 1, background: C.seashell, border: `1px solid ${C.border}`, borderRadius: "10px", padding: "10px 12px" }}>
              <div style={{ fontSize: "10px", color: C.textMuted, marginBottom: "3px", letterSpacing: "0.5px" }}>{l}</div>
              <div style={{ fontSize: "12px", fontWeight: "600", ...mono, color: C.textPrimary }}>{v}</div>
            </div>
          ))}
        </div>
        <HR my={0} /><div style={{ height: "20px" }} />
        <Label>Bank Details (Fallback)</Label>
        <div style={{ fontSize: "11px", color: C.textMuted, marginBottom: "16px", lineHeight: "1.6" }}>Used when bank details are not provided in the monthly CSV.</div>
        {[["Beneficiary Name", "beneficiaryName"], ["Bank Name", "bankName"], ["Account Number", "accountNumber"], ["IFSC Code", "ifscCode"]].map(([label, key]) => (
          <div key={key} style={{ marginBottom: "12px" }}>
            <label style={{ fontSize: "11px", color: C.textSecondary, fontWeight: "600", display: "block", marginBottom: "4px" }}>{label}</label>
            <input type="text" value={form[key] || ""} onChange={e => setForm({ ...form, [key]: e.target.value })}
              style={{ width: "100%", padding: "9px 11px", border: `1px solid ${C.border}`, borderRadius: "8px", fontSize: "12px", color: C.textPrimary, background: C.white, ...mono, boxSizing: "border-box", outline: "none", transition: "border-color 0.15s" }}
              onFocus={e => e.target.style.borderColor = C.orange} onBlur={e => e.target.style.borderColor = C.border} />
          </div>
        ))}
        <button onClick={handleSave} style={{ width: "100%", background: saved ? C.green : C.greyBlue, color: C.white, border: "none", borderRadius: "10px", padding: "12px", fontSize: "13px", fontWeight: "600", cursor: "pointer", ...satoshi, transition: "background 0.3s", marginTop: "8px" }}>
          {saved ? "✓ Saved" : "Save Details"}
        </button>
        <div style={{ marginTop: "auto" }}>
          <HR my={20} />
          <button onClick={onSignOut} style={{ background: "none", border: "none", color: C.red, fontSize: "13px", cursor: "pointer", padding: 0, ...satoshi }}>Sign out</button>
        </div>
      </div>
    </>
  );
}

// ─── Admin Screen ─────────────────────────────────────────────────────────────
function AdminScreen() {
  const [tab, setTab] = useState("overview");
  const [allInvoices, setAllInvoices] = useState([]);
  const [loadingInvoices, setLoadingInvoices] = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const [filter, setFilter] = useState("all");
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [reminderSending, setReminderSending] = useState({});
  const [reminderSent, setReminderSent] = useState({});
  const [allConsultants, setAllConsultants] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const fileRef = useRef();

  useEffect(() => { if (tab === "overview" || tab === "consultants") fetchAllInvoices(); }, [tab]);

  async function fetchAllInvoices() {
    setLoadingInvoices(true); setFetchError(null);
    try {
      const json = await fetchAdminInvoices();
      setAllInvoices(json.invoices);
      setAllConsultants(json.consultants || []);
    } catch (err) { setFetchError(err.message); }
    setLoadingInvoices(false);
  }

  async function handleMarkPaid(invoiceId) {
    try {
      await markInvoicePaid(invoiceId);
      setAllInvoices(prev => prev.map(i => i.id === invoiceId ? { ...i, status: "paid" } : i));
      if (selectedInvoice?.id === invoiceId) setSelectedInvoice(s => ({ ...s, status: "paid" }));
    } catch (err) { alert("Error: " + err.message); }
  }

  async function handleSendReminder(inv) {
    setReminderSending(s => ({ ...s, [inv.id]: true }));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await sendReminder(inv.consultant_email, inv.consultant_name, inv.billing_period, session?.provider_token);
      setReminderSent(s => ({ ...s, [inv.id]: true }));
      setTimeout(() => setReminderSent(s => ({ ...s, [inv.id]: false })), 3000);
    } catch (err) { alert("Could not send reminder: " + err.message); }
    setReminderSending(s => ({ ...s, [inv.id]: false }));
  }

  async function processFile(f) {
    setFile(f); setResult(null); setUploadError(null); setUploading(true);
    try { const res = await uploadPaymentCSV(f); setResult(res); } catch (e) { setUploadError(e.message); }
    setUploading(false);
  }

  const filtered = filter === "all" ? allInvoices : allInvoices.filter(i => i.status === filter);
  const totalPayout = allInvoices.reduce((sum, i) => sum + calcNet(i), 0);
  const pendingCount = allInvoices.filter(i => i.status === "pending").length;
  const sentCount = allInvoices.filter(i => i.status === "sent").length;
  const paidCount = allInvoices.filter(i => i.status === "paid").length;

  const thStyle = { padding: "11px 16px", textAlign: "left", fontSize: "10px", fontWeight: "600", color: C.textMuted, letterSpacing: "1px", textTransform: "uppercase", whiteSpace: "nowrap", ...satoshi };
  const tdStyle = { padding: "12px 16px", ...satoshi };

  if (selectedInvoice) {
    return (
      <div style={{ display: "flex", minHeight: "calc(100vh - 56px)", background: C.seashell, ...satoshi }}>
        <div style={{ flex: 1, overflow: "auto", padding: "36px 32px", display: "flex", justifyContent: "center", alignItems: "flex-start" }}>
          <div id="invoice-document">
            <InvoiceDocument invoice={selectedInvoice} user={{ name: selectedInvoice.consultant_name, pan: selectedInvoice.consultant_pan, consultant_id: selectedInvoice.consultant_id }} />
          </div>
        </div>
        <div style={{ width: "320px", background: C.white, borderLeft: `1px solid ${C.border}`, padding: "28px 24px", display: "flex", flexDirection: "column", flexShrink: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <GhostBtn onClick={() => setSelectedInvoice(null)}>← Back</GhostBtn>
            <PDFBtn invoiceId={selectedInvoice.id} invoiceNo={selectedInvoice.invoice_no} />
          </div>
          <div style={{ marginTop: "20px", marginBottom: "4px", fontSize: "20px", fontWeight: "700", color: C.textPrimary, letterSpacing: "-0.3px" }}>{selectedInvoice.billing_period}</div>
          <div style={{ fontSize: "11px", color: C.textMuted, ...mono, marginBottom: "2px" }}>{selectedInvoice.invoice_no}</div>
          <div style={{ fontSize: "12px", color: C.textSecondary, marginBottom: "20px" }}>{selectedInvoice.consultant_name}</div>
          <HR /><div style={{ height: "20px" }} />
          <Label>Breakdown</Label>
          {[["Professional Fee", inr(selectedInvoice.professional_fee || 0)], ["Incentive", inr(selectedInvoice.incentive || 0)], ["Variable", inr(selectedInvoice.variable || 0)], ["TDS", `- ${inr(selectedInvoice.tds || 0)}`], ["Reimbursement", inr(selectedInvoice.reimbursement || 0)]].map(([l, v]) => (
            <div key={l} style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
              <span style={{ fontSize: "12px", color: C.textMuted }}>{l}</span>
              <span style={{ fontSize: "12px", ...mono }}>{v}</span>
            </div>
          ))}
          <HR my={12} />
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "24px" }}>
            <span style={{ fontWeight: "700" }}>Net Payable</span>
            <span style={{ fontWeight: "700", color: C.orange, ...mono }}>{inr(calcNet(selectedInvoice))}</span>
          </div>
          <div style={{ marginBottom: "20px" }}><Label>Status</Label><Badge status={selectedInvoice.status} /></div>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "auto" }}>
            {selectedInvoice.status === "sent" && <OrangeBtn onClick={() => handleMarkPaid(selectedInvoice.id)} full>✓ Mark as Paid</OrangeBtn>}
            {selectedInvoice.status === "pending" && (
              <button onClick={() => handleSendReminder(selectedInvoice)}
                style={{ width: "100%", background: reminderSent[selectedInvoice.id] ? C.green : C.greyBlue, color: C.white, border: "none", borderRadius: "10px", padding: "13px", fontSize: "13px", fontWeight: "600", cursor: "pointer", ...satoshi, transition: "background 0.3s" }}>
                {reminderSent[selectedInvoice.id] ? "✓ Reminder Sent" : reminderSending[selectedInvoice.id] ? "Sending…" : "Send Reminder →"}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...satoshi }}>
      {/* Tab bar */}
      <div style={{ borderBottom: `1px solid ${C.border}`, display: "flex", padding: "0 32px", background: C.white }}>
        {[["overview", "Overview"], ["consultants", "Consultants"], ["upload", "Upload CSV"]].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} style={{ background: "none", border: "none", cursor: "pointer", padding: "14px 16px", fontSize: "13px", fontWeight: "600", color: tab === key ? C.textPrimary : C.textMuted, borderBottom: `2px solid ${tab === key ? C.orange : "transparent"}`, marginBottom: "-1px", ...satoshi, transition: "color 0.15s" }}>
            {label}
          </button>
        ))}
      </div>

      {/* Upload tab */}
      {tab === "upload" && (
        <div style={{ maxWidth: "720px", margin: "0 auto", padding: "36px 24px" }}>
          <div style={{ marginBottom: "32px" }}>
            <div style={{ fontSize: "28px", fontWeight: "700", color: C.textPrimary, marginBottom: "6px", letterSpacing: "-0.3px" }}>Monthly Upload</div>
            <div style={{ color: C.textMuted, fontSize: "14px" }}>Upload the payroll CSV to pre-fill invoices for all consultants this month.</div>
          </div>
          <div onDragOver={e => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); e.dataTransfer.files[0] && processFile(e.dataTransfer.files[0]); }}
            onClick={() => fileRef.current.click()}
            style={{ border: `2px dashed ${dragOver ? C.orange : C.border}`, background: dragOver ? C.orangeLight : C.white, borderRadius: "14px", padding: "48px", textAlign: "center", cursor: "pointer", transition: "all 0.15s", marginBottom: "20px" }}>
            <input ref={fileRef} type="file" accept=".csv" style={{ display: "none" }} onChange={e => e.target.files[0] && processFile(e.target.files[0])} />
            <div style={{ fontSize: "28px", marginBottom: "10px" }}>📁</div>
            <div style={{ fontWeight: "600", fontSize: "14px", color: C.textPrimary, marginBottom: "4px" }}>{file ? file.name : "Drop CSV here or click to browse"}</div>
            <div style={{ fontSize: "12px", color: C.textMuted }}>Accepts .csv files only</div>
          </div>
          {uploading && <div style={{ background: C.orangeLight, border: `1px solid ${C.orangeBorder}`, borderRadius: "10px", padding: "14px 18px", color: C.orange, fontWeight: "600", marginBottom: "16px" }}>Processing CSV…</div>}
          {uploadError && <div style={{ background: C.redLight, border: `1px solid ${C.redBorder}`, borderRadius: "10px", padding: "14px 18px", color: C.red, marginBottom: "16px" }}><strong>Error:</strong> {uploadError}</div>}
          {result && (
            <div style={{ background: C.greenLight, border: `1px solid ${C.greenBorder}`, borderRadius: "10px", padding: "14px 18px", marginBottom: "20px" }}>
              <div style={{ color: C.green, fontWeight: "700", marginBottom: "2px" }}>✓ Upload successful</div>
              <div style={{ color: C.textSecondary, fontSize: "13px" }}>{result.count} invoice(s) created and ready for review.</div>
            </div>
          )}
          {result?.rows?.length > 0 && (
            <div style={{ marginBottom: "28px", border: `1px solid ${C.border}`, borderRadius: "12px", overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                <thead style={{ background: C.seashell }}>
                  <tr>{["Consultant ID", "Invoice No", "Period", "Prof. Fee", "TDS", "Net Payable"].map(h => <th key={h} style={thStyle}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {result.rows.map((row, i) => {
                    const fee = +row.professional_fee || 0, inc = +row.incentive || 0, vari = +row.variable || 0, tds = +row.tds || 0, reimb = +row.reimbursement || 0;
                    const net = fee + inc + vari - tds + reimb;
                    return (
                      <tr key={i} style={{ borderTop: `1px solid ${C.border}` }}>
                        <td style={{ ...tdStyle, ...mono, color: C.orange, fontWeight: "600" }}>{row.consultant_id}</td>
                        <td style={{ ...tdStyle, ...mono }}>{row.invoice_no}</td>
                        <td style={tdStyle}>{row.billing_period}</td>
                        <td style={{ ...tdStyle, ...mono }}>{inr(fee)}</td>
                        <td style={{ ...tdStyle, ...mono, color: C.red }}>-{inr(tds)}</td>
                        <td style={{ ...tdStyle, ...mono, fontWeight: "700" }}>{inr(net)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ background: C.seashell, border: `1px solid ${C.border}`, borderRadius: "12px", padding: "20px 24px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "14px" }}>
              <div>
                <div style={{ fontWeight: "600", fontSize: "14px", color: C.textPrimary, marginBottom: "3px" }}>CSV Template</div>
                <div style={{ fontSize: "12px", color: C.textMuted }}>Required columns for the upload to work.</div>
              </div>
              <OrangeBtn onClick={downloadCSVTemplate}>Download Template</OrangeBtn>
            </div>
            <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: "8px", padding: "12px 14px", overflowX: "auto" }}>
              <code style={{ fontSize: "11px", color: C.textSecondary, ...mono, whiteSpace: "nowrap" }}>
                consultant_id, email, pan, gstin, invoice_no, billing_period, professional_fee, incentive, variable, tds, reimbursement, total_days, working_days, lop_days, net_payable_days, bank_beneficiary, bank_name, bank_account, bank_ifsc
              </code>
            </div>
            <div style={{ marginTop: "12px", fontSize: "11px", color: C.textMuted, lineHeight: "1.7" }}>
              <strong>Required:</strong> consultant_id, email, pan, invoice_no, billing_period, professional_fee, tds, total_days, working_days, net_payable_days.<br />
              <strong>Optional:</strong> gstin, incentive, variable, reimbursement, lop_days, bank columns.<br />
              Consultant profiles are created/updated automatically from the CSV — consultants just sign in and send.
            </div>
          </div>
        </div>
      )}

      {/* Consultants tab */}
      {tab === "consultants" && (
        <div style={{ maxWidth: "1000px", margin: "0 auto", padding: "36px 24px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "12px", marginBottom: "32px" }}>
            {[
              { label: "Total Registered", value: allConsultants.length, color: C.textPrimary },
              { label: "Profile Complete", value: allConsultants.filter(c => c.pan && c.bank_account && c.consultant_id).length, color: C.green },
              { label: "Incomplete Profile", value: allConsultants.filter(c => !c.pan || !c.bank_account || !c.consultant_id).length, color: C.orange, highlight: allConsultants.filter(c => !c.pan || !c.bank_account || !c.consultant_id).length > 0 },
            ].map(({ label, value, color, highlight }) => (
              <div key={label} style={{ border: `1px solid ${highlight ? C.orangeBorder : C.border}`, background: highlight ? C.orangeLight : C.white, borderRadius: "12px", padding: "18px 20px" }}>
                <div style={{ fontSize: "10px", fontWeight: "600", letterSpacing: "1px", color: color, textTransform: "uppercase", marginBottom: "6px" }}>{label}</div>
                <div style={{ fontSize: "26px", fontWeight: "700", color: color }}>{value}</div>
              </div>
            ))}
          </div>
          {loadingInvoices ? (
            <div style={{ textAlign: "center", padding: "60px 0", color: C.textMuted }}>Loading…</div>
          ) : allConsultants.length === 0 ? (
            <div style={{ textAlign: "center", padding: "60px 0", color: C.textMuted, fontSize: "14px" }}>No consultants have logged in yet.</div>
          ) : (
            <div style={{ border: `1px solid ${C.border}`, borderRadius: "12px", overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                <thead style={{ background: C.seashell }}>
                  <tr>{["Name", "Consultant ID", "PAN", "Bank Account", "IFSC", "Profile"].map(h => <th key={h} style={thStyle}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {allConsultants.map((c, i) => {
                    const complete = c.pan && c.bank_account && c.bank_ifsc && c.bank_beneficiary && c.consultant_id;
                    return (
                      <tr key={c.email} style={{ borderTop: `1px solid ${C.border}`, background: i % 2 === 0 ? C.white : C.seashell }}>
                        <td style={tdStyle}><div style={{ fontWeight: "600", fontSize: "13px", color: C.textPrimary }}>{c.name}</div><div style={{ fontSize: "11px", color: C.textMuted }}>{c.email}</div></td>
                        <td style={{ ...tdStyle, ...mono, color: c.consultant_id ? C.orange : C.red, fontWeight: "600" }}>{c.consultant_id || "Not set"}</td>
                        <td style={{ ...tdStyle, ...mono, fontSize: "12px" }}>{c.pan || <span style={{ color: C.red }}>Missing</span>}</td>
                        <td style={{ ...tdStyle, ...mono, fontSize: "12px" }}>{c.bank_account ? `••••${c.bank_account.slice(-4)}` : <span style={{ color: C.red }}>Missing</span>}</td>
                        <td style={{ ...tdStyle, ...mono, fontSize: "12px" }}>{c.bank_ifsc || <span style={{ color: C.red }}>Missing</span>}</td>
                        <td style={tdStyle}>
                          <span style={{ background: complete ? C.greenLight : C.orangeLight, color: complete ? C.green : C.orange, border: `1px solid ${complete ? C.greenBorder : C.orangeBorder}`, borderRadius: "20px", padding: "3px 10px", fontSize: "11px", fontWeight: "600", ...satoshi }}>
                            {complete ? "Complete" : "Incomplete"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Overview tab */}
      {tab === "overview" && (
        <div style={{ maxWidth: "1000px", margin: "0 auto", padding: "36px 24px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "12px", marginBottom: "32px" }}>
            {[
              { label: "Total Payout", value: inr(totalPayout), color: C.textPrimary, big: true },
              { label: "Pending", value: pendingCount, highlight: pendingCount > 0, color: C.orange },
              { label: "Sent", value: sentCount, color: C.green },
              { label: "Paid", value: paidCount, color: C.blue },
            ].map(({ label, value, highlight, color, big }) => (
              <div key={label} style={{ border: `1px solid ${highlight ? C.orangeBorder : C.border}`, background: highlight ? C.orangeLight : C.white, borderRadius: "12px", padding: "18px 20px" }}>
                <div style={{ fontSize: "10px", fontWeight: "600", letterSpacing: "1px", color: color || C.textMuted, textTransform: "uppercase", marginBottom: "6px" }}>{label}</div>
                <div style={{ fontSize: big ? "16px" : "26px", fontWeight: "700", color: color || C.textPrimary, ...(big ? mono : {}) }}>{value}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <div style={{ display: "flex", gap: "6px" }}>
              {[["all", "All"], ["pending", "Pending"], ["sent", "Sent"], ["paid", "Paid"]].map(([key, label]) => (
                <button key={key} onClick={() => setFilter(key)} style={{ padding: "5px 14px", borderRadius: "20px", border: `1px solid ${filter === key ? C.orange : C.border}`, background: filter === key ? C.orangeLight : C.white, color: filter === key ? C.orange : C.textSecondary, fontSize: "12px", fontWeight: "600", cursor: "pointer", ...satoshi, transition: "all 0.15s" }}>
                  {label}
                </button>
              ))}
            </div>
            <button onClick={fetchAllInvoices} style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: "8px", padding: "6px 14px", fontSize: "12px", color: C.textMuted, cursor: "pointer", ...satoshi, transition: "all 0.15s" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = C.orange; e.currentTarget.style.color = C.orange; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.textMuted; }}>
              ↻ Refresh
            </button>
          </div>
          {loadingInvoices ? (
            <div style={{ textAlign: "center", padding: "60px 0", color: C.textMuted }}>Loading invoices…</div>
          ) : fetchError ? (
            <div style={{ background: C.redLight, border: `1px solid ${C.redBorder}`, borderRadius: "10px", padding: "16px", color: C.red }}>{fetchError}</div>
          ) : filtered.length === 0 ? (
            <div style={{ textAlign: "center", padding: "60px 0", color: C.textMuted, fontSize: "14px" }}>No invoices found.</div>
          ) : (
            <div style={{ border: `1px solid ${C.border}`, borderRadius: "12px", overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                <thead style={{ background: C.seashell }}>
                  <tr>{["Consultant", "ID", "Period", "Invoice No", "Amount", "Status", "Actions"].map(h => <th key={h} style={thStyle}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {filtered.map((inv, i) => (
                    <tr key={inv.id} style={{ borderTop: `1px solid ${C.border}`, background: i % 2 === 0 ? C.white : C.seashell }}>
                      <td style={tdStyle}><div style={{ fontWeight: "600", fontSize: "13px", color: C.textPrimary }}>{inv.consultant_name}</div><div style={{ fontSize: "11px", color: C.textMuted }}>{inv.consultant_email}</div></td>
                      <td style={{ ...tdStyle, ...mono, color: C.orange, fontWeight: "600" }}>{inv.consultant_id}</td>
                      <td style={{ ...tdStyle, fontWeight: "500" }}>{inv.billing_period}</td>
                      <td style={{ ...tdStyle, ...mono, fontSize: "12px", color: C.textMuted }}>{inv.invoice_no}</td>
                      <td style={{ ...tdStyle, ...mono, fontWeight: "700" }}>{inr(calcNet(inv))}</td>
                      <td style={tdStyle}><Badge status={inv.status} /></td>
                      <td style={tdStyle}>
                        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                          <button onClick={() => setSelectedInvoice(inv)} style={{ padding: "5px 10px", background: C.seashell, border: `1px solid ${C.border}`, borderRadius: "7px", fontSize: "11px", cursor: "pointer", fontWeight: "600", ...satoshi, color: C.textPrimary, transition: "all 0.15s" }}
                            onMouseEnter={e => e.currentTarget.style.borderColor = C.orange}
                            onMouseLeave={e => e.currentTarget.style.borderColor = C.border}>View</button>
                          {inv.status === "sent" && (
                            <button onClick={() => handleMarkPaid(inv.id)} style={{ padding: "5px 10px", background: C.blueLight, border: `1px solid ${C.blueBorder}`, color: C.blue, borderRadius: "7px", fontSize: "11px", cursor: "pointer", fontWeight: "600", ...satoshi }}>Mark Paid</button>
                          )}
                          {inv.status === "pending" && (
                            <button onClick={() => handleSendReminder(inv)} style={{ padding: "5px 10px", background: reminderSent[inv.id] ? C.greenLight : C.orangeLight, border: `1px solid ${reminderSent[inv.id] ? C.greenBorder : C.orangeBorder}`, color: reminderSent[inv.id] ? C.green : C.orange, borderRadius: "7px", fontSize: "11px", cursor: "pointer", fontWeight: "600", ...satoshi }}>
                              {reminderSent[inv.id] ? "✓ Sent" : reminderSending[inv.id] ? "…" : "Remind"}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen] = useState("login");
  const [user, setUser] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [activeInvoice, setActiveInvoice] = useState(null);
  const [showProfile, setShowProfile] = useState(false);
  const [loading, setLoading] = useState(true);
  const [darkMode, setDarkMode] = useState(false);

  useEffect(() => { document.body.classList.toggle("dark", darkMode); }, [darkMode]);

  useEffect(() => {
    if (screen !== "login" && screen !== "not-setup") localStorage.setItem("ng_screen", screen);
    if (screen === "invoice" && activeInvoice) {
      localStorage.setItem("ng_invoice", activeInvoice.id);
    } else if (screen !== "invoice" && screen !== "login") {
      localStorage.removeItem("ng_invoice");
    }
  }, [screen, activeInvoice]);

  useEffect(() => {
    let mounted = true;
    async function loadUser(session) {
      try {
        const userData = await fetchUser(session.user.email, session.user.user_metadata?.full_name);
        if (!mounted) return;
        if (userData) {
          setUser(userData);
          if (userData.isAdmin) {
            setScreen("admin");
          } else {
            const inv = await fetchInvoices(userData.consultant_id);
            if (!mounted) return;
            setInvoices(inv);
            const savedScreen = localStorage.getItem("ng_screen");
            const savedInvoiceId = localStorage.getItem("ng_invoice");
            const validScreens = ["dashboard", "invoice"];
            if (validScreens.includes(savedScreen)) {
              if (savedScreen === "invoice" && savedInvoiceId) {
                const found = inv.find(i => String(i.id) === savedInvoiceId);
                if (found) { setActiveInvoice(found); setScreen("invoice"); }
                else setScreen("dashboard"); // invoice not found, fall back
              } else {
                setScreen(savedScreen);
              }
            } else {
              setScreen("dashboard");
            }
          }
        } else {
          setUser({ email: session.user.email, name: session.user.user_metadata?.full_name || session.user.email });
          setScreen("not-setup");
        }
      } catch (err) { console.error("Load user error:", err); if (mounted) setScreen("login"); }
      finally { if (mounted) setTimeout(() => setLoading(false), 0); }
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "INITIAL_SESSION" || event === "SIGNED_IN") {
        if (session) { loadUser(session); }
        else if (mounted) { setScreen("login"); setLoading(false); }
      } else if (event === "SIGNED_OUT") {
        if (mounted) { setUser(null); setInvoices([]); setScreen("login"); setLoading(false); }
      }
    });
    return () => { mounted = false; subscription.unsubscribe(); };
  }, []);

  async function handleLogin() { try { await signInWithGoogle(); } catch (err) { console.error("Login error:", err); } }
  function handleOpen(inv) { setActiveInvoice(inv); setScreen("invoice"); }
  function handleSent() { setInvoices(prev => prev.map(i => i.id === activeInvoice.id ? { ...i, status: "sent", sent_at: new Date().toISOString() } : i)); setActiveInvoice(null); setScreen("dashboard"); }
  function handleUpdate(updatedInvoice) { setInvoices(prev => prev.map(i => i.id === updatedInvoice.id ? updatedInvoice : i)); setActiveInvoice(updatedInvoice); }

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    localStorage.removeItem("ng_screen");
    setUser(null); setScreen("login"); setShowProfile(false);
  };

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: C.seashell, display: "flex", alignItems: "center", justifyContent: "center", ...satoshi }}>
        <div style={{ textAlign: "center" }}>
          <FiteloMark size={40} />
          <div style={{ color: C.textMuted, fontSize: "13px", marginTop: "16px" }}>Loading…</div>
        </div>
      </div>
    );
  }

  return (
    <>
      <style>{`
  @import url('https://api.fontshare.com/v2/css?f[]=satoshi@400,500,600,700&display=swap');
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  input { outline: none; }
  body { background: ${C.seashell}; }
  ::-webkit-scrollbar { width: 4px; height: 4px; }
  ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 2px; }
  ::-webkit-scrollbar-track { background: transparent; }
  body.dark { background: #1a1b22; filter: invert(1) hue-rotate(180deg); }
  body.dark img { filter: invert(1) hue-rotate(180deg); }
`}</style>

      {screen === "login" && <LoginScreen onLogin={handleLogin} />}
      {screen === "not-setup" && <NotSetUpScreen user={user} onSignOut={handleSignOut} />}

      {screen === "admin" && (
        <div style={{ minHeight: "100vh", background: C.seashell }}>
          <Topbar user={user} isAdmin={true} onProfile={() => setShowProfile(true)} darkMode={darkMode} onToggleDark={() => setDarkMode(d => !d)} />
          <AdminScreen />
          {showProfile && <ProfileDrawer user={user} onClose={() => setShowProfile(false)} onSignOut={handleSignOut} />}
        </div>
      )}

      {(screen === "dashboard" || screen === "invoice") && user && !user.isAdmin && (
        <div style={{ minHeight: "100vh", background: C.seashell }}>
          <Topbar user={user} isAdmin={false} onProfile={() => setShowProfile(true)} darkMode={darkMode} onToggleDark={() => setDarkMode(d => !d)} />
          {screen === "dashboard" && <Dashboard user={user} invoices={invoices} onOpen={handleOpen} />}
          {screen === "invoice" && activeInvoice && <InvoiceScreen invoice={activeInvoice} user={user} onBack={() => setScreen("dashboard")} onSent={handleSent} onUpdate={handleUpdate} />}
          {showProfile && <ProfileDrawer user={user} onClose={() => setShowProfile(false)} onSignOut={handleSignOut} />}
        </div>
      )}
    </>
  );
}