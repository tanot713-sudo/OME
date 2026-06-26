/* ================================================================
   AMR INSPECTION SYSTEM — Google Apps Script Backend
   ================================================================
   วิธีติดตั้ง:
   1. ไปที่ script.google.com → New Project
   2. วางโค้ดทั้งหมดนี้แทน Code.gs
   3. กำหนดค่าใน CONFIG ด้านล่าง
   4. Deploy → New Deployment → Web App
      - Execute as: Me
      - Who has access: Anyone
   5. เปิด URL ที่ได้จาก deployment ในเบราว์เซอร์ได้เลย
      (ไม่ต้องใส่ใน index.html แล้ว — HTML อยู่ใน GAS โดยตรง)
   ================================================================ */

/* ================================================================
   CONFIG — แก้ค่าเหล่านี้ก่อน Deploy
   ================================================================ */
const CONFIG = {
  SHEET_ID:     '1pQFjICQRG3GcLLy7PxQl2U_wa6oZsALNIysZJytnGMc',
  DRIVE_ROOT_ID:'19HJJzcMl92Vk3q1y_00Coy-R34SF-DlR',

  SHEETS: {
    USERS:   'Users',
    RECORDS: 'Records',
    MASTER:  'Master',
    SURVEY:  'Survey',
    PDPA:    'PDPA',
    TOKENS:  'Tokens',
    LOGS:    'Logs'
  },

  FOLDERS: {
    AMR_IMAGES:       'AMR Inspection Images',
    AMR_IMG_EQUIP:    'Equipment Photos',
    AMR_IMG_STICKER:  'Sticker Photos',
    ONSITE_IMAGES:    'AMR Onsite Inspection Images',
    ONSITE_IMG_EQUIP: 'Equipment Photos',
    ONSITE_IMG_STICK: 'Sticker Photos',
    ONSITE_MASTER:    'Onsite master data',
    ONSITE_EXCEL:     'Excel'
  },

  TOKEN_TTL:    8 * 60 * 60 * 1000,
  PDPA_VERSION: '1.0'
};

/* ================================================================
   ENTRY POINT
   ✅ FIX #1 — สลับ doGet/doPost ให้ถูกต้อง
      doGet  → เสิร์ฟ HTML
      doPost → รับ API call จาก frontend
   ================================================================ */

// doGet → แสดงหน้าเว็บ (HTML จากไฟล์ index.html ใน GAS)
function doGet(e) {
  return HtmlService.createTemplateFromFile('index').evaluate()
    .setTitle('AMR Inspection System')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no') 
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// doPost → รับ API request จาก fetch() ใน frontend
function doPost(e) {
  const headers = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type':                 'application/json; charset=utf-8'
  };
  try {
    const body = JSON.parse(e.postData.contents);
    const { action, token, ctx } = body;
    const payload = Object.assign({}, body);
    delete payload.action;
    delete payload.token;
    delete payload.ctx;

    const PUBLIC_ACTIONS = ['login'];
    if (!PUBLIC_ACTIONS.includes(action)) {
      const auth = verifyToken(token);
      if (!auth.ok) return output({ ok: false, error: 'UNAUTHORIZED', message: 'Session หมดอายุ กรุณาเข้าสู่ระบบใหม่' }, headers);
      payload._user = auth.user;
    }

    if (ctx) writeLog(action, token ? getTokenUser(token) : 'guest', ctx);

    const result = route(action, payload);
    return output(result, headers);

  } catch (err) {
    console.error('doPost error:', err);
    return output({ ok: false, error: 'SERVER_ERROR', message: err.message }, headers);
  }
}

function output(data, headers) {
  const res = ContentService.createTextOutput(JSON.stringify(data));
  res.setMimeType(ContentService.MimeType.JSON);
  return res;
}

/* ================================================================
   ROUTER
   ✅ FIX #2 — เพิ่ม setUserActive ที่หายไป
   ================================================================ */
function route(action, payload) {
  switch (action) {
    // Auth
    case 'login':             return actionLogin(payload);
    case 'verifyToken':       return actionVerifyToken(payload);
    // PDPA
    case 'getPdpaStatus':     return actionGetPdpaStatus(payload);
    case 'acceptPdpa':        return actionAcceptPdpa(payload);
    // Records
    case 'createRecord':      return actionCreateRecord(payload);
    case 'listRecords':       return actionListRecords(payload);
    case 'deleteRecord':      return actionDeleteRecord(payload);
    // Master Data
    case 'saveMaster':        return actionSaveMaster(payload);
    case 'listMaster':        return actionListMaster(payload);
    case 'getProgress':       return actionGetProgress(payload);
    // Survey
    case 'createSurvey':      return actionCreateSurvey(payload);
    case 'listSurvey':        return actionListSurvey(payload);
    case 'updateSurvey':      return actionUpdateSurvey(payload);
    case 'deleteSurvey':      return actionDeleteSurvey(payload);
    // Users
    case 'createUser':        return actionCreateUser(payload);
    case 'updateUser':        return actionUpdateUser(payload);
    case 'deleteUser':        return actionDeleteUser(payload);
    case 'setUserActive':     return actionSetUserActive(payload);   // ✅ เพิ่มใหม่
    case 'bulkCreateUsers':   return actionBulkCreateUsers(payload);
    case 'listUsers':         return actionListUsers(payload);
    // Page Permissions
    case 'getPagePerms':      return actionGetPagePerms(payload);
    case 'setPagePerms':      return actionSetPagePerms(payload);
    // Report Templates (เลือก Word/PDF template จากเว็บ)
    case 'listReportTemplates': return actionListReportTemplates(payload);
    case 'saveReportTemplate':  return actionSaveReportTemplate(payload);
    case 'deleteReportTemplate':return actionDeleteReportTemplate(payload);
    // Report Field Presets (autocomplete จากค่าที่เคยกรอก)
    case 'listReportPresets':   return actionListReportPresets(payload);
    case 'saveReportPreset':    return actionSaveReportPreset(payload);
     // Switch-case
    case 'saveTarget':   return actionSaveTarget(payload);
    case 'listTargets':  return actionListTargets(payload);
    // PDF Report
    case 'generateReport':    return actionGenerateReport(payload, payload._user);
    default:
      return { ok: false, error: 'UNKNOWN_ACTION', message: `ไม่รู้จัก action: ${action}` };
  }
}


/* ================================================================
   PDF / GOOGLE DOC REPORT GENERATION
   ================================================================ */

var REPORT_TEMPLATE_ID = '1EZyibVq33y3Xzt82bXtD5DUKp_zIciDf';

