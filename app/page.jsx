"use client";

import { useState, useEffect, useRef } from "react";
import { supabase, signInWithGoogle, fetchConsultant, fetchInvoices, updateBankDetails, sendInvoice, uploadPaymentCSV } from "@/lib/supabase";

const COMPANY = {
  name: "Noguilt Fitness and Nutrition Private Limited",
  address: "E-190, 2nd Floor, Industrial Area, Sector 74, Sahibzada Ajit Singh Nagar, Pin-140308",
  financeEmail: process.env.NEXT_PUBLIC_FINANCE_EMAIL || "finance@noguiltfitness.com",
};

const CSV_TEMPLATE = [
  "consultant_id,invoice_no,billing_period,professional_fee,incentive,variable,tds,reimbursement,total_days,working_days,lop_days,net_payable_days,bank_beneficiary,bank_name,bank_account,bank_ifsc",
  "C0096,JAN26-0001,Jan'26,7000,0,0,700,0,31,31,0,31,,,,",
  "C0097,JAN26-0002,Jan'26,8500,500,0,900,0,31,30,1,30,,,,",
].join("\n");

function toWords(n) {
  if (n === 0) return "Zero";
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
    "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
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

const C = {
  orange: "#E85D04", orangeHover: "#C94E00", orangeLight: "#FFF3EC", orangeBorder: "#FFD0B0",
  black: "#111111", gray700: "#444444", gray500: "#777777", gray300: "#CCCCCC",
  gray100: "#F0F0F0", gray50: "#F8F8F8", white: "#FFFFFF",
  green: "#16A34A", greenLight: "#F0FDF4", greenBorder: "#BBF7D0",
  red: "#DC2626", redLight: "#FFF0F0", redBorder: "#FECACA",
  blue: "#2563EB", blueLight: "#EFF6FF", blueBorder: "#BFDBFE",
};

const mono = { fontFamily: "'IBM Plex Mono', monospace" };
const serif = { fontFamily: "'Instrument Serif', serif", letterSpacing: "-0.3px" };
const sans = { fontFamily: "'Geist', sans-serif" };

const HR = ({ my = 0 }) => <div style={{ height: "1px", background: C.gray100, margin: `${my}px 0` }} />;

const Label = ({ children }) => (
  <div style={{ fontSize: "10px", fontWeight: "700", letterSpacing: "1px", color: C.gray500, textTransform: "uppercase", marginBottom: "10px" }}>
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
    <span style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}`, borderRadius: "4px", padding: "3px 9px", fontSize: "11px", fontWeight: "600", ...mono, letterSpacing: "0.5px" }}>
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
        background: disabled ? C.gray300 : hover ? C.orangeHover : C.orange,
        color: C.white, border: "none", borderRadius: "7px",
        padding: "13px 20px", fontSize: "14px", fontWeight: "600",
        cursor: disabled ? "not-allowed" : "pointer", ...sans, transition: "background 0.15s",
      }}
    >{children}</button>
  );
}

function GhostBtn({ onClick, children }) {
  return (
    <button onClick={onClick} style={{ background: "none", border: "none", color: C.gray500, fontSize: "13px", cursor: "pointer", padding: "0", ...sans, display: "flex", alignItems: "center", gap: "4px" }}>
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
      a.href = url;
      a.download = `Invoice-${invoiceNo}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert("Could not download PDF: " + err.message);
    }
    setLoading(false);
  }

  return (
    <button onClick={handle} disabled={loading}
      style={{ background: C.gray50, border: `1px solid ${C.gray300}`, borderRadius: "5px", padding: "6px 12px", fontSize: "11px", fontWeight: "600", color: loading ? C.gray300 : C.black, cursor: loading ? "wait" : "pointer", ...sans }}>
      {loading ? "Generating..." : "↓ Download PDF"}
    </button>
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
    <div style={{ background: C.white, width: "620px", padding: "48px 52px", boxShadow: "0 2px 8px rgba(0,0,0,0.06), 0 12px 40px rgba(0,0,0,0.04)", borderRadius: "3px", color: C.black, fontSize: "12px", ...sans }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "28px" }}>
        <div>
          <div style={{ fontSize: "36px", ...serif, color: C.black, lineHeight: 1 }}>Invoice</div>
          <div style={{ color: C.gray500, fontSize: "12px", ...mono, marginTop: "6px" }}>{invoice.invoice_no}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ display: "inline-block", background: C.orange, color: C.white, borderRadius: "5px", padding: "5px 12px", fontSize: "12px", fontWeight: "700", ...mono, marginBottom: "4px" }}>{invoice.billing_period}</div>
          <div style={{ color: C.gray500, fontSize: "11px" }}>Billing Period</div>
        </div>
      </div>
      <HR />
      <div style={{ height: "20px" }} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "32px", marginBottom: "24px" }}>
        <div>
          <Label>From</Label>
          <div style={{ fontWeight: "600", marginBottom: "6px" }}>{user.name}</div>
          <div style={{ color: C.gray700, lineHeight: "1.7", fontSize: "12px" }}>
            <div>PAN: <span style={mono}>{user.pan}</span></div>
            {user.gstin && <div>GSTIN: <span style={mono}>{user.gstin}</span></div>}
            <div>ID: <span style={mono}>{user.consultant_id || invoice.consultant_id}</span></div>
          </div>
        </div>
        <div>
          <Label>Bill To</Label>
          <div style={{ fontWeight: "600", marginBottom: "6px" }}>{COMPANY.name}</div>
          <div style={{ color: C.gray700, lineHeight: "1.7", fontSize: "12px" }}>{COMPANY.address}</div>
        </div>
      </div>
      <div style={{ background: C.gray50, border: `1px solid ${C.gray100}`, borderRadius: "6px", padding: "16px 20px", marginBottom: "24px" }}>
        <Label>Service Days Summary</Label>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", textAlign: "center" }}>
          {[["Total Days", invoice.total_days], ["Working Days", invoice.working_days], ["LOP Days", invoice.lop_days], ["Net Payable Days", invoice.net_payable_days]].map(([l, v]) => (
            <div key={l}>
              <div style={{ fontSize: "24px", fontWeight: "700", ...serif }}>{v || 0}</div>
              <div style={{ fontSize: "10px", color: C.gray500, marginTop: "2px" }}>{l}</div>
            </div>
          ))}
        </div>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "12px" }}>
        <thead>
          <tr style={{ borderBottom: `2px solid ${C.black}` }}>
            <th style={{ textAlign: "left", padding: "8px 0", fontSize: "10px", fontWeight: "700", letterSpacing: "1px", color: C.gray500, textTransform: "uppercase" }}>Description</th>
            <th style={{ textAlign: "right", padding: "8px 0", fontSize: "10px", fontWeight: "700", letterSpacing: "1px", color: C.gray500, textTransform: "uppercase" }}>Amount (₹)</th>
          </tr>
        </thead>
        <tbody>
          {[["Professional Fee", invoice.professional_fee || 0], ["Incentive", invoice.incentive || 0], ["Variable / Bonus / Referral", invoice.variable || 0]].map(([l, v]) => (
            <tr key={l} style={{ borderBottom: `1px solid ${C.gray100}` }}>
              <td style={{ padding: "10px 0", color: C.gray700 }}>{l}</td>
              <td style={{ padding: "10px 0", textAlign: "right", ...mono }}>{v.toLocaleString("en-IN")}</td>
            </tr>
          ))}
          <tr style={{ borderBottom: `1px solid ${C.gray100}` }}>
            <td style={{ padding: "10px 0", fontWeight: "600" }}>Total Amount</td>
            <td style={{ padding: "10px 0", textAlign: "right", fontWeight: "600", ...mono }}>{total.toLocaleString("en-IN")}</td>
          </tr>
          <tr style={{ borderBottom: `1px solid ${C.gray100}` }}>
            <td style={{ padding: "10px 0", color: C.red }}>TDS @ 10%</td>
            <td style={{ padding: "10px 0", textAlign: "right", color: C.red, ...mono }}>({(invoice.tds || 0).toLocaleString("en-IN")})</td>
          </tr>
          <tr style={{ borderBottom: `1px solid ${C.gray100}` }}>
            <td style={{ padding: "10px 0", color: C.gray700 }}>Reimbursement</td>
            <td style={{ padding: "10px 0", textAlign: "right", ...mono }}>{(invoice.reimbursement || 0).toLocaleString("en-IN")}</td>
          </tr>
        </tbody>
      </table>
      <div style={{ background: C.black, color: C.white, padding: "14px 20px", borderRadius: "5px", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
        <span style={{ fontWeight: "700", fontSize: "14px" }}>Net Payable</span>
        <span style={{ fontWeight: "700", fontSize: "20px", ...mono }}>{net.toLocaleString("en-IN")}</span>
      </div>
      <div style={{ color: C.gray500, fontSize: "11px", fontStyle: "italic", marginBottom: "24px" }}>{toWords(net)} Rupees Only</div>
      <HR />
      <div style={{ height: "20px" }} />
      <Label>Bank Details</Label>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", marginBottom: "32px" }}>
        {[["Beneficiary Name", bank.beneficiaryName], ["Bank Name", bank.bankName], ["Account Number", bank.accountNumber], ["IFSC Code", bank.ifscCode]].map(([l, v]) => (
          <div key={l}>
            <div style={{ fontSize: "10px", color: C.gray500, marginBottom: "2px" }}>{l}</div>
            <div style={{ fontWeight: "600", ...mono, fontSize: "12px" }}>{v || "—"}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ width: "150px", height: "52px", borderBottom: `1px solid ${C.gray300}` }} />
          <div style={{ fontSize: "10px", color: C.gray500, marginTop: "6px" }}>Consultant Signature</div>
        </div>
      </div>
    </div>
  );
}

function LoginScreen({ onLogin }) {
  const [hover, setHover] = useState(false);
  return (
    <div style={{ minHeight: "100vh", display: "flex", ...sans }}>
      <div style={{ width: "400px", background: C.black, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "48px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ width: "30px", height: "30px", background: C.orange, borderRadius: "7px", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ color: C.white, fontSize: "11px", fontWeight: "700", ...mono }}>NG</span>
          </div>
          <span style={{ color: "rgba(255,255,255,0.45)", fontSize: "13px" }}>Invoice Portal</span>
        </div>
        <div>
          <div style={{ fontSize: "44px", ...serif, color: C.white, lineHeight: "1.15", marginBottom: "18px" }}>
            Your invoices,<br />done in<br /><span style={{ color: C.orange }}>seconds.</span>
          </div>
          <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "14px", lineHeight: "1.7" }}>
            Log in each month, review your pre-filled invoice, and send it to finance with one click.
          </div>
        </div>
        <div style={{ color: "rgba(255,255,255,0.18)", fontSize: "11px", ...mono }}>Noguilt Fitness & Nutrition Pvt. Ltd.</div>
      </div>
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: C.white, padding: "48px" }}>
        <div style={{ width: "320px" }}>
          <div style={{ fontSize: "28px", ...serif, color: C.black, marginBottom: "8px" }}>Sign in</div>
          <div style={{ color: C.gray500, fontSize: "14px", marginBottom: "32px" }}>Use your work Google account to continue.</div>
          <button onClick={onLogin} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
            style={{ width: "100%", background: C.white, border: `1.5px solid ${hover ? C.orange : C.gray300}`, borderRadius: "8px", padding: "13px 20px", display: "flex", alignItems: "center", justifyContent: "center", gap: "12px", fontSize: "14px", fontWeight: "500", color: C.black, cursor: "pointer", ...sans, transition: "border-color 0.15s" }}>
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Continue with Google
          </button>
          <div style={{ marginTop: "20px", padding: "14px 16px", background: C.orangeLight, border: `1px solid ${C.orangeBorder}`, borderRadius: "7px", fontSize: "12px", color: C.gray700, lineHeight: "1.6" }}>
            <strong style={{ color: C.orange }}>Note:</strong> This app will request Gmail permission to send invoices on your behalf.
          </div>
        </div>
      </div>
    </div>
  );
}

