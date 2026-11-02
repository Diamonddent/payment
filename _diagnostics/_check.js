
// CONFIGURATION
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwxsFGasGrnDBUfv-iavj4y5T5ODk-FCBjney_TrNf5OSByQ9OSAPHvr7vpthyyczHnPw/exec";

// STATE
let beneficiaries = [];
let filteredBens = [];
let selectedBen = null;
let allRecords = [];
let lastKnownRequestNumber = 0;

/* =========================================================
   SHARED HELPERS
   ========================================================= */

// Fetch + parse. Surfaces the REAL server error instead of a silent "network error".
async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error(`Server did not return JSON (HTTP ${res.status}). Response: ${text.slice(0, 180)}`);
  }
  if (!res.ok) {
    throw new Error(`Server error ${res.status}: ${(json && json.message) || text.slice(0, 180)}`);
  }
  return json;
}

function pad2(v) { return String(v).padStart(2, "0"); }

// Amount: thousand separators are stripped before reading / sending
function parseAmount(v) {
  const n = parseFloat(String(v == null ? "" : v).replace(/,/g, "").trim());
  return isFinite(n) ? n : null;
}
function formatAmount(v) {
  const n = parseAmount(v);
  if (n === null) return "";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatAmountOnInput(el) {
  let v = String(el.value).replace(/[^\d.]/g, "");
  const parts = v.split(".");
  if (parts.length > 2) v = parts.shift() + "." + parts.join(".");
  if (parts.length === 2) v = parts[0] + "." + parts[1].slice(0, 2);
  el.value = v;
}
function formatAmountOnBlur(el) {
  const n = parseAmount(el.value);
  el.value = n === null ? "" : formatAmount(n);
}

// Sheet "Date" column is DD/MM/YYYY -> value for <input type="date">
function sheetDateToIso(v) {
  const s = String(v == null ? "" : v).trim();
  if (!s) return "";
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    const day = +m[1], mon = +m[2], year = +m[3];
    if (mon >= 1 && mon <= 12 && day >= 1 && day <= 31) return `${year}-${pad2(mon)}-${pad2(day)}`;
  }
  return "";
}

// Sheet stores Payment Terms as a fraction: 1 = 100%, 0.5 = 50%
function termsLabel(v) {
  const s = String(v == null ? "" : v).trim();
  if (!s) return "";
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    const n = parseFloat(s);
    if (n === 0) return "";
    if (n === 1) return "100%";
    if (n > 0 && n < 1) return `${(n * 100).toFixed(2).replace(/\.?0+$/, "")}%`;
    return s;
  }
  return s;
}

// Maps submission-form field id -> sheet column name
const RECORD_FIELD_MAP = [
  ["requestNumber",     "Request Number",   "text"],
  ["date",              "Date",             "date"],
  ["totalAmount",       "Total Amount",     "text"],
  ["currency",          "Currency",         "select"],
  ["paymentConcern",    "Payment Concern",  "text"],
  ["anotherNote",       "Another Note",     "text"],
  ["paymentTerms",      "Payment Terms",    "select"],
  ["beneficiarySearch", "Beneficiary Name", "text"],
  ["bankName",          "Bank Name",        "text"],
  ["ibanNo",            "IBAN No",          "text"],
  ["requesterName",     "Requester Name",   "text"],
  ["position",          "Position",         "text"]
];

// INIT
document.addEventListener("DOMContentLoaded", () => {
  setToday();
  loadBeneficiaries();
  getNextRequestNumber();
  document.addEventListener("click", e => {
    if (!document.getElementById("benWrap").contains(e.target)) closeBenDropdown();
  });
  // Delegated handler for the "Create New" option - user input is never inlined into JS
  document.getElementById("benDropdown").addEventListener("mousedown", e => {
    const opt = e.target.closest("[data-create-ben]");
    if (opt) createNewBeneficiary(opt.getAttribute("data-create-ben"));
  });
  window.addEventListener("afterprint", () => {
    document.body.classList.remove("print-record");
  });
});

function setToday() {
  document.getElementById("date").value = new Date().toISOString().split("T")[0];
}