function actionGenerateReport(payload, _user) {
  try {
  if (!_user || (_user.role !== 'admin' && _user.role !== 'manager')) {
    return { ok: false, message: 'เฉพาะ Admin/Manager เท่านั้น' };
  }

  var reportTitle  = payload.reportTitle  || 'รายงานผลการติดฉลากระบุรายละเอียดอุปกรณ์';
  var contractName = payload.contractName || '';
  var contractNo   = payload.contractNo   || '-';
  var contractDate = payload.contractDate || '';
  var clause       = payload.clause       || '';
  var submittedTo  = payload.submittedTo  || '';
  var logoCustomer = payload.logoCustomer || '';
  var projFilter   = payload.projectFilter|| '';
  var templateId   = payload.templateId   || REPORT_TEMPLATE_ID;

  /* ── 1. Get filtered entries ── */
  var sh = getSheet(CONFIG.SHEETS.RECORDS);
  var rows = sheetToObjects(sh);
  var entries = rows;
  if (projFilter && projFilter !== '__all') {
    entries = entries.filter(function(e){ return e.project === projFilter; });
  }
  if (!entries.length) return { ok: false, message: 'ไม่มีข้อมูลสำหรับโครงการที่เลือก' };

  /* ── 2. Copy template ── */
  var today    = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');
  var docName  = (projFilter && projFilter !== '__all' ? projFilter : 'ทุกโครงการ') + '_' + today;
  var copyFile = DriveApp.getFileById(templateId).makeCopy(docName);
  var docId    = copyFile.getId();
  var doc      = DocumentApp.openById(docId);
  var body     = doc.getBody();

  /* ── 3. Replace cover placeholders ── */
  function safe(s){ return String(s||'').replace(/\$/g,''); }
  body.replaceText('\{\{reportTitle\}\}',  safe(reportTitle));
  body.replaceText('\{\{logocustomer\}\}', safe(logoCustomer));
  body.replaceText('\{\{contractName\}\}', safe(contractName));
  body.replaceText('\{\{contractNo\}\}',   safe(contractNo));
  body.replaceText('\{\{contractDate\}\}', safe(contractDate));
  body.replaceText('\{\{clause\}\}',       safe(clause));
  body.replaceText('\{\{submittedTo\}\}',  safe(submittedTo));

  /* ── 4. Find {{CONTENT_START}} position ── */
  var NORMAL = DocumentApp.ParagraphHeading.NORMAL;
  var H2     = DocumentApp.ParagraphHeading.HEADING2;
  var H3     = DocumentApp.ParagraphHeading.HEADING3;
  var CENTER = DocumentApp.HorizontalAlignment.CENTER;
  var LEFT   = DocumentApp.HorizontalAlignment.LEFT;

  var insertIdx = body.getNumChildren();
  for (var ci = 0; ci < body.getNumChildren(); ci++) {
    var el = body.getChild(ci);
    if (el.getType() === DocumentApp.ElementType.PARAGRAPH &&
        el.getText().indexOf('{{CONTENT_START}}') >= 0) {
      el.asText().setText('');
      insertIdx = ci + 1;
      break;
    }
  }

  /* ── 5. Group entries by location ── */
  var locMap = {};
  entries.forEach(function(e){
    var loc = e.locName || e.location || '(ไม่ระบุสถานที่)';
    if (!locMap[loc]) locMap[loc] = [];
    locMap[loc].push(e);
  });

  /* helper: style paragraph */
  function para(text, heading, align) {
    var p = body.insertParagraph(insertIdx++, text||'');
    p.setHeading(heading || NORMAL);
    p.setAlignment(align || LEFT);
    return p;
  }

  /* helper: try fetch image blob */
  function fetchBlob(url) {
    if (!url) return null;
    try {
      var resp = UrlFetchApp.fetch(url, {muteHttpExceptions:true});
      if (resp.getResponseCode() !== 200) return null;
      var blob = resp.getBlob();
      if (blob.getBytes().length < 500) return null;
      return blob;
    } catch(e){ return null; }
  }

  /* ── Section heading ── */
  var secPara = para('สำนักเขต', H2, LEFT);

  /* ── Loop locations ── */
  var locKeys = Object.keys(locMap).sort();
  var equipCounter = 0;

  locKeys.forEach(function(loc, li){
    /* Location heading */
    var lp = para((li+1)+'. '+loc, H2, CENTER);
    lp.editAsText().setUnderline(true);
    para('', NORMAL); // spacer

    var items = locMap[loc];
    items.forEach(function(e, ei){
      equipCounter++;

      /* Equipment name */
      var eqPara = para(equipCounter+'. '+(e.equipment||'(ไม่ระบุ)'), H3, LEFT);

      /* Brand / model */
      if (e.brand || e.model) {
        para('    ยี่ห้อ '+(e.brand||'')+' รุ่น '+(e.model||''), NORMAL);
      }

      /* Serial / asset */
      var metaParts = [];
      if (e.serial) metaParts.push('Serial: '+e.serial);
      if (e.asset)  metaParts.push('รหัส: '+e.asset);
      if (metaParts.length) para('    '+metaParts.join('   '), NORMAL);

      /* Sublocation */
      if (e.subName) para(e.subName, NORMAL);

      /* ── Photo table (2 cols per row) ── */
      var imgList = [
        { url: e.thumbMain||e.imgMain||'',       cap: 'รูปรวมอุปกรณ์' },
        { url: e.thumbSticker||e.imgSticker||'', cap: 'รูปสติกเกอร์' },
        { url: e.thumb3||e.img3||'',             cap: 'รูปเพิ่มเติมที่ 1' },
        { url: e.thumb4||e.img4||'',             cap: 'รูปเพิ่มเติมที่ 2' }
      ].filter(function(im){ return im.url; });

      if (imgList.length) {
        for (var ri = 0; ri < imgList.length; ri += 2) {
          var tbl = body.insertTable(insertIdx++);
          tbl.setBorderWidth(0);
          var row = tbl.appendTableRow();

          var pair = [imgList[ri], imgList[ri+1]||null];
          pair.forEach(function(im){
            var cell = row.appendTableCell();
            if (!im) { cell.appendParagraph(''); return; }
            var blob = fetchBlob(im.url);
            if (blob) {
              try {
                var img = cell.insertImage(0, blob);
                var ow = img.getWidth(), oh = img.getHeight();
                var scale = Math.min(220/ow, 165/oh, 1);
                img.setWidth(Math.round(ow*scale));
                img.setHeight(Math.round(oh*scale));
              } catch(err){}
            }
            var capPara = cell.appendParagraph(im.cap);
            capPara.setAlignment(CENTER);
            capPara.editAsText().setFontSize(9).setForegroundColor('#555555');
          });
        }
      }

      para('', NORMAL); // spacer between equipment
    });
  });

  /* ── 6. Save and export PDF ── */
  doc.saveAndClose();
  Utilities.sleep(3000);

  var pdfBlob  = DriveApp.getFileById(docId).getAs(MimeType.PDF);
  var pdfB64   = Utilities.base64Encode(pdfBlob.getBytes());

  /* Move doc to AMR_PDF_Reports folder */
  try {
    var folder = getOrCreateFolder(getRootFolder(), 'AMR_PDF_Reports');
    copyFile.moveTo(folder);
  } catch(e){}

  /* บันทึกค่าฟิลด์ไว้ autocomplete ครั้งหน้า — ไม่ให้ error ตรงนี้ทำให้ทั้ง report เสีย */
  try {
    actionSaveReportPreset({
      fields: { reportTitle: reportTitle, contractName: contractName, contractNo: contractNo,
                 clause: clause, submittedTo: submittedTo, logoCustomer: logoCustomer },
      _user: _user
    });
  } catch (e) {}

  return {
    ok: true,
    pdfBase64:   pdfB64,
    docId:       docId,
    docUrl:      copyFile.getUrl(),
    docName:     docName,
    totalEquip:  equipCounter
  };
  } catch(err) {
    return { ok: false, message: 'เกิดข้อผิดพลาด: ' + (err.message || String(err)) };
  }
}

