// ===== Code.gs =====
// Google Apps Script backend

// PortalGuard.gs ต้องถูกวางไว้ในโปรเจกต์เดียวกับไฟล์นี้
// PORTAL_ENFORCE = false คือโหมด shadow (ไม่บล็อกใครจริง แค่บันทึก log) เปลี่ยนเป็น
// true เมื่อยืนยันแล้วว่า role ของผู้ใช้จริงทุกคนแมปถูกต้องใน Hub
var PORTAL_MENU_ID = 'sec-assets-dash';
var PORTAL_ENFORCE = false;

// ชื่อคอลัมน์ที่ใช้ผูกกับ "โครงการ" ของ Hub (Sheet_Projects.code) — สมมติว่าค่าใน
// คอลัมน์นี้ตรงกับรหัสโครงการเดียวกับที่ Project List/Finance ใช้ (เช่น NB230004)
// ยังไม่ได้ยืนยันกับข้อมูลจริง ถ้ารหัสไม่ตรงกัน ให้เพิ่มคอลัมน์ aliases ใน
// Sheet_Projects แทนการเปลี่ยนข้อมูลในชีตนี้ (ดู README)
var PROJECT_COLUMN = 'plant (โครงการ)';
var ID_COLUMN      = 'id (รหัสอุปกรณ์แหน่งที่ใช้งาน)';

function doGet(e) {
  var g = portalGuard(e, PORTAL_MENU_ID);
  if (g.deny) return g.deny;

  var bootstrap = JSON.stringify({
    token: (e && e.parameter && e.parameter.portalToken) || '',
    email: g.access.email, name: g.access.name, role: g.access.role,
    isAdmin: isAdminish(g.access), canWrite: canWrite(g.access),
    // null = เห็นทุกแถบ (ยังไม่ถูกจำกัด), array = เห็นเฉพาะ id ที่อยู่ในนี้ — เทียบกับ
    // id ของ .ni ในแถบข้าง (dashboard/tree/warranty/gantt/service)
    allowedSections: g.access.allowedSections
  });

  return HtmlService.createHtmlOutputFromFile('Index')
    .append('<script>window.PORTAL = ' + bootstrap + ';</script>')
    .setTitle('Asset')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ---- ดึงข้อมูล sheet ทั้งหมด (กรองตามโครงการที่ผู้ใช้เห็นได้) ----
function getAssetData(portalToken) {
  var access = portalAccessForCall(portalToken, PORTAL_MENU_ID);
  if (!access.ok) throw new Error(access.message || 'ไม่มีสิทธิ์เข้าถึงข้อมูลนี้');

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ws = ss.getSheetByName('Funclocation');           // ชื่อ sheet
  const data = ws.getDataRange().getValues();
  const headers = data[0];
  const tz = ss.getSpreadsheetTimeZone();        // ดึง Timezone
  let rows = [];
  for (let i = 1; i < data.length; i++) {
    const obj = {};
    headers.forEach((h, j) => {
      let val = data[i][j];
      if (val instanceof Date) {
        val = Utilities.formatDate(val, tz, "yyyy-MM-dd"); // แปลงวันที่ก่อนส่ง
      }
      obj[h] = val;
    });
    rows.push(obj);
  }
  rows = scopeRows(rows, access, PROJECT_COLUMN);
  return JSON.stringify(rows);
}

// ---- อัพเดทแถว (ส่ง id + fields ที่เปลี่ยน) — ยังไม่ถูกเรียกจาก Index.html ปัจจุบัน
//      แต่ Apps Script เปิดให้เรียกตรงได้เสมอ จึงต้องเช็คสิทธิ์เหมือนฟังก์ชันที่ใช้จริง ----
function updateRow(portalToken, id, fields) {
  const access = portalAccessForCall(portalToken, PORTAL_MENU_ID);
  if (!access.ok) return 'FORBIDDEN: ' + access.message;
  if (!canWrite(access)) return 'FORBIDDEN: สิทธิ์ไม่พอ';
  if (!requireSection(access, 'tree')) return 'FORBIDDEN: ไม่มีสิทธิ์เข้าแถบ Asset Structure';

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ws = ss.getSheetByName('Funclocation');
  const data = ws.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf(ID_COLUMN);
  const projCol = headers.indexOf(PROJECT_COLUMN);

  for (let i = 1; i < data.length; i++) {
    if (data[i][idCol] === id) {
      if (projCol >= 0 && !canSeeProject(access, data[i][projCol])) {
        return 'FORBIDDEN: ไม่มีสิทธิ์แก้ไขโครงการนี้';
      }
      Object.keys(fields).forEach(key => {
        const col = headers.indexOf(key);
        if (col >= 0) ws.getRange(i + 1, col + 1).setValue(fields[key]);
      });
      return 'OK';
    }
  }
  return 'NOT_FOUND';
}

// ---- เพิ่มแถวใหม่ — ระดับองค์กร (สร้างสินทรัพย์ใหม่) จำกัดเฉพาะ admin/manager ----
function addRow(portalToken, rowObj) {
  const access = portalAccessForCall(portalToken, PORTAL_MENU_ID);
  if (!access.ok) return 'FORBIDDEN: ' + access.message;
  if (!isAdminish(access)) return 'FORBIDDEN: เฉพาะ admin/manager เท่านั้น';
  if (!requireSection(access, 'tree')) return 'FORBIDDEN: ไม่มีสิทธิ์เข้าแถบ Asset Structure';

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ws = ss.getSheetByName('Funclocation');
  const headers = ws.getRange(1, 1, 1, ws.getLastColumn()).getValues()[0];
  const newRow = headers.map(h => rowObj[h] || '');
  ws.appendRow(newRow);
  return 'OK';
}

// ---- ลบแถว — ระดับองค์กร จำกัดเฉพาะ admin/manager ----
function deleteRow(portalToken, id) {
  const access = portalAccessForCall(portalToken, PORTAL_MENU_ID);
  if (!access.ok) return 'FORBIDDEN: ' + access.message;
  if (!isAdminish(access)) return 'FORBIDDEN: เฉพาะ admin/manager เท่านั้น';
  if (!requireSection(access, 'tree')) return 'FORBIDDEN: ไม่มีสิทธิ์เข้าแถบ Asset Structure';

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ws = ss.getSheetByName('Funclocation');
  const data = ws.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf(ID_COLUMN);

  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][idCol] === id) {
      ws.deleteRow(i + 1);
      return 'OK';
    }
  }
  return 'NOT_FOUND';
}

