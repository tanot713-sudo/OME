// =====================================================================================
// GOOGLE APPS SCRIPT: MODULE BACKEND (code.gs)
// SYSTEM: OMA TESTROOM BOOKING — VERSION 5.0
// Changes v5: StaticAreas sheet, endDate multi-day, manual DUT, saveStaticAreaData
// =====================================================================================

// PortalGuard.gs ต้องถูกวางไว้ในโปรเจกต์เดียวกับไฟล์นี้
// PORTAL_ENFORCE = false คือโหมด shadow (ไม่บล็อกใครจริง แค่บันทึก log) เปลี่ยนเป็น
// true เมื่อยืนยันแล้วว่า role ของผู้ใช้จริงทุกคนแมปถูกต้องใน Hub
var PORTAL_MENU_ID = 'sec-labroom-dash';
var PORTAL_ENFORCE = false;

function doGet(e) {
  // =========================
  // 1. ถ้ามี action = ลิงก์จากอีเมล (ผู้รับไม่มี portal session เลย จึงตรวจด้วย
  //    ลายเซ็น HMAC ที่ตอนส่งอีเมลเซ็นไว้ แทนการเชื่อพารามิเตอร์ตรงๆ แบบเดิม)
  //    ตัด action=approve/cancel ทิ้ง — approve เรียกฟังก์ชันที่ไม่มีอยู่จริงใน
  //    โค้ด (ไม่เคยทำงาน) และ cancel เดิมรับอีเมลผู้กระทำจาก URL ตรงๆ โดยไม่ตรวจ
  //    สอบอะไรเลย ใครก็ยกเลิกคิวคนอื่นแทนได้ถ้ารู้ booking id
  // =========================
  if (e && e.parameter && e.parameter.action) {
    var action = e.parameter.action;
    var id = e.parameter.id;
    var exp = e.parameter.exp;
    var sig = e.parameter.sig;

    if (action === "extend" || action === "end") {
      if (!_verifyLink_(action, id, exp, sig)) {
        return HtmlService.createHtmlOutput(
          "<h3>ลิงก์นี้หมดอายุหรือไม่ถูกต้องแล้ว</h3><p>กรุณาจัดการคิวผ่านหน้าเว็บแทน</p>"
        );
      }
      var result = action === "extend" ? _extendByEmailLink_(id) : _endBookingInternal_(id);
      return HtmlService.createHtmlOutput(result.message);
    }

    return HtmlService.createHtmlOutput("Invalid action");
  }

  // =========================
  // 2. ไม่มี action = เปิด UI ปกติ — ต้องผ่านสิทธิ์ portal ก่อน
  // =========================
  var g = portalGuard(e, PORTAL_MENU_ID);
  if (g.deny) return g.deny;

  var t = HtmlService.createTemplateFromFile("Index");
  t.portalBootstrap = JSON.stringify({
    token: (e && e.parameter && e.parameter.portalToken) || '',
    email: g.access.email, name: g.access.name, role: g.access.role,
    isAdmin: isAdminish(g.access), canWrite: canWrite(g.access)
  });
  return t.evaluate()
    .setTitle("OMA LabRoom Booking")
    .addMetaTag("viewport", "width=device-width, initial-scale=1")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/* ── ลิงก์อีเมลที่เซ็นด้วย HMAC — จุดเดียวในทั้งแอปที่ใช้การเซ็นแทน verify สด
   เพราะผู้รับอีเมล (เปิดลิงก์จากกล่องจดหมาย) ไม่มี portal token ให้ยืนยัน ─── */
function _linkSecret_() {
  var props = PropertiesService.getScriptProperties();
  var secret = props.getProperty('LABROOM_LINK_SECRET');
  if (!secret) {
    secret = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('LABROOM_LINK_SECRET', secret);
  }
  return secret;
}
function _signLink_(action, id, expMs) {
  var payload = String(action) + '|' + String(id) + '|' + String(expMs);
  var sigBytes = Utilities.computeHmacSha256Signature(payload, _linkSecret_());
  return Utilities.base64EncodeWebSafe(sigBytes);
}
function _verifyLink_(action, id, expMs, sig) {
  if (!action || !id || !expMs || !sig) return false;
  if (Date.now() > Number(expMs)) return false;
  var expected = _signLink_(action, id, expMs);
  // เทียบแบบไม่รั่วเวลา (constant-time) กัน timing attack เดารหัสทีละตัวอักษร
  if (expected.length !== String(sig).length) return false;
  var diff = 0;
  for (var i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ String(sig).charCodeAt(i);
  return diff === 0;
}

/**
 * ดึงข้อมูลทั้งหมดจาก Google Sheets (Users, Bookings, StaticAreas)
 */
function getDatabaseData(portalToken) {
  var access = portalAccessForCall(portalToken, PORTAL_MENU_ID);
  if (!access.ok) throw new Error(access.message || 'ไม่มีสิทธิ์เข้าถึงข้อมูลนี้');
  try {
    var sheetBookings = getOrCreateSheet("Bookings", [
      "id","deskId","systemName","teamName","team","userEmail",
      "date","startTime","endTime","endDate","notes",
      "equipment","matCode","Objective","createdAt","Status", "approvedBy", "approvedAt", "reminderSent", "cancelledAt"
    ]);
    var sheetUsers = getOrCreateSheet("Users", [
      "email","password","name","team","position","allowedProjects","role"
    ]);
    var sheetSA = getOrCreateSheet("StaticAreas", [
      "id","name","type","responsibleTeam","info","items"
    ]);

    // ── Migration: เพิ่มคอลัมน์ endDate ในชีต Bookings เดิมที่ยังไม่มี ──
    ensureColumnExists(sheetBookings, "endDate", "endTime");

    // ── Migration: เพิ่มคอลัมน์ Objective และ team ในชีต Bookings เดิมที่ยังไม่มี ──
    // (แก้บั๊ก: วัตถุประสงค์ไม่ถูกบันทึกลงชีตเพราะไม่มีคอลัมน์นี้ ทำให้หายไปจากทุกจุดที่อ่านย้อนกลับ)
    ensureColumnExists(sheetBookings, "Objective", "matCode");
    // (แก้บั๊ก: ไม่มีคอลัมน์ team แยกจาก teamName ทำให้หาอีเมลหัวหน้างานไม่เจอ)
    ensureColumnExists(sheetBookings, "team", "teamName");

    // ── Seed StaticAreas ถ้าชีตใหม่เปล่า ──
    if (sheetSA.getLastRow() === 1) {
      var defaults = [
        ["Rack","Server Rack (Rack)","rack",
         "System Operations & SCADA Control (ดร. นคร)",
         "ตู้เซิร์ฟเวอร์หลักสำหรับควบคุมและส่งข้อมูลเครือข่ายความเร็วสูงใน LAB-01",
         JSON.stringify(["Core Fiber Network Switch (Industrial Managed)",
           "Primary SCADA PLC Gateway Node (Master)",
           "Quantum Telemetry Central Server Engine",
           "High-throughput Laser Telemetry Transceiver"])],
        ["CAB1","Cabinet 1 (CAB1)","cabinet",
         "Security Ops / Data (คุณเบญจมาศ)",
         "ตู้เก็บอุปกรณ์เครือข่ายและระบบสำรองข้อมูลด้านความปลอดภัย",
         JSON.stringify(["CCTV Backup IP-Camera Modules",
           "Cybersecurity Network Intrusion Sensors",
           "Data Migration Backup Drive Enclosures"])],
        ["CAB2","Cabinet 2 (CAB2)","cabinet",
         "Logistics Devs (คุณสราวุธ)",
         "ตู้เก็บชิ้นส่วนอิเล็กทรอนิกส์และแผงวงจรสำหรับพัฒนาระบบสมาร์ทโลจิสติกส์",
         JSON.stringify(["SCADA PLC Expansion Bus Units",
           "Logistics Pressure Sensor Hub Arrays",
           "Hardware Prototype Calibration Board Kits"])],
        ["CAB3","Cabinet 3 (CAB3)","cabinet",
         "Research Lab Director (ดร. นคร / ฝ่ายวิจัย)",
         "ตู้เก็บอุปกรณ์เลเซอร์และเครื่องมือทดสอบสำหรับงานวิจัยฟิสิกส์",
         JSON.stringify(["Plasma Injection Flow Regulators",
           "Laser Calibration Alignment Lenses",
           "Quantum Sensor Fusion Testing Loops"])],
        ["E","Entrance (E)","entrance",
         "ห้องปฏิบัติการ LAB-01 (ส่วนกลาง)",
         "ประตูทางเข้าหลัก LAB-01 พร้อมระบบสแกนลายนิ้วมือ/ใบหน้า",
         JSON.stringify(["Fingerprint Biometrics & Keycard Authorization System",
           "Emergency SCADA Cut-off Safety Valve",
           "Emergency Hazard Lab Coats & Helmets"])]
      ];
      defaults.forEach(function(row) { sheetSA.appendRow(row); });
    }

    // ── อ่านข้อมูล Bookings (by header name สำหรับ backward compat) ──
    var rowsB = sheetBookings.getDataRange().getValues();
    var headersB = rowsB[0];
    var bookings = [];
    for (var i = 1; i < rowsB.length; i++) {
      var bk = {};
      for (var j = 0; j < headersB.length; j++) {
        var key = headersB[j];
        var val = rowsB[i][j];
        if (val instanceof Date) {
          if (key === 'date' || key === 'endDate') {
            bk[key] = Utilities.formatDate(val, Session.getScriptTimeZone(), "yyyy-MM-dd");
          } else if (key === 'startTime' || key === 'endTime') {
            bk[key] = Utilities.formatDate(val, Session.getScriptTimeZone(), "HH:mm");
          } else {
            bk[key] = val.toISOString();
          }
        } else {
          bk[key] = val;
        }
      }
      if (!bk.endDate) bk.endDate = bk.date;
      bookings.push(bk);
    }

    // ── อ่านข้อมูล Users — ไม่ส่งคอลัมน์ password ให้ browser อีกต่อไป (login ทำที่
    //    Hub แล้ว ข้อมูลนี้เหลือไว้แค่เป็นทำเนียบ team/position/allowedProjects) ──
    var rowsU = sheetUsers.getDataRange().getValues();
    var headersU = rowsU[0];
    var users = [];
    for (var u = 1; u < rowsU.length; u++) {
      var userObj = {};
      for (var k = 0; k < headersU.length; k++) {
        var key = headersU[k];
        if (key === 'password') continue;
        var val = rowsU[u][k];
        userObj[key] = (key === 'allowedProjects')
          ? (val ? val.toString().split(",").map(function(s){return s.trim();}) : [])
          : val;
      }
      users.push(userObj);
    }

    // ── อ่านข้อมูล StaticAreas ──
    var rowsSA = sheetSA.getDataRange().getValues();
    var headersSA = rowsSA[0];
    var staticAreas = [];
    for (var sa = 1; sa < rowsSA.length; sa++) {
      var areaObj = {};
      for (var sak = 0; sak < headersSA.length; sak++) {
        var key = headersSA[sak];
        var val = rowsSA[sa][sak];
        if (key === 'items') {
          try { areaObj[key] = val ? JSON.parse(val) : []; }
          catch(e) { areaObj[key] = val ? val.toString().split('|').map(function(s){return s.trim();}) : []; }
        } else {
          areaObj[key] = val;
        }
      }
      staticAreas.push(areaObj);
    }

    return { status: "success", bookings: bookings, users: users, staticAreas: staticAreas };

  } catch (err) {
    throw new Error("getDatabaseData error: " + err.toString());
  }
}

/**
 * บันทึกการจองใหม่ รองรับการจองข้ามวัน (endDate)
 */
function saveNewBooking(portalToken, booking) {
  var access = portalAccessForCall(portalToken, PORTAL_MENU_ID);
  if (!access.ok) return { status: "error", message: access.message };
  if (!canWrite(access)) return { status: "error", message: "สิทธิ์ไม่พอ" };
  try {
    // 1. เพิ่มโค้ดดักจับวัตถุประสงค์ตรงนี้
    var displayObjective = booking.objective || booking.purpose || '';
    if (displayObjective.toString().trim() === "") {
       return { status: "error", message: "ไม่สามารถบันทึกได้: กรุณาระบุวัตถุประสงค์การจอง" };
    }

    var sheet = getOrCreateSheet("Bookings", []);

    // ตรวจสอบคิวซ้อน
    if (checkCollision(sheet, booking)) {
       return { status: "error", message: "โต๊ะนี้มีการจองทับซ้อนในช่วงเวลาที่เลือก" };
    }

    // 1. บันทึกข้อมูล (สถานะ APPROVED อัตโนมัติ) — userEmail มาจาก access.email ที่
    //    ยืนยันกับ Hub แล้วเสมอ ไม่เชื่อค่าที่ client ส่งมาอีกต่อไป
    var actualHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var fieldMap = {
      id: booking.id, deskId: booking.deskId, systemName: booking.systemName,
      teamName: booking.teamName, team: booking.team || '', userEmail: access.email, date: booking.date,
      startTime: booking.startTime, endTime: booking.endTime, endDate: booking.endDate || booking.date,
      notes: booking.notes || '', equipment: booking.equipment || '',
      matCode: booking.matCode || '',
      Objective: booking.objective || booking.purpose || '', // [ปรับปรุง] เปลี่ยนคีย์ให้ตรงกับหัวคอลัมน์ 'Objective' ในชีต
      createdAt: new Date().toISOString(),
      Status: 'APPROVED',
      approvedBy: 'SYSTEM_AUTO'
    };
    sheet.appendRow(actualHeaders.map(function(h) { return fieldMap[h] !== undefined ? fieldMap[h] : ''; }));

    // 2. จัดกลุ่มผู้รับอีเมล
    // (แก้บั๊ก: เดิมใช้ booking.teamName ซึ่งเป็น "ชื่อผู้จอง" ไม่ใช่ "ชื่อทีม"
    //  ทำให้ getTeamManagers หาไม่เจอและไม่มีหัวหน้างานได้รับอีเมลเลย)
    var userEmail = access.email;
    var managers = getTeamManagers(booking.team || booking.teamName);
    var adminEmails = ["parichat@amrasia.com", "pailin@amrasia.com"]; 
    
    // รวมรายการอีเมล
    var allRecipients = managers.concat(adminEmails);

    // 3. อีเมลแจ้งผู้จอง
    var displayObjective = booking.objective || booking.purpose || '-';
    MailApp.sendEmail(userEmail, "ยืนยันการจอง: " + booking.systemName, 
      "การจองของคุณได้รับการยืนยันแล้ว\n\nโต๊ะ: " + booking.deskId + 
      "\nวันที่: " + booking.date + 
      "\nเวลา: " + booking.startTime + " - " + booking.endTime +
      "\nวัตถุประสงค์การจอง: " + displayObjective);

    // 4. อีเมลแจ้งกลุ่มผู้รับทราบ (Managers + Admin)
    if (allRecipients.length > 0) {
      MailApp.sendEmail({
        to: allRecipients.join(","),
        subject: "[ACKNOWLEDGE] การจองใหม่: " + booking.systemName,
        htmlBody: 
          "<h3>ระบบรับทราบการจองใหม่</h3>" +
          "<p>หัวหน้างานและผู้ดูแลระบบได้รับทราบการจองนี้แล้ว:</p>" +
          "<ul>" +
            "<li><b>โครงการ:</b> " + booking.systemName + "</li>" +
            "<li><b>ผู้จอง:</b> " + booking.teamName + "</li>" +
            "<li><b>โต๊ะ:</b> " + booking.deskId + "</li>" +
            "<li><b>วันที่:</b> " + booking.date + "</li>" +
            "<li><b>เวลา:</b> " + booking.startTime + " - " + booking.endTime + "</li>" +
            "<li><b>วัตถุประสงค์การจอง:</b> " + displayObjective + "</li>" + 
          "</ul>"
      });
    }

    return { status: "success", message: "บันทึกและส่งแจ้งเตือนเรียบร้อยแล้ว" };

  } catch (err) {
    return { status: "error", message: err.toString() };
  }
}

/**
 * ยกเลิกการจอง (เจ้าของคิว หรือ super_admin เท่านั้น)
 */
function deleteBookingById(portalToken, id) {
  var access = portalAccessForCall(portalToken, PORTAL_MENU_ID);
  if (!access.ok) return { status: "error", message: access.message };
  try {
    var sheetB = getOrCreateSheet("Bookings", []);

    var rows      = sheetB.getDataRange().getValues();
    var hB        = rows[0];
    var idIdx     = hB.indexOf('id');
    var ownerIdx  = hB.indexOf('userEmail');
    var statusIdx = hB.indexOf('Status');
    var cancelIdx = hB.indexOf('cancelledAt');
    var deskIdx   = hB.indexOf('deskId');
    var dateIdx   = hB.indexOf('date');
    var startIdx  = hB.indexOf('startTime');
    var endIdx    = hB.indexOf('endTime');
    var requesterEmail = access.email;

    for (var i = 1; i < rows.length; i++) {
      if (rows[i][idIdx] === id) {
        var ownerEmail = rows[i][ownerIdx];

        // สิทธิ์ role ตอนนี้มาจาก Hub (isAdminish) ที่ยืนยันสดแล้วเท่านั้น ไม่อ่าน
        // role จากชีต Users อีก — บัญชีที่ถูกลด role จาก admin แล้วจะไม่มีสิทธิ์
        // ยกเลิกคิวคนอื่นทันที ไม่ต้องรอ Users sheet อัปเดต
        if (requesterEmail !== ownerEmail && !isAdminish(access)) {
          return { status: "error", message: "คุณไม่มีสิทธิ์ยกเลิกคิวของผู้อื่น" };
        }

        sheetB.getRange(i + 1, statusIdx + 1).setValue("CANCELLED");
        if (cancelIdx >= 0) {
          sheetB.getRange(i + 1, cancelIdx + 1).setValue(new Date());
        }

        var dateStr  = formatDateSafe(rows[i][dateIdx],  "date");
        var startStr = formatDateSafe(rows[i][startIdx], "time");
        var endStr   = formatDateSafe(rows[i][endIdx],   "time");

        var adminEmails = ["parichat@amrasia.com","pailin@amrasia.com"];

        MailApp.sendEmail(
          ownerEmail,
          "รายการจองถูกยกเลิก",
          "Booking ID: " + id + "\n" +
          "โต๊ะ: "   + rows[i][deskIdx] + "\n" +
          "วันที่: "  + dateStr  + "\n" +
          "เวลา: "   + startStr + " - " + endStr + "\n\n" +
          "ผู้ยกเลิก: " + requesterEmail
        );

        MailApp.sendEmail(
          adminEmails.join(","),
          "[ADMIN] Booking CANCELLED",
          "Booking ID: " + id + "\n" +
          "โต๊ะ: "   + rows[i][deskIdx] + "\n" +
          "ผู้จอง: "  + ownerEmail + "\n" +
          "ผู้ยกเลิก: " + requesterEmail
        );

        return { status: "success", message: "ยกเลิกการจองเรียบร้อยแล้ว" };
      }
    }

    return { status: "error", message: "ไม่พบรหัสการจองในระบบ" };

  } catch (err) {
    return { status: "error", message: err.toString() };
  }
}

/**
 * Admin: บันทึกข้อมูล Rack/CAB (อุปกรณ์และผู้รับผิดชอบ)
 */
function saveStaticAreaData(portalToken, areaData) {
  var access = portalAccessForCall(portalToken, PORTAL_MENU_ID);
  if (!access.ok) return { status: "error", message: access.message };
  if (!isAdminish(access)) return { status: "error", message: "เฉพาะ admin/manager เท่านั้น" };
  try {
    var sheet = getOrCreateSheet("StaticAreas", ["id","name","type","responsibleTeam","info","items"]);
    var rows = sheet.getDataRange().getValues();
    var idIdx = rows[0].indexOf('id');

    for (var i = 1; i < rows.length; i++) {
      if (rows[i][idIdx].toString() === areaData.id.toString()) {
        sheet.getRange(i + 1, 1, 1, 6).setValues([[
          areaData.id, areaData.name, areaData.type,
          areaData.responsibleTeam, areaData.info,
          JSON.stringify(areaData.items || [])
        ]]);
        return { status: "success", message: "บันทึกข้อมูลอุปกรณ์เรียบร้อย" };
      }
    }
    sheet.appendRow([
      areaData.id, areaData.name, areaData.type,
      areaData.responsibleTeam, areaData.info,
      JSON.stringify(areaData.items || [])
    ]);
    return { status: "success", message: "บันทึกข้อมูลอุปกรณ์เรียบร้อย" };
  } catch (err) {
    return { status: "error", message: err.toString() };
  }
}

// ==========================================
// ── Utility Functions ──
// ==========================================

function getOrCreateSheet(sheetName, defaultHeaders) {
  var doc = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = doc.getSheetByName(sheetName);
  if (!sheet) {
    sheet = doc.insertSheet(sheetName);
    if (defaultHeaders && defaultHeaders.length > 0) {
      sheet.appendRow(defaultHeaders);
      sheet.getRange(1, 1, 1, defaultHeaders.length)
           .setFontWeight("bold").setBackground("#F1F5F9");
    }
  }
  return sheet;
}

/**
 * เพิ่มคอลัมน์ใหม่ในชีตที่มีอยู่ (migration helper)
 * ถ้าคอลัมน์นั้นมีอยู่แล้ว ไม่ทำอะไร
 */
function ensureColumnExists(sheet, columnName, afterColumnName) {
  var lastCol = sheet.getLastColumn();
  if (lastCol === 0) return;
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  if (headers.indexOf(columnName) >= 0) return;

  var afterIdx = headers.indexOf(afterColumnName);
  if (afterIdx >= 0) {
    sheet.insertColumnAfter(afterIdx + 1);
    sheet.getRange(1, afterIdx + 2).setValue(columnName)
         .setFontWeight("bold").setBackground("#F1F5F9");
  } else {
    var newCol = lastCol + 1;
    sheet.getRange(1, newCol).setValue(columnName)
         .setFontWeight("bold").setBackground("#F1F5F9");
  }
}

/**
 * ตรวจสอบการชนกันของช่วงเวลา รองรับการจองข้ามวัน
 */
function checkCollision(sheet, newB) {
  var rows = sheet.getDataRange().getValues();
  if (rows.length < 2) return false;

  var h = rows[0];
  var deskIdx    = h.indexOf('deskId');
  var dateIdx    = h.indexOf('date');
  var endDateIdx = h.indexOf('endDate');
  var startIdx   = h.indexOf('startTime');
  var endIdx     = h.indexOf('endTime');

  var newStart = parseToMs(newB.date, newB.startTime);
  var newEnd   = parseToMs(newB.endDate || newB.date, newB.endTime);

  for (var i = 1; i < rows.length; i++) {
    if (rows[i][deskIdx] !== newB.deskId) continue;

    var exDate    = cellToDateStr(rows[i][dateIdx]);
    var exEndDate = exDate;
    if (endDateIdx >= 0 && rows[i][endDateIdx]) {
      var ev = cellToDateStr(rows[i][endDateIdx]);
      if (ev) exEndDate = ev;
    }

    var exStart = parseToMs(exDate, rows[i][startIdx].toString());
    var exEnd   = parseToMs(exEndDate, rows[i][endIdx].toString());

    if (newStart < exEnd && newEnd > exStart) return true;
  }
  return false;
}

function cellToTimeStr(val) {
  if (!val) return '';
  if (val instanceof Date) return Utilities.formatDate(val, Session.getScriptTimeZone(), "HH:mm");
  return val.toString();
}

function cellToDateStr(val) {
  if (!val) return '';
  if (val instanceof Date) return Utilities.formatDate(val, Session.getScriptTimeZone(), "yyyy-MM-dd");
  return val.toString();
}

function parseToMs(dateStr, timeStr) {
  if (!dateStr || !timeStr) return 0;
  try {
    var dp = dateStr.toString().split('-');
    var tp = timeStr.toString().replace(/[^0-9:]/g, '').split(':');
    return new Date(+dp[0], +dp[1]-1, +dp[2], +tp[0]||0, +tp[1]||0).getTime();
  } catch(e) { return 0; }
}

/**
 * ฟังก์ชันสำหรับตรวจสอบและส่งอีเมลแจ้งเตือน
 * 1. ล่วงหน้า 1 วัน (สำหรับการจองข้ามวัน)
 * 2. ล่วงหน้า 10 นาที (ก่อนหมดเวลา)
 * ต้องตั้ง Trigger ให้รันทุกๆ 5 นาที
 */
function checkAndSendReminders() {
  var sheet = getOrCreateSheet("Bookings", []);
  
  // สร้างคอลัมน์บันทึกสถานะการส่งอีเมลล่วงหน้า 1 วัน ถ้ายังไม่มี
  ensureColumnExists(sheet, "longReminderSent", "reminderSent");
  
  var rows = sheet.getDataRange().getValues();
  if (rows.length < 2) return;

  var headers = rows[0];

  var dateIdx = headers.indexOf("endDate");
  if (dateIdx === -1) dateIdx = headers.indexOf("date");
  var startDateIdx = headers.indexOf("date"); // วันเริ่มต้น
  var endIdx = headers.indexOf("endTime");
  var emailIdx = headers.indexOf("userEmail");
  var deskIdx = headers.indexOf("deskId");
  var systemIdx = headers.indexOf("systemName");
  var teamIdx = headers.indexOf("teamName");

  var reminderIdx = headers.indexOf("reminderSent");
  var longReminderIdx = headers.indexOf("longReminderSent");

  var now = new Date();
  var adminEmails = ["parichat@amrasia.com","pailin@amrasia.com"];

  for (var i = 1; i < rows.length; i++) {
    if (rows[i][headers.indexOf("Status")] !== "APPROVED") continue;

    var startDateStr = cellToDateStr(rows[i][startDateIdx]);
    var endDateStr = cellToDateStr(rows[i][dateIdx]);
    var endTimeStr = cellToTimeStr(rows[i][endIdx]);
    var userEmail = rows[i][emailIdx];
    
    var endMs = parseToMs(endDateStr, endTimeStr);
    if (endMs === 0) continue;

    var diffMinutes = Math.floor((endMs - now.getTime()) / 60000);
    var diffHours = diffMinutes / 60;
    
    var reminderSent = reminderIdx >= 0 ? rows[i][reminderIdx] : "";
    var longReminderSent = longReminderIdx >= 0 ? rows[i][longReminderIdx] : "";

    var bookingId = rows[i][headers.indexOf("id")];
    // ลิงก์เซ็นด้วย HMAC หมดอายุใน 48 ชม. — ผู้รับอีเมลไม่มี portal session ให้ยืนยัน
    // จึงต้องใช้ลายเซ็นแทน ป้องกันไม่ให้ใครก็ได้ที่เดา/รู้ booking id มายิง action
    // เองได้ตรงๆ เหมือนของเดิม
    var baseUrl = ScriptApp.getService().getUrl();
    var linkExp = Date.now() + 48 * 60 * 60 * 1000;
    var extendLink = baseUrl + "?action=extend&id=" + encodeURIComponent(bookingId) +
      "&exp=" + linkExp + "&sig=" + encodeURIComponent(_signLink_('extend', bookingId, linkExp));
    var endLink = baseUrl + "?action=end&id=" + encodeURIComponent(bookingId) +
      "&exp=" + linkExp + "&sig=" + encodeURIComponent(_signLink_('end', bookingId, linkExp));

      // ในลูป for ของฟังก์ชัน checkAndSendReminders
      if (now.getTime() > endMs) {
        sheet.getRange(i + 1, headers.indexOf("Status") + 1).setValue("FINISHED");
        continue; // ข้ามรายการนี้ไปเพราะมันจบแล้ว
      }

    // ── 1. แจ้งเตือนล่วงหน้า 1 วัน (24 ชั่วโมง) เฉพาะการจองข้ามวัน ──
    if (startDateStr !== endDateStr) {
      if (
        diffHours > 23 && diffHours <= 24 && 
        longReminderSent !== true && longReminderSent !== "true"
      ) {
        var longSubject = "🗓️ แจ้งเตือน: คิวจองโต๊ะ " + rows[i][deskIdx] + " ของคุณจะหมดอายุในอีก 24 ชั่วโมง";
        
        if (userEmail) {
          MailApp.sendEmail(
            userEmail,
            longSubject,
            "คิวทดสอบระบบแบบข้ามวันของคุณใกล้หมดอายุในอีก 1 วัน กรุณาวางแผนการทำงาน",
            {
              htmlBody: 
                "<p>เรียนคุณ <b>" + rows[i][teamIdx] + "</b>,</p>" +
                "<p>รายการจองโต๊ะ <b>" + rows[i][deskIdx] + "</b> ของโครงการ <b>" + rows[i][systemIdx] + "</b> <span style='color:#D62828; font-weight:bold;'>จะสิ้นสุดลงในวันพรุ่งนี้เวลา " + endTimeStr + " น.</span></p>" +
                "<p>กรุณาวางแผนการทำงานและเคลียร์อุปกรณ์ก่อนหมดเวลา หรือกดขยายเวลาหากมีความจำเป็น</p>"
            }
          );
        }
        
        if (longReminderIdx >= 0) {
          sheet.getRange(i + 1, longReminderIdx + 1).setValue(true);
        }
      }
    }

    // ── 2. แจ้งเตือน 5-10 นาทีก่อนหมดเวลา (คงระบบเดิมไว้) ──
    if (
      diffMinutes >= 5 && diffMinutes < 10 &&
      reminderSent !== true && reminderSent !== "true"
    ) {
      var shortSubject = "⚠️ แจ้งเตือน: คิวจองโต๊ะ " + rows[i][deskIdx] + " กำลังจะหมดเวลาใน 5-10 นาที";
      
      if (userEmail) {
        MailApp.sendEmail(
          userEmail,
          shortSubject,
          "คิวของคุณกำลังจะหมดเวลา กรุณาจัดการสถานะผ่านหน้าเว็บหรืออีเมล HTML",
          {
            htmlBody: 
              "<p>เรียนคุณ <b>" + rows[i][teamIdx] + "</b>,</p>" +
              "<p>รายการจองโต๊ะ <b>" + rows[i][deskIdx] + "</b> ของโครงการ <b>" + rows[i][systemIdx] + "</b> ใกล้ถึงเวลาสิ้นสุดคิวแล้ว</p>" +
              "<p>กรุณาเลือกดำเนินการด้านล่างนี้เพื่อจัดการสถานะห้องแล็บ:</p>" +
              "<table border='0' cellpadding='10'>" +
              "<tr>" +
              "<td><a href='" + extendLink + "' style='background-color: #059669; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;'>➕ ต่อเวลาใช้งาน (+30 นาที)</a></td>" +
              "<td><a href='" + endLink + "' style='background-color: #dc2626; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;'>🛑 สิ้นสุดการใช้งาน (คืนโต๊ะว่าง)</a></td>" +
              "</tr>" +
              "</table>" +
              "<br><p>*หมายเหตุ: การต่อเวลาจะสำเร็จก็ต่อเมื่อช่วงเวลาถัดไปไม่มีผู้ใช้อื่นจองไว้ล่วงหน้า</p>"
          }
        );
      }

      MailApp.sendEmail(adminEmails.join(","), "[ADMIN] " + shortSubject, "ระบบส่งสัญญาณเตือนหมดเวลาไปยังผู้ใช้แล้ว");

      if (reminderIdx >= 0) {
        sheet.getRange(i + 1, reminderIdx + 1).setValue(true);
      }
    }
  } 
}

function formatDateSafe(val, type) {
  if (!val) return "";

  var tz = Session.getScriptTimeZone();

  if (type === "date") {
    return Utilities.formatDate(new Date(val), tz, "yyyy-MM-dd");
  }

  if (type === "time") {
    return Utilities.formatDate(new Date(val), tz, "HH:mm");
  }

  return val.toString();
}

/**
 * ฟังก์ชันสำหรับต่อเวลาใช้งานแบบกำหนดวัน-เวลาอิสระ (พร้อมเก็บเหตุผล)
 */
// หาเจ้าของคิวจาก booking id — ใช้เช็คสิทธิ์ owner-or-admin ทั้ง extend/end
function _bookingOwnerEmail_(bookingId) {
  var sheet = getOrCreateSheet("Bookings", []);
  var rows = sheet.getDataRange().getValues();
  var headers = rows[0];
  var idIdx = headers.indexOf("id");
  var ownerIdx = headers.indexOf("userEmail");
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][idIdx] == bookingId) return rows[i][ownerIdx];
  }
  return null;
}

