/*************************************************************
 * OMA Workforce Dashboard — Code.gs
 *
 * Built to survive edits to the sheet:
 *  - finds the sheet even if the tab is renamed
 *  - finds the header row even if rows are inserted above it
 *  - accepts several spellings for every column
 *  - passes every extra column straight through to the front end
 *************************************************************/

var SHEET_NAMES = ['Data Staff', 'Staff OMA', 'DB_OMA_Employee'];  // tried in order
var APP_TITLE   = 'OMA Workforce Dashboard';

/* Names of the HTML file, tried in order. Add yours here if it is called
   something else — the name is case sensitive and has no .html on the end. */
var HTML_FILES = ['Index', 'index', 'INDEX', 'Employee', 'Dashboard', 'DB_OMA_Employee'];

/* PortalGuard.gs ต้องถูกวางไว้ในโปรเจกต์เดียวกับไฟล์นี้ — ดูคำอธิบายในไฟล์นั้น
   PORTAL_ENFORCE = false คือโหมด shadow (ไม่บล็อกใครจริง แค่บันทึก log) เปลี่ยน
   เป็น true เมื่อยืนยันแล้วว่า role ของผู้ใช้จริงทุกคนแมปถูกต้องใน Hub */
var PORTAL_MENU_ID = 'sec-employee-dash';
var PORTAL_ENFORCE = false;

function doGet(e) {
  var g = portalGuard(e, PORTAL_MENU_ID);
  if (g.deny) return g.deny;

  var bootstrap = JSON.stringify({
    token: (e && e.parameter && e.parameter.portalToken) || '',
    email: g.access.email, name: g.access.name, role: g.access.role,
    isAdmin: isAdminish(g.access)
  });

  for (var i = 0; i < HTML_FILES.length; i++) {
    try {
      var t = HtmlService.createTemplateFromFile(HTML_FILES[i]);
      t.portalBootstrap = bootstrap;
      return t.evaluate()
        .setTitle(APP_TITLE)
        .addMetaTag('viewport', 'width=device-width, initial-scale=1')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    } catch (e2) { /* try the next name */ }
  }
  return HtmlService.createHtmlOutput(
    '<div style="font-family:sans-serif;padding:24px;line-height:1.7">' +
    '<h3 style="margin:0 0 8px">HTML file not found</h3>' +
    'Code.gs looked for these file names: <b>' + HTML_FILES.join(', ') + '</b><br>' +
    'Rename the dashboard HTML file to <b>Index</b>, or add its name to the ' +
    '<b>HTML_FILES</b> list at the top of Code.gs.</div>');
}

function include(f) {
  return HtmlService.createHtmlOutputFromFile(f).getContent();
}

/* ---------- small helpers -------------------------------------------- */

function _s_(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/\s+/g, ' ').trim();
}

function _date_(v) {
  if (!v) return null;
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v)) return v;
  var s = String(v).trim();
  if (!s) return null;
  var m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);          // 1989/11/13
  if (m) { var y1 = +m[1]; if (y1 > 2400) y1 -= 543; return new Date(y1, +m[2] - 1, +m[3]); }
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);              // 13/11/1989
  if (m) { var y2 = +m[3]; if (y2 > 2400) y2 -= 543; return new Date(y2, +m[2] - 1, +m[1]); }
  var d = new Date(s);
  return isNaN(d) ? null : d;
}

function _iso_(d) { return d ? Utilities.formatDate(d, 'Asia/Bangkok', 'yyyy-MM-dd') : ''; }

function _months_(from, to) {
  var m = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  if (to.getDate() < from.getDate()) m--;
  return Math.max(0, m);
}

/* Drive share link -> displayable thumbnail URL */
function _photoUrl_(url) {
  var s = _s_(url);
  if (!s) return '';
  if (s.indexOf('thumbnail?id=') > -1) return s;                       // already converted
  var m = s.match(/\/d\/([a-zA-Z0-9_-]{20,})/) || s.match(/[?&]id=([a-zA-Z0-9_-]{20,})/);
  return m ? 'https://drive.google.com/thumbnail?id=' + m[1] + '&sz=w400' : s;
}

/* ---------- which System values are real systems ----------------------
 * Everything NOT on this list counts as a technical system, so renaming
 * or adding a system in the sheet keeps working with no code change.
 * -------------------------------------------------------------------- */
