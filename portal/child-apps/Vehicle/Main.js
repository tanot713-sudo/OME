// @ts-nocheck
// ==========================================
// ⚙️ GLOBAL CONFIGURATION
// ==========================================
var SHEET_ID = '19ToC7yNPeL4nFEDDKy9EokBZtBAcHrNI0OvFfsE5ceo'; // ID ของ Google Sheet
var DOC_TEMPLATE_ID = '1KosCuXDDdHXQ9D30Z0UDtadoOydnU7M9WiJnDSpyct4'; // ID ของ Google Doc Template สำหรับ PDF
var FOLDER_ID = '1HqfMvrjSg_s5q6LJn8d4-ZtuDE3RscEA'; // โฟลเดอร์เก็บ PDF

// PortalGuard.gs ต้องถูกวางไว้ในโปรเจกต์เดียวกับไฟล์นี้
// PORTAL_ENFORCE = false คือโหมด shadow (ไม่บล็อกใครจริง แค่บันทึก log) เปลี่ยนเป็น
// true เมื่อยืนยันแล้วว่า role ของผู้ใช้จริงทุกคนแมปถูกต้องใน Hub
var PORTAL_MENU_ID = 'sec-vehicles-dash';
var PORTAL_ENFORCE = false;

// ==========================================
// 🔏 ลิงก์อีเมลเซ็นด้วย HMAC — จุดเดียวที่ live-verify กับ Hub ทำไม่ได้ เพราะผู้รับ
// อีเมล (confirmKey/approveBooking/issueKey) ไม่มี portal session เลย
// (รูปแบบเดียวกับที่ใช้ใน Lab Room)
// ==========================================
function _vehicleLinkSecret_() {
  var props = PropertiesService.getScriptProperties();
  var secret = props.getProperty('VEHICLE_LINK_SECRET');
  if (!secret) {
    secret = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('VEHICLE_LINK_SECRET', secret);
  }
  return secret;
}
function _signVehicleLink_(action, id, expMs) {
  var payload = String(action) + '|' + String(id) + '|' + String(expMs);
  var sigBytes = Utilities.computeHmacSha256Signature(payload, _vehicleLinkSecret_());
  return Utilities.base64EncodeWebSafe(sigBytes);
}
function _verifyVehicleLink_(action, id, expMs, sig) {
  if (!action || !id || !expMs || !sig) return false;
  if (Date.now() > Number(expMs)) return false;
  var expected = _signVehicleLink_(action, id, expMs);
  // เทียบแบบไม่รั่วเวลา (constant-time) กัน timing attack เดารหัสทีละตัวอักษร
  if (expected.length !== String(sig).length) return false;
  var diff = 0;
  for (var i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ String(sig).charCodeAt(i);
  return diff === 0;
}
// เรียกตอนสร้างลิงก์ในอีเมล (Notifications.js) หรือลิงก์ในแอปที่เปิดแท็บใหม่แบบไม่มี
// iframe/portalToken ติดไปด้วย (เช่น confirmKey ที่แสดงในรายการ booking) — หมดอายุ
// ใน 90 วัน กว้างพอสำหรับ booking ที่ยังไม่ปิดงานนานๆ โดยไม่เปิดช่องให้ใช้ซ้ำตลอดไป
function _signVehicleActionUrl_(webAppUrl, action, id) {
  var exp = Date.now() + 90 * 24 * 60 * 60 * 1000;
  var sig = _signVehicleLink_(action, id, exp);
  return webAppUrl + "?q=" + action + "&id=" + id + "&exp=" + exp + "&sig=" + encodeURIComponent(sig);
}

// ==========================================
// 🌐 WEB APP ROUTING
// ==========================================
function doGet(e) {
  var p = (e && e.parameter) || {};

  // 1. กรณีขอไฟล์ PDF — เปิดจากในแอป (มี portalToken) เท่านั้น
  if (p.q === 'pdf' && p.id) {
    var access1 = portalAccessFromToken(p.portalToken, PORTAL_MENU_ID);
    if (!access1.ok && PORTAL_ENFORCE) return portalDenied(access1.message);
    var pdf = createBookingPDF(p.id);
    if (pdf.toString() === 'Blob') return pdf;
    else return ContentService.createTextOutput(pdf);
  }

  // 2-4. ลิงก์จากอีเมล/รายการ booking ในแอป — ไม่มี portal session ที่ verify สดได้
  // (ผู้รับอีเมลไม่ได้ login เข้า Hub) ใช้ลายเซ็น HMAC ยืนยันแทนเสมอ ไม่ว่าจะเปิดจากไหน
  if ((p.q === 'confirmKey' || p.q === 'approveBooking' || p.q === 'issueKey') && p.id) {
    if (!_verifyVehicleLink_(p.q, p.id, p.exp, p.sig)) {
      return HtmlService.createHtmlOutput(
        "<div style='text-align:center; padding: 50px; font-family: sans-serif;'><h2>❌ ลิงก์นี้หมดอายุหรือไม่ถูกต้องแล้ว</h2><p>กรุณาเปิดหน้าเว็บ AMR Management แล้วทำรายการผ่านหน้าเว็บแทน</p></div>"
      );
    }
    if (p.q === 'confirmKey') return confirmKeyReturn(p.id);
    if (p.q === 'approveBooking') return processActionFromEmail(p.id, 'Approved', 'อนุมัติการจองสำเร็จ', '✅');
    if (p.q === 'issueKey') return processActionFromEmail(p.id, 'KeyIssued', 'บันทึกจ่ายกุญแจเรียบร้อย', '🔑');
  }

  // 💥 กรณีขอพิมพ์ใบเบิกรถ/ใบแจ้งซ่อมแบบ HTML — เปิดจากในแอป ต้อง login ผ่าน Portal
  if ((p.q === 'bookingPdf' || p.q === 'maintenancePdf') && p.id) {
    var access2 = portalAccessFromToken(p.portalToken, PORTAL_MENU_ID);
    if (!access2.ok && PORTAL_ENFORCE) return portalDenied(access2.message);
    var html = p.q === 'bookingPdf' ? createBookingHTMLPdf(p.id) : createMaintenanceHTMLPdf(p.id);
    return HtmlService.createHtmlOutput(html)
      .setTitle((p.q === 'bookingPdf' ? 'รายงานการใช้งานยานพาหนะ - ' : 'ใบแจ้งซ่อม - ') + p.id)
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  // 💥 API สำหรับเปิดหน้าต่างแก้ไขข้อมูลการจอง — เจ้าของ booking เองหรือ admin/manager
  // เท่านั้น (เดิมใครมี id ก็เปิดแก้ได้หมด ไม่เช็คอะไรเลยนอกจากสถานะ Pending)
  if (p.q === 'editForm' && p.id) {
    var access3 = portalAccessFromToken(p.portalToken, PORTAL_MENU_ID);
    if (!access3.ok) {
      if (PORTAL_ENFORCE) return portalDenied(access3.message);
    } else if (PORTAL_ENFORCE && !isAdminish(access3)) {
      var bk3 = getDataFromSheet('Bookings').find(function(b) { return String(b.id) === String(p.id); });
      if (!bk3 || !_isBookingOwner_(access3, bk3)) {
        return HtmlService.createHtmlOutput("<h2 style='text-align:center; padding: 50px; font-family: sans-serif; color:red;'>❌ ไม่มีสิทธิ์แก้ไขการจองนี้</h2>");
      }
    }
    return HtmlService.createHtmlOutput(createEditFormHTML(p.id, p.portalToken))
      .setTitle('แก้ไขการจอง - ' + p.id)
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  // 💥 API สำหรับแอดมินสั่งตีกลับให้แก้ไข — เฉพาะ admin/manager
  if (p.q === 'requireEdit' && p.id) {
    var access4 = portalAccessFromToken(p.portalToken, PORTAL_MENU_ID);
    if (PORTAL_ENFORCE && (!access4.ok || !isAdminish(access4))) {
      return ContentService.createTextOutput("Error: ไม่มีสิทธิ์ทำรายการนี้");
    }
    try {
      var bkId = p.id;
      var note = p.note || "แอดมินรบกวนตรวจสอบข้อมูลอีกครั้งค่ะ";
      var bookings = getDataFromSheet('Bookings');
      var bk = bookings.find(b => String(b.id) === String(bkId));

      if (bk) {
         // 1. ค้นหาอีเมลและส่งแจ้งเตือนผู้ใช้งาน
         var users = getDataFromSheet('Users');
         var usr = users.find(u => String(u.id) === String(bk.userId));
         if(usr && usr.email) {
             var subject = "⚠️ แจ้งแก้ไขรายละเอียดการจองรถ: " + (bk.vehicleName || "-");
             var body = "สวัสดีคุณ " + (usr.name || "") + "\n\nแอดมินรบกวนให้คุณเข้าสู่ระบบเพื่อ 'แก้ไขรายละเอียด' การจองรถคันนี้ให้ครบถ้วนค่ะ\n\n💬 ข้อความจากแอดมิน: " + note + "\n\nขอบคุณค่ะ";
             MailApp.sendEmail(usr.email, subject, body);
         }

         // 2. ปรับสถานะกลับเป็น "รออนุมัติ (Pending)" และบันทึกหมายเหตุ
         bk.status = 'Pending';
         bk.adminNote = note;
         updateRowInSheet('Bookings', bk.id, bk);
      }
      return ContentService.createTextOutput("Success");
    } catch(err) {
      return ContentService.createTextOutput("Error: " + err.message);
    }
  }

  // 💥 API สำหรับเปิดหน้าติดตามการล้างรถ — ต้อง login ผ่าน Portal
  if (p.q === 'carwash') {
    var access5 = portalAccessFromToken(p.portalToken, PORTAL_MENU_ID);
    if (!access5.ok && PORTAL_ENFORCE) return portalDenied(access5.message);
    return HtmlService.createHtmlOutput(createCarWashHTML(p.portalToken))
      .setTitle('ระบบติดตามการล้างรถ')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  // 5. กรณีปกติ (เปิดหน้าเว็บ) — ต้องผ่านสิทธิ์ portal ก่อนเสมอ
  var g = portalGuard(e, PORTAL_MENU_ID);
  if (g.deny) return g.deny;

  var t = HtmlService.createTemplateFromFile('index');
  t.portalBootstrap = JSON.stringify({
    token: p.portalToken || '',
    email: g.access.email,
    name: g.access.name,
    role: g.access.role,
    isAdmin: isAdminish(g.access),
    canWrite: canWrite(g.access),
    // null = เห็นทุกแถบ (ไม่ถูกจำกัด), array = เห็นเฉพาะ id ที่อยู่ในนี้ — รวม
    // แถบหลัก (dashboard/fleet/bookings/return/maintenance/reports/settings) และ
    // แท็บย่อยในหน้า Settings (settings:vehicles/settings:users/settings:projects)
    allowedSections: g.access.allowedSections
  });
  return t.evaluate()
      .setTitle('AMR Vehicle Management')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function portalDenied(message) {
  return HtmlService.createHtmlOutput(
    "<div style='text-align:center; padding: 50px; font-family: sans-serif;'><h2>❌ ไม่มีสิทธิ์เข้าถึง</h2><p>" + (message || 'กรุณาเข้าสู่ระบบผ่าน OMA Portal') + "</p></div>"
  );
}

// ฟังก์ชันดึงไฟล์ HTML ย่อย (ถ้ามี)
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ฟังก์ชันช่วยจัดการเมื่อมีการกดปุ่มจากในอีเมล (รองรับทั้ง จองรถ และ แจ้งซ่อม)
function processActionFromEmail(reqId, newStatus, successTitle, iconStr) {
  try {
    var isMaintenance = false;
    var dataList = getDataFromSheet('Bookings');
    var item = dataList.find(b => String(b.id) === String(reqId));

    // 1. ถ้าไม่เจอใน Bookings ให้สลับไปหาใน Maintenance
    if (!item) {
      dataList = getDataFromSheet('Maintenance');
      item = dataList.find(m => String(m.id) === String(reqId));
      isMaintenance = true; // จำไว้ว่าเป็นงานแจ้งซ่อม
    }

    // 2. ถ้าหาทั้ง 2 ชีตแล้วยังไม่เจอ แสดงว่าไม่มีข้อมูลจริงๆ
    if (!item) {
      return HtmlService.createHtmlOutput(`
        <div style='text-align:center; padding: 50px; font-family: sans-serif;'>
          <h2>❌ ไม่พบข้อมูลคำขอนี้ในระบบ</h2>
          <p>รหัสคำขออาจไม่ถูกต้อง หรือถูกลบออกจากระบบไปแล้ว</p>
        </div>
      `);
    }

    // 3. ถ้าสถานะปัจจุบันเป็นแบบที่ต้องการอยู่แล้ว (กันคนกดซ้ำ)
    if (item.status === newStatus) {
       return HtmlService.createHtmlOutput(`
         <div style="text-align:center; padding: 50px; font-family: sans-serif;">
           <h2>⚠️ รายการนี้ถูก ${successTitle} ไปแล้ว</h2>
           <p>ระบบได้บันทึกข้อมูลไปก่อนหน้านี้แล้ว คุณสามารถปิดหน้านี้ได้เลย</p>
         </div>
       `);
    }

    // 4. จัดเตรียมข้อมูลเพื่อส่งไปอัปเดตสถานะ — action ผ่านลิงก์เซ็นแล้ว จึงข้าม
    // portalToken (เทียบเท่า admin ที่กดจากในอีเมลของตัวเอง) ไปเรียกฟังก์ชันภายในตรงๆ
    item.status = newStatus;

    // 5. โยนเข้าฟังก์ชันอัปเดตหลักของระบบ (เพื่อบันทึกลงชีตและส่งอีเมลแจ้งเตือนอัตโนมัติ)
    if (isMaintenance) {
       item.adminName = 'ทำรายการผ่านอีเมล (1-Click)';
       _internalUpdateMaintenance_(item);
    } else {
       if (newStatus === 'KeyIssued') {
         item.handoverTime = new Date().toISOString();
         item.adminHandoverNote = 'ทำรายการผ่านอีเมล (1-Click)';
       }
       item.adminName = 'ทำรายการผ่านอีเมล (1-Click)';
       _internalUpdateBookingStatus_(item);
    }

    // 6. ส่งหน้าจอสวยๆ กลับไปบอกว่าทำรายการสำเร็จ
    return HtmlService.createHtmlOutput(`
      <div style="font-family: sans-serif; text-align: center; padding: 50px; background-color: #f9f9f9; min-height: 100vh;">
        <div style="background-color: white; max-width: 500px; margin: 0 auto; padding: 40px; border-radius: 15px; box-shadow: 0 4px 15px rgba(0,0,0,0.05);">
          <div style="font-size: 70px; margin-bottom: 20px;">${iconStr}</div>
          <h1 style="color: #2c3e50; margin-bottom: 10px;">${successTitle}</h1>
          <p style="color: #7f8c8d; line-height: 1.6;">รหัสคำขอ: <strong>${reqId}</strong></p>
          <p style="color: #7f8c8d; line-height: 1.6; margin-bottom: 30px;">ระบบได้อัปเดตสถานะและส่งอีเมลแจ้งเตือนขั้นตอนต่อไปเรียบร้อยแล้ว คุณสามารถปิดหน้านี้ได้เลย</p>
        </div>
      </div>
    `);
  } catch (e) {
    return HtmlService.createHtmlOutput(`
      <div style='text-align:center; padding: 50px; font-family: sans-serif;'>
        <h2>❌ เกิดข้อผิดพลาดในระบบ: ${e.toString()}</h2>
      </div>
    `);
  }
}

// ==========================================
// 📤 POST API (รับข้อมูลจากหน้าเว็บ รวมถึงรูปภาพ)
// ==========================================
function doPost(e) {
  try {
    const eData  = (e.postData && e.postData.contents)
                   ? JSON.parse(e.postData.contents)
                   : e.parameter;
    const action  = eData.action;
    const payload = eData.payload;
    let result;

    switch (action) {
      case 'UPLOAD_FILE':
        var access = portalAccessFromToken(eData.portalToken, PORTAL_MENU_ID);
        if (!access.ok || !canWrite(access)) {
          if (PORTAL_ENFORCE) { result = { status: 'ERROR', message: access.message || 'สิทธิ์ไม่พอ' }; break; }
        }
        result = handleUploadFile(payload);
        break;
      default:
        result = { status: 'ERROR', message: 'Invalid action: ' + action };
    }

    return _jsonResponse(result);

  } catch (err) {
    return _jsonResponse({ status: 'ERROR', message: err.message });
  }
}

// ==========================================
// 🖼️ ฟังก์ชันย่อย: แปลง Base64 เป็นไฟล์และอัปโหลดขึ้น Drive
// ==========================================
function handleUploadFile(payload) {
  try {
    // ใช้ FOLDER_ID จากที่คุณตั้งค่าไว้ด้านบนสุดของไฟล์
    if (!FOLDER_ID) {
      return { status: "ERROR", message: "ยังไม่ได้ตั้งค่า FOLDER_ID" };
    }
    var folder = DriveApp.getFolderById(FOLDER_ID);

    // แยกข้อมูลภาพจริงออกจาก Header
    var base64Data = payload.fileBase64.split(',')[1];
    var blob = Utilities.newBlob(Utilities.base64Decode(base64Data), payload.fileType, payload.fileName);

    // สร้างไฟล์ลงใน Google Drive
    var file = folder.createFile(blob);

    // 💥 สำคัญ: ตั้งค่าแชร์ให้ทุกคนที่มีลิงก์ดูได้ เพื่อให้ภาพไปโชว์ในเว็บและ PDF ได้
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    // ส่ง URL ของภาพกลับไปให้หน้าเว็บ
    return { status: "SUCCESS", fileUrl: file.getUrl(), fileId: file.getId() };

  } catch (err) {
    return { status: "ERROR", message: "Upload ERROR: " + err.message };
  }
}

// ==========================================
// 🔍 ตัวช่วย: ตรวจสอบสถานะรถแบบ Real-time (รู้จักการจองล่วงหน้า)
// ==========================================
function getCorrectVehicleStatus(vehicleId) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Bookings');
    if (!sheet) return 'Available';
    var data = sheet.getDataRange().getValues();
    var headers = data[0];

    var vIdCol = headers.indexOf('vehicleId');
    var statusCol = headers.indexOf('status');
    var keyRetCol = headers.indexOf('keyReturned');
    var startCol = headers.indexOf('startDate');
    var endCol = headers.indexOf('endDate');
    var pickCol = headers.indexOf('pickupTime');
    var retTimeCol = headers.indexOf('returnTime');

    var now = new Date().getTime(); // เวลา ณ วินาทีปัจจุบัน

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][vIdCol]) === String(vehicleId)) {
        var bStatus = String(data[i][statusCol]);
        var kRet = String(data[i][keyRetCol]).toLowerCase();

        // 🚨 ด่านที่ 1: ถ้าเบิกกุญแจออกไปแล้ว (KeyIssued/Active) และยังไม่ได้คืน = "กำลังใช้งาน" 100% (ไม่สนเวลา)
        if ((bStatus === 'KeyIssued' || bStatus === 'Inspected' || bStatus === 'Active' || bStatus === 'Completed') && kRet !== 'yes') {
          return 'In Use';
        }

        // ⏳ ด่านที่ 2: ถ้าเพิ่งถูก "อนุมัติ (Approved)" หรือ "รออนุมัติ (Pending)" ให้เช็คเวลา!
        if (bStatus === 'Approved' || bStatus === 'Pending') {
          // ดึงวันที่และเวลาของการจองนั้นๆ มาประกอบร่างกัน
          var bStartDateStr = String(data[i][startCol]).split('T')[0];
          var bEndDateStr = String(data[i][endCol]).split('T')[0];

          var bStart = new Date(bStartDateStr + 'T' + (data[i][pickCol] || '00:00') + ':00').getTime();
          var bEnd = new Date(bEndDateStr + 'T' + (data[i][retTimeCol] || '23:59') + ':00').getTime();

          // 💥 ไฮไลท์สำคัญ: ถ้า "เวลาปัจจุบัน" ตกอยู่ในช่วงเวลาที่เขาจองไว้พอดีเป๊ะ ถือว่ารถ "กำลังใช้งาน"
          // แต่ถ้าจองไว้เดือนหน้า (now ยังน้อยกว่า bStart) จะไม่เข้าเงื่อนไขนี้ และมองว่ารถยังจอดว่างอยู่ (Available)
          if (!isNaN(bStart) && !isNaN(bEnd) && now >= bStart && now <= bEnd) {
            return 'In Use';
          }
        }
      }
    }
    return 'Available'; // ผ่านทุกด่านแล้วไม่มีคิวของวันนี้/ตอนนี้ = รถพร้อมใช้
  } catch (err) {
    console.error("Status Check Error: ", err);
    return 'Available';
  }
}