// เรียกจากหน้าเว็บ (มี portal token) — เจ้าของคิวเองหรือ admin/manager เท่านั้น
function extendBookingCustom(portalToken, bookingId, newEndDateStr, newEndTimeStr, extendReason) {
  var access = portalAccessForCall(portalToken, PORTAL_MENU_ID);
  if (!access.ok) return { status: "error", message: access.message };
  var owner = _bookingOwnerEmail_(bookingId);
  if (owner !== null && access.email !== owner && !isAdminish(access)) {
    return { status: "error", message: "คุณไม่มีสิทธิ์ต่อเวลาคิวของผู้อื่น" };
  }
  return _extendBookingCore_(bookingId, newEndDateStr, newEndTimeStr, extendReason);
}

// ลิงก์อีเมล (เซ็น HMAC ยืนยันแล้วจาก doGet) — ต่อเวลาอัตโนมัติ +30 นาทีจากเวลา
// สิ้นสุดปัจจุบัน แล้วเรียกตรรกะเดียวกับปุ่มบนหน้าเว็บ
function _extendByEmailLink_(bookingId) {
  var sheet = getOrCreateSheet("Bookings", []);
  var rows = sheet.getDataRange().getValues();
  var headers = rows[0];
  var idIdx = headers.indexOf("id");
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][idIdx] == bookingId) {
      var endDateIdx = headers.indexOf("endDate");
      if (endDateIdx === -1) endDateIdx = headers.indexOf("date");
      var endTimeIdx = headers.indexOf("endTime");
      var curDateStr = cellToDateStr(rows[i][endDateIdx]);
      var curTimeStr = cellToTimeStr(rows[i][endTimeIdx]);
      var curMs = parseToMs(curDateStr, curTimeStr);
      if (curMs === 0) return { status: "error", message: "ไม่พบเวลาสิ้นสุดเดิมของคิวนี้" };
      var tz = Session.getScriptTimeZone();
      var newMs = curMs + 30 * 60000;
      var newDateStr = Utilities.formatDate(new Date(newMs), tz, "yyyy-MM-dd");
      var newTimeStr = Utilities.formatDate(new Date(newMs), tz, "HH:mm");
      return _extendBookingCore_(bookingId, newDateStr, newTimeStr, "ต่อเวลาอัตโนมัติจากลิงก์อีเมล (+30 นาที)");
    }
  }
  return { status: "error", message: "ไม่พบรหัสการจองในระบบ" };
}