/* ================================================================
   SHEET HELPERS
   ================================================================ */
function getSheet(name) {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  return sh;
}

function sheetToObjects(sh) {
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0].map(h => String(h).trim());
  return data.slice(1).filter(r => r.some(v => v !== '')).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i] !== undefined ? row[i] : ''; });
    return obj;
  });
}

// เพิ่ม header ที่ขาดไปต่อท้ายคอลัมน์ที่มีอยู่แล้วเสมอ (ไม่เขียนทับ/สลับตำแหน่งคอลัมน์เดิม)
// กันข้อมูลเพี้ยนเวลาเพิ่มฟิลด์ใหม่ใน sheet ที่มีข้อมูลอยู่แล้ว (เช่น Records)
function ensureHeaders(sh, headers) {
  const lastCol = sh.getLastColumn();
  if (lastCol === 0) { sh.getRange(1, 1, 1, headers.length).setValues([headers]); return; }
  const existing = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  if (!existing[0]) { sh.getRange(1, 1, 1, headers.length).setValues([headers]); return; }
  const missing = headers.filter(h => existing.indexOf(h) === -1);
  if (missing.length) sh.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
}

// เขียนค่าตามตำแหน่งคอลัมน์จริงของ sheet (อ่านชื่อ header แถวแรกจริง) ไม่ใช่ตามลำดับใน array headers
// เพื่อไม่ให้ข้อมูลเลื่อนคอลัมน์ผิดถ้ามีการเพิ่ม/เรียง headers array ใหม่ในอนาคต
function appendRow(sh, headers, obj) {
  ensureHeaders(sh, headers);
  const physicalHeaders = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const row = physicalHeaders.map(h => obj[h] !== undefined ? obj[h] : '');
  sh.appendRow(row);
}

function findRowById(sh, id) {
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return -1;
  const idCol = data[0].indexOf('id');
  if (idCol < 0) return -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idCol]) === String(id)) return i + 1;
  }
  return -1;
}

function updateRowById(sh, headers, id, obj) {
  const row = findRowById(sh, id);
  if (row < 0) return false;
  ensureHeaders(sh, headers);
  const physicalHeaders = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const vals = physicalHeaders.map(h => obj[h] !== undefined ? obj[h] : '');
  sh.getRange(row, 1, 1, vals.length).setValues([vals]);
  return true;
}

function deleteRowById(sh, id) {
  const row = findRowById(sh, id);
  if (row < 0) return false;
  sh.deleteRow(row);
  return true;
}

/* ================================================================
   DRIVE HELPERS
   ================================================================ */
function getRootFolder() {
  return DriveApp.getFolderById(CONFIG.DRIVE_ROOT_ID);
}

function getOrCreateFolder(parent, name) {
  const iter = parent.getFoldersByName(name);
  if (iter.hasNext()) return iter.next();
  return parent.createFolder(name);
}

function getFolder(pathParts) {
  let folder = getRootFolder();
  for (const part of pathParts) folder = getOrCreateFolder(folder, part);
  return folder;
}

