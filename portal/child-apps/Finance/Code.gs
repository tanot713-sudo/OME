/**
 * OMA — Project Billing Dashboard  (Google Apps Script Web App)
 * --------------------------------------------------------------
 * SETUP
 * 1. Put your data in the SAME spreadsheet that owns this script,
 *    in two tabs named exactly:  Project_Master  and  Installment_Trans
 *    (column headers must match the originals — see SHEET_* below).
 *    If your data lives in another file, set SPREADSHEET_ID to its ID.
 * 2. Deploy ▸ New deployment ▸ Web app ▸ Execute as "Me",
 *    Who has access = anyone in your org (or Anyone). Copy the URL.
 * 3. Embed that URL in an <iframe> inside the OMA system.
 */
// Leave blank ('') to use the spreadsheet this script is bound to.
const SPREADSHEET_ID = '';
const SHEET_MASTER = 'Project_Master';
const SHEET_TRANS  = 'Installment_Trans';
/** Bonds live in the OMA Project workbook. Paste that file's ID here, and make sure
 *  this script's account can open it. Leave blank to fall back to this same file. */
const BOND_SPREADSHEET_ID = '1EOfqoNUWy0JYb1mPyrHw0Y8PIk20oESjLOQ0iWiJQBE';
const SHEET_BOND = 'Bond Data';
const SHEET_BOND_PROJECTS = 'Project List OMA';   // gives every bond its project context
const BOND_PROJ_COL = {
  ref:'Ref. Code', name:'Project Name', client:'Customer',
  end:'Contract End Date', type:'Type', status:'Status (Contract)',
  contractNo:'Contract No.'
};
const BOND_COL = {
  ref:'Ref. Code', bondType:'Bond Type', bank:'Bank', bondNo:'Bond No.',
  amount:'Amount', issueDate:'Issue Date', expiry:'Expiry', status:'Status', note:'Note'
};
// PortalGuard.gs ต้องถูกวางไว้ในโปรเจกต์เดียวกับไฟล์นี้
// PORTAL_ENFORCE = false คือโหมด shadow (ไม่บล็อกใครจริง แค่บันทึก log) เปลี่ยนเป็น
// true เมื่อยืนยันแล้วว่า role ของผู้ใช้จริงทุกคนแมปถูกต้องใน Hub
var PORTAL_MENU_ID = 'sec-finance-dash';
var PORTAL_ENFORCE = false;

function doGet(e) {
  const g = portalGuard(e, PORTAL_MENU_ID);
  if (g.deny) return g.deny;

  const t = HtmlService.createTemplateFromFile('Index');
  t.portalBootstrap = JSON.stringify({
    token: (e && e.parameter && e.parameter.portalToken) || '',
    email: g.access.email, name: g.access.name, role: g.access.role,
    isAdmin: isAdminish(g.access),
    // null = เห็นทุกแท็บ (ไม่ถูกจำกัด), array = เห็นเฉพาะ id ที่อยู่ในนี้
    allowedSections: g.access.allowedSections
  });
  return t.evaluate()
    .setTitle('OMA — Billing Dashboard')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}
