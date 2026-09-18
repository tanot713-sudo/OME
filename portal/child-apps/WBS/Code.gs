// ============================================================
//  Code.gs — OMA WBS | AMR ASIA
//  Google Apps Script Backend
//  Sheets: WBS_Tasks, WBS_Progress
// ============================================================

// PortalGuard.gs ต้องถูกวางไว้ในโปรเจกต์เดียวกับไฟล์นี้
// PORTAL_ENFORCE = false คือโหมด shadow (ไม่บล็อกใครจริง แค่บันทึก log) เปลี่ยนเป็น
// true เมื่อยืนยันแล้วว่า role ของผู้ใช้จริงทุกคนแมปถูกต้องใน Hub
var PORTAL_MENU_ID = 'sec-wbs-dash';
var PORTAL_ENFORCE = false;

/* ── Entry Point ──────────────────────────────────────────── */
function doGet(e) {
  var g = portalGuard(e, PORTAL_MENU_ID);
  if (g.deny) return g.deny;

  var bootstrap = JSON.stringify({
    token: (e && e.parameter && e.parameter.portalToken) || '',
    email: g.access.email, name: g.access.name, role: g.access.role,
    isAdmin: isAdminish(g.access), canWrite: canWrite(g.access),
    projectScope: g.access.projectScope,
    assigned: g.access.projectScope === 'all' ? ['ALL'] : g.access.projects,
    // null = เห็นทุกแท็บ (ไม่ถูกจำกัด), array = เห็นเฉพาะ id ('dashboard'/'update')
    allowedSections: g.access.allowedSections
  });

  return HtmlService
    .createHtmlOutputFromFile('Index')
    .append('<script>window.PORTAL = ' + bootstrap + ';</script>')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .setTitle('OMA WBS — AMR ASIA');
}

/* doLogin() ถูกลบออก — login ทำที่ OMA Portal แล้วเท่านั้น ห้ามใส่กลับเข้ามาอีก
   (ของเดิมยังมีบั๊กร้ายแรงที่ index.txt ฝั่ง frontend: ถ้าเปิดไฟล์นี้นอก Apps
   Script sandbox จะ login เป็น Admin ไม่จำกัดสิทธิ์ให้ทันทีโดยไม่ต้องใส่รหัสผ่าน
   เลย — แก้ไปพร้อมกันแล้วที่ Index.html) ชีต User_Roles เดิมยังเก็บไว้เป็นข้อมูล
   อ้างอิงสำหรับย้ายไปตั้งค่าใน Hub (Sheet_Users) เท่านั้น โค้ดนี้ไม่อ่านมันอีกแล้ว */

// หา RefProject ของ task จาก TaskID — ใช้เช็คสิทธิ์โครงการก่อนแก้/ลบ task ที่ไม่ได้
// ส่ง RefProject มาตรงๆ (deleteTask/updateTaskFields/toggleTaskFlag/getTaskRevisions)
function _taskRefProject_(taskID) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('WBS_Tasks');
  if (!sheet) return null;
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var idCol = headers.indexOf('TaskID');
  var refCol = headers.indexOf('RefProject');
  if (idCol < 0 || refCol < 0) return null;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idCol]) === String(taskID)) return String(data[i][refCol] || '');
  }
  return null;
}

// ใช้ร่วมกันโดย updateTaskFields และ bulkSaveImport (การ import จากไฟล์ยิงคำขอเดียว
// เขียนได้หลาย task พร้อมกัน แทนที่จะเรียก updateTaskFields แยกทีละแถว)
function _applyTaskFieldsToRow_(headers, sheet, targetRow, fields) {
  var headerMapping = { 'StartDate': 'StartDate', 'EndDate': 'EndDate', 'Duration_Day': 'Duration_Day' };
  Object.keys(fields || {}).forEach(function (key) {
    var sheetHeaderName = headerMapping[key] || key;
    var colIdx = headers.indexOf(sheetHeaderName);
    if (colIdx === -1) return;
    var value = fields[key];
    if ((key === 'StartDate' || key === 'EndDate') && value) {
      value = new Date(value);
    } else if (key === 'Duration_Day' || key === 'PlanPercent') {
      value = Number(value);
    }
    sheet.getRange(targetRow, colIdx + 1).setValue(value);
  });
}

function _appendTaskRevisions_(ss, taskID, revs, userEmail) {
  if (!revs || !revs.length) return;
  var revSheet = ss.getSheetByName('WBS_TaskRevisions');
  if (!revSheet) return;
  var tz = Session.getScriptTimeZone();
  var today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var revRows = revs.map(function (r, idx) {
    return [
      'TR-' + Utilities.formatDate(new Date(), tz, 'yyyyMMddHHmmss') + '-' + idx,
      taskID, r.Field, r.OldValue, r.NewValue, userEmail, today
    ];
  });
  revSheet.getRange(revSheet.getLastRow() + 1, 1, revRows.length, 7).setValues(revRows);
}