var NON_SYSTEM = ['management', 'specialist', 'project leader', 'admin',
  'ma manager', 'ma support', 'maintenance manager', 'maintenance support',
  'planner/cmms/iso', 'customer support', 'custumer support'];

var SYSTEM_FIX = { 'custumer support': 'Customer Support' };           // typo in the source only

function _mapUnit_(v) {
  var raw = _s_(v), k = raw.toLowerCase();
  return { name: SYSTEM_FIX[k] || raw, isSys: NON_SYSTEM.indexOf(k) === -1 && raw !== '' };
}

/* ---------- finding the sheet and the header row --------------------- */

function _sheet_() {
  var ss = SpreadsheetApp.getActive(), sh;
  for (var i = 0; i < SHEET_NAMES.length; i++) {
    sh = ss.getSheetByName(SHEET_NAMES[i]);
    if (sh) return sh;
  }
  return ss.getSheets()[0];                                            // fall back to the first tab
}

/* The header row is the first row (within the top 10) that contains a cell
   reading "Employee ID" or "Name" — so extra title rows above it are ignored. */
function _headerRow_(values) {
  var limit = Math.min(10, values.length);
  for (var r = 0; r < limit; r++) {
    var row = values[r].map(function (c) { return _s_(c).toLowerCase(); });
    if (row.indexOf('employee id') > -1 || row.indexOf('name') > -1) return r;
  }
  return 0;
}

/* ---------- main ------------------------------------------------------ */

/* คอลัมน์ที่ถือว่าอ่อนไหว เช็คแบบ substring ไม่สนตัวพิมพ์เล็กใหญ่ — กันคอลัมน์ใหม่ที่
   HR อาจเพิ่มในอนาคต (เงินเดือน, เลขบัญชี, เลขบัตรประชาชน) ไม่ให้หลุดออกไปกับผู้ใช้
   ทุกคนโดยไม่ตั้งใจผ่านลูป "ส่งทุกคอลัมน์ที่เหลือผ่านตรงๆ" ด้านล่าง (เดิมไม่มีการกรอง
   เลย คอลัมน์ไหนก็ตามที่เพิ่มเข้าไปในชีตจะถูกส่งให้ผู้ดูทุกคนทันที) */
var SENSITIVE_KEYWORDS = [
  'dob', 'date of birth', 'birth', 'วันเกิด',
  'address', 'ที่อยู่',
  'emergency', 'ฉุกเฉิน',
  'disease', 'medical', 'โรค',
  'training', 'อบรม',
  'phone', 'mobile', 'tel', 'เบอร์โทร',
  'salary', 'wage', 'เงินเดือน', 'ค่าจ้าง',
  'bank', 'ธนาคาร', 'บัญชี',
  'national id', 'id card', 'บัตรประชาชน', 'เลขบัตร'
];
function _isSensitiveHeader_(header) {
  var h = String(header || '').toLowerCase();
  return SENSITIVE_KEYWORDS.some(function (kw) { return h.indexOf(kw) !== -1; });
}