function getNestedFolder(rootFolderName, record, subfolder) {
  const safe = s => String(s || 'Unknown').replace(/[\/\\:*?"<>|]/g, '_').trim() || 'Unknown';
  let f = getOrCreateFolder(getRootFolder(), rootFolderName);
  f = getOrCreateFolder(f, safe(record.project));
  f = getOrCreateFolder(f, safe(record.location || record.locName || 'Unknown'));
  f = getOrCreateFolder(f, safe(record.sublocation || record.subName || 'Unknown'));
  if (subfolder) f = getOrCreateFolder(f, subfolder);
  return f;
}

function saveImageToFolder(base64Data, filename, folder) {
  if (!base64Data || !base64Data.startsWith('data:')) return '';
  try {
    const [meta, b64] = base64Data.split(',');
    const mimeMatch = meta.match(/:(.*?);/);
    const mimeType  = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    const decoded   = Utilities.base64Decode(b64);
    const blob      = Utilities.newBlob(decoded, mimeType, filename);
    const file      = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return file.getDownloadUrl().replace('&export=download', '');
  } catch (err) {
    console.error('saveImageToFolder error:', err);
    return '';
  }
}

function getThumbnailUrl(driveUrl) {
  if (!driveUrl) return '';
  const m = driveUrl.match(/[-\w]{25,}/);
  if (!m) return '';
  return `https://drive.google.com/thumbnail?id=${m[0]}&sz=w400`;
}

/* ================================================================
   AUTH — LOGIN / TOKEN
   ✅ FIX #3 — ส่ง error/code field ชื่อเดียวกัน (ใช้ 'code') ให้ frontend อ่านได้
   ================================================================ */
const USER_HEADERS = ['id','username','password','name','role','project','active','createdAt'];

function actionLogin({ username, password }) {
  if (!username || !password) return { ok: false, message: 'กรุณากรอก username และ password' };
  const sh = getSheet(CONFIG.SHEETS.USERS);
  ensureHeaders(sh, USER_HEADERS);

  const all = sheetToObjects(sh);
  if (all.length === 0) {
    appendRow(sh, USER_HEADERS, {
      id: genId(), username: 'admin', password: hashPw('admin1234'),
      name: 'Administrator', role: 'admin', project: '', active: 'true',
      createdAt: new Date().toISOString()
    });
  }

  const users      = sheetToObjects(sh);
  const byUsername = users.find(u => u.username === username);
  const byBoth     = users.find(u =>
    u.username === username &&
    (u.password === hashPw(password) || u.password === password)
  );

  if (!byUsername) {
    // ✅ ใช้ field 'code' ให้ตรงกับ frontend emap
    return { ok: false, code: 'USER_NOT_FOUND', message: 'ไม่พบชื่อผู้ใช้นี้ในระบบ' };
  }
  if (!byBoth) {
    return { ok: false, code: 'WRONG_PASSWORD', message: 'รหัสผ่านไม่ถูกต้อง' };
  }

  const user = byBoth;
  if (String(user.active).toLowerCase() === 'false') {
    return { ok: false, code: 'USER_INACTIVE', message: 'บัญชีนี้ถูกปิดการใช้งาน · ติดต่อผู้ดูแลระบบ' };
  }

  const token = genToken();
  const exp   = new Date(Date.now() + CONFIG.TOKEN_TTL).toISOString();
  const tsh   = getSheet(CONFIG.SHEETS.TOKENS);
  ensureHeaders(tsh, ['token','username','role','project','exp']);
  tsh.appendRow([token, user.username, user.role, user.project || '', exp]);

  const perms = getPagePermissions(user.role);

  return {
    ok: true, token,
    user: {
      username:  user.username,
      name:      user.name,
      role:      user.role,
      project:   user.project || '',
      pagePerms: perms
    }
  };
}

function verifyToken(token) {
  if (!token) return { ok: false };
  const tsh  = getSheet(CONFIG.SHEETS.TOKENS);
  const rows = sheetToObjects(tsh);
  const t    = rows.find(r => r.token === token);
  if (!t) return { ok: false };
  if (new Date(t.exp) < new Date()) return { ok: false };
  return { ok: true, user: { username: t.username, role: t.role, project: t.project } };
}

function actionVerifyToken({ _user }) {
  return { ok: true, user: _user };
}

function getTokenUser(token) {
  const tsh  = getSheet(CONFIG.SHEETS.TOKENS);
  const rows = sheetToObjects(tsh);
  const t    = rows.find(r => r.token === token);
  return t ? t.username : 'unknown';
}

function hashPw(pw) {
  return Utilities.base64Encode(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, pw + 'AMR_SALT_2024')
  );
}
function genToken() { return Utilities.getUuid(); }
function genId()    { return Utilities.getUuid().replace(/-/g,'').slice(0,12); }

/* ================================================================
   PDPA
   ================================================================ */
const PDPA_HEADERS = ['username','version','acceptedAt','ip'];

function actionGetPdpaStatus({ version, _user }) {
  const sh   = getSheet(CONFIG.SHEETS.PDPA);
  ensureHeaders(sh, PDPA_HEADERS);
  const rows = sheetToObjects(sh);
  const rec  = rows.find(r =>
    r.username === _user.username &&
    r.version  === (version || CONFIG.PDPA_VERSION)
  );
  return { ok: true, accepted: !!rec };
}

function actionAcceptPdpa({ version, ctx, _user }) {
  const sh = getSheet(CONFIG.SHEETS.PDPA);
  ensureHeaders(sh, PDPA_HEADERS);
  appendRow(sh, PDPA_HEADERS, {
    username:   _user.username,
    version:    version || CONFIG.PDPA_VERSION,
    acceptedAt: new Date().toISOString(),
    ip:         ctx ? ctx.ip : ''
  });
  return { ok: true };
}

/* ================================================================
   RECORDS
   ================================================================ */
const REC_HEADERS = [
  'id','project','system','typeLocation','location','sublocation','equipment',
  'serial','brand','model','asset','inspector','note',
  'imgMain','thumbMain','imgSticker','thumbSticker',
  'img3','thumb3','img4','thumb4',
  'createdBy','createdAt'
];
function actionCreateRecord({ record, images, _user }) {
  const sh = getSheet(CONFIG.SHEETS.RECORDS);
  ensureHeaders(sh, REC_HEADERS);

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const equip = (record.equipment || 'img').replace(/[/\\:*?"<>|]/g, '_');
  const ser = (record.serial || '').replace(/[/\\:*?"<>|]/g, '_');
  const fname = (suffix) => `${equip}_${ser}_${ts}_${suffix}.jpg`;

  // สร้างโฟลเดอร์สำหรับรูปภาพ
  const equipFolder = getOrCreateDynamicFolder('AMR Inspection Images', record.project, record.location, record.sublocation, record.equipment, 'Equipment Photos');
  const stickerFolder = getOrCreateDynamicFolder('AMR Inspection Images', record.project, record.location, record.sublocation, record.equipment, 'Sticker Photos');
  const add1Folder = getOrCreateDynamicFolder('AMR Inspection Images', record.project, record.location, record.sublocation, record.equipment, 'Additional image 1');
  const add2Folder = getOrCreateDynamicFolder('AMR Inspection Images', record.project, record.location, record.sublocation, record.equipment, 'Additional image 2');

  let imgMain = '', thumbMain = '', imgSticker = '', thumbSticker = '', img3 = '', thumb3 = '', img4 = '', thumb4 = '';

  // บันทึกรูปและกำหนดค่า thumb (หากมีระบบย่อรูปใน saveImageToFolder หรือต้องการเก็บค่าเดียวกันไปก่อน)
  if (images && images.main) {
    imgMain = saveImageToFolder(images.main, fname('main'), equipFolder);
    thumbMain = imgMain; // หากยังไม่มีระบบย่อรูป ให้ใช้ URL รูปหลักไปก่อน
  }
  if (images && images.sticker) {
    imgSticker = saveImageToFolder(images.sticker, fname('sticker'), stickerFolder);
    thumbSticker = imgSticker;
  }
  if (images && images.img3) {
    img3 = saveImageToFolder(images.img3, fname('img3'), add1Folder);
    thumb3 = img3;
  }
  if (images && images.img4) {
    img4 = saveImageToFolder(images.img4, fname('img4'), add2Folder);
    thumb4 = img4;
  }

  // รวมข้อมูลและบันทึกลง Sheet (ใส่ค่า thumb ครบทุกตัว)
  appendRow(sh, REC_HEADERS, { 
    ...record, 
    imgMain, thumbMain, 
    imgSticker, thumbSticker, 
    img3, thumb3, 
    img4, thumb4, 
    createdBy: _user.username 
  });
  
  return { ok: true, serverId: record.id };
}

function actionListRecords({ _user }) {
  const sh   = getSheet(CONFIG.SHEETS.RECORDS);
  ensureHeaders(sh, REC_HEADERS);
  let rows = sheetToObjects(sh);

  const role = _user.role;
  const leaderProjs = (role==='leader')
    ? (_user.project||'').split(',').map(p=>p.trim()).filter(Boolean)
    : [];
  if      (role === 'inspector') rows = rows.filter(r => r.createdBy === _user.username);
  else if (role === 'leader' && leaderProjs.length>0) rows = rows.filter(r => leaderProjs.includes(r.project));

  return {
    ok: true,
    records: rows.map(r => ({
      id: r.id, project: r.project, system: r.system, typeLocation: r.typeLocation,
      location: r.location, sublocation: r.sublocation,
      equipment: r.equipment, serial: r.serial,
      brand: r.brand, model: r.model, asset: r.asset,
      inspector: r.inspector, note: r.note,
imgMain: r.imgMain, thumbMain: r.thumbMain,
      imgSticker: r.imgSticker, thumbSticker: r.thumbSticker,
      img3: r.img3, thumb3: r.thumb3,
      img4: r.img4, thumb4: r.thumb4,
      createdAt: r.createdAt ? new Date(r.createdAt).getTime() : Date.now()
    }))
  };
}

function actionDeleteRecord({ id, _user }) {
  if (!['admin','manager','leader'].includes(_user.role))
    return { ok: false, message: 'ไม่มีสิทธิ์ลบ' };
  const sh = getSheet(CONFIG.SHEETS.RECORDS);
  const ok = deleteRowById(sh, id);
  return { ok, message: ok ? 'ลบแล้ว' : 'ไม่พบรายการ' };
}

/* ================================================================
   MASTER DATA
   ================================================================ */
const MASTER_HEADERS = [
  'id','project','system','typeLocation','location','sublocation',
  'equipment','brand','model','asset','serial'
];

function actionSaveMaster({ master, _user }) {
  if (_user.role !== 'admin') return { ok: false, message: 'เฉพาะ admin เท่านั้น' };
  const sh = getSheet(CONFIG.SHEETS.MASTER);
  sh.clearContents();
  ensureHeaders(sh, MASTER_HEADERS);
  (master || []).forEach(m => appendRow(sh, MASTER_HEADERS, m));
  return { ok: true, count: (master || []).length };
}

function actionListMaster({ _user }) {
  const sh   = getSheet(CONFIG.SHEETS.MASTER);
  ensureHeaders(sh, MASTER_HEADERS);
  return { ok: true, master: sheetToObjects(sh) };
}

function actionGetProgress({ _user }) {
  const master  = sheetToObjects(getSheet(CONFIG.SHEETS.MASTER));
  const records = sheetToObjects(getSheet(CONFIG.SHEETS.RECORDS));
  const role    = _user.role;

  const leaderProjs = (role==='leader'||role==='inspector')
    ? (_user.project||'').split(',').map(p=>p.trim()).filter(Boolean)
    : [];

  const projectMap = {};
  master.forEach(m => {
    if(leaderProjs.length>0 && !leaderProjs.includes(m.project)) return;
    if(!projectMap[m.project]) projectMap[m.project]={total:0,serials:new Set()};
    projectMap[m.project].total++;
    if(m.serial) projectMap[m.project].serials.add(m.serial);
  });

  let filteredRecords = records;
  if(role==='leader' && leaderProjs.length>0)
    filteredRecords = records.filter(r=>leaderProjs.includes(r.project));
  else if(role==='inspector')
    filteredRecords = records.filter(r=>r.createdBy===_user.username);

  const doneSerials = new Set(filteredRecords.map(r=>r.serial).filter(Boolean));

  const progress = Object.entries(projectMap).map(([project,info])=>({
    project,
    total: info.total,
    done:  [...info.serials].filter(s=>doneSerials.has(s)).length
  })).sort((a,b)=>a.project.localeCompare(b.project,'th'));

  return { ok:true, progress };
}

/* ================================================================
   SURVEY
   ================================================================ */
const SURVEY_HEADERS = [
  'id','project','system','location','sublocation','equipment',
  'brand','model','serial','inspector','surveyDate','note',
  'imgMain','thumbMain','imgSticker','thumbSticker',
  'createdBy','createdAt'
];

function actionCreateSurvey({ record, images, _user }) {
  const sh = getSheet(CONFIG.SHEETS.SURVEY);
  ensureHeaders(sh, SURVEY_HEADERS);

  let imgMain='', thumbMain='', imgSticker='', thumbSticker='';
  const ts   = new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);
  const equip = (record.equipment || 'survey').replace(/[/\\:*?"<>|]/g, '_');
  const ser   = (record.serial   || '').replace(/[/\\:*?"<>|]/g, '_');
  const fname = (suffix) => `${equip}_${ser}_${ts}_${suffix}.jpg`;
   /* ================================================================
   TARGETS — เป้าหมายวันเสร็จต่อโครงการ (Leader/Admin/Manager)
   ================================================================ */
const TARGET_HEADERS = ['project','username','deadline','note','updatedAt'];

function actionSaveTarget({ project, deadline, note, _user }) {
  if (!['admin','manager','leader'].includes(_user.role))
    return { ok: false, message: 'ไม่มีสิทธิ์' };
  if (!project || !deadline)
    return { ok: false, message: 'ต้องมีโครงการและวันเสร็จ' };

  const sh   = getSheet('Targets');
  ensureHeaders(sh, TARGET_HEADERS);
  const data = sh.getDataRange().getValues();
  const pCol = data[0].indexOf('project');
  const uCol = data[0].indexOf('username');

  // อัปเดตถ้ามีอยู่แล้ว (same project + username)
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][pCol]) === project && String(data[i][uCol]) === _user.username) {
      sh.getRange(i+1, 1, 1, TARGET_HEADERS.length).setValues([[
        project, _user.username, deadline, note||'', new Date().toISOString()
      ]]);
      return { ok: true, action: 'updated' };
    }
  }
  // เพิ่มใหม่
  appendRow(sh, TARGET_HEADERS, {
    project, username: _user.username,
    deadline, note: note||'',
    updatedAt: new Date().toISOString()
  });
  return { ok: true, action: 'created' };
}

function actionListTargets({ _user }) {
  if (!['admin','manager','leader'].includes(_user.role))
    return { ok: false, message: 'ไม่มีสิทธิ์' };

  const sh   = getSheet('Targets');
  ensureHeaders(sh, TARGET_HEADERS);
  let rows = sheetToObjects(sh);

  // leader เห็นเฉพาะของตัวเอง
  if (_user.role === 'leader') {
    rows = rows.filter(r => r.username === _user.username);
  }
  return { ok: true, targets: rows };
}
    const equipFolder = getOrCreateDynamicFolder(
  'AMR Onsite Inspection Images',
  record.project,
  record.location,
  record.sublocation,
  record.equipment,
  'Equipment Photos'
);

const stickerFolder = getOrCreateDynamicFolder(
  'AMR Onsite Inspection Images',
  record.project,
  record.location,
  record.sublocation,
  record.equipment,
  'Sticker Photos'
);
  if (images && images.main) {
    const folder = getNestedFolder(CONFIG.FOLDERS.ONSITE_IMAGES, record, 'Equipment Photos');
    imgMain = saveImageToFolder(
  images.main,
  fname('main'),
  equipFolder
);
}
  if (images && images.sticker) {
    const folder = getNestedFolder(CONFIG.FOLDERS.ONSITE_IMAGES, record, 'Sticker Photos');
    imgSticker = saveImageToFolder(
  images.sticker,
  fname('sticker'),
  stickerFolder
);
}

  appendRow(sh, SURVEY_HEADERS, { ...record, imgMain, thumbMain, imgSticker, thumbSticker, createdBy: _user.username });
  exportSurveyExcelToDrive(record.project);
  return { ok: true, serverId: record.id };
}

function actionListSurvey({ _user }) {
  const sh   = getSheet(CONFIG.SHEETS.SURVEY);
  ensureHeaders(sh, SURVEY_HEADERS);
  let rows = sheetToObjects(sh);

  const role = _user.role;
  const leaderProjs = (role==='leader')
    ? (_user.project||'').split(',').map(p=>p.trim()).filter(Boolean)
    : [];
  if      (role === 'inspector') rows = rows.filter(r => r.createdBy === _user.username);
  else if (role === 'leader' && leaderProjs.length>0) rows = rows.filter(r => leaderProjs.includes(r.project));

  return {
    ok: true,
    records: rows.map(r => ({
      id: r.id, project: r.project, system: r.system,
      location: r.location, sublocation: r.sublocation,
      equipment: r.equipment, brand: r.brand, model: r.model, serial: r.serial,
      inspector: r.inspector, surveyDate: r.surveyDate, note: r.note,
      imgMain: r.imgMain, thumbMain: r.thumbMain,
      imgSticker: r.imgSticker, thumbSticker: r.thumbSticker,
      createdBy: r.createdBy,
      createdAt: r.createdAt ? new Date(r.createdAt).getTime() : Date.now()
    }))
  };
}

function actionUpdateSurvey({ record, images, _user }) {
  const sh   = getSheet(CONFIG.SHEETS.SURVEY);
  const rows = sheetToObjects(sh);
  const old  = rows.find(r => r.id === record.id);
  if (!old) return { ok: false, message: 'ไม่พบรายการ' };

  const role = _user.role;
  if (role === 'inspector' && old.createdBy !== _user.username) return { ok: false, message: 'ไม่มีสิทธิ์แก้ไข' };
  if (role === 'leader'    && old.project   !== _user.project)  return { ok: false, message: 'ไม่มีสิทธิ์แก้ไข' };

  let imgMain    = old.imgMain    || '';
  let thumbMain  = old.thumbMain  || '';
  let imgSticker = old.imgSticker || '';
  let thumbSticker = old.thumbSticker || '';
  const ts   = new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);
  const base = (record.serial || record.equipment || 'survey').replace(/[^\w\u0E00-\u0E7F]/g,'_');

  if (images && images.main && images.main.startsWith('data:')) {
    const folder = getFolder([CONFIG.FOLDERS.ONSITE_IMAGES, CONFIG.FOLDERS.ONSITE_IMG_EQUIP]);
    imgMain   = saveImageToFolder(images.main, `${base}_main_${ts}.jpg`, folder);
    thumbMain = getThumbnailUrl(imgMain);
  }
  if (images && images.sticker && images.sticker.startsWith('data:')) {
    const folder = getFolder([CONFIG.FOLDERS.ONSITE_IMAGES, CONFIG.FOLDERS.ONSITE_IMG_STICK]);
    imgSticker   = saveImageToFolder(images.sticker, `${base}_sticker_${ts}.jpg`, folder);
    thumbSticker = getThumbnailUrl(imgSticker);
  }

  const updated = { ...record, imgMain, thumbMain, imgSticker, thumbSticker, createdBy: old.createdBy };
  const ok = updateRowById(sh, SURVEY_HEADERS, record.id, updated);
  if (ok) exportSurveyExcelToDrive(record.project);
  return { ok, message: ok ? 'แก้ไขแล้ว' : 'ไม่พบรายการ' };
}

function actionDeleteSurvey({ id, _user }) {
  const sh   = getSheet(CONFIG.SHEETS.SURVEY);
  const rows = sheetToObjects(sh);
  const old  = rows.find(r => r.id === id);
  if (!old) return { ok: false, message: 'ไม่พบรายการ' };

  const role = _user.role;
  if (role === 'inspector' && old.createdBy !== _user.username) return { ok: false, message: 'ไม่มีสิทธิ์ลบ' };
  if (role === 'leader'    && old.project   !== _user.project)  return { ok: false, message: 'ไม่มีสิทธิ์ลบ' };
  if (!['admin','manager','leader','inspector'].includes(role))  return { ok: false, message: 'ไม่มีสิทธิ์ลบ' };

  const ok = deleteRowById(sh, id);
  return { ok, message: ok ? 'ลบแล้ว' : 'ไม่พบรายการ' };
}

function exportSurveyExcelToDrive(project) {
  try {
    const sh   = getSheet(CONFIG.SHEETS.SURVEY);
    const rows = sheetToObjects(sh);
    const list = project ? rows.filter(r => r.project === project) : rows;
    if (!list.length) return;

    const tmpSS = SpreadsheetApp.create(`Survey_${project || 'All'}_tmp`);
    const tmpSh = tmpSS.getActiveSheet();
    const cols  = ['project','system','location','sublocation','equipment','brand','model',
                   'serial','inspector','surveyDate','note','createdBy','createdAt'];
    tmpSh.appendRow(cols);
    list.forEach(r => tmpSh.appendRow(cols.map(c => r[c] || '')));

    const ssId  = tmpSS.getId();
    const url   = `https://docs.google.com/spreadsheets/d/${ssId}/export?format=xlsx`;
    const token = ScriptApp.getOAuthToken();
    const resp  = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) { DriveApp.getFileById(ssId).setTrashed(true); return; }

    const safeName = (project || 'All').replace(/[^\w\u0E00-\u0E7F]/g, '_');
    const dateStr  = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMdd_HHmm');
    const blob     = resp.getBlob().setName(`Survey_${safeName}_${dateStr}.xlsx`);
    const folder   = getFolder([CONFIG.FOLDERS.ONSITE_MASTER, CONFIG.FOLDERS.ONSITE_EXCEL]);

    // ลบไฟล์เก่าของโครงการนี้ก่อน
    const prefix = `Survey_${safeName}_`;
    const files  = folder.getFiles();
    while (files.hasNext()) {
      const f = files.next();
      if (f.getName().startsWith(prefix)) f.setTrashed(true);
    }

    folder.createFile(blob);
    DriveApp.getFileById(ssId).setTrashed(true);
  } catch (err) {
    console.error('exportSurveyExcelToDrive error:', err);
  }
}

/* ================================================================
   PAGE PERMISSIONS
   ================================================================ */
const PERM_HEADERS = ['role','pages'];
const DEFAULT_PAGES = {
  manager:   ['overview','add','records','survey','import'],
  leader:    ['add','records','survey'],
  inspector: ['add','records','survey'],
  observer:  ['records','survey']
};
const ALL_PAGES = ['overview','add','records','survey','import','master','users'];

function getPagePermissions(role) {
  if (role === 'admin') return ALL_PAGES;
  const sh   = getSheet('PagePerms');
  ensureHeaders(sh, PERM_HEADERS);
  const rows = sheetToObjects(sh);
  const rec  = rows.find(r => r.role === role);
  if (rec && rec.pages) return String(rec.pages).split(',').map(p => p.trim()).filter(Boolean);
  return DEFAULT_PAGES[role] || [];
}

function actionGetPagePerms({ _user }) {
  if (_user.role !== 'admin') return { ok: false, message: 'เฉพาะ admin' };
  const sh   = getSheet('PagePerms');
  ensureHeaders(sh, PERM_HEADERS);
  const rows = sheetToObjects(sh);
  const result = {};
  ['manager','leader','inspector','observer'].forEach(role => {
    const rec = rows.find(r => r.role === role);
    result[role] = rec && rec.pages
      ? String(rec.pages).split(',').map(p => p.trim()).filter(Boolean)
      : (DEFAULT_PAGES[role] || []);
  });
  return { ok: true, perms: result, allPages: ALL_PAGES };
}

function actionSetPagePerms({ perms, _user }) {
  if (_user.role !== 'admin') return { ok: false, message: 'เฉพาะ admin' };
  const sh = getSheet('PagePerms');
  sh.clearContents();
  ensureHeaders(sh, PERM_HEADERS);
  Object.entries(perms).forEach(([role, pages]) => {
    sh.appendRow([role, Array.isArray(pages) ? pages.join(',') : pages]);
  });
  return { ok: true };
}

/* ================================================================
   REPORT TEMPLATES — เลือก Word/PDF template (Drive file ID) จากเว็บ
   ================================================================ */
var REPORT_TEMPLATES_HEADERS = ['id', 'name', 'fileId', 'createdAt'];

function actionListReportTemplates({ _user }) {
  const sh = getSheet('ReportTemplates');
  ensureHeaders(sh, REPORT_TEMPLATES_HEADERS);
  const rows = sheetToObjects(sh);
  return { ok: true, templates: rows };
}

function actionSaveReportTemplate({ name, fileId, _user }) {
  if (_user.role !== 'admin' && _user.role !== 'manager') {
    return { ok: false, message: 'เฉพาะ Admin/Manager เท่านั้น' };
  }
  name = String(name || '').trim();
  fileId = String(fileId || '').trim();
  if (!name || !fileId) return { ok: false, message: 'ต้องกรอกชื่อและ File ID' };
  // กันซ้ำ: ตรวจสอบว่ามีไฟล์นี้อยู่จริงและเข้าถึงได้
  try { DriveApp.getFileById(fileId).getName(); }
  catch (e) { return { ok: false, message: 'ไม่พบไฟล์ หรือไม่มีสิทธิ์เข้าถึง File ID นี้' }; }

  const sh = getSheet('ReportTemplates');
  ensureHeaders(sh, REPORT_TEMPLATES_HEADERS);
  const rows = sheetToObjects(sh);
  if (rows.some(r => r.fileId === fileId)) return { ok: false, message: 'Template นี้มีอยู่แล้ว' };
  appendRow(sh, REPORT_TEMPLATES_HEADERS, {
    id: genId(), name, fileId, createdAt: new Date().toISOString()
  });
  return { ok: true };
}

function actionDeleteReportTemplate({ id, _user }) {
  if (_user.role !== 'admin') return { ok: false, message: 'เฉพาะ admin เท่านั้น' };
  const sh = getSheet('ReportTemplates');
  const ok = deleteRowById(sh, id);
  return { ok, message: ok ? 'ลบแล้ว' : 'ไม่พบรายการ' };
}

/* ================================================================
   REPORT FIELD PRESETS — จำค่าที่เคยกรอกไว้ (autocomplete)
   ================================================================ */
var REPORT_PRESETS_HEADERS = ['field', 'value', 'lastUsedAt'];

function actionListReportPresets({ _user }) {
  const sh = getSheet('ReportPresets');
  ensureHeaders(sh, REPORT_PRESETS_HEADERS);
  const rows = sheetToObjects(sh);
  const byField = {};
  rows.forEach(r => {
    if (!r.field || !r.value) return;
    if (!byField[r.field]) byField[r.field] = [];
    if (!byField[r.field].includes(r.value)) byField[r.field].push(r.value);
  });
  return { ok: true, presets: byField };
}

// บันทึกค่าที่กรอกไว้ใช้ autocomplete ครั้งหน้า — เรียกจาก frontend ทุกครั้งที่กด "สร้างรายงาน" สำเร็จ
// fields: { contractName: '...', contractNo: '...', clause: '...', submittedTo: '...', logoCustomer: '...', reportTitle: '...' }
function actionSaveReportPreset({ fields, _user }) {
  if (!fields || typeof fields !== 'object') return { ok: false, message: 'ไม่มีข้อมูล' };
  const sh = getSheet('ReportPresets');
  ensureHeaders(sh, REPORT_PRESETS_HEADERS);
  const rows = sheetToObjects(sh);
  const now = new Date().toISOString();
  Object.keys(fields).forEach(field => {
    const value = String(fields[field] || '').trim();
    if (!value) return;
    const existingRow = findRowByFieldValue_(sh, rows, field, value);
    if (existingRow > 0) {
      sh.getRange(existingRow, REPORT_PRESETS_HEADERS.indexOf('lastUsedAt') + 1).setValue(now);
    } else {
      appendRow(sh, REPORT_PRESETS_HEADERS, { field, value, lastUsedAt: now });
    }
  });
  return { ok: true };
}

// helper: หาแถวที่ field+value ตรงกัน (ไม่ใช้ id เพราะ key คือ field+value คู่กัน)
function findRowByFieldValue_(sh, rows, field, value) {
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].field === field && rows[i].value === value) return i + 2; // +2: header row + 1-index
  }
  return -1;
}

