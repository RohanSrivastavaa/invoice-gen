// lib/InvoicePDF.jsx
// Renders the invoice as a proper PDF using @react-pdf/renderer
// Used both for download and for email attachment

import {
  Document, Page, Text, View, StyleSheet, Font
} from "@react-pdf/renderer";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toWords(n) {
  if (n === 0) return "Zero";
  const ones = ["","One","Two","Three","Four","Five","Six","Seven","Eight","Nine","Ten",
    "Eleven","Twelve","Thirteen","Fourteen","Fifteen","Sixteen","Seventeen","Eighteen","Nineteen"];
  const tens = ["","","Twenty","Thirty","Forty","Fifty","Sixty","Seventy","Eighty","Ninety"];
  if (n < 20) return ones[n];
  if (n < 100) return tens[Math.floor(n/10)] + (n%10 ? " "+ones[n%10] : "");
  if (n < 1000) return ones[Math.floor(n/100)]+" Hundred"+(n%100?" "+toWords(n%100):"");
  if (n < 100000) return toWords(Math.floor(n/1000))+" Thousand"+(n%1000?" "+toWords(n%1000):"");
  if (n < 10000000) return toWords(Math.floor(n/100000))+" Lakh"+(n%100000?" "+toWords(n%100000):"");
  return toWords(Math.floor(n/10000000))+" Crore"+(n%10000000?" "+toWords(n%10000000):"");
}

const inr = n => "Rs. " + Number(n).toLocaleString("en-IN");
const calcNet = inv =>
  inv.professional_fee + inv.incentive + inv.variable - inv.tds + inv.reimbursement;

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#111111",
    paddingTop: 48,
    paddingBottom: 48,
    paddingLeft: 52,
    paddingRight: 52,
    backgroundColor: "#FFFFFF",
  },

  // Header
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 },
  invoiceTitle: { fontSize: 28, fontFamily: "Helvetica-Bold", letterSpacing: -0.5, color: "#111111" },
  invoiceNo: { fontSize: 10, color: "#777777", marginTop: 4, fontFamily: "Courier" },
  periodBadge: { backgroundColor: "#E85D04", color: "#FFFFFF", borderRadius: 4, paddingVertical: 4, paddingHorizontal: 10, fontSize: 10, fontFamily: "Helvetica-Bold", textAlign: "center" },
  periodLabel: { fontSize: 9, color: "#777777", marginTop: 4, textAlign: "right" },

  // Divider
  divider: { height: 1, backgroundColor: "#F0F0F0", marginVertical: 16 },
  dividerDark: { height: 2, backgroundColor: "#111111", marginBottom: 8 },

  // Two-col layout
  row2: { flexDirection: "row", gap: 32, marginBottom: 20 },
  col: { flex: 1 },

  // Labels
  sectionLabel: { fontSize: 8, fontFamily: "Helvetica-Bold", letterSpacing: 1, color: "#777777", textTransform: "uppercase", marginBottom: 8 },
  fieldLabel: { fontSize: 8, color: "#777777", marginBottom: 2 },
  fieldValue: { fontSize: 10, fontFamily: "Helvetica-Bold" },
  monoValue: { fontSize: 10, fontFamily: "Courier" },

  // Service days box
  daysBox: { backgroundColor: "#F8F8F8", borderWidth: 1, borderColor: "#F0F0F0", borderRadius: 4, padding: 14, marginBottom: 20 },
  daysRow: { flexDirection: "row" },
  dayCell: { flex: 1, alignItems: "center" },
  dayNumber: { fontSize: 20, fontFamily: "Helvetica-Bold", color: "#111111" },
  dayLabel: { fontSize: 8, color: "#777777", marginTop: 2 },

  // Table
  tableHeader: { flexDirection: "row", borderBottomWidth: 2, borderBottomColor: "#111111", paddingBottom: 6, marginBottom: 2 },
  tableHeaderText: { fontSize: 8, fontFamily: "Helvetica-Bold", letterSpacing: 1, color: "#777777", textTransform: "uppercase" },
  tableRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#F0F0F0", paddingVertical: 8 },
  tableCell: { flex: 1, fontSize: 10, color: "#444444" },
  tableCellRight: { fontSize: 10, textAlign: "right", fontFamily: "Courier", color: "#444444" },
  tableCellBold: { flex: 1, fontSize: 10, fontFamily: "Helvetica-Bold" },
  tableCellBoldRight: { fontSize: 10, textAlign: "right", fontFamily: "Courier-Bold" },
  tableCellRed: { flex: 1, fontSize: 10, color: "#DC2626" },
  tableCellRedRight: { fontSize: 10, textAlign: "right", fontFamily: "Courier", color: "#DC2626" },

  // Net payable bar
  netBar: { backgroundColor: "#111111", borderRadius: 4, flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 12, paddingHorizontal: 16, marginBottom: 6 },
  netLabel: { fontSize: 12, fontFamily: "Helvetica-Bold", color: "#FFFFFF" },
  netAmount: { fontSize: 16, fontFamily: "Courier-Bold", color: "#FFFFFF" },
  netWords: { fontSize: 9, color: "#777777", fontStyle: "italic", marginBottom: 20 },

  // Bank details
  bankGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginBottom: 28 },
  bankCell: { width: "47%" },

  // Signature
  signatureRow: { flexDirection: "row", justifyContent: "flex-end" },
  signatureLine: { width: 150, borderBottomWidth: 1, borderBottomColor: "#CCCCCC", paddingBottom: 40 },
  signatureLabel: { fontSize: 8, color: "#777777", marginTop: 6, textAlign: "center" },

  // Footer
  footer: { position: "absolute", bottom: 24, left: 52, right: 52 },
  footerText: { fontSize: 8, color: "#CCCCCC", textAlign: "center" },
});