// ตรรกะจริงของการต่อเวลา — ใช้ร่วมกันทั้งปุ่มบนหน้าเว็บและลิงก์อีเมล
function _extendBookingCore_(bookingId, newEndDateStr, newEndTimeStr, extendReason) {
  try {
    var sheet = getOrCreateSheet("Bookings", []);
    var rows = sheet.getDataRange().getValues();
    var headers = rows[0];

    var idIdx = headers.indexOf("id");
    var endIdx = headers.indexOf("endTime");
    var dateIdx = headers.indexOf("endDate");
    if (dateIdx === -1) dateIdx = headers.indexOf("date");
    var statusIdx = headers.indexOf("Status");
    var notesIdx = headers.indexOf("notes"); // หาคอลัมน์หมายเหตุ

    for (var i = 1; i < rows.length; i++) {
      if (rows[i][idIdx] == bookingId) {
        if (rows[i][statusIdx] === "CANCELLED" || rows[i][statusIdx] === "FINISHED") {
          return { status: "error", message: "ไม่สามารถต่อเวลาได้ เนื่องจากคิวนี้จบลงหรือถูกยกเลิกไปแล้ว" };
        }

        var mockBooking = {
          deskId: rows[i][headers.indexOf("deskId")],
          date: cellToDateStr(rows[i][headers.indexOf("date")]),
          startTime: rows[i][headers.indexOf("startTime")].toString(),
          endDate: newEndDateStr,
          endTime: newEndTimeStr,
          id: bookingId
        };

        if (checkCollisionForExtend(sheet, mockBooking)) {
          return { status: "error", message: "ไม่สามารถต่อเวลาได้ เนื่องจากช่วงเวลาที่เลือกทับซ้อนกับคิวของผู้ใช้อื่น" };
        }

        // อัปเดตวัน-เวลา
        sheet.getRange(i + 1, endIdx + 1).setValue(newEndTimeStr);
        if (headers.indexOf("endDate") >= 0) {
          sheet.getRange(i + 1, headers.indexOf("endDate") + 1).setValue(newEndDateStr);
        }

        // 📌 อัปเดตเหตุผลการต่อเวลาลงในหมายเหตุ
        if (notesIdx >= 0 && extendReason) {
          var oldNotes = rows[i][notesIdx] ? rows[i][notesIdx].toString() : "";
          var appendedNote = oldNotes ? oldNotes + "\n[ต่อเวลา]: " + extendReason : "[ต่อเวลา]: " + extendReason;
          sheet.getRange(i + 1, notesIdx + 1).setValue(appendedNote);
        }

        var reminderIdx = headers.indexOf("reminderSent");
        if (reminderIdx >= 0) sheet.getRange(i + 1, reminderIdx + 1).setValue(false);
        var longReminderIdx = headers.indexOf("longReminderSent");
        if (longReminderIdx >= 0) sheet.getRange(i + 1, longReminderIdx + 1).setValue(false);

        return { status: "success", message: "ขยายเวลาการใช้งานเรียบร้อยแล้ว" };
      }
    }
    return { status: "error", message: "ไม่พบรหัสการจองในระบบ" };
  } catch (err) {
    return { status: "error", message: "เกิดข้อผิดพลาด: " + err.toString() };
  }
}