function OnboardingScreen({ user, onComplete }) {
  const [form, setForm] = useState({ consultantId: "", pan: "", gstin: "", bankBeneficiary: "", bankName: "", bankAccount: "", bankIfsc: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit() {
    if (!form.consultantId || !form.pan || !form.bankBeneficiary || !form.bankName || !form.bankAccount || !form.bankIfsc) {
      setError("Please fill in all required fields."); return;
    }
    setSaving(true); setError(null);
    try {
      const { error: updateError } = await supabase.from("consultants").update({
        consultant_id: form.consultantId, pan: form.pan, gstin: form.gstin,
        bank_beneficiary: form.bankBeneficiary, bank_name: form.bankName,
        bank_account: form.bankAccount, bank_ifsc: form.bankIfsc,
      }).eq("email", user.email);
      if (updateError) throw updateError;
      onComplete({ ...user, consultant_id: form.consultantId, pan: form.pan, gstin: form.gstin, bank_beneficiary: form.bankBeneficiary, bank_name: form.bankName, bank_account: form.bankAccount, bank_ifsc: form.bankIfsc });
    } catch (err) { setError(err.message); }
    setSaving(false);
  }

  const inputStyle = { width: "100%", padding: "10px 12px", border: `1px solid ${C.gray300}`, borderRadius: "7px", fontSize: "13px", color: C.black, ...mono, boxSizing: "border-box", background: C.white };

  return (
    <div style={{ minHeight: "100vh", background: C.white, display: "flex", ...sans }}>
      <div style={{ width: "360px", background: C.black, padding: "48px", display: "flex", flexDirection: "column", justifyContent: "space-between", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ width: "28px", height: "28px", background: C.orange, borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ color: C.white, fontSize: "10px", fontWeight: "700", ...mono }}>NG</span>
          </div>
          <span style={{ color: "rgba(255,255,255,0.4)", fontSize: "13px" }}>Invoice Portal</span>
        </div>
        <div>
          <div style={{ fontSize: "36px", ...serif, color: C.white, lineHeight: "1.2", marginBottom: "16px" }}>One-time<br />setup.</div>
          <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "13px", lineHeight: "1.7" }}>We need a few details to generate your invoices correctly. You only need to do this once.</div>
        </div>
        <div style={{ color: "rgba(255,255,255,0.2)", fontSize: "11px", ...mono }}>Logged in as {user?.email}</div>
      </div>
      <div style={{ flex: 1, padding: "48px", overflowY: "auto", display: "flex", alignItems: "flex-start", justifyContent: "center" }}>
        <div style={{ width: "100%", maxWidth: "480px" }}>
          <div style={{ fontSize: "26px", ...serif, color: C.black, marginBottom: "6px" }}>Complete your profile</div>
          <div style={{ fontSize: "13px", color: C.gray500, marginBottom: "32px" }}>These details will appear on every invoice you generate.</div>
          <div style={{ fontSize: "11px", fontWeight: "700", letterSpacing: "1px", color: C.gray500, textTransform: "uppercase", marginBottom: "14px" }}>Consultant Details</div>
          {[{ label: "Consultant ID *", key: "consultantId", placeholder: "e.g. C0096" }, { label: "PAN *", key: "pan", placeholder: "e.g. ABCDE1234F" }, { label: "GSTIN (optional)", key: "gstin", placeholder: "Leave blank if not applicable" }].map(({ label, key, placeholder }) => (
            <div key={key} style={{ marginBottom: "16px" }}>
              <label style={{ fontSize: "12px", fontWeight: "600", color: C.gray700, display: "block", marginBottom: "5px" }}>{label}</label>
              <input type="text" placeholder={placeholder} value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} style={inputStyle} onFocus={e => e.target.style.borderColor = C.orange} onBlur={e => e.target.style.borderColor = C.gray300} />
            </div>
          ))}
          <HR my={20} />
          <div style={{ fontSize: "11px", fontWeight: "700", letterSpacing: "1px", color: C.gray500, textTransform: "uppercase", marginBottom: "14px" }}>Bank Details</div>
          {[{ label: "Beneficiary Name *", key: "bankBeneficiary", placeholder: "As per bank records" }, { label: "Bank Name *", key: "bankName", placeholder: "e.g. State Bank of India" }, { label: "Account Number *", key: "bankAccount", placeholder: "Your account number" }, { label: "IFSC Code *", key: "bankIfsc", placeholder: "e.g. SBIN0010913" }].map(({ label, key, placeholder }) => (
            <div key={key} style={{ marginBottom: "16px" }}>
              <label style={{ fontSize: "12px", fontWeight: "600", color: C.gray700, display: "block", marginBottom: "5px" }}>{label}</label>
              <input type="text" placeholder={placeholder} value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} style={inputStyle} onFocus={e => e.target.style.borderColor = C.orange} onBlur={e => e.target.style.borderColor = C.gray300} />
            </div>
          ))}
          {error && <div style={{ background: C.redLight, border: `1px solid ${C.redBorder}`, borderRadius: "7px", padding: "12px 14px", color: C.red, fontSize: "13px", marginBottom: "16px" }}>{error}</div>}
          <OrangeBtn onClick={handleSubmit} disabled={saving} full>{saving ? "Saving..." : "Save & Continue →"}</OrangeBtn>
        </div>
      </div>
    </div>
  );
}