// GET SERIAL REQUEST NUMBER FROM SHEET
async function getNextRequestNumber() {
  try {
    console.log("Fetching last request number...");
    const json = await fetchJson(`${SCRIPT_URL}?type=getLastRequestNumber`);
    console.log("Server response:", json);

    let lastNum = 0;
    if (json.status === "success" && json.lastNumber !== undefined && json.lastNumber !== null) {
      lastNum = parseInt(json.lastNumber) || 0;
    }

    lastKnownRequestNumber = lastNum;
    const nextNum = lastNum + 1;
    const paddedNum = String(nextNum).padStart(6, '0');
    const reqNum = `REQ-${paddedNum}`;

    console.log(`Last number: ${lastNum}, Next number: ${nextNum}, Request number: ${reqNum}`);

    document.getElementById("requestNumber").value = reqNum;
    document.getElementById("badge-req").textContent = reqNum;
  } catch (err) {
    console.error("Error getting request number:", err);
    // Fall back to the last number we successfully read (never a random/time based id)
    const fallback = "REQ-" + String(lastKnownRequestNumber + 1).padStart(6, "0");
    document.getElementById("requestNumber").value = fallback;
    document.getElementById("badge-req").textContent = fallback;
    showToast("Could not reach server for the next number (" + err.message + ")", "error");
  }
}

// LOAD BENEFICIARIES
async function loadBeneficiaries() {
  try {
    const json = await fetchJson(`${SCRIPT_URL}?type=beneficiaries`);
    if (json.status === "success" && json.data.length) {
      beneficiaries = json.data;
      filteredBens = [...beneficiaries];
      document.getElementById("benLoadStatus").textContent = `(${beneficiaries.length} saved)`;
      renderBenOptions(beneficiaries, "");
    } else {
      document.getElementById("benLoadStatus").textContent = "(no beneficiaries)";
      document.getElementById("benDropdown").innerHTML = `<div class="ben-option" style="color:var(--gray-400);text-align:center">No beneficiaries found</div>`;
    }
  } catch (err) {
    console.error("Error loading beneficiaries:", err);
    document.getElementById("benLoadStatus").textContent = "(load failed)";
    showToast("Beneficiaries not loaded: " + err.message, "error");
  }
}

// UPDATED: renderBenOptions with searchText parameter for "Create New" option
function renderBenOptions(list, searchText = "") {
  const dd = document.getElementById("benDropdown");
  
  // If no matches found AND user is searching for something - show "Create New" option
  if (!list.length && searchText.trim()) {
    dd.innerHTML = `<div class="ben-option" data-create-ben="${escapeAttr(searchText)}">
      <strong><i class="fas fa-plus-circle"></i> Create New: "${escapeHtml(searchText)}"</strong>
      <small>Click to add as new beneficiary</small>
    </div>`;
    return;
  }
  
  // If no matches and no search text (empty list)
  if (!list.length) {
    dd.innerHTML = `<div class="ben-option" style="color:var(--gray-400);text-align:center"><i class="fas fa-info-circle"></i> No beneficiaries found</div>`;
    return;
  }
  
  // Show matching beneficiaries
  dd.innerHTML = list.map((b, i) => `
    <div class="ben-option" onmousedown="selectBeneficiary(${i})">
      <strong>${escapeHtml(b.name)}</strong>
      <small>${escapeHtml(b.bankName || '')} · ${escapeHtml(b.iban || '')}</small>
    </div>
  `).join("");
}

// NEW FUNCTION: Create new beneficiary from search text
function createNewBeneficiary(name) {
  document.getElementById("beneficiarySearch").value = name;
  document.getElementById("bankName").value = "";
  document.getElementById("ibanNo").value = "";
  selectedBen = null;
  closeBenDropdown();
  showToast(`Enter bank details for "${name}"`, "success");
  document.getElementById("bankName").focus();
}

// UPDATED: filterBeneficiaries with searchText parameter
function filterBeneficiaries(q) {
  openBenDropdown();
  selectedBen = null;
  
  if (!q.trim()) {
    filteredBens = [...beneficiaries];
    renderBenOptions(filteredBens, "");
  } else {
    const lower = q.toLowerCase();
    filteredBens = beneficiaries.filter(b =>
      b.name.toLowerCase().includes(lower) ||
      (b.iban || "").toLowerCase().includes(lower) ||
      (b.bankName || "").toLowerCase().includes(lower)
    );
    renderBenOptions(filteredBens, q);
  }
}

function selectBeneficiary(idx) {
  const ben = filteredBens[idx];
  if (!ben) return;
  selectedBen = ben;
  document.getElementById("beneficiarySearch").value = ben.name;
  document.getElementById("bankName").value = ben.bankName || "";
  document.getElementById("ibanNo").value = ben.iban || "";
  closeBenDropdown();
}

function openBenDropdown() {
  document.getElementById("benDropdown").classList.add("open");
}

function closeBenDropdown() {
  document.getElementById("benDropdown").classList.remove("open");
}

function delayCloseDrop() {
  setTimeout(closeBenDropdown, 200);
}

