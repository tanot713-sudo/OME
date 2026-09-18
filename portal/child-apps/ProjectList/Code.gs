/**
 * OMA Operation & Maintenance — Project Dashboard
 * Google Apps Script backend. Reads LIVE from the project Google Sheet.
 *
 * ── SETUP ─────────────────────────────────────────────────────────────
 * 1. Open your Google Sheet (the "Project List OMA" data).
 * 2. Extensions ▸ Apps Script.
 * 3. Create two files: Code.gs (this file) and Index.html.
 * 4. Set SHEET_NAME below to match your data tab name.
 * 5. Deploy ▸ New deployment ▸ Web app ▸ Execute as "Me", access as you wish.
 * 6. Edit the Sheet anytime — the dashboard reflects changes on reload.
 * ──────────────────────────────────────────────────────────────────────
 */
// ===== CONFIG =====
var SHEET_NAME = 'Project List OMA';   // <-- change if your tab is named differently
var BOND_SHEET_NAME = 'Bond Data';     // <-- separate tab for bonds (one row per bond; a project can have many)
var EXCLUDED_ITEMS = [172, 173];       // Green Line / Gold Line outliers — never shown or counted
var GAP_THRESHOLD_DAYS = 120;          // > this gap between MA renewals = a "loss period"
var TREND_START_YEAR = 2016;           // year-based charts (Value Trend, Loss line) start here
// Column header text as it appears in row 1 of the sheet (trimmed match).
var COL = {
  item:        'Item',
  type:        'Type',
  customer:    'Customer',
  ref:         'Ref. Code',
  contractNo:  'Contract No.',
  name:        'Project Name',
  start:       'Contract Start Date',
  end:         'Contract End Date',
  period:      'Contract Period',
  handoverDate:'Handover Date',        // the day OMA actually received the work (warranty-in)
  statusC:     'Status Contract',
  statusERP:   'Status Project @ ERP',
  leader:      'Maintenance Leader',
  valueExVat:  'Project Value (Ex Vat)  (Baht)',
  closed:      'Closed Project Date',
  docUrl:      'Document Link',
  bgNo:        'BG No.',
  bgBank:      'BG Bank',
  bgAmount:    'BG Amount',
  bgExpiry:    'BG Expiry',
  bgStatus:    'BG Status'
};
// Column headers for the separate "Bond Data" tab (one row = one bond).
// Ref. Code links each bond to its project. A project can have several bonds.
var BOND_COL = {
  ref:            'Ref. Code',        // links to project
  bondType:       'Bond Type',        // Bank Guarantee / Final Installment / Retention / ...
  bank:           'Bank',
  bondNo:         'Bond No.',
  amount:         'Amount',
  issueDate:      'Issue Date',
  expiry:         'Expiry',
  status:         'Status',           // Active / Returned / Overdue (auto); Returned may also be in Note
  note:           'Note'
};
// The optional "Closure Tracking" tab: one row per outstanding closure issue.
var CLOSURE_SHEET_NAME = 'Closure Tracking';
var CLOSURE_COL = {
  ref:         'Ref. Code',
  subject:     'Subject',
  reviewer:    'Reviewer',
  outstanding: 'Outstanding (Yes/No)',
  documents:   'Documents',
  details:     'Details',
  amount:      'Amount',
  vendor:      'Vendor',
  asOf:        'As of Date',
  actionBy:    'Action By',
  note:        'Note'
};
// The optional "Frontlog" tab: expected incoming work (pipeline), one row per opportunity.
var FRONTLOG_SHEET_NAME = 'Frontlog';
// Frontlog = implementation projects that will be handed over to OMA (warranty-in).
// Expected_Warranty_In_Date is the expected handover month plotted on the charts.
var FRONTLOG_COL = {
  ref:       'Ref_Code',
  name:      'Project_Name',
  pm:        'PM',                        // implementation PM (not the OMA in-charge)
  owner:     'Owner',                     // counterparty / customer of the implementation
  value:     'Project Value (Ex Vat) (Baht)',
  omaInCharge: 'OMA_In_Charge',           // the OMA person who will receive the work
  startDate: 'Start_Date',                // implementation start (timeline bar begins here)
  endDate:   'End_Date',                  // original contract end (slippage baseline)
  updateEnd: 'Update_End_Date',           // latest expected end
  progress:  '%Progress',                 // 0..1
  expectedWarranty: 'Expected_Warranty_In_Date',  // the plot date (OMA warranty-in)
  warranty:  'Warranty_Period',           // how long OMA carries the warranty (e.g. "24 M")
  handover:  'Handover_Status',           // FORMULA: On Track / Delayed only — never "Transferred"
  note:      'Note',
  transferredDate: 'Transferred_Date',    // actual handover date — THE field that marks a handover
  dataAsOf:  'Data_As_Of',                // per-project date this row was last updated
  eventDate: 'Event_Date'                 // legacy fallback only; column can be deleted
};
// Free-text ways a handover can be recorded when Transferred_Date is still blank.
var TRANSFERRED_RE = /transferred|done|completed|hand(?:ed)?\s*over|โอนแล้ว|รับโอน|ส่งมอบแล้ว/i;
// PortalGuard.gs ต้องถูกวางไว้ในโปรเจกต์เดียวกับไฟล์นี้
// PORTAL_ENFORCE = false คือโหมด shadow (ไม่บล็อกใครจริง แค่บันทึก log) เปลี่ยนเป็น
// true เมื่อยืนยันแล้วว่า role ของผู้ใช้จริงทุกคนแมปถูกต้องใน Hub
var PORTAL_MENU_ID = 'sec-projects-dash';
var PORTAL_ENFORCE = false;