function getEmployeeData(portalToken) {
  var access = portalAccessForCall(portalToken, PORTAL_MENU_ID);
  if (!access.ok) throw new Error(access.message || 'ไม่มีสิทธิ์เข้าถึงข้อมูลนี้');
  var canSeeSensitive = isAdminish(access); // ข้อมูลส่วนบุคคล (ที่อยู่/เบอร์/วันเกิด/โรคประจำตัว/ผู้ติดต่อฉุกเฉิน) เห็นได้เฉพาะ admin/manager

  var sh = _sheet_();
  if (!sh) throw new Error('No sheet found in this spreadsheet');

  var values = sh.getDataRange().getValues();
  if (!values.length) throw new Error('The sheet is empty');

  var hr = _headerRow_(values);
  var headRaw = values[hr].map(_s_);
  var head = headRaw.map(function (h) { return h.toLowerCase(); });

  /* col('a','b','c') returns the index of the first header that matches */
  function col() {
    for (var i = 0; i < arguments.length; i++) {
      var idx = head.indexOf(String(arguments[i]).toLowerCase());
      if (idx > -1) return idx;
    }
    return -1;
  }

  var C = {
    div:   col('division'),
    dept:  col('department'),
    id:    col('employee id', 'employee no', 'staff id', 'id', 'รหัสพนักงาน'),
    title: col('title', 'คำนำหน้า'),
    name:  col('name', 'full name', 'ชื่อ-นามสกุล', 'ชื่อ'),
    nick:  col('nickname', 'nick name', 'ชื่อเล่น'),
    pos:   col('position', 'job title', 'ตำแหน่ง'),
    loc:   col('location', 'work place', 'workplace', 'work location',
               'site', 'work site', 'พื้นที่', 'พื้นที่ปฏิบัติงาน', 'สถานที่ปฏิบัติงาน'),
    sys:   col('system', 'systems', 'ระบบ', 'ระบบงาน'),
    sex:   col('gender', 'sex', 'เพศ'),
    dob:   col('date of birth', 'birth date', 'birthday', 'dob', 'วันเกิด'),
    start: col('employment start date', 'start date', 'hire date',
               'employment date', 'วันเริ่มงาน'),
    mail:  col('email', 'e-mail', 'อีเมล'),
    tel:   col('phone', 'mobile', 'tel', 'telephone', 'เบอร์โทร'),
    pic:   col('picture', 'photo', 'image', 'รูป', 'รูปภาพ'),
    lvl:   col('level', 'job level', 'band', 'ระดับ', 'ระดับตำแหน่ง'),
    edu:   col('educational qualifications', 'education', 'ประวัติการศึกษา', 'วุฒิการศึกษา'),
    field: col('field of study', 'major', 'สาขาวิชา'),
    addr:  col('current address', 'address', 'ที่อยู่', 'ที่อยู่ปัจจุบัน'),
    emerg: col('emergency contact person', 'emergency contact', 'ผู้ติดต่อฉุกเฉิน'),
    dis:   col('congenital disease', 'medical condition', 'โรคประจำตัว'),
    train: col('training history', 'training', 'ประวัติการอบรม'),

    /* org chart, driven entirely by the sheet */
    unit2: col('org unit', 'orgunit', 'unit', 'หน่วยงาน'),
    sub:   col('sub group', 'subgroup', 'group', 'กลุ่มย่อย'),
    crole: col('chart role', 'chartrole', 'role', 'บทบาท'),
    team:  col('team', 'ทีม'),
    last:  col('last day', 'end date', 'resign date', 'วันสุดท้าย'),
    afor:  col('acting for', 'actingfor', 'acting', 'รักษาการแทน', 'รักษาการ')
  };

  if (C.name === -1 && C.id === -1) {
    throw new Error('Could not find a "Name" or "Employee ID" column on sheet "' + sh.getName() + '"');
  }

  function g(row, key) { return C[key] > -1 ? row[C[key]] : ''; }

  var today = new Date(), rows = [], vacs = [];

  for (var r = hr + 1; r < values.length; r++) {
    var v = values[r];
    var name = _s_(g(v, 'name')), id = _s_(g(v, 'id'));
    var orgUnit = _s_(g(v, 'unit2'));
    var isVacant = /^(vacant|ว่าง)$/i.test(name);
    if (!name && !id && !orgUnit) continue;          // truly empty row
    if (isVacant) {                                   // an open post, not a person
      vacs.push({
        vacant: true,
        id: 'VAC' + (vacs.length + 1),
        name: '',
        nick: '',
        position: _s_(g(v, 'pos')),
        band: _s_(g(v, 'pos')),
        orgUnit: orgUnit,
        subGroup: _s_(g(v, 'sub')),
        chartRole: _s_(g(v, 'crole')),
        team: _s_(g(v, 'team')) || orgUnit
      });
      continue;
    }
    if (!name && !id) continue;

    var dob = _date_(g(v, 'dob')), start = _date_(g(v, 'start'));
    var unit = _mapUnit_(g(v, 'sys'));
    var pos = _s_(g(v, 'pos')).replace(/^intenance /i, 'Maintenance ');   // typo in the source

    var row = {
      no: rows.length + 1,
      id: id,
      title: _s_(g(v, 'title')),
      name: name,
      nick: _s_(g(v, 'nick')),
      position: pos,
      band: _s_(g(v, 'lvl')) || pos,          // Level column wins; otherwise the position itself
      unit: unit.name,
      isSys: unit.isSys,
      system: unit.isSys ? unit.name : '',
      func: unit.isSys ? '' : unit.name,
      site: _s_(g(v, 'loc')),
      division: _s_(g(v, 'div')),
      dept: _s_(g(v, 'dept')),
      gender: /female|หญิง|นาง|น\.?ส\.?/i.test(_s_(g(v, 'sex')) || _s_(g(v, 'title'))) ? 'Female' : 'Male',
      dob: canSeeSensitive ? _iso_(dob) : '',            // เห็นวันเกิดจริงเฉพาะ admin/manager
      start: _iso_(start),
      ageM: dob ? _months_(dob, today) : null,           // อายุ (เดือน) ที่คำนวณแล้ว ยังโชว์ได้ทุกคน ไม่ใช่ข้อมูลอ่อนไหวเท่าวันเกิดจริง
      svcM: start ? _months_(start, today) : null,
      email: _s_(g(v, 'mail')).toLowerCase(),
      phone: canSeeSensitive ? _s_(g(v, 'tel')) : '',
      photoUrl: _photoUrl_(g(v, 'pic')),

      /* HR profile drawer — ข้อมูลส่วนบุคคล เห็นได้เฉพาะ admin/manager */
      'educational qualifications': _s_(g(v, 'edu')),
      'Field of Study': _s_(g(v, 'field')),
      'Current address': canSeeSensitive ? _s_(g(v, 'addr')) : '',
      'Emergency contact person': canSeeSensitive ? _s_(g(v, 'emerg')) : '',
      'congenital disease': canSeeSensitive ? _s_(g(v, 'dis')) : '',
      'Training history': canSeeSensitive ? (C.train > -1 ? String(v[C.train] || '') : '') : '',

      /* org chart fields */
      vacant: false,
      orgUnit: orgUnit,
      subGroup: _s_(g(v, 'sub')),
      chartRole: _s_(g(v, 'crole')),
      team: _s_(g(v, 'team')) || orgUnit || _mapUnit_(g(v, 'sys')).name,
      actingFor: _s_(g(v, 'afor')),
      lastDay: _s_(g(v, 'last'))
    };

    /* pass every remaining column through under its own header name,
       so a new column in the sheet is instantly available in Index.html —
       except a column that looks sensitive by name (see SENSITIVE_KEYWORDS
       above), which stays out unless the caller is admin/manager */
    for (var c = 0; c < headRaw.length; c++) {
      var key = headRaw[c];
      if (key && !(key in row) && (canSeeSensitive || !_isSensitiveHeader_(key))) {
        row[key] = _s_(v[c]);
      }
    }

    rows.push(row);
  }

  return {
    updated: Utilities.formatDate(today, 'Asia/Bangkok', 'd MMM yyyy, HH:mm'),
    sheet: sh.getName(),
    rows: rows,
    vacancies: vacs
  };
}