// SUBMIT FORM
async function submitForm() {
  const required = [
    { id: "currency", label: "Currency" },
    { id: "paymentConcern", label: "Payment Concern" },
    { id: "requesterName", label: "Requester Name" }
  ];

  for (const req of required) {
    if (!document.getElementById(req.id).value.trim()) {
      showToast(`Please fill in: ${req.label}`, "error");
      return;
    }
  }

  const amount = parseAmount(document.getElementById("totalAmount").value);
  if (amount === null) {
    showToast("Please enter a valid Total Amount", "error");
    return;
  }

  const benName = document.getElementById("beneficiarySearch").value.trim();
  if (!benName) {
    showToast("Please enter or select a Beneficiary", "error");
    return;
  }

  const btn = document.getElementById("btnSubmit");
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Submitting...';

  const existingBen = beneficiaries.find(b => b.name.toLowerCase() === benName.toLowerCase());
  const isNewBen = !existingBen;

  const payload = {
    requestNumber: document.getElementById("requestNumber").value,
    date: document.getElementById("date").value,
    totalAmount: amount,
    currency: document.getElementById("currency").value,
    paymentConcern: document.getElementById("paymentConcern").value,
    anotherNote: document.getElementById("anotherNote").value,
    paymentTerms: document.getElementById("paymentTerms").value,
    beneficiaryName: benName,
    bankName: document.getElementById("bankName").value,
    ibanNo: document.getElementById("ibanNo").value,
    requesterName: document.getElementById("requesterName").value,
    position: document.getElementById("position").value,
    isNewBeneficiary: isNewBen
  };

  try {
    const json = await fetchJson(SCRIPT_URL, { method: "POST", body: JSON.stringify(payload) });

    if (json.status === "success") {
      showToast(isNewBen ? "✓ New beneficiary added & request submitted!" : "✓ Payment request submitted!", "success");
      resetForm();
      await loadBeneficiaries();
      await getNextRequestNumber();
    } else {
      showToast("Error: " + (json.message || "server rejected the request"), "error");
    }
  } catch (err) {
    console.error("Submit error:", err);
    showToast("Submit failed: " + err.message, "error");
  }

  btn.disabled = false;
  btn.innerHTML = '<i class="fas fa-paper-plane"></i> Submit Payment Request';
}

function resetForm() {
  document.getElementById("totalAmount").value = "";
  document.getElementById("currency").value = "";
  document.getElementById("paymentConcern").value = "";
  document.getElementById("anotherNote").value = "";
  document.getElementById("paymentTerms").value = "";
  document.getElementById("bankName").value = "";
  document.getElementById("ibanNo").value = "";
  document.getElementById("beneficiarySearch").value = "";
  document.getElementById("requesterName").value = "";
  document.getElementById("position").value = "";
  selectedBen = null;
  setToday();
}

function switchTab(tab, btn) {
  document.querySelectorAll(".tab-content").forEach(el => el.classList.remove("active"));
  document.querySelectorAll("nav button").forEach(el => el.classList.remove("active"));
  document.getElementById("tab-" + tab).classList.add("active");
  btn.classList.add("active");
  if (tab === "records") loadRecords();
}