/* ================================================================
   USER MANAGEMENT
   ✅ FIX #4 — เพิ่ม actionSetUserActive + แก้ actionDeleteUser
   ================================================================ */
function actionCreateUser({ username, password, name, role, project, _user }) {
  if (_user.role !== 'admin') return { ok: false, message: 'เฉพาะ admin เท่านั้น' };
  if (!username || !password)  return { ok: false, message: 'ต้องมี username และ password' };

  const sh   = getSheet(CONFIG.SHEETS.USERS);
  ensureHeaders(sh, USER_HEADERS);
  const rows = sheetToObjects(sh);
  if (rows.find(r => r.username === username))
    return { ok: false, message: `username "${username}" มีอยู่แล้ว` };

  appendRow(sh, USER_HEADERS, {
    id: genId(), username, password: hashPw(password),
    plainPwd: password,
    name: name || username, role: role || 'inspector',
    project: project || '', active: 'true',
    createdAt: new Date().toISOString()
  });
  return { ok: true };
}

function actionUpdateUser({ username, updates, _user }) {
  if (_user.role !== 'admin') return { ok: false, message: 'เฉพาะ admin เท่านั้น' };
  const sh   = getSheet(CONFIG.SHEETS.USERS);
  const data = sh.getDataRange().getValues();
  const hdrs = data[0];
  const uCol = hdrs.indexOf('username');
  for (let i = 1; i < data.length; i++) {
    if (data[i][uCol] === username) {
      hdrs.forEach((h, ci) => {
        if (h === 'password' && updates.password) {
          sh.getRange(i+1, ci+1).setValue(hashPw(updates.password));
        } else if (updates[h] !== undefined && h !== 'id' && h !== 'createdAt' && h !== 'username') {
          sh.getRange(i+1, ci+1).setValue(updates[h]);
        }
      });
      return { ok: true };
    }
  }
  return { ok: false, message: 'ไม่พบ username' };
}