/* ── Read WBS Data ────────────────────────────────────────── */
function getWBSData(portalToken) {
  try {
    var access = portalAccessForCall(portalToken, PORTAL_MENU_ID);
    if (!access.ok) return JSON.stringify({ tasks:[], progress:[], projects:[], members:[], ok:false, error: access.message });
    const ss  = SpreadsheetApp.getActiveSpreadsheet();
    const tz  = Session.getScriptTimeZone();

    // ดึงข้อมูล Projects
    const projSheet = ss.getSheetByName("Projects");
    let projectsData = [];
    if (projSheet) {
      const pData = projSheet.getDataRange().getValues();
      for (let i = 1; i < pData.length; i++) { // เริ่ม 1 เพื่อข้ามแถว Header
        if (pData[i][0]) { // ตรวจสอบว่าคอลัมน์ ID ไม่ว่างเปล่า
          projectsData.push({
            id: String(pData[i][0] || ''), 
            name: String(pData[i][1] || ''), 
            owner: String(pData[i][2] || ''),
            pm: String(pData[i][3] || ''), 
            // จัดฟอร์แมตวันที่ให้อยู่ในรูป YYYY-MM-DD เพื่อให้หน้าเว็บอ่านง่าย
            start: pData[i][4] ? Utilities.formatDate(new Date(pData[i][4]), tz, "yyyy-MM-dd") : '', 
            end: pData[i][5] ? Utilities.formatDate(new Date(pData[i][5]), tz, "yyyy-MM-dd") : '',
            status: String(pData[i][6] || 'active'), 
            color: String(pData[i][7] || '#D62828'), 
            note: String(pData[i][8] || ''),
            // Item 5: Cutoff Period ของ Monthly S-Curve — วันเริ่ม Cutoff แรก + ความถี่ (เดือน)
            // คอลัมน์ J,K ในชีต Projects — ถ้ายังไม่มีคอลัมน์นี้/ยังไม่ได้กรอก ระบบ fallback เป็น
            // ปฏิทินเดือนปกติ (เหมือนพฤติกรรมเดิมทุกประการ ไม่กระทบ Project ที่มีอยู่แล้ว)
            cutoffStart: pData[i][9] ? Utilities.formatDate(new Date(pData[i][9]), tz, "yyyy-MM-dd") : '',
            cutoffFreq: pData[i][10] ? Number(pData[i][10]) : 1
          });
        }
      }
    }

    // ดึงข้อมูล Members
    const memSheet = ss.getSheetByName("Members");
    let membersData = [];
    if (memSheet) {
      const mData = memSheet.getDataRange().getValues();
      for (let i = 1; i < mData.length; i++) { 
        if (mData[i][0]) { // ตรวจสอบว่าคอลัมน์ Name ไม่ว่างเปล่า
          membersData.push({
            name: String(mData[i][0] || ''), 
            role: String(mData[i][1] || ''), 
            dept: String(mData[i][2] || ''), 
            email: String(mData[i][3] || '')
          });
        }
      }
    }

    // ── WBS_Tasks ──────────────────────────────────────────
    const tSheet  = ss.getSheetByName('WBS_Tasks');
    const tRaw    = tSheet.getDataRange().getValues();
    const tHdr    = tRaw[0];

    const NUMERIC_TASK = ['Duration_Day','Weight_Pct','Level','SortOrder'];

    const tasks = tRaw.slice(1)
      .filter(r => r[0])
      .map(r => {
        const o = {};
        tHdr.forEach((h, i) => {
          const v = r[i];
          if (NUMERIC_TASK.includes(h))        o[h] = Number(v) || 0;
          else if (v instanceof Date)          o[h] = Utilities.formatDate(v, tz, 'yyyy-MM-dd');
          else                                 o[h] = v;
        });
        return o;
      });

    // ── WBS_Progress ───────────────────────────────────────
    const pSheet  = ss.getSheetByName('WBS_Progress');
    const pRaw    = pSheet.getDataRange().getValues();
    const pHdr    = pRaw[0];

    const progress = pRaw.slice(1)
      .filter(r => r[0])
      .map(r => {
        const o = {};
        pHdr.forEach((h, i) => {
          const v = r[i];
          if (h === 'ActualPercent')           o[h] = Number(v) || 0;
          else if (v instanceof Date)          o[h] = Utilities.formatDate(v, tz, 'yyyy-MM-dd');
          else                                 o[h] = v;
        });
        return o;
      });

    // ── WBS_SCurveOverride (ค่าที่ผู้ใช้ล็อกเอง รายเดือน/รายโครงการ) ──
    const ovSheet = ss.getSheetByName('WBS_SCurveOverride');
    let scOverrides = [];
    if (ovSheet) {
      const ovData = ovSheet.getDataRange().getValues();
      for (let i = 1; i < ovData.length; i++) {
        if (ovData[i][0] && ovData[i][1]) {
          scOverrides.push({
            RefProject:     String(ovData[i][0] || ''),
            YearMonth:      String(ovData[i][1] || ''),
            PlanOverride:   (ovData[i][2] === '' || ovData[i][2] === null) ? null : Number(ovData[i][2]),
            ActualOverride: (ovData[i][3] === '' || ovData[i][3] === null) ? null : Number(ovData[i][3])
          });
        }
      }
    }

    // กรองตามโครงการที่ผู้ใช้เห็นได้ — membersData ไม่กรอง (ตามที่ตัดสินใจไว้แล้วว่า
    // รายชื่อ+อีเมลทีมงานให้ทุกคนที่ล็อกอินเห็นได้หมด ไม่ผูกกับโครงการ)
    var scopedTasks    = scopeRows(tasks, access, 'RefProject');
    var scopedProgress = scopeRows(progress, access, 'RefProject');
    var scopedProjects = scopeRows(projectsData, access, 'id');
    var scopedOverrides = scopeRows(scOverrides, access, 'RefProject');

    // ส่งค่ากลับเมื่อทำงานสำเร็จทั้งหมด (แก้ไขชื่อตัวแปรให้ตรงกันแล้ว)
    return JSON.stringify({
      tasks: scopedTasks,
      progress: scopedProgress,
      projects: scopedProjects,
      members: membersData,
      scOverrides: scopedOverrides,
      ok: true
    });

  } catch(e) {
    // ปิด try ตัวหลัก และดักจับ Error ทั้งหมดในฟังก์ชัน
    return JSON.stringify({
      tasks: [],
      progress: [],
      projects: [],
      members: [],
      ok: false,
      error: e.message
    });
  }
}