async function loadRecords(query = "") {
  const tbody = document.getElementById("recordsBody");
  tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px"><i class="fas fa-spinner fa-spin"></i> Loading...</td></tr>`;

  try {
    const url = `${SCRIPT_URL}?type=records${query ? "&q=" + encodeURIComponent(query) : ""}`;
    const json = await fetchJson(url);

    if (json.status === "success") {
      allRecords = json.data || [];
      renderTable(allRecords);
    } else {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px">Error: ${escapeHtml(json.message || "unknown server error")}</td></tr>`;
    }
  } catch (err) {
    console.error("Load records error:", err);
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px"><i class="fas fa-exclamation-triangle"></i> ${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderTable(data) {
  const tbody = document.getElementById("recordsBody");
  document.getElementById("recordsCount").textContent = data.length + " record(s)";

  if (!data.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:60px"><i class="fas fa-inbox"></i> No records found</td></tr>`;
    return;
  }

  tbody.innerHTML = data.map((r, i) => `
    <tr>
      <td style="font-weight:600;color:var(--accent)">${escapeHtml(r["Request Number"] || "-")}</td>
      <td>${escapeHtml(r["Date"] || "-")}</td>
      <td>${escapeHtml(r["Beneficiary Name"] || "-")}</td>
      <td style="font-weight:600">${escapeHtml(formatAmount(r["Total Amount"]) || "-")}</td>
      <td>${escapeHtml(r["Currency"] || "-")}</td>
      <td>${escapeHtml(r["Requester Name"] || "-")}</td>
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(r["Payment Concern"] || "-")}</td>
      <td style="white-space:nowrap">
        <button class="btn-view" onclick="openRecord(${i})"><i class="fas fa-eye"></i> View</button>
        <button class="btn-view" onclick="openRecord(${i}, true)" title="Open and print / save as PDF"><i class="fas fa-file-pdf"></i> PDF</button>
      </td>
    </tr>
  `).join("");
}

function searchRecords() {
  loadRecords(document.getElementById("searchInput").value.trim());
}

function clearSearch() {
  document.getElementById("searchInput").value = "";
  loadRecords();
}

/* =========================================================
   RECORD VIEW
   The saved request is rendered by cloning the submission
   form card, so the layout is identical by construction.
   ========================================================= */
function openRecord(idx, autoPrint) {
  const rec = allRecords[idx];
  if (!rec) {
    showToast("Record not found", "error");
    return;
  }

  const src = document.getElementById("tab-form").querySelector(".form-card");
  const card = src.cloneNode(true);

  // Collect the fields by id, then remove the ids (keeps the document id-unique)
  const byId = {};
  card.querySelectorAll("[id]").forEach(el => {
    byId[el.id] = el;
    el.removeAttribute("id");
  });

  // Strip every inline handler from the clone
  card.querySelectorAll("*").forEach(el => {
    ["oninput", "onblur", "onfocus", "onkeydown", "onmousedown", "onclick", "onchange"]
      .forEach(a => el.removeAttribute(a));
  });

  card.classList.add("record-sheet");

  // Header: request number + submission timestamp
  const badge = byId["badge-req"];
  badge.textContent = rec["Request Number"] || "-";
  const header = badge.parentNode;
  const headRight = document.createElement("div");
  headRight.className = "record-head-right";
  const meta = document.createElement("div");
  meta.className = "record-meta";
  meta.textContent = "Submitted: " + (rec["Submitted At"] || "-");
  header.insertBefore(headRight, badge);
  headRight.appendChild(badge);
  headRight.appendChild(meta);

  // Fill the form fields from the sheet columns
  RECORD_FIELD_MAP.forEach(([id, col, kind]) => {
    const el = byId[id];
    if (!el) return;
    const raw = rec[col];
    let value = raw == null ? "" : String(raw).trim();

    if (id === "date") value = sheetDateToIso(raw);
    else if (id === "paymentTerms") value = termsLabel(raw);
    else if (id === "totalAmount") value = formatAmount(raw);
    else if (id === "currency") value = value.toUpperCase();

    if (kind === "select") {
      const known = Array.prototype.some.call(el.options, o => o.value === value);
      if (value && !known) {
        const opt = document.createElement("option");
        opt.value = value;
        opt.textContent = value;
        el.appendChild(opt);
      }
      el.value = value;
    } else {
      el.value = value;
    }
  });

  // The beneficiary lookup dropdown is not needed on a read-only record
  if (byId["benDropdown"]) byId["benDropdown"].remove();
  if (byId["benLoadStatus"]) byId["benLoadStatus"].remove();

  // Read-only controls
  card.querySelectorAll("input,textarea").forEach(el => {
    el.setAttribute("readonly", "readonly");
    el.removeAttribute("placeholder");
  });
  card.querySelectorAll("select").forEach(el => { el.disabled = true; });

  // Actions (hidden automatically when printing)
  const btnRow = card.querySelector(".btn-row");
  if (btnRow) {
    btnRow.innerHTML = `
      <button class="btn-submit" onclick="printRecord()"><i class="fas fa-print"></i> Print / Save as PDF</button>
      <button class="btn-print" onclick="backToRecords()"><i class="fas fa-arrow-left"></i> Back to Records</button>`;
  }

  const host = document.getElementById("recordSheetHost");
  host.innerHTML = "";
  host.appendChild(card);
  document.getElementById("recordEmpty").style.display = "none";
  document.getElementById("navRecord").style.display = "";

  switchTab("record", document.getElementById("navRecord"));
  window.scrollTo(0, 0);

  if (autoPrint) setTimeout(printRecord, 150);
}

function backToRecords() {
  switchTab("records", document.getElementById("navRecords"));
}

// Print the loaded record only (print CSS honours the print-record mode)
function printRecord() {
  document.body.classList.add("print-record");
  setTimeout(() => window.print(), 60);
}

function printForm() {
  document.body.classList.remove("print-record");
  window.print();
}

function showToast(msg, type = "") {
  const t = document.getElementById("toast");
  t.innerHTML = `<i class="fas ${type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle'}"></i> ${msg}`;
  t.className = "show " + type;
  setTimeout(() => { t.className = ""; }, 3500);
}

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str).replace(/[&<>"']/g, function(m) {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    if (m === '"') return '&quot;';
    if (m === "'") return '&#39;';
    return m;
  });
}

// Values that are placed inside an HTML attribute
function escapeAttr(str) {
  return escapeHtml(str);
}