function Topbar({ user, onProfile, isAdmin, onToggleAdmin, darkMode, onToggleDark }) {
  return (
    <div style={{ height: "56px", borderBottom: `1px solid ${C.gray100}`, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 32px", background: C.white, position: "sticky", top: 0, zIndex: 50 }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <div style={{ width: "28px", height: "28px", background: C.orange, borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ color: C.white, fontSize: "10px", fontWeight: "700", ...mono }}>NG</span>
        </div>
        <span style={{ color: C.gray500, fontSize: "13px", ...sans }}>Invoice Portal</span>
        {isAdmin && <span style={{ background: C.black, color: C.white, fontSize: "10px", borderRadius: "4px", padding: "2px 7px", ...mono }}>ADMIN</span>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
        {user && <span style={{ fontSize: "12px", color: C.gray500, ...mono }}>{user.consultant_id}</span>}
        {user?.is_admin && (
          <button onClick={onToggleAdmin} style={{ fontSize: "11px", color: C.gray500, background: "none", border: `1px solid ${C.gray300}`, borderRadius: "5px", padding: "5px 10px", cursor: "pointer", ...mono }}>
            {isAdmin ? "← Consultant view" : "Admin →"}
          </button>
        )}
        <button
          onClick={onToggleDark}
          title="Toggle dark mode"
          style={{ background: "none", border: `1px solid ${C.gray300}`, borderRadius: "5px", padding: "5px 10px", cursor: "pointer", fontSize: "13px", lineHeight: 1 }}
        >
          {darkMode ? "☀️" : "🌙"}
        </button>
        {user && (
          <button onClick={onProfile} style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}>
            <div style={{ width: "32px", height: "32px", background: C.orange, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ color: C.white, fontSize: "13px", fontWeight: "700" }}>{user.name?.charAt(0) || "?"}</span>
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
    <div style={{ maxWidth: "700px", margin: "0 auto", padding: "44px 24px", ...sans }}>
      <div style={{ marginBottom: "36px" }}>
        <div style={{ color: C.gray500, fontSize: "13px", marginBottom: "4px" }}>Good day,</div>
        <div style={{ fontSize: "38px", ...serif, color: C.black }}>{user.name}</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "14px", marginBottom: "36px" }}>
        {[{ label: "Pending", value: pending.length, highlight: pending.length > 0 }, { label: "Sent", value: sent.length }, { label: "Consultant ID", value: user.consultant_id, isMono: true }].map(({ label, value, highlight, isMono }) => (
          <div key={label} style={{ border: `1px solid ${highlight ? C.orange : C.gray100}`, background: highlight ? C.orangeLight : C.gray50, borderRadius: "8px", padding: "18px 20px" }}>
            <div style={{ fontSize: "10px", fontWeight: "700", letterSpacing: "1px", color: highlight ? C.orange : C.gray500, textTransform: "uppercase", marginBottom: "6px" }}>{label}</div>
            <div style={{ fontSize: isMono ? "15px" : "26px", fontWeight: "700", ...serif, color: highlight ? C.orange : C.black, ...(isMono ? mono : {}) }}>{value}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", borderBottom: `1px solid ${C.gray100}`, marginBottom: "20px" }}>
        {[["pending", "Pending"], ["sent", "History"]].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} style={{ background: "none", border: "none", cursor: "pointer", padding: "10px 16px", fontSize: "13px", fontWeight: "600", color: tab === key ? C.black : C.gray500, borderBottom: `2px solid ${tab === key ? C.orange : "transparent"}`, marginBottom: "-1px", ...sans, transition: "color 0.15s" }}>{label}</button>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {list.length === 0 && (
          <div style={{ textAlign: "center", padding: "60px 0", color: C.gray300, fontSize: "14px" }}>
            {tab === "pending" ? "No pending invoices — you're all caught up." : "No invoices sent yet."}
          </div>
        )}
        {list.map(inv => {
          const net = calcNet(inv);
          const clickable = true; // Allow clicking on all invoices
          return (
            <div key={inv.id} onClick={() => clickable && onOpen(inv)}
              style={{ background: C.white, border: `1px solid ${C.gray100}`, borderRadius: "8px", padding: "18px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: clickable ? "pointer" : "default", transition: "border-color 0.15s, box-shadow 0.15s" }}
              onMouseEnter={e => { if (clickable) { e.currentTarget.style.borderColor = C.orange; e.currentTarget.style.boxShadow = `0 0 0 3px ${C.orangeLight}`; } }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = C.gray100; e.currentTarget.style.boxShadow = "none"; }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                <div style={{ width: "42px", height: "42px", background: clickable ? C.orangeLight : C.gray100, borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "18px", flexShrink: 0 }}>
                  {clickable ? "📄" : "✓"}
                </div>
                <div>
                  <div style={{ fontWeight: "600", fontSize: "14px", color: C.black, marginBottom: "2px" }}>{inv.billing_period}</div>
                  <div style={{ fontSize: "11px", color: C.gray500, ...mono }}>{inv.invoice_no}{inv.sent_at ? ` · Sent ${inv.sent_at.slice(0, 10)}` : ""}</div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontWeight: "700", fontSize: "16px", color: C.black, ...mono }}>{inr(net)}</div>
                  <div style={{ fontSize: "10px", color: C.gray500 }}>net payable</div>
                </div>
                <Badge status={inv.status} />
                {clickable && <span style={{ color: C.orange, fontSize: "16px" }}>→</span>}
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
      setState("sent");
      setTimeout(onSent, 2000);
    } catch (err) {
      console.error("Send error:", err);
      setState("error");
    }
  }

  async function saveEdits() {
    setSavingEdit(true);
    try {
      const updates = {
        professional_fee: Number(draft.professional_fee) || 0,
        incentive: Number(draft.incentive) || 0,
        variable: Number(draft.variable) || 0,
        tds: Number(draft.tds) || 0,
        reimbursement: Number(draft.reimbursement) || 0,
        working_days: Number(draft.working_days) || 0,
        lop_days: Number(draft.lop_days) || 0,
        net_payable_days: (Number(draft.working_days) || 0) - (Number(draft.lop_days) || 0),
      };
      const { error } = await supabase.from("invoices").update(updates).eq("id", draft.id);
      if (error) throw error;
      setIsEditing(false);
      if (onUpdate) onUpdate({ ...draft, ...updates });
    } catch (err) {
      alert("Error saving edits: " + err.message);
    }
    setSavingEdit(false);
  }

  const inputStyle = { width: "80px", padding: "5px 8px", border: `1px solid ${C.gray300}`, borderRadius: "5px", fontSize: "12px", ...mono, textAlign: "right", outline: "none" };

  return (
    <div style={{ display: "flex", minHeight: "calc(100vh - 56px)", background: C.gray50, ...sans }}>
      <div style={{ flex: 1, overflow: "auto", padding: "36px 32px", display: "flex", justifyContent: "center", alignItems: "flex-start" }}>
        <div id="invoice-document">
          <InvoiceDocument invoice={draft} user={user} />
        </div>
      </div>
      <div style={{ width: "320px", background: C.white, borderLeft: `1px solid ${C.gray100}`, padding: "28px 24px", display: "flex", flexDirection: "column", flexShrink: 0, overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <GhostBtn onClick={onBack}>← Back</GhostBtn>
          <PDFBtn invoiceId={draft.id} invoiceNo={draft.invoice_no} />
        </div>
        <div style={{ marginTop: "20px", marginBottom: "4px", fontSize: "22px", ...serif, color: C.black }}>{draft.billing_period}</div>
        <div style={{ fontSize: "11px", color: C.gray500, ...mono, marginBottom: "24px" }}>{draft.invoice_no}</div>
        <HR /><div style={{ height: "20px" }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
          <Label>Summary</Label>
          {invoice.status === "pending" && !isEditing && (
            <button onClick={() => setIsEditing(true)} style={{ background: "none", border: "none", color: C.orange, fontSize: "11px", fontWeight: "600", cursor: "pointer" }}>Edit Data</button>
          )}
        </div>
        {isEditing ? (
          <div style={{ background: C.orangeLight, padding: "16px", borderRadius: "8px", border: `1px solid ${C.orangeBorder}`, marginBottom: "24px" }}>
            {[
              ["Prof. Fee", "professional_fee"], ["Incentive", "incentive"], ["Variable", "variable"],
              ["TDS Deducted", "tds"], ["Reimbursement", "reimbursement"],
              ["Working Days", "working_days"], ["LOP Days", "lop_days"]
            ].map(([l, key]) => (
              <div key={key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                <span style={{ fontSize: "11px", color: C.gray700, fontWeight: "500" }}>{l}</span>
                <input type="number" value={draft[key] || ""} onChange={e => setDraft({ ...draft, [key]: e.target.value })} style={inputStyle} onFocus={e => e.target.style.borderColor = C.orange} onBlur={e => e.target.style.borderColor = C.gray300} />
              </div>
            ))}
            <div style={{ display: "flex", gap: "8px", marginTop: "16px" }}>
              <button onClick={() => { setDraft(invoice); setIsEditing(false); }} style={{ flex: 1, padding: "8px", background: C.white, border: `1px solid ${C.gray300}`, borderRadius: "5px", cursor: "pointer", fontSize: "12px", ...sans }}>Cancel</button>
              <button onClick={saveEdits} disabled={savingEdit} style={{ flex: 1, padding: "8px", background: C.orange, color: C.white, border: "none", borderRadius: "5px", cursor: savingEdit ? "wait" : "pointer", fontSize: "12px", fontWeight: "600", ...sans }}>{savingEdit ? "Saving..." : "Save"}</button>
            </div>
          </div>
        ) : (
          <div style={{ marginBottom: "24px" }}>
            {[["Professional Fee", inr(draft.professional_fee || 0)], ["Incentive", inr(draft.incentive || 0)], ["Variable / Bonus", inr(draft.variable || 0)], ["TDS Deducted", `- ${inr(draft.tds || 0)}`], ["Reimbursement", inr(draft.reimbursement || 0)]].map(([l, v]) => (
              <div key={l} style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                <span style={{ fontSize: "12px", color: C.gray500 }}>{l}</span>
                <span style={{ fontSize: "12px", color: C.black, ...mono }}>{v}</span>
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
                <div style={{ background: C.gray50, border: `1px solid ${C.gray100}`, borderRadius: "6px", padding: "10px 12px" }}>
                  <div style={{ fontSize: "10px", color: C.gray500, marginBottom: "2px" }}>{sub}</div>
                  <div style={{ fontSize: "12px", color: C.black, ...mono }}>{email}</div>
                </div>
              </div>
            ))}
            <div style={{ marginTop: "auto" }}>
              {state === "sent" ? (
                <div style={{ background: C.greenLight, border: `1px solid ${C.greenBorder}`, borderRadius: "8px", padding: "16px", textAlign: "center", color: C.green, fontWeight: "600", fontSize: "14px" }}>✓ Invoice Sent!</div>
              ) : state === "error" ? (
                <div style={{ background: C.redLight, border: `1px solid ${C.redBorder}`, borderRadius: "8px", padding: "16px", textAlign: "center", color: C.red, fontSize: "13px" }}>
                  Failed to send. Please try again.
                  <div style={{ marginTop: "10px" }}><OrangeBtn onClick={() => setState("idle")} full>Retry</OrangeBtn></div>
                </div>
              ) : (
                <OrangeBtn onClick={handleSend} disabled={state === "sending" || isEditing} full>{state === "sending" ? "Sending..." : "Send Invoice →"}</OrangeBtn>
              )}
              <div style={{ fontSize: "11px", color: C.gray300, textAlign: "center", marginTop: "10px" }}>Stored in your history after sending</div>
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

  async function handleSave() {
    await updateBankDetails(user.consultant_id, form);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.15)", zIndex: 99 }} />
      <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: "340px", background: C.white, borderLeft: `1px solid ${C.gray100}`, zIndex: 100, padding: "28px 24px", display: "flex", flexDirection: "column", ...sans }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
          <div>
            <div style={{ fontWeight: "700", fontSize: "16px" }}>{user.name}</div>
            <div style={{ fontSize: "12px", color: C.gray500, marginTop: "2px" }}>{user.email}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: C.gray500, fontSize: "18px", lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ display: "flex", gap: "8px", marginBottom: "24px" }}>
          {[["ID", user.consultant_id], ["PAN", user.pan]].map(([l, v]) => (
            <div key={l} style={{ flex: 1, background: C.gray50, border: `1px solid ${C.gray100}`, borderRadius: "7px", padding: "10px 12px" }}>
              <div style={{ fontSize: "10px", color: C.gray500, marginBottom: "3px" }}>{l}</div>
              <div style={{ fontSize: "12px", fontWeight: "600", ...mono }}>{v}</div>
            </div>
          ))}
        </div>
        <HR my={0} /><div style={{ height: "20px" }} />
        <Label>Bank Details (Fallback)</Label>
        <div style={{ fontSize: "11px", color: C.gray500, marginBottom: "16px", lineHeight: "1.6" }}>Used when bank details are not provided in the monthly CSV.</div>
        {[["Beneficiary Name", "beneficiaryName"], ["Bank Name", "bankName"], ["Account Number", "accountNumber"], ["IFSC Code", "ifscCode"]].map(([label, key]) => (
          <div key={key} style={{ marginBottom: "12px" }}>
            <label style={{ fontSize: "11px", color: C.gray700, fontWeight: "600", display: "block", marginBottom: "4px" }}>{label}</label>
            <input type="text" value={form[key] || ""} onChange={e => setForm({ ...form, [key]: e.target.value })}
              style={{ width: "100%", padding: "9px 11px", border: `1px solid ${C.gray300}`, borderRadius: "6px", fontSize: "12px", color: C.black, background: C.white, ...mono, boxSizing: "border-box" }}
              onFocus={e => e.target.style.borderColor = C.orange} onBlur={e => e.target.style.borderColor = C.gray300} />
          </div>
        ))}
        <button onClick={handleSave} style={{ width: "100%", background: saved ? C.green : C.black, color: C.white, border: "none", borderRadius: "7px", padding: "12px", fontSize: "13px", fontWeight: "600", cursor: "pointer", ...sans, transition: "background 0.3s", marginTop: "8px" }}>
          {saved ? "✓ Saved" : "Save Details"}
        </button>
        <div style={{ marginTop: "auto" }}>
          <HR my={20} />
          <button onClick={onSignOut} style={{ background: "none", border: "none", color: C.red, fontSize: "13px", cursor: "pointer", padding: 0, ...sans }}>Sign out</button>
        </div>
      </div>
    </>
  );
}

// ─── Admin Screen (tabbed: Overview + Upload CSV) ─────────────────────────────
function AdminScreen() {
  const [tab, setTab] = useState("overview");
  const [allInvoices, setAllInvoices] = useState([]);
  const [loadingInvoices, setLoadingInvoices] = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const [filter, setFilter] = useState("all");
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [reminderSending, setReminderSending] = useState({});
  const [reminderSent, setReminderSent] = useState({});

  // CSV upload state
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const fileRef = useRef();

  useEffect(() => {
    if (tab === "overview") fetchAllInvoices();
  }, [tab]);

  async function fetchAllInvoices() {
    setLoadingInvoices(true); setFetchError(null);
    try {
      const res = await fetch("/api/admin-invoices");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setAllInvoices(json.invoices);
    } catch (err) { setFetchError(err.message); }
    setLoadingInvoices(false);
  }

  async function handleMarkPaid(invoiceId) {
    try {
      const res = await fetch("/api/admin-invoices", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId, status: "paid" }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setAllInvoices(prev => prev.map(i => i.id === invoiceId ? { ...i, status: "paid" } : i));
      if (selectedInvoice?.id === invoiceId) setSelectedInvoice(s => ({ ...s, status: "paid" }));
    } catch (err) { alert("Error: " + err.message); }
  }

  async function handleSendReminder(inv) {
    setReminderSending(s => ({ ...s, [inv.id]: true }));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/send-reminder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inv.consultant_email, name: inv.consultant_name, period: inv.billing_period, accessToken: session?.provider_token }),
      });

      if (!res.ok) throw new Error("Failed");
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

  // Invoice detail view (when a row is clicked)
  if (selectedInvoice) {
    return (
      <div style={{ display: "flex", minHeight: "calc(100vh - 56px)", background: C.gray50, ...sans }}>
        <div style={{ flex: 1, overflow: "auto", padding: "36px 32px", display: "flex", justifyContent: "center", alignItems: "flex-start" }}>
          <div id="invoice-document">
            <InvoiceDocument invoice={selectedInvoice} user={{ name: selectedInvoice.consultant_name, pan: selectedInvoice.consultant_pan, consultant_id: selectedInvoice.consultant_id }} />
          </div>
        </div>
        <div style={{ width: "320px", background: C.white, borderLeft: `1px solid ${C.gray100}`, padding: "28px 24px", display: "flex", flexDirection: "column", flexShrink: 0 }}>
          <GhostBtn onClick={() => setSelectedInvoice(null)}>← Back to Overview</GhostBtn>
          <PDFBtn invoiceId={selectedInvoice.id} invoiceNo={selectedInvoice.invoice_no} />
          <div style={{ marginTop: "20px", marginBottom: "4px", fontSize: "22px", ...serif, color: C.black }}>{selectedInvoice.billing_period}</div>
          <div style={{ fontSize: "11px", color: C.gray500, ...mono, marginBottom: "2px" }}>{selectedInvoice.invoice_no}</div>
          <div style={{ fontSize: "12px", color: C.gray700, marginBottom: "20px" }}>{selectedInvoice.consultant_name}</div>
          <HR /><div style={{ height: "20px" }} />
          <Label>Breakdown</Label>
          {[["Professional Fee", inr(selectedInvoice.professional_fee || 0)], ["Incentive", inr(selectedInvoice.incentive || 0)], ["Variable", inr(selectedInvoice.variable || 0)], ["TDS", `- ${inr(selectedInvoice.tds || 0)}`], ["Reimbursement", inr(selectedInvoice.reimbursement || 0)]].map(([l, v]) => (
            <div key={l} style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
              <span style={{ fontSize: "12px", color: C.gray500 }}>{l}</span>
              <span style={{ fontSize: "12px", ...mono }}>{v}</span>
            </div>
          ))}
          <HR my={12} />
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "24px" }}>
            <span style={{ fontWeight: "700" }}>Net Payable</span>
            <span style={{ fontWeight: "700", color: C.orange, ...mono }}>{inr(calcNet(selectedInvoice))}</span>
          </div>
          <div style={{ marginBottom: "20px" }}>
            <Label>Status</Label>
            <Badge status={selectedInvoice.status} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "auto" }}>
            {selectedInvoice.status === "sent" && (
              <OrangeBtn onClick={() => handleMarkPaid(selectedInvoice.id)} full>✓ Mark as Paid</OrangeBtn>
            )}
            {selectedInvoice.status === "pending" && (
              <button onClick={() => handleSendReminder(selectedInvoice)}
                style={{ width: "100%", background: reminderSent[selectedInvoice.id] ? C.green : C.black, color: C.white, border: "none", borderRadius: "7px", padding: "13px", fontSize: "13px", fontWeight: "600", cursor: "pointer", ...sans, transition: "background 0.3s" }}>
                {reminderSent[selectedInvoice.id] ? "✓ Reminder Sent" : reminderSending[selectedInvoice.id] ? "Sending..." : "Send Reminder →"}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...sans }}>
      {/* Tab bar */}
      <div style={{ borderBottom: `1px solid ${C.gray100}`, display: "flex", padding: "0 32px", background: C.white }}>
        {[["overview", "Overview"], ["upload", "Upload CSV"]].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} style={{ background: "none", border: "none", cursor: "pointer", padding: "14px 16px", fontSize: "13px", fontWeight: "600", color: tab === key ? C.black : C.gray500, borderBottom: `2px solid ${tab === key ? C.orange : "transparent"}`, marginBottom: "-1px", ...sans }}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Upload tab ── */}
      {tab === "upload" && (
        <div style={{ maxWidth: "720px", margin: "0 auto", padding: "36px 24px" }}>
          <div style={{ marginBottom: "32px" }}>
            <div style={{ fontSize: "34px", ...serif, color: C.black, marginBottom: "6px" }}>Monthly Upload</div>
            <div style={{ color: C.gray500, fontSize: "14px" }}>Upload the payroll CSV to pre-fill invoices for all consultants this month.</div>
          </div>
          <div onDragOver={e => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); e.dataTransfer.files[0] && processFile(e.dataTransfer.files[0]); }}
            onClick={() => fileRef.current.click()}
            style={{ border: `2px dashed ${dragOver ? C.orange : C.gray300}`, background: dragOver ? C.orangeLight : C.gray50, borderRadius: "10px", padding: "48px", textAlign: "center", cursor: "pointer", transition: "all 0.15s", marginBottom: "20px" }}>
            <input ref={fileRef} type="file" accept=".csv" style={{ display: "none" }} onChange={e => e.target.files[0] && processFile(e.target.files[0])} />
            <div style={{ fontSize: "32px", marginBottom: "10px" }}>📁</div>
            <div style={{ fontWeight: "600", fontSize: "15px", color: C.black, marginBottom: "4px" }}>{file ? file.name : "Drop CSV here or click to browse"}</div>
            <div style={{ fontSize: "12px", color: C.gray500 }}>Accepts .csv files only</div>
          </div>
          {uploading && <div style={{ background: C.orangeLight, border: `1px solid ${C.orangeBorder}`, borderRadius: "8px", padding: "14px 18px", color: C.orange, fontWeight: "600", marginBottom: "16px" }}>Processing CSV...</div>}
          {uploadError && <div style={{ background: C.redLight, border: `1px solid ${C.redBorder}`, borderRadius: "8px", padding: "14px 18px", color: C.red, marginBottom: "16px" }}><strong>Error:</strong> {uploadError}</div>}
          {result && (
            <div style={{ background: C.greenLight, border: `1px solid ${C.greenBorder}`, borderRadius: "8px", padding: "14px 18px", marginBottom: "20px" }}>
              <div style={{ color: C.green, fontWeight: "700", marginBottom: "2px" }}>✓ Upload successful</div>
              <div style={{ color: C.gray700, fontSize: "13px" }}>{result.count} consultant invoice(s) created and ready for review.</div>
            </div>
          )}
          {result?.rows?.length > 0 && (
            <div style={{ marginBottom: "28px", border: `1px solid ${C.gray100}`, borderRadius: "8px", overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                <thead style={{ background: C.gray50 }}>
                  <tr>{["Consultant ID", "Invoice No", "Period", "Prof. Fee", "TDS", "Net Payable"].map(h => <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: "10px", fontWeight: "700", color: C.gray500, letterSpacing: "0.5px", textTransform: "uppercase" }}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {result.rows.map((row, i) => {
                    const fee = +row.professional_fee || 0, inc = +row.incentive || 0, vari = +row.variable || 0, tds = +row.tds || 0, reimb = +row.reimbursement || 0;
                    const net = fee + inc + vari - tds + reimb;
                    return (
                      <tr key={i} style={{ borderTop: `1px solid ${C.gray100}` }}>
                        <td style={{ padding: "10px 14px", ...mono, color: C.orange, fontWeight: "600" }}>{row.consultant_id}</td>
                        <td style={{ padding: "10px 14px", ...mono }}>{row.invoice_no}</td>
                        <td style={{ padding: "10px 14px" }}>{row.billing_period}</td>
                        <td style={{ padding: "10px 14px", ...mono }}>{inr(fee)}</td>
                        <td style={{ padding: "10px 14px", ...mono, color: C.red }}>-{inr(tds)}</td>
                        <td style={{ padding: "10px 14px", ...mono, fontWeight: "700" }}>{inr(net)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ background: C.gray50, border: `1px solid ${C.gray100}`, borderRadius: "8px", padding: "20px 24px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "14px" }}>
              <div>
                <div style={{ fontWeight: "600", fontSize: "14px", color: C.black, marginBottom: "3px" }}>CSV Template</div>
                <div style={{ fontSize: "12px", color: C.gray500 }}>Required columns for the upload to work.</div>
              </div>
              <OrangeBtn onClick={downloadCSVTemplate}>Download Template</OrangeBtn>
            </div>
            <div style={{ background: C.white, border: `1px solid ${C.gray100}`, borderRadius: "6px", padding: "12px 14px", overflowX: "auto" }}>
              <code style={{ fontSize: "11px", color: C.gray700, ...mono, whiteSpace: "nowrap" }}>
                consultant_id, invoice_no, billing_period, professional_fee, incentive, variable, tds, reimbursement, total_days, working_days, lop_days, net_payable_days, bank_beneficiary, bank_name, bank_account, bank_ifsc
              </code>
            </div>
            <div style={{ marginTop: "12px", fontSize: "11px", color: C.gray500, lineHeight: "1.7" }}>
              <strong>Note:</strong> Bank columns are optional. Consultant must have signed in at least once before their invoice can be created.
            </div>
          </div>
        </div>
      )}

      {/* ── Overview tab ── */}
      {tab === "overview" && (
        <div style={{ maxWidth: "1000px", margin: "0 auto", padding: "36px 24px" }}>
          {/* Summary cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "14px", marginBottom: "32px" }}>
            {[
              { label: "Total Payout", value: inr(totalPayout), color: C.black, big: true },
              { label: "Pending", value: pendingCount, highlight: pendingCount > 0, color: C.orange },
              { label: "Sent", value: sentCount, color: C.green },
              { label: "Paid", value: paidCount, color: C.blue },
            ].map(({ label, value, highlight, color, big }) => (
              <div key={label} style={{ border: `1px solid ${highlight ? C.orange : C.gray100}`, background: highlight ? C.orangeLight : C.gray50, borderRadius: "8px", padding: "18px 20px" }}>
                <div style={{ fontSize: "10px", fontWeight: "700", letterSpacing: "1px", color: color || C.gray500, textTransform: "uppercase", marginBottom: "6px" }}>{label}</div>
                <div style={{ fontSize: big ? "18px" : "26px", fontWeight: "700", ...serif, color: color || C.black, ...(big ? mono : {}) }}>{value}</div>
              </div>
            ))}
          </div>

          {/* Filter + Refresh */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <div style={{ display: "flex", gap: "8px" }}>
              {[["all", "All"], ["pending", "Pending"], ["sent", "Sent"], ["paid", "Paid"]].map(([key, label]) => (
                <button key={key} onClick={() => setFilter(key)} style={{ padding: "6px 14px", borderRadius: "20px", border: `1px solid ${filter === key ? C.orange : C.gray300}`, background: filter === key ? C.orangeLight : C.white, color: filter === key ? C.orange : C.gray700, fontSize: "12px", fontWeight: "600", cursor: "pointer", ...sans }}>
                  {label}
                </button>
              ))}
            </div>
            <button onClick={fetchAllInvoices} style={{ background: "none", border: `1px solid ${C.gray300}`, borderRadius: "6px", padding: "6px 14px", fontSize: "12px", color: C.gray500, cursor: "pointer", ...sans }}>
              ↻ Refresh
            </button>
          </div>

          {/* Table */}
          {loadingInvoices ? (
            <div style={{ textAlign: "center", padding: "60px 0", color: C.gray300 }}>Loading invoices...</div>
          ) : fetchError ? (
            <div style={{ background: C.redLight, border: `1px solid ${C.redBorder}`, borderRadius: "8px", padding: "16px", color: C.red }}>{fetchError}</div>
          ) : filtered.length === 0 ? (
            <div style={{ textAlign: "center", padding: "60px 0", color: C.gray300, fontSize: "14px" }}>No invoices found.</div>
          ) : (
            <div style={{ border: `1px solid ${C.gray100}`, borderRadius: "10px", overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                <thead style={{ background: C.gray50 }}>
                  <tr>
                    {["Consultant", "ID", "Period", "Invoice No", "Amount", "Status", "Actions"].map(h => (
                      <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontSize: "10px", fontWeight: "700", color: C.gray500, letterSpacing: "0.5px", textTransform: "uppercase", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((inv, i) => (
                    <tr key={inv.id} style={{ borderTop: `1px solid ${C.gray100}`, background: i % 2 === 0 ? C.white : C.gray50 }}>
                      <td style={{ padding: "12px 16px" }}>
                        <div style={{ fontWeight: "600", fontSize: "13px" }}>{inv.consultant_name}</div>
                        <div style={{ fontSize: "11px", color: C.gray500 }}>{inv.consultant_email}</div>
                      </td>
                      <td style={{ padding: "12px 16px", ...mono, color: C.orange, fontWeight: "600" }}>{inv.consultant_id}</td>
                      <td style={{ padding: "12px 16px", fontWeight: "500" }}>{inv.billing_period}</td>
                      <td style={{ padding: "12px 16px", ...mono, fontSize: "12px", color: C.gray500 }}>{inv.invoice_no}</td>
                      <td style={{ padding: "12px 16px", ...mono, fontWeight: "700" }}>{inr(calcNet(inv))}</td>
                      <td style={{ padding: "12px 16px" }}><Badge status={inv.status} /></td>
                      <td style={{ padding: "12px 16px" }}>
                        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                          <button onClick={() => setSelectedInvoice(inv)}
                            style={{ padding: "5px 10px", background: C.gray100, border: "none", borderRadius: "5px", fontSize: "11px", cursor: "pointer", fontWeight: "600", ...sans }}>
                            View
                          </button>
                          {inv.status === "sent" && (
                            <button onClick={() => handleMarkPaid(inv.id)}
                              style={{ padding: "5px 10px", background: C.blueLight, border: `1px solid ${C.blueBorder}`, color: C.blue, borderRadius: "5px", fontSize: "11px", cursor: "pointer", fontWeight: "600", ...sans }}>
                              Mark Paid
                            </button>
                          )}
                          {inv.status === "pending" && (
                            <button onClick={() => handleSendReminder(inv)}
                              style={{ padding: "5px 10px", background: reminderSent[inv.id] ? C.greenLight : C.orangeLight, border: `1px solid ${reminderSent[inv.id] ? C.greenBorder : C.orangeBorder}`, color: reminderSent[inv.id] ? C.green : C.orange, borderRadius: "5px", fontSize: "11px", cursor: "pointer", fontWeight: "600", ...sans }}>
                              {reminderSent[inv.id] ? "✓ Sent" : reminderSending[inv.id] ? "..." : "Remind"}
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

// ─────────────────────────────────────────────────────────────────────────────
// ROOT
// ─────────────────────────────────────────────────────────────────────────────

export default function App() {
  const [screen, setScreen] = useState("login");
  const [user, setUser] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [activeInvoice, setActiveInvoice] = useState(null);
  const [showProfile, setShowProfile] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [darkMode, setDarkMode] = useState(false);

  useEffect(() => {
    document.body.classList.toggle("dark", darkMode);
  }, [darkMode]);

  useEffect(() => {
    let mounted = true;

    async function loadUser(session) {
      try {
        console.log("loadUser started:", session?.user?.email);
        const consultant = await fetchConsultant(session.user.email);
        console.log("consultant fetched:", consultant);

        if (!mounted) return;

        if (consultant) {
          setUser(consultant);
          const inv = await fetchInvoices();
          if (!mounted) return;
          setInvoices(inv);
          setScreen(consultant.consultant_id ? "dashboard" : "onboarding");
        } else {
          setUser({ email: session.user.email, name: session.user.user_metadata?.full_name || session.user.email });
          setScreen("onboarding");
        }
      } catch (err) {
        console.error("Load user error:", err);
        if (mounted) setScreen("login");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log("auth event:", event, session?.user?.email);

      if (event === "INITIAL_SESSION" || event === "SIGNED_IN") {
        if (session) {
          loadUser(session);
        } else {
          if (mounted) { setScreen("login"); setLoading(false); }
        }
      } else if (event === "SIGNED_OUT") {
        if (mounted) { setUser(null); setInvoices([]); setScreen("login"); setLoading(false); }
      }
    });

    return () => { mounted = false; subscription.unsubscribe(); };
  }, []);

  async function handleLogin() {
    try { await signInWithGoogle(); } catch (err) { console.error("Login error:", err); }
  }

  function handleOpen(inv) { setActiveInvoice(inv); setScreen("invoice"); }

  function handleSent() {
    setInvoices(prev => prev.map(i => i.id === activeInvoice.id ? { ...i, status: "sent", sent_at: new Date().toISOString() } : i));
    setActiveInvoice(null);
    setScreen("dashboard");
  }

  function handleUpdate(updatedInvoice) {
    setInvoices(prev => prev.map(i => i.id === updatedInvoice.id ? updatedInvoice : i));
    setActiveInvoice(updatedInvoice);
  }

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: C.white, display: "flex", alignItems: "center", justifyContent: "center", ...sans }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ width: "36px", height: "36px", background: C.orange, borderRadius: "8px", margin: "0 auto 16px", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ color: C.white, fontSize: "12px", fontWeight: "700", ...mono }}>NG</span>
          </div>
          <div style={{ color: C.gray500, fontSize: "13px" }}>Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <>
      <style>{`
  @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=IBM+Plex+Mono:wght@400;500;600&family=Geist:wght@400;500;600;700&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  input { outline: none; }
  ::-webkit-scrollbar { width: 4px; height: 4px; }
  ::-webkit-scrollbar-thumb { background: #CCCCCC; border-radius: 2px; }
  ::-webkit-scrollbar-track { background: transparent; }

  body.dark { background: #111; filter: invert(1) hue-rotate(180deg); }
  body.dark img, body.dark [style*="background: #E85D04"], body.dark [style*="background:#E85D04"] { filter: invert(1) hue-rotate(180deg); }
`}</style>

      {screen === "login" && <LoginScreen onLogin={handleLogin} />}

      {screen === "onboarding" && user && (
        <OnboardingScreen user={user} onComplete={(updatedUser) => { setUser(updatedUser); setScreen("dashboard"); }} />
      )}

      {screen !== "login" && screen !== "onboarding" && (
        <div style={{ minHeight: "100vh", background: C.white }}>
          <Topbar user={user} onProfile={() => setShowProfile(true)} isAdmin={isAdmin} onToggleAdmin={() => { setIsAdmin(a => !a); }} darkMode={darkMode}
            onToggleDark={() => setDarkMode(d => !d)} />
          {isAdmin
            ? <AdminScreen />
            : screen === "dashboard"
              ? <Dashboard user={user} invoices={invoices} onOpen={handleOpen} />
              : screen === "invoice" && activeInvoice
                ? <InvoiceScreen invoice={activeInvoice} user={user} onBack={() => setScreen("dashboard")} onSent={handleSent} onUpdate={handleUpdate} />
                : null
          }
          {showProfile && (
            <ProfileDrawer
              user={user}
              onClose={() => setShowProfile(false)}
              onSignOut={async () => {
                await supabase.auth.signOut();
                setUser(null); setScreen("login"); setShowProfile(false);
              }}
            />
          )}
        </div>
      )}
    </>
  );
}