/* ── Save Progress Record ─────────────────────────────────── */
function saveProgress(portalToken, jsonStr) {
  try {
    const access = portalAccessForCall(portalToken, PORTAL_MENU_ID);
    if (!access.ok) return JSON.stringify({ ok:false, error: access.message });
    if (!canWrite(access)) return JSON.stringify({ ok:false, error: 'สิทธิ์ไม่พอ' });
    if (!requireSection(access, 'update')) return JSON.stringify({ ok:false, error: 'ไม่มีสิทธิ์เข้าแถบ Update %Actual' });

    const d = JSON.parse(jsonStr);
    if (!canSeeProject(access, d.RefProject)) return JSON.stringify({ ok:false, error: 'ไม่มีสิทธิ์บันทึกโครงการนี้' });

    const ss     = SpreadsheetApp.getActiveSpreadsheet();
    const sheet  = ss.getSheetByName('WBS_Progress');
    const tz     = Session.getScriptTimeZone();
    const id     = 'PR-' + String(sheet.getLastRow()).padStart(4, '0');

    sheet.appendRow([
      id,
      d.TaskID,
      d.RefProject,
      Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd'),
      d.ActualPercent,
      access.email,
      d.Remark || ''
    ]);

    return JSON.stringify({ ok:true, id });
  } catch (err) {
    return JSON.stringify({ ok:false, error: err.message });
  }
}

/* ── Save Task (Add New / Update Existing) ────────────────── */
function saveTask(portalToken, jsonStr) {
  try {
    const access = portalAccessForCall(portalToken, PORTAL_MENU_ID);
    if (!access.ok) return JSON.stringify({ ok:false, error: access.message });
    if (!canWrite(access)) return JSON.stringify({ ok:false, error: 'สิทธิ์ไม่พอ' });
    if (!requireSection(access, 'update')) return JSON.stringify({ ok:false, error: 'ไม่มีสิทธิ์เข้าแถบ Update %Actual' });

    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('WBS_Tasks');
    const d     = JSON.parse(jsonStr);
    const tz    = Session.getScriptTimeZone();

    // ── Validate required fields ───────────────────────────
    if (!d.TaskID || !d.TaskName) {
      return JSON.stringify({ ok: false, error: 'TaskID และ TaskName ต้องไม่ว่าง' });
    }
    if (!canSeeProject(access, d.RefProject)) {
      return JSON.stringify({ ok: false, error: 'ไม่มีสิทธิ์บันทึกโครงการนี้' });
    }

    // ── Column order must match Sheet header exactly ───────
    const COLS = [
      'TaskID', 'RefProject', 'ParentTaskID', 'TaskName', 'InCharge',
      'StartDate', 'EndDate', 'Duration_Day', 'Weight_Pct', 'Level', 'SortOrder'
    ];

    // ── Build row array in header order ───────────────────
    const newRow = COLS.map(col => {
      const v = d[col];
      if (col === 'StartDate' || col === 'EndDate') {
        // Store as plain text YYYY-MM-DD to avoid date serial issues
        return v || '';
      }
      if (['Duration_Day', 'Weight_Pct', 'Level', 'SortOrder'].includes(col)) {
        return Number(v) || 0;
      }
      return v !== undefined ? v : '';
    });

    // ── Check if TaskID already exists → Update ────────────
    const data    = sheet.getDataRange().getValues();
    const headers = data[0];
    const idCol   = headers.indexOf('TaskID');   // 0-based

    let existingRow = -1;   // 1-based sheet row, -1 = not found
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][idCol]) === String(d.TaskID)) {
        existingRow = i + 1;  // convert to 1-based
        break;
      }
    }

    if (existingRow > 0) {
      // ── UPDATE: overwrite each column by header position ──
      COLS.forEach((col, ci) => {
        const sheetCol = headers.indexOf(col) + 1;  // 1-based
        if (sheetCol > 0) {
          sheet.getRange(existingRow, sheetCol).setValue(newRow[ci]);
        }
      });
      return JSON.stringify({ ok: true, action: 'updated', taskID: d.TaskID, row: existingRow });

    } else {
      // ── INSERT: append new row ─────────────────────────────
      // Re-order newRow to match actual sheet header (safer)
      const orderedRow = headers.map(h => {
        const ci = COLS.indexOf(h);
        return ci >= 0 ? newRow[ci] : '';
      });
      sheet.appendRow(orderedRow);
      return JSON.stringify({ ok: true, action: 'inserted', taskID: d.TaskID });
    }

  } catch (err) {
    return JSON.stringify({ ok: false, error: err.message });
  }
}

/* ── Save S-Curve Monthly Overrides ───────────────────────────
   บันทึกค่า Plan%/Actual% ที่ผู้ใช้ล็อกเองรายเดือน/รายPeriodจากตัวแก้ไข S-Curve
   เข้าชีต WBS_SCurveOverride — upsert ทีละหลาย Period ในคำขอเดียว
   ถ้า Period ไหนส่งมาว่างทั้ง Plan และ Actual = เคลียร์ override Period นั้นทิ้ง
   (กลับไปใช้ค่าที่คำนวณอัตโนมัติ)
   Item 5: รับ revisions[] มาด้วย (คำนวณฝั่ง Frontend แล้วว่าค่าไหนเปลี่ยนจากเดิมจริง)
   บันทึกลงชีต WBS_SCurveRevisions ทุกครั้งที่มีการ Override ทับค่า Auto-calculate/Override เดิม */