// ─── Component ────────────────────────────────────────────────────────────────

export function InvoicePDF({ invoice, consultant, company }) {
  const net = calcNet(invoice);
  const total = invoice.professional_fee + invoice.incentive + invoice.variable;

  // Use CSV bank details if present, otherwise fall back to consultant's saved details
  const bank = {
    beneficiaryName: invoice.bank_beneficiary || consultant.bank_beneficiary,
    bankName:        invoice.bank_name        || consultant.bank_name,
    accountNumber:   invoice.bank_account     || consultant.bank_account,
    ifscCode:        invoice.bank_ifsc        || consultant.bank_ifsc,
  };

  return (
    <Document>
      <Page size="A4" style={s.page}>

        {/* ── Header ── */}
        <View style={s.headerRow}>
          <View>
            <Text style={s.invoiceTitle}>Invoice</Text>
            <Text style={s.invoiceNo}>{invoice.invoice_no}</Text>
          </View>
          <View>
            <Text style={s.periodBadge}>{invoice.billing_period}</Text>
            <Text style={s.periodLabel}>Billing Period</Text>
          </View>
        </View>

        <View style={s.divider} />

        {/* ── From / Bill To ── */}
        <View style={s.row2}>
          <View style={s.col}>
            <Text style={s.sectionLabel}>From</Text>
            <Text style={[s.fieldValue, { marginBottom: 6 }]}>{consultant.name}</Text>
            <Text style={s.monoValue}>PAN: {consultant.pan}</Text>
            {consultant.gstin ? <Text style={s.monoValue}>GSTIN: {consultant.gstin}</Text> : null}
            <Text style={s.monoValue}>ID: {consultant.consultant_id}</Text>
          </View>
          <View style={s.col}>
            <Text style={s.sectionLabel}>Bill To</Text>
            <Text style={[s.fieldValue, { marginBottom: 6 }]}>{company.name}</Text>
            <Text style={{ fontSize: 10, color: "#444444", lineHeight: 1.5 }}>{company.address}</Text>
          </View>
        </View>

        {/* ── Service Days ── */}
        <View style={s.daysBox}>
          <Text style={[s.sectionLabel, { marginBottom: 12 }]}>Service Days Summary</Text>
          <View style={s.daysRow}>
            {[
              ["Total Days",       invoice.total_days],
              ["Working Days",     invoice.working_days],
              ["LOP Days",         invoice.lop_days],
              ["Net Payable Days", invoice.net_payable_days],
            ].map(([label, value]) => (
              <View key={label} style={s.dayCell}>
                <Text style={s.dayNumber}>{value}</Text>
                <Text style={s.dayLabel}>{label}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* ── Payment Table ── */}
        <Text style={s.sectionLabel}>Payment Details</Text>
        <View style={s.tableHeader}>
          <Text style={[s.tableHeaderText, { flex: 1 }]}>Description</Text>
          <Text style={[s.tableHeaderText, { textAlign: "right" }]}>Amount (Rs.)</Text>
        </View>

        {[
          ["Professional Fee",             invoice.professional_fee, false, false],
          ["Incentive",                    invoice.incentive,        false, false],
          ["Variable / Bonus / Referral",  invoice.variable,         false, false],
        ].map(([label, val]) => (
          <View key={label} style={s.tableRow}>
            <Text style={s.tableCell}>{label}</Text>
            <Text style={s.tableCellRight}>{val.toLocaleString("en-IN")}</Text>
          </View>
        ))}

        <View style={s.tableRow}>
          <Text style={s.tableCellBold}>Total Amount</Text>
          <Text style={s.tableCellBoldRight}>{total.toLocaleString("en-IN")}</Text>
        </View>

        <View style={s.tableRow}>
          <Text style={s.tableCellRed}>TDS @ 10%</Text>
          <Text style={s.tableCellRedRight}>({invoice.tds.toLocaleString("en-IN")})</Text>
        </View>

        <View style={[s.tableRow, { marginBottom: 12 }]}>
          <Text style={s.tableCell}>Reimbursement</Text>
          <Text style={s.tableCellRight}>{invoice.reimbursement.toLocaleString("en-IN")}</Text>
        </View>

        {/* ── Net Payable ── */}
        <View style={s.netBar}>
          <Text style={s.netLabel}>Net Payable</Text>
          <Text style={s.netAmount}>{net.toLocaleString("en-IN")}</Text>
        </View>
        <Text style={s.netWords}>{toWords(net)} Rupees Only</Text>

        <View style={s.divider} />

        {/* ── Bank Details ── */}
        <Text style={s.sectionLabel}>Bank Details</Text>
        <View style={s.bankGrid}>
          {[
            ["Beneficiary Name", bank.beneficiaryName],
            ["Bank Name",        bank.bankName],
            ["Account Number",   bank.accountNumber],
            ["IFSC Code",        bank.ifscCode],
          ].map(([label, value]) => (
            <View key={label} style={s.bankCell}>
              <Text style={s.fieldLabel}>{label}</Text>
              <Text style={s.monoValue}>{value || "—"}</Text>
            </View>
          ))}
        </View>

        {/* ── Signature ── */}
        <View style={s.signatureRow}>
          <View>
            <View style={s.signatureLine} />
            <Text style={s.signatureLabel}>Consultant Signature</Text>
          </View>
        </View>

        {/* ── Footer ── */}
        <View style={s.footer}>
          <Text style={s.footerText}>
            {company.name}  ·  Generated via Invoice Portal  ·  {invoice.invoice_no}
          </Text>
        </View>

      </Page>
    </Document>
  );
}