/**
 * ผู้ใช้งานกดสิ้นสุดการใช้งานก่อนเวลาเพื่อคืนสถานะโต๊ะ — เรียกจากหน้าเว็บ (มี
 * portal token) เจ้าของคิวเองหรือ admin/manager เท่านั้น หมายเหตุ: ปัจจุบัน
 * frontend ไม่มีปุ่มเรียกฟังก์ชันนี้ตรงๆ (เข้าถึงได้ทางลิงก์อีเมลเท่านั้น) แต่ใส่
 * การเช็คสิทธิ์ไว้เผื่ออนาคตมีปุ่มเรียกจากหน้าเว็บโดยตรง
 */
function endBookingById(portalToken, bookingId) {
  var access = portalAccessForCall(portalToken, PORTAL_MENU_ID);
  if (!access.ok) return { status: "error", message: access.message };
  var owner = _bookingOwnerEmail_(bookingId);
  if (owner !== null && access.email !== owner && !isAdminish(access)) {
    return { status: "error", message: "คุณไม่มีสิทธิ์สิ้นสุดคิวของผู้อื่น" };
  }
  return _endBookingInternal_(bookingId);
}

// ลิงก์อีเมล (เซ็น HMAC ยืนยันแล้วจาก doGet) เรียกตรงนี้ — ไม่ผ่าน portal token
function _endBookingInternal_(bookingId) {
  try {
    var sheet = getOrCreateSheet("Bookings", []);
    var rows = sheet.getDataRange().getValues();
    var idIdx = rows[0].indexOf("id");
    var statusIdx = rows[0].indexOf("Status");

    for (var i = 1; i < rows.length; i++) {
      if (rows[i][idIdx] == bookingId) {
        sheet.getRange(i + 1, statusIdx + 1).setValue("FINISHED");
        return { status: "success", message: "<h3>สิ้นสุดการใช้งานเรียบร้อย ขอบคุณที่ช่วยคืนสถานะให้โต๊ะว่างครับ</h3>" };
      }
    }
    return { status: "error", message: "<h3>ไม่พบข้อมูลคิวการจอง</h3>" };
  } catch (err) {
    return { status: "error", message: "เกิดข้อผิดพลาด: " + err.toString() };
  }
}