function saveSCOverrides(portalToken, jsonStr) {
  try {
    const access = portalAccessForCall(portalToken, PORTAL_MENU_ID);
    if (!access.ok) return JSON.stringify({ ok:false, error: access.message });
    if (!canWrite(access)) return JSON.stringify({ ok:false, error: 'สิทธิ์ไม่พอ' });
    if (!requireSection(access, 'update')) return JSON.stringify({ ok:false, error: 'ไม่มีสิทธิ์เข้าแถบ Update %Actual' });

    const d = JSON.parse(jsonStr); // { projID, entries:[...], revisions:[{YearMonth,Field,OldValue,NewValue}] }
    if (!canSeeProject(access, d.projID)) return JSON.stringify({ ok:false, error: 'ไม่มีสิทธิ์บันทึกโครงการนี้' });

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('WBS_SCurveOverride');
    if (!sheet) {
      return JSON.stringify({ ok:false, error:'ไม่พบชีต WBS_SCurveOverride — กรุณาสร้างชีตนี้ก่อน (คอลัมน์: RefProject, YearMonth, PlanOverride, ActualOverride, UpdatedBy, UpdatedDate)' });
    }

    const tz = Session.getScriptTimeZone();
    // ไม่เชื่อ d.changedBy ที่ client ส่งมาอีกต่อไป — ใช้อีเมลที่ Hub ยืนยันแล้วเท่านั้น
    const userEmail = access.email;
    const today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');

    const data = sheet.getDataRange().getValues();
    const hdr  = data[0];
    const colProj = hdr.indexOf('RefProject');
    const colYM   = hdr.indexOf('YearMonth');
    const colPlan = hdr.indexOf('PlanOverride');
    const colAct  = hdr.indexOf('ActualOverride');
    const colBy   = hdr.indexOf('UpdatedBy');
    const colDate = hdr.indexOf('UpdatedDate');

    // ทำ lookup แถวที่มีอยู่แล้วของโครงการนี้ (YearMonth -> เลขแถวจริงใน Sheet)
    const rowMap = {};
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][colProj]) === String(d.projID)) {
        rowMap[String(data[i][colYM])] = i + 1;
      }
    }

    const rowsToAppend = [];
    (d.entries || []).forEach(e => {
      const hasPlan = e.PlanOverride   !== null && e.PlanOverride   !== undefined && e.PlanOverride   !== '';
      const hasAct  = e.ActualOverride !== null && e.ActualOverride !== undefined && e.ActualOverride !== '';
      const existingRow = rowMap[e.YearMonth];

      if (!hasPlan && !hasAct) {
        // ล้างค่าออกแต่ไม่ลบแถว (กันปัญหา index เลื่อนระหว่างลูป)
        if (existingRow) {
          sheet.getRange(existingRow, colPlan + 1).setValue('');
          sheet.getRange(existingRow, colAct + 1).setValue('');
        }
        return;
      }

      if (existingRow) {
        sheet.getRange(existingRow, colPlan + 1).setValue(hasPlan ? Number(e.PlanOverride) : '');
        sheet.getRange(existingRow, colAct  + 1).setValue(hasAct  ? Number(e.ActualOverride) : '');
        sheet.getRange(existingRow, colBy   + 1).setValue(userEmail);
        sheet.getRange(existingRow, colDate + 1).setValue(today);
      } else {
        rowsToAppend.push([
          d.projID, e.YearMonth,
          hasPlan ? Number(e.PlanOverride) : '',
          hasAct  ? Number(e.ActualOverride) : '',
          userEmail, today
        ]);
      }
    });

    if (rowsToAppend.length) {
      sheet.getRange(sheet.getLastRow() + 1, 1, rowsToAppend.length, 6).setValues(rowsToAppend);
    }

    // ── บันทึก Revision History (Item 5) ────────────────────
    // ชีต WBS_SCurveRevisions ยังไม่มี -> ข้ามการบันทึก Rev แบบไม่ทำให้ Save Override หลักล้มเหลว
    // (Override หลักถือว่าสำคัญกว่า Revision Log ที่เป็นแค่ Audit Trail เสริม)
    const revs = d.revisions || [];
    if (revs.length) {
      const revSheet = ss.getSheetByName('WBS_SCurveRevisions');
      if (revSheet) {
        const revRows = revs.map((r, idx) => [
          'SCR-' + Utilities.formatDate(new Date(), tz, 'yyyyMMddHHmmss') + '-' + idx,
          d.projID, r.YearMonth, r.Field, r.OldValue, r.NewValue, userEmail, today
        ]);
        revSheet.getRange(revSheet.getLastRow() + 1, 1, revRows.length, 8).setValues(revRows);
      }
    }

    return JSON.stringify({ ok:true, saved: (d.entries || []).length, revisionsLogged: revs.length });
  } catch (err) {
    return JSON.stringify({ ok:false, error: err.message });
  }
}

/* ── Get S-Curve Revision History for a Project ───────────────
   คืน Revision ทั้งหมดของโปรเจกต์นี้ (ทุก Period/Field) เรียงล่าสุดก่อน — ใช้แสดงใน
   popup "View Revision History" ของตัวแก้ไข Monthly S-Curve
   ต้องมีชีต WBS_SCurveRevisions (คอลัมน์: RevID, RefProject, YearMonth, Field,
   OldValue, NewValue, ChangedBy, ChangedDate) — ถ้ายังไม่มีให้สร้างเอง */
function getSCRevisions(portalToken, projID) {
  try {
    const access = portalAccessForCall(portalToken, PORTAL_MENU_ID);
    if (!access.ok) return JSON.stringify({ ok:false, error: access.message, revisions: [] });
    if (!canSeeProject(access, projID)) return JSON.stringify({ ok:false, error: 'ไม่มีสิทธิ์ดูโครงการนี้', revisions: [] });
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('WBS_SCurveRevisions');
    if (!sheet) {
      return JSON.stringify({ ok:true, revisions: [] }); // ยังไม่มีชีต = ยังไม่มี Rev ใดๆ เท่านั้น ไม่ถือเป็น Error
    }
    const data = sheet.getDataRange().getValues();
    const hdr  = data[0];
    const colProj = hdr.indexOf('RefProject');
    const colYM   = hdr.indexOf('YearMonth');
    const colFld  = hdr.indexOf('Field');
    const colOld  = hdr.indexOf('OldValue');
    const colNew  = hdr.indexOf('NewValue');
    const colBy   = hdr.indexOf('ChangedBy');
    const colDate = hdr.indexOf('ChangedDate');

    const revisions = [];
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][colProj]) === String(projID)) {
        revisions.push({
          YearMonth:   String(data[i][colYM]   || ''),
          Field:       String(data[i][colFld]  || ''),
          OldValue:    String(data[i][colOld]  || ''),
          NewValue:    String(data[i][colNew]  || ''),
          ChangedBy:   String(data[i][colBy]   || ''),
          ChangedDate: data[i][colDate] instanceof Date
            ? Utilities.formatDate(data[i][colDate], Session.getScriptTimeZone(), 'yyyy-MM-dd')
            : String(data[i][colDate] || '')
        });
      }
    }
    return JSON.stringify({ ok:true, revisions });
  } catch (err) {
    return JSON.stringify({ ok:false, error: err.message, revisions: [] });
  }
}

