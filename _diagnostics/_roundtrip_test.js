// Round-trip verification of the helpers in index.html against the live sheet data.
const fs = require("fs");

const html = fs.readFileSync("C:/Users/naiem/Downloads/payment-main/index.html", "utf8");
const js = html.match(/<script>([\s\S]*?)<\/script>/g).pop().replace(/^<script>|<\/script>$/g, "");

const stubEl = () => ({
  textContent: "", value: "", style: {}, innerHTML: "", className: "",
  classList: { add() {}, remove() {}, contains() { return false; } },
  options: [], appendChild() {}, remove() {}, removeAttribute() {}, setAttribute() {},
  querySelectorAll() { return []; }, querySelector() { return null; },
  closest() { return null; }, parentNode: null, addEventListener() {}
});
global.document = {
  addEventListener() {}, querySelectorAll() { return []; }, querySelector() { return null; },
  getElementById() { return stubEl(); }, createElement() { return stubEl(); },
  body: { classList: { add() {}, remove() {} } }
};
global.window = { addEventListener() {}, scrollTo() {}, print() {} };
global.fetch = async () => ({ ok: true, text: async () => JSON.stringify({ status: "success", data: [] }) });

eval(js);

const records = JSON.parse(fs.readFileSync("C:/Users/naiem/Downloads/payment-main/_records_dump.json", "utf8")).data;

let fail = 0;
const bad = [];
const FORM_OPTION_VALUES = new Set(["", "100%", "50%", "Immediate", "Net 7", "Net 15", "Net 30"]);
const FORM_CURRENCIES = new Set(["", "SAR", "USD", "EUR", "GBP", "AED"]);

for (const r of records) {
  // 1) Date must land in the <input type="date"> as a valid ISO value
  const iso = sheetDateToIso(r["Date"]);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) { fail++; bad.push(["date", r["Request Number"], r["Date"], iso]); }

  // 2) Payment Terms must map onto a value the form can display
  const terms = termsLabel(r["Payment Terms"]);
  if (!FORM_OPTION_VALUES.has(terms)) { fail++; bad.push(["terms", r["Request Number"], r["Payment Terms"], terms]); }

  // 3) Amount must never render as NaN / undefined
  const amt = formatAmount(r["Total Amount"]);
  if (!/^\d{1,3}(,\d{3})*\.\d{2}$/.test(amt)) { fail++; bad.push(["amount", r["Request Number"], r["Total Amount"], amt]); }

  // 4) Currency must be displayable
  if (!FORM_CURRENCIES.has(String(r["Currency"] || "").toUpperCase())) { fail++; bad.push(["currency", r["Request Number"], r["Currency"], ""]); }
}

// 5) The number that gets POSTed must be a clean numeric value
const posted = parseAmount("1,234.56");
if (posted !== 1234.56) { fail++; bad.push(["post-amount", "-", "1,234.56", posted]); }

// 6) Every stored Date must round-trip back to the same calendar day
let dayMismatch = 0;
for (const r of records) {
  const iso = sheetDateToIso(r["Date"]);
  const [y, m, d] = iso.split("-");
  const [dd, mm] = String(r["Date"]).split("/");
  if (Number(mm) !== Number(m) || Number(dd) !== Number(d)) { dayMismatch++; }
}

console.log("records checked :", records.length);
console.log("field failures  :", fail);
console.log("date day mismatches:", dayMismatch);
console.log("sample terms map  :", [...new Set(records.map(r => termsLabel(r["Payment Terms"])))].join(" | "));
console.log("sample iso dates  :", [...new Set(records.slice(-3).map(r => sheetDateToIso(r["Date"])))].join(" | "));
console.log("sample amounts    :", records.slice(-3).map(r => formatAmount(r["Total Amount"])).join(" | "));
if (bad.length) console.log("FAILURES:", JSON.stringify(bad.slice(0, 10), null, 1));
console.log(fail === 0 && dayMismatch === 0 ? "RESULT: ALL CHECKS PASSED" : "RESULT: CHECKS FAILED");