// ✅ FIX — เพิ่มฟังก์ชันใหม่ที่หายไปจาก router
function actionSetUserActive({ username, active, _user }) {
  if (_user.role !== 'admin') return { ok: false, message: 'เฉพาะ admin เท่านั้น' };
  const sh   = getSheet(CONFIG.SHEETS.USERS);
  const data = sh.getDataRange().getValues();
  const hdrs = data[0];
  const uCol = hdrs.indexOf('username');
  const aCol = hdrs.indexOf('active');
  if (uCol < 0 || aCol < 0) return { ok: false, message: 'ไม่พบคอลัมน์ที่ต้องการ' };
  for (let i = 1; i < data.length; i++) {
    if (data[i][uCol] === username) {
      sh.getRange(i+1, aCol+1).setValue(active ? 'true' : 'false');
      return { ok: true };
    }
  }
  return { ok: false, message: 'ไม่พบ username' };
}

// ✅ FIX — แก้ actionDeleteUser ให้หา by username column ตรง ๆ (ไม่ผ่าน findRowById ที่หา by id)
function actionDeleteUser({ username, _user }) {
  if (_user.role !== 'admin') return { ok: false, message: 'เฉพาะ admin เท่านั้น' };
  if (username === 'admin')   return { ok: false, message: 'ไม่สามารถลบ admin หลักได้' };

  const sh   = getSheet(CONFIG.SHEETS.USERS);
  const data = sh.getDataRange().getValues();
  const uCol = data[0].indexOf('username');
  if (uCol < 0) return { ok: false, message: 'ไม่พบคอลัมน์ username' };
  for (let i = 1; i < data.length; i++) {
    if (data[i][uCol] === username) {
      sh.deleteRow(i + 1);
      return { ok: true };
    }
  }
  return { ok: false, message: 'ไม่พบ username' };
}