function doGet(e) {
  var g = portalGuard(e, PORTAL_MENU_ID);
  if (g.deny) return g.deny;

  var t = HtmlService.createTemplateFromFile('Index');
  t.portalBootstrap = JSON.stringify({
    token: (e && e.parameter && e.parameter.portalToken) || '',
    email: g.access.email, name: g.access.name, role: g.access.role,
    isAdmin: isAdminish(g.access),
    // null = เห็นทุกแท็บ (ไม่ถูกจำกัด), array = เห็นเฉพาะ id ที่อยู่ในนี้
    allowedSections: g.access.allowedSections
  });
  return t.evaluate()
    .setTitle('OMA · Project Dashboard')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
/** Find a column index by fuzzy-trimmed header match. */
function findCol_(headers, label) {
  var want = String(label).replace(/\s+/g, ' ').trim().toLowerCase();
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i] || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (h === want) return i;
  }
  // loose contains fallback
  for (var j = 0; j < headers.length; j++) {
    var h2 = String(headers[j] || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (h2.indexOf(want) !== -1) return j;
  }
  return -1;
}
function toISO_(v) {
  if (!v) return null;
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v)) {
    var y = v.getFullYear(), m = ('0' + (v.getMonth() + 1)).slice(-2), d = ('0' + v.getDate()).slice(-2);
    return y + '-' + m + '-' + d;
  }
  var d2 = new Date(v);
  if (!isNaN(d2)) return toISO_(d2);
  return null;
}
function shortLeader_(n) {
  if (!n) return '';
  n = String(n).trim();
  if (n === 'ยังไม่ระบุ' || n === 'ไม่ระบุ' || n === 'Unassigned' || n === '-') return '';
  var titles = ['นางสาว', 'นาย', 'นาง'];
  for (var i = 0; i < titles.length; i++) {
    if (n.indexOf(titles[i]) === 0) return n.substring(titles[i].length).trim();
  }
  return n;
}
/** Main data endpoint — returns cleaned projects + precomputed analytics. */
function getDashboardData(portalToken) {
  var access = portalAccessForCall(portalToken, PORTAL_MENU_ID);
  if (!access.ok) throw new Error(access.message || 'ไม่มีสิทธิ์เข้าถึงข้อมูลนี้');

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) throw new Error('Sheet "' + SHEET_NAME + '" not found. Update SHEET_NAME in Code.gs.');
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return { projects: [], maTrend: [], continuity: {}, generatedAt: new Date().toISOString() };
  var headers = values[0];
  var idx = {};
  for (var k in COL) idx[k] = findCol_(headers, COL[k]);
  var projects = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var itemRaw = row[idx.item];
    if (itemRaw === '' || itemRaw === null || itemRaw === undefined) continue;
    var item = Number(itemRaw);
    if (EXCLUDED_ITEMS.indexOf(item) !== -1) continue;   // drop outliers by item number
    // also drop by name pattern (robust even if items get renumbered)
    var nm = String(row[idx.name] || '');
    if (/gold\s*line/i.test(nm) || /green\s*line/i.test(nm)) continue;
    var startISO = toISO_(row[idx.start]);
    var endISO   = toISO_(row[idx.end]);
    var closedISO = toISO_(row[idx.closed]);
    var valEx = Number(row[idx.valueExVat]) || 0;
    projects.push({
      item: item,
      type: String(row[idx.type] || '').trim(),
      customer: String(row[idx.customer] || '—').trim(),
      ref: String(row[idx.ref] || '').trim(),
      contractNo: String(row[idx.contractNo] || '').trim(),
      name: String(row[idx.name] || '').trim(),
      start: startISO,
      end: endISO,
      closed: closedISO,
      startYear: startISO ? Number(startISO.substring(0, 4)) : null,
      endYear: endISO ? Number(endISO.substring(0, 4)) : null,
      period: String(row[idx.period] || '').trim(),
      handoverDate: (idx.handoverDate >= 0 ? toISO_(row[idx.handoverDate]) : null),
      statusContract: String(row[idx.statusC] || '').trim(),
      statusERP: String(row[idx.statusERP] || '').trim(),
      leader: shortLeader_(row[idx.leader]),
      value: Math.round(valEx),
      valueM: Math.round((valEx / 1e6) * 100) / 100,
      docUrl: (idx.docUrl >= 0 ? String(row[idx.docUrl] || '').trim() : ''),
      bgNo: (idx.bgNo >= 0 ? String(row[idx.bgNo] || '').trim() : ''),
      bgBank: (idx.bgBank >= 0 ? String(row[idx.bgBank] || '').trim() : ''),
      bgAmount: (idx.bgAmount >= 0 ? (Number(row[idx.bgAmount]) || 0) : 0),
      bgExpiry: (idx.bgExpiry >= 0 ? toISO_(row[idx.bgExpiry]) : null),
      bgStatus: (idx.bgStatus >= 0 ? String(row[idx.bgStatus] || '').trim() : '')
    });
  }
  // กรองตามโครงการที่ผู้ใช้เห็นได้ ก่อนที่จะแนบ bonds/closure และก่อนคำนวณสรุปรวม
  // ทุกตัว (maTrend/continuity/monthlyEvents/activeMaLine/alerts) — ถ้ากรองแค่ตัว
  // `projects` ที่ return สุดท้าย ตัวเลขสรุปภาพรวมจะยังรั่วไปให้ผู้ใช้ที่เห็นแค่
  // โครงการเดียวอยู่ดี เพราะฟังก์ชันเหล่านี้รับ projects ทั้งก้อนไปคำนวณ
  projects = scopeRows(projects, access, 'ref');

  // ----- Bonds: read the separate "Bond Data" tab (optional; N/A if missing) -----
  var bondsByRef = readBonds_(ss);
  // ----- Closure Tracking: outstanding issues per project (optional) -----
  var closureByRef = readClosure_(ss);
  projects.forEach(function (p) {
    p.bonds = bondsByRef[p.ref] || [];
    p.closure = closureByRef[p.ref] || [];
  });
  // A Frontlog project that has already landed in Project List OMA with a Handover Date
  // IS a completed handover, whatever the Frontlog row still says. Build the lookup here
  // so readFrontlog_ can cross-check without re-reading the main sheet.
  var handoverByRef = {};
  projects.forEach(function (p) {
    if (p.ref && p.handoverDate) handoverByRef[p.ref] = p.handoverDate;
  });
  // scopeRows ต่อ frontlog เหมือนกัน — แถวที่ ref ว่างเปล่าจะไม่ตรงกับโครงการไหน
  // เลยของผู้ใช้ที่ถูกจำกัดสิทธิ์ จึงถูกกรองออกไปเองโดยไม่ต้องเช็คแยก
  var frontlog = scopeRows(readFrontlog_(ss, handoverByRef), access, 'ref');
  return {
    projects: projects,
    frontlog: frontlog,
    maTrend: buildMaTrend_(projects),
    continuity: buildContinuity_(projects),
    monthlyEvents: buildMonthlyEvents_(projects),
    activeMaLine: buildActiveMaLine_(projects),
    alerts: buildAlerts_(projects),
    generatedAt: new Date().toISOString()
  };
}
// Reads the optional "Bond Data" tab. Returns { refCode: [ {bondType,bank,...}, ... ] }.
// If the tab does not exist yet, returns {} so the dashboard simply shows N/A.
function readBonds_(ss) {
  var out = {};
  var sh = ss.getSheetByName(BOND_SHEET_NAME);
  if (!sh) return out;                       // tab not created yet -> no bonds, no error
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return out;
  var headers = values[0];
  var bi = {};
  for (var k in BOND_COL) bi[k] = findCol_(headers, BOND_COL[k]);
  if (bi.ref < 0) return out;                // no Ref. Code column -> cannot link
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var ref = String(row[bi.ref] || '').trim();
    if (!ref) continue;
    var rawStatus = bi.status >= 0 ? String(row[bi.status] || '').trim() : '';
    var noteVal   = bi.note >= 0 ? String(row[bi.note] || '').trim() : '';
    // A broken spreadsheet formula (e.g. #NAME?, #REF!) must never leak to the UI.
    if (rawStatus.charAt(0) === '#') rawStatus = '';
    // "Returned" may be recorded either in Status or written into the Note (sometimes only
    // the fact of return is known, without a date), so detect it from both.
    var noteLc = noteVal.toLowerCase();
    var isReturned = (rawStatus === 'Returned') || (noteLc.indexOf('returned') >= 0) || (noteVal.indexOf('คืนแล้ว') >= 0);
    var bond = {
      bondType:        bi.bondType >= 0 ? String(row[bi.bondType] || '').trim() : '',
      bank:            bi.bank >= 0 ? String(row[bi.bank] || '').trim() : '',
      bondNo:          bi.bondNo >= 0 ? String(row[bi.bondNo] || '').trim() : '',
      amount:          bi.amount >= 0 ? (Number(row[bi.amount]) || 0) : 0,
      issueDate:       bi.issueDate >= 0 ? toISO_(row[bi.issueDate]) : null,
      expiry:          bi.expiry >= 0 ? toISO_(row[bi.expiry]) : null,
      status:          isReturned ? 'Returned' : rawStatus,
      note:            noteVal
    };
    if (!out[ref]) out[ref] = [];
    out[ref].push(bond);
  }
  return out;
}
// Reads the optional "Frontlog" tab (one row per implementation project handing over to OMA).
//
// HANDOVER DETECTION — the single reason a row turns green ("Transferred"):
//   1. Transferred_Date has a date                      <- the intended way to record it
//   2. Note / Handover_Status contains "โอนแล้ว" etc.   <- free-text fallback
//   3. the Ref_Code already exists in Project List OMA with a Handover Date
// Handover_Status ALONE can never say Transferred: it is a formula that only ever returns
// On Track / Delayed, so anything typed into it is overwritten on the next recalculation.
function readFrontlog_(ss, handoverByRef) {
  var out = [];
  handoverByRef = handoverByRef || {};
  var sh = ss.getSheetByName(FRONTLOG_SHEET_NAME);
  if (!sh) return out;                       // tab not created yet -> empty pipeline, no error
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return out;
  var headers = values[0];
  var fi = {};
  for (var k in FRONTLOG_COL) fi[k] = findCol_(headers, FRONTLOG_COL[k]);
  // The plot date is Expected_Warranty_In_Date (the day the work enters OMA warranty).
  // Event_Date is redundant and kept only as a fallback for older sheets.
  if (fi.expectedWarranty < 0 && fi.eventDate < 0) return out;   // nothing to plot by
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var eventDate = fi.expectedWarranty >= 0 ? toISO_(row[fi.expectedWarranty]) : null;
    if (!eventDate && fi.eventDate >= 0) eventDate = toISO_(row[fi.eventDate]);
    var name = fi.name >= 0 ? String(row[fi.name] || '').trim() : '';
    if (!eventDate || !name) continue;       // both are required to be useful
    var ref = fi.ref >= 0 ? String(row[fi.ref] || '').trim() : '';
    // Broken formula results (#REF!, #NAME?, ...) are treated as blank.
    var handover = fi.handover >= 0 ? String(row[fi.handover] || '').trim() : '';
    if (/^#/.test(handover)) handover = '';
    var noteTxt = fi.note >= 0 ? String(row[fi.note] || '').trim() : '';
    // 1. the dedicated column
    var transferredDate = fi.transferredDate >= 0 ? toISO_(row[fi.transferredDate]) : null;
    // 3. already received into Project List OMA — inherit that date if we have none of our own
    if (!transferredDate && ref && handoverByRef[ref]) transferredDate = handoverByRef[ref];
    // 2. free text, when no date was recorded anywhere
    var transferred = !!transferredDate
      || TRANSFERRED_RE.test(handover)
      || TRANSFERRED_RE.test(noteTxt);
    out.push({
      item:      r,
      ref:       ref,
      name:      name,
      pm:        fi.pm >= 0 ? String(row[fi.pm] || '').trim() : '',
      owner:     fi.owner >= 0 ? String(row[fi.owner] || '').trim() : '',
      value:     fi.value >= 0 ? (Number(row[fi.value]) || 0) : 0,
      transferred: transferred,
      endDate:   fi.endDate >= 0 ? toISO_(row[fi.endDate]) : null,
      startDate: fi.startDate >= 0 ? toISO_(row[fi.startDate]) : null,
      updateEnd: fi.updateEnd >= 0 ? toISO_(row[fi.updateEnd]) : null,
      progress:  fi.progress >= 0 ? (Number(row[fi.progress]) || 0) : 0,
      expectedWarranty: fi.expectedWarranty >= 0 ? toISO_(row[fi.expectedWarranty]) : null,
      warranty:  fi.warranty >= 0 ? String(row[fi.warranty] || '').trim() : '',
      omaInCharge: fi.omaInCharge >= 0 ? String(row[fi.omaInCharge] || '').trim() : '',
      note:      noteTxt,
      transferredDate: transferredDate,
      dataAsOf:  fi.dataAsOf >= 0 ? toISO_(row[fi.dataAsOf]) : null,
      handover:  handover,
      eventDate: eventDate
    });
  }
  return out;
}
// Reads the optional "Closure Tracking" tab (one row per outstanding issue).
// Returns { refCode: [ {subject,reviewer,outstanding,documents,amount,vendor,asOf,actionBy,note}, ... ] }.
function readClosure_(ss) {
  var out = {};
  var sh = ss.getSheetByName(CLOSURE_SHEET_NAME);
  if (!sh) return out;                        // tab not created yet -> no closure data, no error
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return out;
  var headers = values[0];
  var ci = {};
  for (var k in CLOSURE_COL) ci[k] = findCol_(headers, CLOSURE_COL[k]);
  if (ci.ref < 0) return out;
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var ref = String(row[ci.ref] || '').trim();
    if (!ref) continue;
    var item = {
      subject:     ci.subject >= 0 ? String(row[ci.subject] || '').trim() : '',
      reviewer:    ci.reviewer >= 0 ? String(row[ci.reviewer] || '').trim() : '',
      outstanding: ci.outstanding >= 0 ? String(row[ci.outstanding] || '').trim() : '',
      documents:   ci.documents >= 0 ? String(row[ci.documents] || '').trim() : '',
      details:     ci.details >= 0 ? String(row[ci.details] || '').trim() : '',
      amount:      ci.amount >= 0 ? (Number(row[ci.amount]) || 0) : 0,
      vendor:      ci.vendor >= 0 ? String(row[ci.vendor] || '').trim() : '',
      asOf:        ci.asOf >= 0 ? toISO_(row[ci.asOf]) : null,
      actionBy:    ci.actionBy >= 0 ? String(row[ci.actionBy] || '').trim() : '',
      note:        ci.note >= 0 ? String(row[ci.note] || '').trim() : ''
    };
    if (!out[ref]) out[ref] = [];
    out[ref].push(item);
  }
  return out;
}
function buildAlerts_(projects) {
  var today = new Date(); today.setHours(0, 0, 0, 0);
  function daysTo(iso) { if (!iso) return null; var d = new Date(iso); return Math.round((d - today) / 86400000); }
  var contractSoon = [];   // active contracts ending soon
  var bgSoon = [];         // bond expiring within 90 days (not yet returned)
  var bgUnreturned = [];   // bond already expired but not yet returned (CRITICAL)
  var hasBond = false;
  projects.forEach(function (p) {
    if (p.statusContract === 'Active' && p.end) {
      var dc = daysTo(p.end);
      if (dc !== null && dc >= 0 && dc <= 90) contractSoon.push({ item: p.item, ref: p.ref, name: p.name, customer: p.customer, end: p.end, days: dc, leader: p.leader, value: p.value });
    }
    // Bond alerts: iterate every bond linked to this project (from the Bond Data sheet).
    // A bond is flagged only when it has an Expiry date and is not yet Returned.
    var bonds = p.bonds || [];
    bonds.forEach(function (b) {
      if (b.expiry || b.bondNo || b.bank || b.amount) hasBond = true;
      if (!b.expiry) return;                       // no expiry -> cannot be due/overdue
      if (b.status === 'Returned') return;         // already returned -> nothing to follow up
      var db = daysTo(b.expiry);
      var payload = { item: p.item, ref: p.ref, name: p.name, customer: p.customer,
                      bgNo: b.bondNo, bgBank: b.bank, bgExpiry: b.expiry, bgAmount: b.amount,
                      bondType: b.bondType, bgStatus: b.status, bgNote: b.note, end: p.end };
      if (db !== null && db >= 0 && db <= 90) { payload.days = db; bgSoon.push(payload); }
      else if (db !== null && db < 0) { bgUnreturned.push(payload); }
    });
  });
  contractSoon.sort(function (a, b) { return a.days - b.days; });
  bgSoon.sort(function (a, b) { return a.days - b.days; });
  return { contractSoon: contractSoon, bgSoon: bgSoon, bgUnreturned: bgUnreturned, hasBgData: hasBond };
}
function buildMonthlyEvents_(projects) {
  var yr = new Date().getFullYear();
  var months = [];
  for (var m = 0; m < 12; m++) months.push({ month: m + 1, newC: 0, endC: 0, closed: 0 });
  projects.forEach(function (p) {
    if (p.start && Number(p.start.substring(0, 4)) === yr) months[Number(p.start.substring(5, 7)) - 1].newC++;
    if (p.end && Number(p.end.substring(0, 4)) === yr) months[Number(p.end.substring(5, 7)) - 1].endC++;
    if (p.closed && Number(p.closed.substring(0, 4)) === yr) months[Number(p.closed.substring(5, 7)) - 1].closed++;
  });
  return { year: yr, months: months };
}
function buildActiveMaLine_(projects) {
  var ma = projects.filter(function (p) { return p.type === 'Maintenance' && p.start && p.end; });
  if (!ma.length) return [];
  var maxY = new Date().getFullYear();
  var minY = TREND_START_YEAR;
  var out = [];
  for (var y = minY; y <= maxY; y++) {
    var ref = new Date(y, 11, 31).getTime();
    var cnt = 0;
    ma.forEach(function (p) {
      var s = new Date(p.start).getTime(), e = new Date(p.end).getTime();
      if (s <= ref && ref <= e) cnt++;
    });
    out.push({ year: y, active: cnt });
  }
  return out;
}
function buildMaTrend_(projects) {
  var map = {};
  projects.forEach(function (p) {
    if (p.type === 'Maintenance' && p.startYear) {
      if (!map[p.startYear]) map[p.startYear] = { year: p.startYear, count: 0, value: 0, valueM: 0 };
      map[p.startYear].count++;
      map[p.startYear].value += p.value;
      map[p.startYear].valueM += p.valueM;
    }
  });
  return Object.keys(map).map(function (y) {
    map[y].valueM = Math.round(map[y].valueM * 100) / 100;
    map[y].value = Math.round(map[y].value);
    return map[y];
  }).filter(function (d) { return d.year >= TREND_START_YEAR; })
    .sort(function (a, b) { return a.year - b.year; });
}
function buildContinuity_(projects) {
  var byCust = {};
  projects.forEach(function (p) {
    if (p.type === 'Maintenance' && p.start && p.end) {
      (byCust[p.customer] = byCust[p.customer] || []).push(p);
    }
  });
  var gaps = [], renewals = 0, transitions = 0;
  Object.keys(byCust).forEach(function (c) {
    var items = byCust[c].sort(function (a, b) { return a.start < b.start ? -1 : 1; });
    for (var i = 0; i < items.length - 1; i++) {
      var e = new Date(items[i].end), s = new Date(items[i + 1].start);
      var gapDays = Math.round((s - e) / 86400000);
      transitions++;
      if (gapDays > GAP_THRESHOLD_DAYS) {
        gaps.push({ customer: c, fromEnd: items[i].end, toStart: items[i + 1].start, gapDays: gapDays });
      } else {
        renewals++;
      }
    }
  });
  gaps.sort(function (a, b) { return b.gapDays - a.gapDays; });
  return {
    maCustomers: Object.keys(byCust).length,
    transitions: transitions,
    renewals: renewals,
    gaps: gaps,
    continuityRate: transitions ? Math.round((renewals / transitions) * 1000) / 10 : 0
  };
}