/* ── Delete Task ──────────────────────────────────────────── */
function deleteTask(portalToken, taskID) {
  try {
    const access = portalAccessForCall(portalToken, PORTAL_MENU_ID);
    if (!access.ok) return JSON.stringify({ ok:false, error: access.message });
    if (!canWrite(access)) return JSON.stringify({ ok:false, error: 'สิทธิ์ไม่พอ' });
    if (!requireSection(access, 'update')) return JSON.stringify({ ok:false, error: 'ไม่มีสิทธิ์เข้าแถบ Update %Actual' });
    if (!taskID) return JSON.stringify({ ok: false, error: 'ไม่ระบุ TaskID' });

    const taskRef = _taskRefProject_(taskID);
    if (taskRef !== null && !canSeeProject(access, taskRef)) {
      return JSON.stringify({ ok: false, error: 'ไม่มีสิทธิ์ลบ task ของโครงการนี้' });
    }

    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('WBS_Tasks');
    const data  = sheet.getDataRange().getValues();
    const idCol = data[0].indexOf('TaskID');

    // ── Find all rows with this TaskID (should be 1) ───────
    let deletedCount = 0;
    // Loop backwards so row indices stay valid after deletion
    for (let i = data.length - 1; i >= 1; i--) {
      if (String(data[i][idCol]) === String(taskID)) {
        sheet.deleteRow(i + 1);   // convert to 1-based
        deletedCount++;
      }
    }

    if (deletedCount === 0) {
      return JSON.stringify({ ok: false, error: `ไม่พบ TaskID: ${taskID}` });
    }
    return JSON.stringify({ ok: true, taskID, deletedRows: deletedCount });

  } catch (err) {
    return JSON.stringify({ ok: false, error: err.message });
  }
}

/* ── Bulk Save (Paste Import) ─────────────────────────────────
   ใช้โดยฟีเจอร์ "Paste Import from Excel" เพื่อบันทึก Task/Progress
   ที่ Paste เข้ามาลง Sheet จริง (ก่อนหน้านี้อยู่แค่ใน memory ของ browser
   ทำให้หายเมื่อ refresh/logout) ยิง 1 request บันทึกได้หลายแถวพร้อมกัน */