function actionBulkCreateUsers({ users, _user }) {
  if (_user.role !== 'admin') return { ok: false, message: 'เฉพาะ admin เท่านั้น' };
  const sh       = getSheet(CONFIG.SHEETS.USERS);
  ensureHeaders(sh, USER_HEADERS);
  const rows     = sheetToObjects(sh);
  const existing = new Set(rows.map(r => r.username));

  let created = 0, skipped = 0;
  const errors = [];
  (users || []).forEach(u => {
    if (!u.username || !u.password) { errors.push('ข้ามแถว: ไม่มี username/password'); skipped++; return; }
    if (existing.has(u.username))   { skipped++; return; }
    appendRow(sh, USER_HEADERS, {
      id: genId(), username: u.username, password: hashPw(u.password),
      name: u.name || u.username, role: u.role || 'inspector',
      project: u.project || '', active: 'true',
      createdAt: new Date().toISOString()
    });
    existing.add(u.username);
    created++;
  });
  return { ok: true, created, skipped, errors };
}

function actionListUsers({ _user }) {
  if (_user.role !== 'admin') return { ok: false, message: 'เฉพาะ admin เท่านั้น' };
  const sh   = getSheet(CONFIG.SHEETS.USERS);
  ensureHeaders(sh, USER_HEADERS);
  const rows = sheetToObjects(sh);
  return {
    ok: true,
    users: rows.map(r => ({
      username:  r.username,
            password:  r.password,
      name:      r.name,
      role:      r.role,
      project:   r.project,
      active:    String(r.active).toLowerCase() !== 'false',
      createdAt: r.createdAt
    }))
  };
}