// ---- ฟังก์ชันแจ้งเตือนก่อนหมดประกันรายโครงการ ----
// หมายเหตุ: ยังไม่ได้เพิ่มการเช็คสิทธิ์ในฟังก์ชันนี้ — สมมติว่าถูกเรียกจาก
// time-based trigger เท่านั้น (ไม่ได้ถูกเรียกจาก Index.html) ถ้าจริงๆ แล้วมีปุ่ม
// ในหน้าเว็บที่เรียกฟังก์ชันนี้ตรงๆ ต้องเพิ่ม portalAccessForCall + isAdminish
// เหมือนฟังก์ชันเขียนข้อมูลด้านบน
function sendWarrantyAlert() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const assetSheet = ss.getSheetByName('Funclocation');
  const picSheet = ss.getSheetByName('Email_PIC');

  if (!assetSheet || !picSheet) return;

  // 1. ดึงข้อมูล PIC Mapping (Project -> Email)
  const picData = picSheet.getDataRange().getValues();
  const picMap = {};
  for (let i = 1; i < picData.length; i++) {
    const [proj, email] = picData[i];
    if (proj && email) picMap[proj] = email;
  }

  // 2. ตั้งค่าเกณฑ์การแจ้งเตือน (Thresholds)
  const thresholds = [90, 60, 30, 15, 7, 0];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // 3. อ่านข้อมูลอุปกรณ์ทั้งหมด
  const data = assetSheet.getDataRange().getValues();
  const headers = data[0];

  // ระบุตำแหน่ง Index คอลัมน์สำคัญ
  const idxDate = headers.indexOf('WarrantyDate (วันที่สิ้นสุดรับประกัน)');
  const idxProj = headers.indexOf('plant (โครงการ)');
  const idxStatus = headers.indexOf('สถานะการต่อประกัน'); // คอลัมน์ที่เพิ่มใหม่
  const idxName = headers.indexOf('Name (ชื่ออุปกรณ์)');
  const idxAssetNo = headers.indexOf('AssetNo (รหัสทรัพย์สิน)');

  const alertsByProject = {};

  // 4. ตรวจสอบเงื่อนไขแต่ละแถว
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const wDate = row[idxDate];
    const proj = row[idxProj];
    const status = idxStatus !== -1 ? row[idxStatus] : '';

    // ข้ามถ้า: ไม่มีวันที่, ไม่ต่อประกัน, หรือไม่มีอีเมล์ PIC
    if (!(wDate instanceof Date) || status === 'ไม่ต่อ' || !picMap[proj]) continue;

    const diffDays = Math.ceil((wDate - today) / (1000 * 60 * 60 * 24));

    if (thresholds.includes(diffDays)) {
      if (!alertsByProject[proj]) alertsByProject[proj] = [];
      alertsByProject[proj].push({
        assetNo: row[idxAssetNo] || '-',
        name: row[idxName] || row[headers.indexOf('detail (รายละเอียดอุปกรณ์)')],
        expiry: Utilities.formatDate(wDate, ss.getSpreadsheetTimeZone(), "dd/MM/yyyy"),
        daysLeft: diffDays
      });
    }
  }

  // 5. ส่งอีเมล์แยกตามโครงการ (1 เมล์ : 1 โครงการ)
  for (const proj in alertsByProject) {
    const items = alertsByProject[proj];
    const emailTo = picMap[proj];
    const subject = `⚠️ แจ้งเตือนประกันอุปกรณ์ใกล้หมดอายุ: โครงการ ${proj}`;

    let htmlTable = `
      <p>เรียน ผู้เกี่ยวข้อง ${proj},</p>
      <p>รายการอุปกรณ์ดังต่อไปนี้กำลังจะหมดอายุการรับประกัน โปรดดำเนินการตรวจสอบ:</p>
      <table border="1" cellpadding="8" style="border-collapse: collapse; font-family: sans-serif;">
        <tr style="background-color: #D62828; color: white;">
          <th>Asset No</th><th>ชื่ออุปกรณ์</th><th>วันที่หมดอายุ</th><th>เหลืออีก (วัน)</th>
        </tr>`;

    items.forEach(item => {
      htmlTable += `
        <tr>
          <td>${item.assetNo}</td><td>${item.name}</td>
          <td align="center">${item.expiry}</td>
          <td align="center" style="color: ${item.daysLeft <= 7 ? 'red' : 'orange'}; font-weight: bold;">${item.daysLeft}</td>
        </tr>`;
    });

    htmlTable += `</table><p>หากอุปกรณ์ใดไม่ต้องการต่อประกัน โปรดระบุในระบบเพื่อปิดการแจ้งเตือน</p>`;

    MailApp.sendEmail({
      to: emailTo,
      subject: subject,
      htmlBody: htmlTable
    });
  }
}