// ฟังก์ชันพิเศษสำหรับเช็คชนคิวตอนต่อเวลา (ไม่ตรวจชนคิวของตัวเอง)
function checkCollisionForExtend(sheet, newB) {
  var rows = sheet.getDataRange().getValues();
  if (rows.length < 2) return false;
  var h = rows[0];
  var idIdx = h.indexOf('id');
  var deskIdx = h.indexOf('deskId');
  var dateIdx = h.indexOf('date');
  var endDateIdx = h.indexOf('endDate');
  var startIdx = h.indexOf('startTime');
  var endIdx = h.indexOf('endTime');
  var statusIdx = h.indexOf('Status');

  var newStart = parseToMs(newB.date, newB.startTime);
  var newEnd = parseToMs(newB.endDate, newB.endTime);

  for (var i = 1; i < rows.length; i++) {
    if (rows[i][idIdx] == newB.id) continue;
    if (rows[i][deskIdx] !== newB.deskId) continue;
    if (rows[i][statusIdx] === 'CANCELLED' || rows[i][statusIdx] === 'FINISHED') continue;

    var exDate = cellToDateStr(rows[i][dateIdx]);
    var exEndDate = (endDateIdx >= 0 && rows[i][endDateIdx]) ? cellToDateStr(rows[i][endDateIdx]) : exDate;

    var exStart = parseToMs(exDate, rows[i][startIdx].toString());
    var exEnd = parseToMs(exEndDate, rows[i][endIdx].toString());

    if (newStart < exEnd && newEnd > exStart) return true;
  }
  return false;
}