/* ================================================================
   LOGS
   ================================================================ */
const LOG_HEADERS = ['ts','action','username','device','browser','ip'];

function writeLog(action, username, ctx) {
  try {
    const sh = getSheet(CONFIG.SHEETS.LOGS);
    ensureHeaders(sh, LOG_HEADERS);
    sh.appendRow([
      new Date().toISOString(), action, username,
      ctx.device  || '',
      ctx.browser ? ctx.browser.slice(0,80) : '',
      ctx.ip      || ''
    ]);
  } catch(e) { /* ไม่ให้ log crash งาน */ }
}

function testDocumentAccess() {
  var doc = DocumentApp.openById('1cs3aZNeU-TTJegfyQH9nyY5fVFlNfanBYNXoPCCe028');
  Logger.log('OK: ' + doc.getName());
}

/* ================================================================
   FIX TOOLS — รันจาก GAS Editor เมื่อมีปัญหา
   ================================================================ */

/** รันครั้งเดียวเพื่อ reset Users sheet headers (แก้ปัญหา column shift) */
function fixUsersSheet() {
  const sh = getSheet(CONFIG.SHEETS.USERS);
  const data = sh.getDataRange().getValues();
  if (data.length < 1) { Logger.log('Sheet empty'); return; }

  const currentHeaders = data[0].map(h => String(h).trim());
  Logger.log('Current headers: ' + JSON.stringify(currentHeaders));

  // ถ้ามี plainPwd ใน header → ต้องเอาออก
  if (currentHeaders.includes('plainPwd')) {
    Logger.log('Found plainPwd column - fixing...');
    const pIdx = currentHeaders.indexOf('plainPwd');
    // สร้าง data ใหม่โดยตัด plainPwd column ออก
    const newData = data.map(row => {
      const newRow = [...row];
      newRow.splice(pIdx, 1);
      return newRow;
    });
    sh.clearContents();
    sh.getRange(1, 1, newData.length, newData[0].length).setValues(newData);
    Logger.log('✅ Removed plainPwd column. New headers: ' + JSON.stringify(newData[0]));
  } else {
    Logger.log('✅ Headers OK: ' + JSON.stringify(currentHeaders));
  }
}

/** ทดสอบ login ว่า API ทำงานหรือไม่ */
function testLogin() {
  const result = actionLogin({ username: 'admin', password: 'admin1234' });
  Logger.log('Login test result: ' + JSON.stringify(result));
}

/** ดู Users ที่มีอยู่ทั้งหมด */
function listAllUsers() {
  const sh = getSheet(CONFIG.SHEETS.USERS);
  const data = sh.getDataRange().getValues();
  Logger.log('Headers: ' + JSON.stringify(data[0]));
  Logger.log('Rows: ' + (data.length - 1));
  if (data.length > 1) Logger.log('First user: ' + JSON.stringify(data[1]));
}

/* ================================================================
   SETUP — รันครั้งแรกเพื่อ Init ทุกอย่าง
   ================================================================ */
function setupFolders() {
  const paths = [
    [CONFIG.FOLDERS.AMR_IMAGES,    CONFIG.FOLDERS.AMR_IMG_EQUIP],
    [CONFIG.FOLDERS.AMR_IMAGES,    CONFIG.FOLDERS.AMR_IMG_STICKER],
    [CONFIG.FOLDERS.ONSITE_IMAGES, CONFIG.FOLDERS.ONSITE_IMG_EQUIP],
    [CONFIG.FOLDERS.ONSITE_IMAGES, CONFIG.FOLDERS.ONSITE_IMG_STICK],
    [CONFIG.FOLDERS.ONSITE_MASTER, CONFIG.FOLDERS.ONSITE_EXCEL]
  ];
  paths.forEach(p => getFolder(p));
  Logger.log('✅ สร้าง folder structure ใน Drive เรียบร้อย');
}

function setupSheets() {
  Object.values(CONFIG.SHEETS).forEach(name => getSheet(name));
  Logger.log('✅ สร้าง Sheet tabs เรียบร้อย');
}

function initialize() {
  setupSheets();
  setupFolders();
  Logger.log('✅ AMR Inspection Backend พร้อมใช้งาน');
}
// ฟังก์ชันสร้างหรือดึง Folder ลึกตาม Path
function getOrCreateDynamicFolder(baseFolderName, project, loc, subloc, equip, typeFolder) {
  const rootId = DriveApp.getFolderById(CONFIG.DRIVE_ROOT_ID);
  const base = getOrCreateFolderObj(rootId, baseFolderName);
  const pFolder = getOrCreateFolderObj(base, project || 'ไม่ระบุโครงการ');
  const lFolder = getOrCreateFolderObj(pFolder, loc || 'ไม่ระบุสถานที่');
  const slFolder = getOrCreateFolderObj(lFolder, subloc || 'ไม่ระบุสถานที่ย่อย');
  const eqFolder = getOrCreateFolderObj(slFolder, equip || 'ไม่ระบุอุปกรณ์');
  return getOrCreateFolderObj(eqFolder, typeFolder);
}

function getOrCreateFolderObj(parentFolder, folderName) {
  if (!folderName) return parentFolder;
  const folders = parentFolder.getFoldersByName(folderName);
  if (folders.hasNext()) return folders.next();
  return parentFolder.createFolder(folderName);
}
function checkFunctions() {
  const required = [
    'login','verifyToken','createRecord','listRecords','deleteRecord',
    'createUser','listUsers','saveMaster','listMaster','getProgress',
    'createSurvey','listSurvey','listTargets','saveTarget',
    'getPdpaStatus','acceptPdpa','bulkCreateUsers','updateUser','deleteUser'
  ];

  // GAS ใช้ globalThis แทน this
  required.forEach(fn => {
    const exists = typeof globalThis[fn] === 'function';
    Logger.log((exists ? '✅' : '❌') + ' ' + fn);
  });
}
function testAllActions() {
  // ทดสอบ login จริงๆ
  const r = actionLogin({ username: 'admin', password: 'admin1234' });
  Logger.log('Login: ' + JSON.stringify(r));

  // ถ้า login ได้ → แสดงว่า GAS backend พร้อมใช้งานจริง
}
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