/* ---------- run this once from the editor to check the wiring ---------
   ทำงานได้เฉพาะตอน PORTAL_ENFORCE = false (shadow mode) เพราะรันจาก editor
   ไม่มี portal token จริงให้ส่ง — ถ้าเปิดใช้งานจริงแล้ว (PORTAL_ENFORCE = true)
   ฟังก์ชันนี้จะ throw เพราะไม่มีสิทธิ์ ซึ่งเป็นเรื่องปกติ ให้ไปเช็คสิทธิ์ผู้ใช้แต่ละ
   คนจากหน้าตั้งค่าของ Hub แทน */
function checkSetup() {
  var res = getEmployeeData(''), r = res.rows[0] || {};
  Logger.log('Sheet          : ' + res.sheet);
  Logger.log('Rows read      : ' + res.rows.length);
  Logger.log('Work places    : ' + res.rows.filter(function (x) { return x.site; }).length + ' rows have a Location');
  Logger.log('Photos         : ' + res.rows.filter(function (x) { return x.photoUrl; }).length + ' rows have a picture');
  Logger.log('Vacant posts   : ' + res.vacancies.length);
  Logger.log('No Org Unit    : ' + res.rows.filter(function (x) { return !x.orgUnit; }).length + ' people are not placed on the chart');
  Logger.log('First record   : ' + JSON.stringify(r, null, 2));
}