function _book() {
  return SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID)
                        : SpreadsheetApp.getActiveSpreadsheet();
}
// Return an ISO date string (yyyy-mm-dd) or null. Handles Date cells and text.
function _iso(v) {
  if (v === '' || v === null || v === undefined) return null;
  if (Object.prototype.toString.call(v) === '[object Date]') {
    if (isNaN(v.getTime())) return null;
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}
function _num(v) {
  if (v === '' || v === null || v === undefined) return 0;
  const n = Number(String(v).replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
}
function _rows(sheetName) {
  const sh = _book().getSheetByName(sheetName);
  if (!sh) throw new Error('Sheet "' + sheetName + '" not found.');
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  const head = values[0].map(h => String(h).trim());
  return values.slice(1)
    .filter(r => r.some(c => c !== '' && c !== null))
    .map(r => { const o = {}; head.forEach((h, i) => o[h] = r[i]); return o; });
}
/** Reads the Bond Data tab from the Project workbook (empty list if unavailable). */
function _bondRows() {
  try {
    const book = BOND_SPREADSHEET_ID ? SpreadsheetApp.openById(BOND_SPREADSHEET_ID) : _book();
    const sh = book.getSheetByName(SHEET_BOND);
    if (!sh) return [];
    const values = sh.getDataRange().getValues();
    if (values.length < 2) return [];
    const head = values[0].map(h => String(h || '').replace(/\s+/g, ' ').trim().toLowerCase());
    const at = label => head.indexOf(String(label).replace(/\s+/g, ' ').trim().toLowerCase());
    const idx = {};
    for (const k in BOND_COL) idx[k] = at(BOND_COL[k]);
    if (idx.ref < 0) return [];
    const out = [];
    for (let r = 1; r < values.length; r++) {
      const row = values[r];
      const ref = String(row[idx.ref] || '').trim();
      if (!ref) continue;
      out.push({
        ref: ref,
        bondType: idx.bondType >= 0 ? String(row[idx.bondType] || '').trim() : '',
        bank:     idx.bank     >= 0 ? String(row[idx.bank]     || '').trim() : '',
        bondNo:   idx.bondNo   >= 0 ? String(row[idx.bondNo]   || '').trim() : '',
        amount:   idx.amount   >= 0 ? _num(row[idx.amount]) : 0,
        issueDate:idx.issueDate>= 0 ? _iso(row[idx.issueDate]) : null,
        expiry:   idx.expiry   >= 0 ? _iso(row[idx.expiry])    : null,
        status:   idx.status   >= 0 ? String(row[idx.status]   || '').trim() : '',
        note:     idx.note     >= 0 ? String(row[idx.note]     || '').trim() : ''
      });
    }
    return out;
  } catch (e) {
    return [];   // no access / no tab -> the Bond tab simply shows nothing
  }
}
/** Projects behind the bonds (the Project workbook holds every type, not just MA). */
function _bondProjects() {
  try {
    const book = BOND_SPREADSHEET_ID ? SpreadsheetApp.openById(BOND_SPREADSHEET_ID) : _book();
    const sh = book.getSheetByName(SHEET_BOND_PROJECTS);
    if (!sh) return [];
    const values = sh.getDataRange().getValues();
    if (values.length < 2) return [];
    const head = values[0].map(h => String(h || '').replace(/\s+/g, ' ').trim().toLowerCase());
    const at = label => head.indexOf(String(label).replace(/\s+/g, ' ').trim().toLowerCase());
    const idx = {};
    for (const k in BOND_PROJ_COL) idx[k] = at(BOND_PROJ_COL[k]);
    if (idx.ref < 0) return [];
    const out = [];
    for (let r = 1; r < values.length; r++) {
      const row = values[r];
      const ref = String(row[idx.ref] || '').trim();
      if (!ref) continue;
      out.push({
        ref:    ref,
        contractNo: idx.contractNo >= 0 ? String(row[idx.contractNo] || '').trim() : '',
        name:   idx.name   >= 0 ? String(row[idx.name]   || '').trim() : '',
        client: idx.client >= 0 ? String(row[idx.client] || '').trim() : '',
        end:    idx.end    >= 0 ? _iso(row[idx.end]) : null,
        type:   idx.type   >= 0 ? String(row[idx.type]   || '').trim() : '',
        status: idx.status >= 0 ? String(row[idx.status] || '').trim() : ''
      });
    }
    return out;
  } catch (e) {
    return [];
  }
}
/** Main data feed consumed by the front-end. */
function getData(portalToken) {
  const access = portalAccessForCall(portalToken, PORTAL_MENU_ID);
  if (!access.ok) throw new Error(access.message || 'ไม่มีสิทธิ์เข้าถึงข้อมูลนี้');

  const projects = _rows(SHEET_MASTER).map(r => ({
    ref:    String(r.Ref_Code).trim(),
    name:   String(r.Project_Name).trim(),
    client: String(r.Client_Name).trim(),
    value:  _num(r.Contract_Value_Ex_VAT),
    start:  _iso(r.Contract_Start_Date),
    end:    _iso(r.Contract_End_Date),
    duration: (r.Duration === '' || r.Duration == null) ? null : String(r.Duration).trim(),
    credit: _num(r.Credit_Term_Days),
    status: String(r.Project_Status || '').trim(),
    name_long: (r.Project_Name_Long === '' || r.Project_Name_Long == null) ? '' : String(r.Project_Name_Long).trim(),
    bg_no:     (r['BG_No.'] === '' || r['BG_No.'] == null) ? '' : String(r['BG_No.']).trim(),
    bg_bank:   (r.BG_Bank === '' || r.BG_Bank == null) ? '' : String(r.BG_Bank).trim(),
    bg_amount: _num(r.BG_Amount),
    bg_expiry: _iso(r.BG_Expiry),
    bg_status: (r.BG_Status === '' || r.BG_Status == null) ? '' : String(r.BG_Status).trim()
  }));
  const trans = _rows(SHEET_TRANS).map(r => ({
    id:        _num(r.Trans_ID),
    ref:       String(r.Ref_Code).trim(),
    inst:      _num(r.Installment_No),
    svc_start: _iso(r.Service_Start_Date),
    svc_end:   _iso(r.Service_End_Date),
    amount:    _num(r.Amount_Ex_VAT),
    plan_inv:  _iso(r.Plan_Invoice_Date),
    act_inv:   _iso(r.Actual_Invoice_Date),
    inv_no:    (r.Invoice_No === '' || r.Invoice_No == null) ? null : String(r.Invoice_No).trim(),
    plan_rcv:  _iso(r.Plan_Receive_Date),
    act_rcv:   _iso(r.Actual_Receive_Date)
  }));
  // กรองทั้ง 4 อาร์เรย์ด้วยชุดโครงการที่ผู้ใช้เห็นได้ ก่อนส่งกลับ — ข้อมูลนี้อ่อนไหว
  // ที่สุดในทั้ง 9 แอป (มูลค่าสัญญา, หนังสือค้ำประกัน) จึงต้องกรองให้ครบทุกอาร์เรย์
  // ไม่ใช่แค่ projects
  const bonds = _bondRows();
  const bondProjects = _bondProjects();
  return JSON.stringify({
    projects: scopeRows(projects, access, 'ref'),
    trans: scopeRows(trans, access, 'ref'),
    bonds: scopeRows(bonds, access, 'ref'),
    bondProjects: scopeRows(bondProjects, access, 'ref'),
    serverDate: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd')
  });
}