function bulkSaveImport(portalToken, jsonStr) {
  try {
    const access = portalAccessForCall(portalToken, PORTAL_MENU_ID);
    if (!access.ok) return JSON.stringify({ ok:false, error: access.message });
    if (!canWrite(access)) return JSON.stringify({ ok:false, error: 'สิทธิ์ไม่พอ' });
    if (!requireSection(access, 'update')) return JSON.stringify({ ok:false, error: 'ไม่มีสิทธิ์เข้าแถบ Update %Actual' });

    const d  = JSON.parse(jsonStr);   // { tasks:[...], progress:[...], updates:[{taskID,fields,revisions}] }
    // เช็คสิทธิ์โครงการของทุกแถวก่อนเขียนจริงสักแถวเดียว — ปฏิเสธทั้ง batch ถ้ามี
    // แถวไหนอยู่นอกสิทธิ์ (กันข้อมูล import ครึ่งเดียวจากการเช็คทีละแถวระหว่างเขียน)
    if (access.projectScope !== 'all') {
      const badTask = (d.tasks || []).find(t => !canSeeProject(access, t.RefProject));
      if (badTask) return JSON.stringify({ ok:false, error: 'ไม่มีสิทธิ์ import โครงการ: ' + badTask.RefProject });
      const badProg = (d.progress || []).find(p => !canSeeProject(access, p.RefProject));
      if (badProg) return JSON.stringify({ ok:false, error: 'ไม่มีสิทธิ์ import โครงการ: ' + badProg.RefProject });
      const badUpdate = (d.updates || []).find(u => {
        var rp = _taskRefProject_(u.taskID);
        return rp !== null && !canSeeProject(access, rp);
      });
      if (badUpdate) return JSON.stringify({ ok:false, error: 'ไม่มีสิทธิ์แก้ไข task: ' + badUpdate.taskID });
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const tz = Session.getScriptTimeZone();
    const userEmail = access.email; // ไม่เชื่อ Session.getActiveUser()/ค่าที่ client ส่งมาอีกต่อไป

    // ── WBS_Tasks ──────────────────────────────────────────
    const tSheet = ss.getSheetByName('WBS_Tasks');
    if (!tSheet) throw new Error('ไม่พบชีต WBS_Tasks');
    const tData  = tSheet.getDataRange().getValues();
    const tHdr   = tData[0];
    const idColT = tHdr.indexOf('TaskID');
    const existingTaskIDs = new Set(tData.slice(1).map(r => String(r[idColT])));

    const NUMERIC_TASK = ['Duration_Day', 'Weight_Pct', 'Level', 'SortOrder'];
    let tasksAdded = 0;
    const taskRows = [];
    (d.tasks || []).forEach(t => {
      const tid = String(t.TaskID || '');
      if (!tid || existingTaskIDs.has(tid)) return;   // ข้าม TaskID ว่าง/ซ้ำ
      existingTaskIDs.add(tid);
      taskRows.push(tHdr.map(h => {
        if (NUMERIC_TASK.includes(h)) return Number(t[h]) || 0;
        return t[h] !== undefined ? t[h] : '';
      }));
      tasksAdded++;
    });
    if (taskRows.length) {
      tSheet.getRange(tSheet.getLastRow() + 1, 1, taskRows.length, tHdr.length).setValues(taskRows);
    }

    // ── WBS_Progress ───────────────────────────────────────
    const pSheet = ss.getSheetByName('WBS_Progress');
    if (!pSheet) throw new Error('ไม่พบชีต WBS_Progress');
    const pHdr  = pSheet.getDataRange().getValues()[0];
    let rowSeq  = pSheet.getLastRow();
    let progressAdded = 0;
    const progRows = (d.progress || []).map(p => {
      rowSeq++; progressAdded++;
      return pHdr.map(h => {
        if (h === 'ProgressID')    return 'PR-' + String(rowSeq).padStart(4, '0');
        if (h === 'ActualPercent') return Number(p.ActualPercent) || 0;
        if (h === 'RecordDate')    return p.RecordDate || Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
        if (h === 'RecordedBy')    return userEmail; // ไม่เชื่อ p.RecordedBy ที่ client ส่งมาอีกต่อไป
        return p[h] !== undefined ? p[h] : '';
      });
    });
    if (progRows.length) {
      pSheet.getRange(pSheet.getLastRow() + 1, 1, progRows.length, pHdr.length).setValues(progRows);
    }

    // ── Field updates on existing tasks (จาก paste-import) ──
    // รวมมาในคำขอเดียวกันแทนที่จะยิง updateTaskFields แยกทีละแถว — import ทั้งก้อน
    // จึงเสียค่า verify สิทธิ์กับ Hub แค่ครั้งเดียว ไม่ใช่หนึ่งครั้งต่อแถวที่แก้ไข
    let updatesApplied = 0;
    (d.updates || []).forEach(u => {
      let targetRow = -1;
      for (let i = 1; i < tData.length; i++) {
        if (String(tData[i][idColT]).trim() === String(u.taskID).trim()) { targetRow = i + 1; break; }
      }
      if (targetRow === -1) return;
      _applyTaskFieldsToRow_(tHdr, tSheet, targetRow, u.fields || {});
      _appendTaskRevisions_(ss, u.taskID, u.revisions || [], userEmail);
      updatesApplied++;
    });

    return JSON.stringify({ ok: true, tasksAdded, progressAdded, updatesApplied });
  } catch (err) {
    return JSON.stringify({ ok: false, error: err.message });
  }
}

/* ── Get Project List ─────────────────────────────────────── */
function getProjects(portalToken) {
  try {
    const access = portalAccessForCall(portalToken, PORTAL_MENU_ID);
    if (!access.ok) return JSON.stringify([]);

    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('WBS_Tasks');
    const data  = sheet.getDataRange().getValues();
    const hdr   = data[0];
    const idx   = hdr.indexOf('RefProject');
    if (idx < 0) return JSON.stringify([]);

    let projects = [...new Set(data.slice(1).map(r => r[idx]).filter(Boolean))];
    if (access.projectScope !== 'all') {
      projects = projects.filter(p => canSeeProject(access, p));
    }
    return JSON.stringify(projects);
  } catch (err) {
    return JSON.stringify([]);
  }
}

// บันทึก หรือ แก้ไข โครงการ — สร้างโครงการใหม่ต้อง admin/manager เท่านั้น แก้ไข
// โครงการเดิมต้องมีสิทธิ์เขียน + เห็นโครงการนั้นอยู่แล้ว
function saveProjectToSheet(portalToken, jsonStr) {
  const access = portalAccessForCall(portalToken, PORTAL_MENU_ID);
  if (!access.ok) throw new Error(access.message);

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Projects");
  if (!sheet) throw new Error("ไม่พบชีตชื่อ Projects ใน Google Sheets");

  const rec = JSON.parse(jsonStr);
  const data = sheet.getDataRange().getValues();

  let rowIndex = -1;
  // ค้นหาว่ามี ID นี้อยู่แล้วหรือไม่ (ข้ามแถวแรกที่เป็น Header)
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === rec.id) {
      rowIndex = i + 1; // Google Sheets เริ่มนับแถวที่ 1
      break;
    }
  }

  if (rowIndex === -1) {
    if (!isAdminish(access)) throw new Error("สร้างโครงการใหม่ได้เฉพาะ admin/manager เท่านั้น");
  } else {
    if (!canWrite(access) || !canSeeProject(access, rec.id)) throw new Error("ไม่มีสิทธิ์แก้ไขโครงการนี้");
  }

  // แปลง Object เป็น Array ตามลำดับคอลัมน์
  // คอลัมน์ J,K (index 9,10) = CutoffStart, CutoffFreqMonths (Item 5) — ถ้ายังไม่มีคอลัมน์นี้ใน Sheet
  // ให้เพิ่มหัวตาราง "CutoffStart" และ "CutoffFreqMonths" ต่อท้ายคอลัมน์ Note เอง
  const rowData = [rec.id, rec.name, rec.owner, rec.pm, rec.start, rec.end, rec.status, rec.color, rec.note,
    rec.cutoffStart || '', rec.cutoffFreq || 1];

  if (rowIndex > -1) {
    // มีอยู่แล้ว -> อัปเดตข้อมูลทับบรรทัดเดิม
    sheet.getRange(rowIndex, 1, 1, rowData.length).setValues([rowData]);
  } else {
    // ยังไม่มี -> เพิ่มบรรทัดใหม่
    sheet.appendRow(rowData);
  }

  return { ok: true };
}

// ลบโครงการ — ระดับองค์กร จำกัดเฉพาะ admin/manager
function deleteProjectFromSheet(portalToken, id) {
  const access = portalAccessForCall(portalToken, PORTAL_MENU_ID);
  if (!access.ok) throw new Error(access.message);
  if (!isAdminish(access)) throw new Error("เฉพาะ admin/manager เท่านั้น");

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Projects");
  if (!sheet) throw new Error("ไม่พบชีตชื่อ Projects ใน Google Sheets");

  const data = sheet.getDataRange().getValues();

  // วนลูปจากล่างขึ้นบน ป้องกัน index เลื่อนเวลาลบแถว
  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][0] === id) {
      sheet.deleteRow(i + 1);
      return { ok: true };
    }
  }

  throw new Error("ไม่พบข้อมูลโครงการที่ต้องการลบใน Sheet");
}