/**
 * ค้นหาอีเมลหัวหน้างานตามชื่อทีม
 */
function getTeamManagers(teamName) {
  var sheet = getOrCreateSheet("Users", []);
  var rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return []; 

  var h = rows[0].map(function(cell) { 
    return cell ? cell.toString().toLowerCase().trim() : ""; 
  });
  
  var teamIdx = h.indexOf("team");
  var posIdx = h.indexOf("position");
  var emailIdx = h.indexOf("email");
  
  if (teamIdx === -1 || posIdx === -1 || emailIdx === -1) {
    Logger.log("Error: ไม่พบหัวคอลัมน์ team, position หรือ email");
    return [];
  }
  
  var managers = [];
  // แปลงชื่อทีมที่ส่งมาจากระบบจองให้เป็นตัวพิมพ์เล็กและตัดช่องว่าง
  var targetTeam = teamName ? teamName.toString().toLowerCase().trim() : "";
  
  for (var i = 1; i < rows.length; i++) {
    var team = rows[i][teamIdx] ? rows[i][teamIdx].toString().toLowerCase().trim() : "";
    var position = rows[i][posIdx] ? rows[i][posIdx].toString().toLowerCase().trim() : "";
    var email = rows[i][emailIdx] ? rows[i][emailIdx].toString().trim() : "";
    
    // ตรวจสอบโดยไม่สนตัวพิมพ์เล็ก-ใหญ่ และตัดช่องว่างเรียบร้อยแล้ว
    if (team === targetTeam && (position === "manager" || position === "leader")) {
      if (email) {
        managers.push(email);
      }
    }
  }
  return managers;
}

function testFinalBridge() {
  // ทดสอบด้วยทีม SCADA ซึ่งมีตำแหน่ง Leader อยู่ในชีต
  var testTeam = "SCADA"; 
  var result = getTeamManagers(testTeam);
  
  Logger.log("--- ผลการทดสอบส่งท้าย ---");
  Logger.log("ชื่อทีมที่ทดสอบ: " + testTeam);
  Logger.log("รายชื่ออีเมลหัวหน้างานที่ดึงได้: " + JSON.stringify(result));
}