// บันทึก หรือ แก้ไข สมาชิก — ระดับองค์กร (รายชื่อทีมงานรวมทุกโครงการ) จำกัดเฉพาะ
// admin/manager เหมือนกับ saveProjectToSheet/deleteProjectFromSheet
function saveMemberToSheet(portalToken, jsonStr) {
  const access = portalAccessForCall(portalToken, PORTAL_MENU_ID);
  if (!access.ok) throw new Error(access.message);
  if (!isAdminish(access)) throw new Error("เฉพาะ admin/manager เท่านั้น");

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Members");
  if (!sheet) throw new Error("ไม่พบชีตชื่อ Members ใน Google Sheets");

  const rec = JSON.parse(jsonStr);
  const data = sheet.getDataRange().getValues();

  let rowIndex = -1;
  // ค้นหาว่ามีชื่อนี้อยู่แล้วหรือไม่ (ใช้ Name เป็นตัวอ้างอิง)
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === rec.name) {
      rowIndex = i + 1;
      break;
    }
  }

  const rowData = [rec.name, rec.role, rec.dept, rec.email];

  if (rowIndex > -1) {
    // อัปเดตข้อมูลทับบรรทัดเดิม
    sheet.getRange(rowIndex, 1, 1, rowData.length).setValues([rowData]);
  } else {
    // เพิ่มบรรทัดใหม่
    sheet.appendRow(rowData);
  }

  return { ok: true };
}

// ลบสมาชิก — เฉพาะ admin/manager
function deleteMemberFromSheet(portalToken, name) {
  const access = portalAccessForCall(portalToken, PORTAL_MENU_ID);
  if (!access.ok) throw new Error(access.message);
  if (!isAdminish(access)) throw new Error("เฉพาะ admin/manager เท่านั้น");

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Members");
  if (!sheet) throw new Error("ไม่พบชีตชื่อ Members ใน Google Sheets");

  const data = sheet.getDataRange().getValues();

  // วนลูปจากล่างขึ้นบน เพื่อหาแถวที่ตรงกับชื่อและลบทิ้ง
  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][0] === name) {
      sheet.deleteRow(i + 1);
      return { ok: true };
    }
  }

  throw new Error("ไม่พบข้อมูลสมาชิกที่ต้องการลบใน Sheet");
}

// ============================================================
//  NEW: BULK UPDATE PROGRESS (From CSV Import)
// ============================================================
function bulkUpdateProgress(portalToken, projectId, dataArray) {
  const access = portalAccessForCall(portalToken, PORTAL_MENU_ID);
  if (!access.ok) throw new Error(access.message);
  if (!canWrite(access)) throw new Error('สิทธิ์ไม่พอ');
  if (!requireSection(access, 'update')) throw new Error('ไม่มีสิทธิ์เข้าแถบ Update %Actual');
  if (!canSeeProject(access, projectId)) throw new Error('ไม่มีสิทธิ์แก้ไขโครงการนี้');

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('WBS_Progress');
  if (!sheet) throw new Error('ไม่พบชีต WBS_Progress');

  const dt = new Date();
  // Format date for logging: yyyy-MM-dd
  const dateStr = Utilities.formatDate(dt, "Asia/Bangkok", "yyyy-MM-dd");
  const timestamp = dt.getTime();
  const userEmail = access.email; // ไม่เชื่อ userEmail ที่ client ส่งมาอีกต่อไป

  // Prepare 2D Array for append
  const rowsToAppend = dataArray.map((item, index) => {
    // Columns: ProgressID, TaskID, RefProject, RecordDate, ActualPercent, RecordedBy, Remark
    return [
      `PR-${timestamp}-${index}`,
      item.taskId,
      projectId,
      dateStr,
      item.actual,
      userEmail,
      "Bulk Update by CSV"
    ];
  });

  if (rowsToAppend.length > 0) {
    const startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, rowsToAppend.length, rowsToAppend[0].length).setValues(rowsToAppend);
  }
  
  return { ok: true, updatedCount: rowsToAppend.length };
}

function updateTaskFields(portalToken, taskID, fieldsJson, metaJson) {
  try {
    const access = portalAccessForCall(portalToken, PORTAL_MENU_ID);
    if (!access.ok) return { success: false, message: access.message };
    if (!canWrite(access)) return { success: false, message: 'สิทธิ์ไม่พอ' };
    if (!requireSection(access, 'update')) return { success: false, message: 'ไม่มีสิทธิ์เข้าแถบ Update %Actual' };

    const taskRef = _taskRefProject_(taskID);
    if (taskRef !== null && !canSeeProject(access, taskRef)) {
      return { success: false, message: 'ไม่มีสิทธิ์แก้ไข task ของโครงการนี้' };
    }

    const fields = JSON.parse(fieldsJson);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("WBS_Tasks"); // เปลี่ยนเป็นชื่อชีตเก็บข้อมูลงานของคุณ

    if (!sheet) throw new Error("ไม่พบชีตข้อมูลที่ระบุ");

    const data = sheet.getDataRange().getValues();
    const headers = data[0];

    // 1. ค้นหาแถวของ TaskID ที่ต้องการอัปเดต
    const taskIdColIdx = headers.indexOf("TaskID");
    if (taskIdColIdx === -1) throw new Error("ไม่พบคอลัมน์ TaskID ใน Google Sheet");

    let targetRow = -1;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][taskIdColIdx]).trim() === String(taskID).trim()) {
        targetRow = i + 1; // แปลงเป็น Index แถวของ Spreadsheet (เริ่มนับที่ 1)
        break;
      }
    }
    
    if (targetRow === -1) throw new Error("ไม่พบรหัส TaskID: " + taskID + " ในระบบ");

    // 2-3. เขียนฟิลด์ที่เปลี่ยนแปลงลงคอลัมน์ที่ตรงกัน (ใช้ helper ร่วมกับ bulkSaveImport)
    _applyTaskFieldsToRow_(headers, sheet, targetRow, fields);

    // 4. Item 6: บันทึก Revision ของ Start/End Date (ถ้ามีส่งมา) ลงชีต WBS_TaskRevisions
    // ชีตนี้ยังไม่มี -> ข้ามการบันทึก Rev แบบไม่ทำให้การอัปเดตฟิลด์หลักล้มเหลว
    if (metaJson) {
      try {
        const meta = JSON.parse(metaJson);
        // ไม่เชื่อ meta.changedBy ที่ client ส่งมาอีกต่อไป — ใช้ access.email ที่ Hub ยืนยันแล้วเสมอ
        _appendTaskRevisions_(ss, taskID, meta.revisions || [], access.email);
      } catch (revErr) {
        Logger.log("Error logging task revision: " + revErr.toString());
      }
    }

    return { success: true, message: "อัปเดตฟิลด์สำเร็จ" };
    
  } catch (error) {
    Logger.log("Error in updateTaskFields: " + error.toString());
    return { success: false, message: error.message };
  }
}
/* ── Toggle Task Flag (ติดดาว Task ที่ต้องติดตามเป็นพิเศษ) ─────────
   ต้องมีคอลัมน์ชื่อ "Flagged" อยู่ในชีต WBS_Tasks (หัวตาราง) ก่อน — ถ้ายังไม่มีให้เพิ่ม
   คอลัมน์นี้เองในชีตหนึ่งคอลัมน์เปล่าๆ ก็พอ ระบบจะเขียนค่า TRUE/FALSE ลงไปเอง
   getWBSData() จะดึงคอลัมน์นี้กลับไปให้หน้าเว็บอัตโนมัติอยู่แล้วเพราะ map ทุกคอลัมน์แบบไดนามิก */
function toggleTaskFlag(portalToken, taskID, flagged) {
  try {
    const access = portalAccessForCall(portalToken, PORTAL_MENU_ID);
    if (!access.ok) return JSON.stringify({ ok:false, error: access.message });
    if (!canWrite(access)) return JSON.stringify({ ok:false, error: 'สิทธิ์ไม่พอ' });
    if (!taskID) return JSON.stringify({ ok: false, error: 'ไม่ระบุ TaskID' });

    const taskRef = _taskRefProject_(taskID);
    if (taskRef !== null && !canSeeProject(access, taskRef)) {
      return JSON.stringify({ ok: false, error: 'ไม่มีสิทธิ์แก้ไข task ของโครงการนี้' });
    }

    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('WBS_Tasks');
    if (!sheet) return JSON.stringify({ ok: false, error: 'ไม่พบชีต WBS_Tasks' });

    const data    = sheet.getDataRange().getValues();
    const headers = data[0];
    let colFlag   = headers.indexOf('Flagged');

    // ยังไม่มีคอลัมน์ Flagged ในชีต -> สร้างคอลัมน์ใหม่ต่อท้ายอัตโนมัติ (กันเคสยังไม่ได้เพิ่มเอง)
    if (colFlag === -1) {
      colFlag = headers.length;
      sheet.getRange(1, colFlag + 1).setValue('Flagged');
    }

    const idCol = headers.indexOf('TaskID');
    let targetRow = -1;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][idCol]) === String(taskID)) { targetRow = i + 1; break; }
    }
    if (targetRow === -1) return JSON.stringify({ ok: false, error: `ไม่พบ TaskID: ${taskID}` });

    sheet.getRange(targetRow, colFlag + 1).setValue(flagged ? true : false);
    return JSON.stringify({ ok: true, taskID, flagged: !!flagged });
  } catch (err) {
    return JSON.stringify({ ok: false, error: err.message });
  }
}

/* ── Get Task Field Revision History (Item 6) ──────────────────
   คืน Revision ของ Start/End Date ทั้งหมดของ Task/Sub-Task/Activity นี้ (เรียงล่าสุดก่อน)
   ใช้แสดงใน popup "View Revision History" ของตาราง Update % Actual
   ต้องมีชีต WBS_TaskRevisions (คอลัมน์: RevID, TaskID, Field, OldValue, NewValue,
   ChangedBy, ChangedDate) — ถ้ายังไม่มีให้สร้างเอง */
function getTaskRevisions(portalToken, taskID) {
  try {
    const access = portalAccessForCall(portalToken, PORTAL_MENU_ID);
    if (!access.ok) return JSON.stringify({ ok:false, error: access.message, revisions: [] });
    const taskRef = _taskRefProject_(taskID);
    if (taskRef !== null && !canSeeProject(access, taskRef)) {
      return JSON.stringify({ ok:false, error: 'ไม่มีสิทธิ์ดู task ของโครงการนี้', revisions: [] });
    }
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('WBS_TaskRevisions');
    if (!sheet) {
      return JSON.stringify({ ok:true, revisions: [] }); // ยังไม่มีชีต = ยังไม่มี Rev ใดๆ เท่านั้น ไม่ถือเป็น Error
    }
    const data = sheet.getDataRange().getValues();
    const hdr  = data[0];
    const colTask = hdr.indexOf('TaskID');
    const colFld  = hdr.indexOf('Field');
    const colOld  = hdr.indexOf('OldValue');
    const colNew  = hdr.indexOf('NewValue');
    const colBy   = hdr.indexOf('ChangedBy');
    const colDate = hdr.indexOf('ChangedDate');

    const revisions = [];
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][colTask]) === String(taskID)) {
        revisions.push({
          Field:       String(data[i][colFld]  || ''),
          OldValue:    String(data[i][colOld]  || ''),
          NewValue:    String(data[i][colNew]  || ''),
          ChangedBy:   String(data[i][colBy]   || ''),
          ChangedDate: data[i][colDate] instanceof Date
            ? Utilities.formatDate(data[i][colDate], Session.getScriptTimeZone(), 'yyyy-MM-dd')
            : String(data[i][colDate] || '')
        });
      }
    }
    return JSON.stringify({ ok:true, revisions });
  } catch (err) {
    return JSON.stringify({ ok:false, error: err.message, revisions: [] });
  }
}