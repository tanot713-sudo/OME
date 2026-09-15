// ==========================================
// 🖨️ PDF GENERATOR & VIEWS
// ==========================================

function createBookingPDF(bookingId) {
  try {
    var bookings = getDataFromSheet('Bookings');
    var booking = bookings.find(b => b.id === bookingId);
    
    if (!booking) return ContentService.createTextOutput("ไม่พบข้อมูลการจอง");

    var templateFile = DriveApp.getFileById(DOC_TEMPLATE_ID);
    var targetFolder = FOLDER_ID ? DriveApp.getFolderById(FOLDER_ID) : DriveApp.getRootFolder();
    var newFile = templateFile.makeCopy("JobOrder_" + bookingId, targetFolder);
    var doc = DocumentApp.openById(newFile.getId());
    var body = doc.getBody();

    body.replaceText("{{bookingId}}", booking.id || "-");
    body.replaceText("{{userName}}", booking.userName || "-");
    body.replaceText("{{car}}", booking.vehicleName || "-");
    body.replaceText("{{plate}}", booking.vehiclePlate || "-"); 
    body.replaceText("{{startDate}}", formatDate(booking.startDate));
    body.replaceText("{{endDate}}", formatDate(booking.endDate));
    body.replaceText("{{returnDate}}", formatDate(booking.returnDate));
    
    replaceImage(body, "{{signature}}", booking.signatureUrl);

    doc.saveAndClose();

    var pdfBlob = newFile.getAs(MimeType.PDF);
    newFile.setTrashed(true);
    return pdfBlob;

  } catch (e) {
    return ContentService.createTextOutput("Error PDF: " + e.toString());
  }
}

function formatDate(isoString) {
  if (!isoString) return "-";
  try {
    var d = new Date(isoString);
    return Utilities.formatDate(d, Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm");
  } catch (e) { return isoString; }
}

function replaceImage(body, placeholder, imageUrl) {
  try {
    var range = body.findText(placeholder);
    if (range && imageUrl) {
      body.replaceText(placeholder, "[มีลายเซ็น]"); 
    } else {
      body.replaceText(placeholder, "");
    }
  } catch (e) {}
}

// หน้าจอยืนยันรับกุญแจ (HTML)
function confirmKeyReturn(bookingId) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName('Bookings');
    var data = sheet.getDataRange().getValues();
    
    // หาคอลัมน์ ID และ keyReturned
    var headers = data[0];
    var idIndex = headers.indexOf('id');
    var keyIndex = headers.indexOf('keyReturned');
    
    // ถ้ายังไม่มีคอลัมน์ keyReturned ให้แจ้งเตือน
    if (keyIndex === -1) {
      return HtmlService.createHtmlOutput("<h2>❌ Error: ไม่พบคอลัมน์ 'keyReturned' ใน Google Sheet</h2>");
    }

    // วนลูปหาแถวที่ตรงกับ Booking ID
    for (var i = 1; i < data.length; i++) {
      if (data[i][idIndex] === bookingId) {
        // อัปเดตค่าเป็น 'Yes'
        sheet.getRange(i + 1, keyIndex + 1).setValue('Yes');
        
        // ส่งหน้าจอสวยๆ กลับไปบอก Admin
        return HtmlService.createHtmlOutput(`
          <div style="font-family: sans-serif; text-align: center; padding: 50px;">
            <div style="font-size: 60px;">🔑✅</div>
            <h1 style="color: #166534;">ยืนยันรับกุญแจเรียบร้อย</h1>
            <p>Booking ID: ${bookingId}</p>
            <p>สถานะอัปเดตแล้ว คุณสามารถปิดหน้านี้และรีเฟรช Web App เพื่อพิมพ์ใบงานได้เลย</p>
          </div>
        `);
      }
    }
    return HtmlService.createHtmlOutput("<h2>❌ ไม่พบข้อมูลการจองนี้</h2>");
  } catch (e) {
    return HtmlService.createHtmlOutput("Error: " + e.toString());
  }
}

// ==========================================
// 📄 ฟังก์ชันสร้างหน้า HTML สำหรับพิมพ์ใบเบิกรถ (พร้อมรูปภาพและข้อมูลครบถ้วน)
// ==========================================
function createBookingHTMLPdf(bookingId) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName('Bookings');
    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    
    var b = null;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(bookingId)) {
        b = {};
        for (var j = 0; j < headers.length; j++) { b[headers[j]] = data[i][j]; }
        break;
      }
    }
    
    if (!b) return "<h2 style='text-align:center; padding: 50px; font-family: sans-serif;'>❌ ไม่พบข้อมูลการจองรหัสนี้</h2>";

    // 🛠️ ตัวช่วยที่ 1: จัดการปัญหาเวลา 1899
    var formatTime = function(t) {
      if (!t || t === "") return "-";
      if (t instanceof Date) return Utilities.formatDate(t, "Asia/Bangkok", "HH:mm");
      var ts = String(t);
      if (ts.indexOf("1899") !== -1 || ts.indexOf("GMT") !== -1) {
        try { return Utilities.formatDate(new Date(ts), "Asia/Bangkok", "HH:mm"); } catch(e){}
      }
      return ts;
    };

    // 🛠️ ตัวช่วยที่ 2: จัดการวันที่และเวลาแบบไทย
    var formatThaiDate = function(dStr) {
      if (!dStr || dStr === "") return "-";
      try {
        var d = new Date(dStr);
        if (isNaN(d.getTime())) return "-";
        return d.toLocaleDateString('th-TH', {year:'numeric', month:'short', day:'numeric'}) + " " + Utilities.formatDate(d, "Asia/Bangkok", "HH:mm") + " น.";
      } catch(e) { return "-"; }
    };

    // 🛠️ ตัวช่วยที่ 3: ดึงรูปภาพจาก Google Drive ให้แสดงผลได้ 100%
    var getImg = function(urlStr) {
      if (!urlStr || urlStr === "" || urlStr === "-") return "<div class='empty-img'>- ไม่มีภาพแนบ -</div>";
      try {
        var urls = urlStr.indexOf('[') === 0 ? JSON.parse(urlStr) : [urlStr];
        var imgTags = "";
        urls.forEach(function(url) {
          if(!url) return;
          // ดึงเฉพาะ ID ของรูปภาพออกมา
          var idMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/id=([a-zA-Z0-9_-]+)/);
          var id = idMatch ? idMatch[1] : null;
          if (id) {
            // ใช้ลิงก์ Thumbnail ของ Drive จะแสดงผลได้เสถียรกว่า
            imgTags += `<img src="https://drive.google.com/thumbnail?id=${id}&sz=w400-h400" class="doc-img" onerror="this.src='https://drive.google.com/uc?export=view&id=${id}'" />`;
          }
        });
        return imgTags || "<div class='empty-img'>- โหลดภาพไม่สำเร็จ -</div>";
      } catch(e) { return "<div class='empty-img'>- รูปแบบภาพผิดพลาด -</div>"; }
    };

    // 🛠️ ตัวช่วยที่ 4: แตกไฟล์ JSON ของรายการตรวจสภาพ
    var getChecklistHtml = function(jsonStr) {
      if (!jsonStr || jsonStr === "" || jsonStr === "-") return "<p style='color:#6b7280; font-size:13px;'>- ไม่มีข้อมูลการตรวจเช็ค -</p>";
      try {
        var obj = JSON.parse(jsonStr);
        var html = `<div class="grid-2" style="font-size:13px; margin-top: 10px; border-top: 1px dashed #e5e7eb; padding-top: 12px;">`;
        
        // 🎯 เพิ่มคำที่เป็น "แง่บวก (ปกติ)" ทั้งหมดไว้ที่นี่
        var normalWords = ["ปกติ", "เรียบร้อย", "มี", "ครบ", "ไม่มี", "ไม่มีคราบ", "Normal"];
        
        for (var key in obj) {
          var item = obj[key];
          var statusTxt = String(item.status).trim();
          var isNormal = normalWords.indexOf(statusTxt) !== -1; // เช็คว่าคำนี้อยู่ในกลุ่มคำปกติหรือไม่
          
          var statusColor = isNormal ? "color: #166534;" : "color: #b91c1c; font-weight: bold; background: #fee2e2; padding: 2px 6px; border-radius: 4px;";
          var noteHtml = item.note ? ` <br><span style="color:#6b7280; font-style:italic; font-size:11px;">หมายเหตุ: ${item.note}</span>` : "";
          
          html += `<div style="margin-bottom: 8px;">
                     <strong>${item.name}:</strong> <span style="${statusColor}">${statusTxt}</span>${noteHtml}
                   </div>`;
        }
        html += `</div>`;
        return html;
      } catch(e) { return "<p>- ข้อมูลตรวจเช็คผิดพลาด -</p>"; }
    };

    // เตรียมตัวแปรวันที่
    var sd = b.startDate ? new Date(b.startDate).toLocaleDateString('th-TH', {year:'numeric', month:'short', day:'numeric'}) : "-";
    var ed = b.endDate ? new Date(b.endDate).toLocaleDateString('th-TH', {year:'numeric', month:'short', day:'numeric'}) : "-";
    var pd = formatThaiDate(b.createdAt || new Date());

    // สร้างหน้า HTML
    var html = `
    <!DOCTYPE html>
    <html lang="th">
    <head>
      <meta charset="UTF-8">
      <title>รายงานการใช้งานยานพาหนะ - ${b.id}</title>
      <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap" rel="stylesheet">
      <style>
        body { font-family: 'Sarabun', sans-serif; background: #525659; margin: 0; padding: 20px; color: #1f2937; line-height: 1.6; font-size: 13px; }        .print-btn-container { display: flex; justify-content: center; gap: 15px; margin-bottom: 20px; position: sticky; top: 20px; z-index: 100; }
        .print-btn { background: #2563eb; color: white; border: none; padding: 10px 24px; border-radius: 8px; font-size: 16px; font-weight: bold; cursor: pointer; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
        .print-btn:hover { background: #1d4ed8; }
        .close-btn { background: #4b5563; color: white; border: none; padding: 10px 24px; border-radius: 8px; font-size: 16px; font-weight: bold; cursor: pointer; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
        .close-btn:hover { background: #374151; }
        .a4-page { background: white; max-width: 850px; margin: 0 auto; padding: 15mm; box-shadow: 0 10px 25px rgba(0,0,0,0.1); border-radius: 4px; box-sizing: border-box; }
        .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #e5e7eb; padding-bottom: 15px; margin-bottom: 25px; }
        .logo-text { color: #dc2626; font-size: 26px; font-weight: bold; margin: 0; }
        .company-name { font-size: 15px; font-weight: bold; margin: 5px 0 0 0; }
        .company-address { font-size: 12px; color: #6b7280; margin: 2px 0 0 0; }
        .title-box { border: 2px solid #111827; padding: 10px 25px; border-radius: 8px; font-weight: bold; font-size: 20px; text-align: center; }
        .section { margin-bottom: 25px; page-break-inside: avoid; }
        .section-title { font-weight: bold; font-size: 13px; background: #f3f4f6; padding: 8px 15px; border-left: 5px solid #dc2626; margin-bottom: 15px; border-radius: 0 4px 4px 0; }
        .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 13px; }
        .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; font-size: 13px; }
        .data-row { margin-bottom: 8px; }
        .data-label { font-weight: bold; color: #4b5563; font-size: 13px; }
        .data-value { color: #111827; font-weight: 600; border-bottom: 1px dotted #cbd5e1; padding-bottom: 2px; }
        .img-container { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 12px; }
        .doc-img { height: 160px; width: 160px; object-fit: cover; border-radius: 8px; border: 2px solid #e2e8f0; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }
        .empty-img { font-size: 13px; color: #9ca3af; font-style: italic; background: #f9fafb; padding: 15px; border-radius: 8px; border: 1px dashed #d1d5db; text-align: center; width: 100%; }
        
        .signature-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 20px; margin-top: 30px; font-size: 13px; }
        .sig-box { border: 1px solid #e5e7eb; padding: 15px; border-radius: 8px; text-align: center; background: #f9fafb; }
        .sig-role { color: #4b5563; font-weight: bold; margin-bottom: 15px; font-size: 12px; }
        .sig-name { font-weight: bold; font-size: 13px; color: #111827; margin-bottom: 8px; border-bottom: 1px solid #d1d5db; padding-bottom: 5px; }
        .sig-time { font-size: 14px; color: #6b7280; }
        
        @media print {
          body { background: white; padding: 0; }
          .print-btn-container { display: none; }
          .a4-page { box-shadow: none; max-width: 100%; padding: 20px; border-radius: 0; }
          @page { size: A4; margin: 1cm; }
        }
      </style>
    </head>
    <body>
      <div class="print-btn-container">
        <button class="print-btn" onclick="window.print()">🖨️ สั่งพิมพ์รายงานการใช้งานยานพาหนะ</button>
      </div>

      <div class="a4-page">
        <div class="header">
          <div>
            <h1 class="logo-text">AMR ASIA</h1>
            <p class="company-name">บริษัท เอเอ็มอาร์ เอเชีย จำกัด (มหาชน)</p>
            <p class="company-address">469 ซอยประวิทย์และเพื่อน ถนนประชาชื่น<br>แขวงลาดยาว เขตจตุจักร กรุงเทพมหานคร 10900</p>
          </div>
          <div class="title-box">รายงานการใช้งานยานพาหนะ<br><span style="font-size:13px; font-weight:normal; color:#4b5563;"></span></div>
        </div>

        <div class="section">
          <div class="grid-2">
            <div class="data-row"><span class="data-label">เลขที่การจอง:</span> <span class="data-value">${b.id}</span></div>
            <div class="data-row"><span class="data-label">วันที่ยื่นคำขอ:</span> <span class="data-value">${pd}</span></div>
            <div class="data-row"><span class="data-label">ผู้เบิก:</span> <span class="data-value">${b.userName || '-'}</span></div>
            <div class="data-row"><span class="data-label">โครงการ:</span> <span class="data-value">${b.projectName || '-'}</span></div>
            <div class="data-row"><span class="data-label">ยานพาหนะ:</span> <span class="data-value">${b.vehicleName || '-'}</span></div>
            <div class="data-row"><span class="data-label">จุดหมายปลายทาง:</span> <span class="data-value">${b.destination || '-'}</span></div>
            <div class="data-row"><span class="data-label">เริ่มใช้งาน:</span> <span class="data-value">${sd} เวลา ${formatTime(b.pickupTime)} น.</span></div>
            <div class="data-row"><span class="data-label">ถึงวันที่:</span> <span class="data-value">${ed} เวลา ${formatTime(b.returnTime)} น.</span></div>
          </div>
          <div class="data-row" style="margin-top: 10px;"><span class="data-label">วัตถุประสงค์:</span> <span class="data-value">${b.purpose || '-'}</span></div>
        </div>

        <div class="section">
          <div class="section-title">รายงานการตรวจสภาพรถก่อนใช้งาน (ขาไป)</div>
          
          <div class="grid-2" style="margin-bottom: 15px;">
            <div>
              <div class="data-row"><span class="data-label">เลขไมล์เริ่มต้น:</span> <span class="data-value" style="font-size: 16px;">${Number(b.startMileage||0).toLocaleString()} กม.</span></div>
              <div class="data-label" style="margin-top:8px; font-size:13px;">ภาพหน้าปัดเลขไมล์:</div>
              <div class="img-container">${getImg(b.startOdometerImage)}</div>
            </div>
            <div>
              <div class="data-row"><span class="data-label">ระดับน้ำมันเริ่มต้น:</span> <span class="data-value" style="font-size: 16px;">${b.startFuel || '-'} ลิตร</span></div>
              <div class="data-label" style="margin-top:8px; font-size:13px;">ภาพระดับน้ำมัน:</div>
              <div class="img-container">${getImg(b.startFuelImage)}</div>
            </div>
          </div>
          
          <div style="margin-top: 15px; padding: 15px; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0;">
            <div class="data-label" style="font-size:15px; margin-bottom: 5px;">รายการตรวจเช็ครอบคัน:</div>
            ${getChecklistHtml(b.preTripChecklist)}
          </div>

          <div style="margin-top: 15px;">
            <div class="data-row"><span class="data-label">สภาพทั่วไป (หมายเหตุเพิ่มเติม):</span> <span class="data-value text-red-600">${b.preConditionNote || 'ปกติ'}</span></div>
            <div class="data-label" style="margin-top:8px; font-size:13px;">ภาพความเสียหายรอบคัน (ถ้ามี):</div>
            <div class="img-container">${getImg(b.preUseDamageImages)}</div>
          </div>
        </div>

        <div class="section">
          <div class="section-title">รายงานการตรวจสภาพรถหลังใช้งาน (ขากลับ)</div>
          <div class="grid-3">
            <div class="data-row"><span class="data-label">เลขไมล์เมื่อคืน:</span> <span class="data-value" style="font-size: 16px;">${Number(b.endMileage||0).toLocaleString()} กม.</span></div>
            <div class="data-row"><span class="data-label">ระยะทางที่ใช้:</span> <span class="data-value" style="font-size: 16px; color: #dc2626;">${Number(b.distanceUsed||0).toLocaleString()} กม.</span></div>
            <div class="data-row"><span class="data-label">น้ำมันคงเหลือ:</span> <span class="data-value" style="font-size: 16px;">${b.endFuel || '-'} ลิตร</span></div>
          </div>
          
          <div class="grid-2" style="margin-top: 15px; margin-bottom: 15px;">
            <div>
              <div class="data-label" style="font-size:13px;">ภาพหน้าปัดเลขไมล์คืนรถ:</div>
              <div class="img-container">${getImg(b.endOdometerImage)}</div>
            </div>
            <div>
              <div class="data-label" style="font-size:13px;">ภาพระดับน้ำมันคืนรถ:</div>
              <div class="img-container">${getImg(b.endFuelImage)}</div>
            </div>
          </div>

          <div class="data-row" style="margin-top: 15px; background: #eff6ff; padding: 15px; border-radius: 8px; border: 1px solid #bfdbfe;">
            <span class="data-label">การเติมน้ำมันระหว่างทาง:</span> 
            <span class="data-value" style="color: ${String(b.fuelFilled).toLowerCase() === 'true' ? '#1d4ed8' : '#991b1b'}; border: none; font-size: 16px;">
              ${String(b.fuelFilled).toLowerCase() === 'true' ? '✅ มีการเติมน้ำมัน' : '❌ ไม่มีการเติม'}
            </span>
            ${String(b.fuelFilled).toLowerCase() === 'true' ? `<div style="margin-top:8px; font-size:14px; color:#1e40af;">จำนวน <strong>${b.liters || 0}</strong> ลิตร | เป็นเงิน <strong>${b.totalCost || 0}</strong> บาท | เลขที่ใบเสร็จ: <strong>${b.receiptId || '-'}</strong></div>` : ''}
          </div>

          <div style="margin-top: 15px;">
            <div class="data-row"><span class="data-label">สภาพรถเมื่อคืน / ปัญหาที่พบ:</span> <span class="data-value" style="color: #dc2626;">${b.returnNote || 'ปกติ'}</span></div>
            <div class="data-label" style="margin-top:8px; font-size:13px;">ภาพความเสียหายตอนคืนรถ (ถ้ามี):</div>
            <div class="img-container">${getImg(b.postUseDamageImages)}</div>
          </div>
        </div>

        <div class="section" style="margin-top: 40px;">
          <div class="section-title" style="background: transparent; border-bottom: 2px solid #e5e7eb; border-left: none; padding-left: 0; color: #1f2937;">บันทึกการอนุมัติและผู้ดำเนินการ</div>
          
          <div class="signature-grid">
            <div class="sig-box">
              <div class="sig-role">ผู้เบิก / ผู้ใช้งาน</div>
              <div class="sig-name">${b.userName || '-'}</div>
              <div class="sig-time">เวลาขอเบิก: <br><strong>${formatThaiDate(b.createdAt)}</strong></div>
            </div>
            <div class="sig-box">
              <div class="sig-role">ผู้อนุมัติ (Manager)</div>
              <div class="sig-name">${b.approverName || '-'}</div>
              <div class="sig-time">เวลาอนุมัติ: <br><strong>${b.approvalDate ? formatThaiDate(b.approvalDate) : '-'}</strong></div>
            </div>
            <div class="sig-box">
              <div class="sig-role">ผู้จ่ายกุญแจ (Admin)</div>
              <div class="sig-name">${b.keyIssuedBy || '-'}</div>
              <div class="sig-time">เวลาจ่ายกุญแจ: <br><strong>${b.handoverTime ? formatThaiDate(b.handoverTime) : '-'}</strong></div>
            </div>
          </div>

          <div class="signature-grid" style="margin-top: 20px;">
            <div class="sig-box">
              <div class="sig-role">ผู้คืนรถ / คืนกุญแจ</div>
              <div class="sig-name">${b.returnDate ? (b.userName || '-') : '-'}</div>
              <div class="sig-time">เวลาคืนรถในระบบ: <br><strong>${b.returnDate ? formatThaiDate(b.returnDate) : '-'}</strong></div>
            </div>
            <div class="sig-box" style="grid-column: 3;">
              <div class="sig-role">ผู้รับกุญแจคืน (Admin)</div>
              <div class="sig-name">${b.keyReceivedBy || '-'}</div>
              <div class="sig-time">เวลารับคืนกุญแจ: <br><strong>${b.keyReceivedAt ? formatThaiDate(b.keyReceivedAt) : '-'}</strong></div>
            </div>
          </div>
        </div>

      </div>
    </body>
    </html>
    `;
    return html;
  } catch (err) {
    return "<h2 style='color:red; text-align:center;'>Error: " + err.message + "</h2>";
  }
}

// ==========================================
// 📄 ฟังก์ชันสร้างหน้า HTML สำหรับพิมพ์ใบแจ้งซ่อม (ย้ายมาจาก React)
// ==========================================
function createMaintenanceHTMLPdf(reqId) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    
    // 1. ฟังก์ชันตัวช่วยดึงข้อมูลจากชีต
    function getRowData(sheetName, idColIndex, idValue) {
      try {
        var sheet = ss.getSheetByName(sheetName);
        if(!sheet) return null;
        var data = sheet.getDataRange().getValues();
        var headers = data[0];
        for (var i = 1; i < data.length; i++) {
          if (String(data[i][idColIndex]) === String(idValue)) {
            var obj = {};
            for (var j = 0; j < headers.length; j++) { obj[headers[j]] = data[i][j]; }
            return obj;
          }
        }
      } catch(e) {}
      return null;
    }

    // 2. ดึงข้อมูลที่เกี่ยวข้อง (เปลี่ยนชื่อชีตให้ตรงกับของคุณได้เลยนะคะ)
    var req = getRowData('Maintenance', 0, reqId) || getRowData('MaintenanceRecords', 0, reqId); 
    if (!req) return "<h2 style='text-align:center; padding: 50px; font-family: sans-serif;'>❌ ไม่พบข้อมูลการแจ้งซ่อมรหัสนี้</h2>";

    var vhc = getRowData('Vehicles', 0, req.vehicleId);
    var proj = req.projectId ? getRowData('Projects', 0, req.projectId) : null;
    var usr = req.requesterId ? getRowData('Users', 0, req.requesterId) : null;

    // 3. เตรียมตัวแปร
    var isCar = vhc ? (String(vhc.type).toLowerCase() !== "motorcycle") : true;
    var rName = (usr ? usr.name : req.requesterName) || "-";
    var rPos = (usr ? usr.role : "-") || "-";
    var rEmp = (usr ? usr.employeeId : "-") || "-";
    var rDept = (usr ? usr.department : req.department) || "-";
    var rPhone = (usr ? usr.phone : "-") || "-";
    
    var aName = req.approverName || "........................................";
    var aSig = req.approverSignature || "";
    var rSig = req.reqSign || req.requesterSignature || "";
    
    var cMil = (req.currentMileage) ? Number(req.currentMileage).toLocaleString() : "-";
    var fDate = req.date ? new Date(req.date).toLocaleDateString("th-TH", {year:"numeric", month:"short", day:"numeric"}) : "-";
    var pCode = proj ? (proj.code ? (proj.code + " " + proj.name) : proj.name) : "-";

    var html = `
    <!DOCTYPE html>
    <html lang="th">
    <head>
      <meta charset="UTF-8">
      <title>ใบแจ้งซ่อม - ${req.id}</title>
      <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap" rel="stylesheet">
      <style>
        body { font-family: 'Sarabun', sans-serif; background: #525659; margin: 0; padding: 20px; color: #000; font-size: 14px; line-height: 1.5; }
        .print-btn-container { display: flex; justify-content: center; gap: 15px; margin-bottom: 20px; position: sticky; top: 20px; z-index: 100; }
        .print-btn { background: #2563eb; color: white; border: none; padding: 10px 24px; border-radius: 8px; font-size: 16px; font-weight: bold; cursor: pointer; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
        .close-btn { background: #4b5563; color: white; border: none; padding: 10px 24px; border-radius: 8px; font-size: 16px; font-weight: bold; cursor: pointer; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
        .print-btn:hover { background: #1d4ed8; } .close-btn:hover { background: #374151; }
        .a4-page { background: white; width: 210mm; min-height: 297mm; padding: 15mm; box-shadow: 0 10px 25px rgba(0,0,0,0.2); margin: 0 auto; box-sizing: border-box; }
        .header { display: flex; justify-content: space-between; border-bottom: 3px solid #000; padding-bottom: 15px; margin-bottom: 20px; }
        .header h1 { color: #b91c1c; font-size: 28px; margin: 0; font-weight: 900; letter-spacing: 1px; }
        .header h2 { font-size: 16px; margin: 5px 0; }
        .header p { font-size: 12px; margin: 2px 0; }
        .title-box { border: 2px solid #000; padding: 10px 20px; border-radius: 8px; font-size: 18px; font-weight: bold; margin-top: 10px; display: inline-block; }
        .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 20px; margin-bottom: 20px; }
        .box { border: 1px solid #000; padding: 15px; margin-bottom: 25px; }
        .check-group { display: flex; gap: 30px; font-weight: bold; margin-bottom: 15px; }
        .section-title { font-weight: bold; text-decoration: underline; margin-bottom: 10px; font-size: 15px; }
        .sign-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; text-align: center; margin-top: 60px; }
        .sign-img { height: 60px; object-fit: contain; margin-bottom: 10px; }
        .sign-line { border-bottom: 1px dotted #000; display: inline-block; width: 80%; margin-bottom: 5px; }
        .footer { margin-top: 50px; padding-top: 15px; border-top: 1px solid #ccc; font-size: 12px; color: #666; display: flex; justify-content: space-between; }
        @media print {
          body { background: white; padding: 0; }
          .print-btn-container { display: none; }
          .a4-page { box-shadow: none; width: 100%; min-height: auto; padding: 0; margin: 0; }
          @page { size: A4; margin: 15mm; }
        }
      </style>
    </head>
    <body>
      <div class="print-btn-container">
        <button class="close-btn" onclick="window.close(); window.history.back();">⬅️ ปิดหน้านี้</button>
        <button class="print-btn" onclick="window.print()">🖨️ สั่งพิมพ์ใบขออนุมัติ</button>
      </div>

      <div class="a4-page">
        <div class="header">
          <div>
            <h1>AMR ASIA</h1>
            <h2>บริษัท เอเอ็มอาร์ เอเซีย จำกัด (มหาชน)</h2>
            <p>469 ซอยประวิทย์และเพื่อน ถนนประชาชื่น<br>แขวงลาดยาว เขตจตุจักร กรุงเทพมหานคร 10900</p>
            <p>โทร. 0-2589-9955 แฟกซ์ 0-2591-7022</p>
            <p>เลขประจำตัวผู้เสียภาษี 0107564000090</p>
          </div>
          <div style="text-align: right;">
            <div class="title-box">ใบขออนุมัติบำรุงรักษารถยนต์และรถจักรยานยนต์</div>
          </div>
        </div>

        <div class="grid-2">
          <div><strong>ผู้ขอดำเนินการ:</strong> ${rName}</div>
          <div><strong>วันที่:</strong> ${fDate}</div>
          <div><strong>ตำแหน่ง:</strong> ${rPos}</div>
          <div><strong>รหัสโครงการ:</strong> ${pCode}</div>
          <div><strong>แผนก/ฝ่าย:</strong> ${rDept}</div>
          <div><strong>รหัสพนักงาน:</strong> ${rEmp}</div>
          <div style="grid-column: span 2;"><strong>เบอร์ติดต่อ:</strong> ${rPhone}</div>
        </div>

        <div class="box">
          <div class="check-group">
            <label><input type="checkbox" ${isCar ? 'checked' : ''}> รถยนต์</label>
            <label><input type="checkbox" ${!isCar ? 'checked' : ''}> รถจักรยานยนต์</label>
          </div>
          <div class="grid-2">
            <div><strong>ยี่ห้อรถ:</strong> ${vhc ? (vhc.brand||'-') : '-'}</div>
            <div><strong>สีรถ:</strong> ${vhc ? (vhc.color||'-') : '-'}</div>
            <div><strong>เลขตัวถัง:</strong> ${vhc ? (vhc.vin||'-') : '-'}</div>
            <div><strong>ทะเบียนรถ:</strong> ${req.vehicleName || '-'}</div>
            <div style="grid-column: span 2;"><strong>เลขไมล์:</strong> ${cMil} กม.</div>
            <div style="grid-column: span 2; color: #b91c1c;"><strong>ศูนย์รับบริการ:</strong> ${req.serviceCenter || '-'}</div>
          </div>
        </div>

        <div class="grid-2" style="margin-bottom: 40px;">
          <div>
            <div class="section-title">1. เช็คระยะ</div>
            <ul style="list-style: none; padding-left: 10px; line-height: 1.8;">
              <li><input type="checkbox" ${(req.type==='Maintenance' && req.maintenanceType==='Checkup') ? 'checked' : ''}> เช็คระยะ</li>
              <li><input type="checkbox"> เคลือบสี</li>
              <li><input type="checkbox"> พ่นสีกันสนิม</li>
              <li><input type="checkbox" ${(req.type==='Maintenance' && req.maintenanceType==='Other') ? 'checked' : ''}> อื่นๆ (ระบุ) ${(req.type==='Maintenance' && req.maintenanceType==='Other') ? (req.description||'') : ''}</li>
            </ul>
            <div style="margin-top: 10px;"><strong>หมายเหตุ:</strong> ${req.type==='Maintenance' ? (req.remark||'-') : '-'}</div>
          </div>
          <div>
            <div class="section-title">2. รายการความเสียหาย</div>
            <div style="min-height: 100px;">${req.type==='Repair' ? (req.description||'-') : '-'}</div>
            <div style="margin-top: 10px;"><strong>หมายเหตุ:</strong> ${req.type==='Repair' ? (req.remark||'-') : '-'}</div>
          </div>
        </div>

        <div class="sign-grid">
          <div>
            <div style="height: 70px; display: flex; align-items: flex-end; justify-content: center; margin-bottom: 5px;">
              ${rSig ? `<img src="${rSig}" class="sign-img">` : '<span style="color:#ccc; font-style:italic;">ยังไม่ได้เซ็นชื่อ</span>'}
            </div>
            <div class="sign-line">( ${rName} )</div>
            <div>ผู้ขอดำเนินการ</div>
          </div>
          <div>
            <div style="height: 70px; display: flex; align-items: flex-end; justify-content: center; margin-bottom: 5px;">
              ${(req.status==='Approved' || req.status==='Completed') 
                ? (aSig ? `<img src="${aSig}" class="sign-img">` : '<span style="color:green; font-weight:bold; border:1px solid green; padding:2px 10px; border-radius:4px;">อนุมัติผ่านระบบแล้ว</span>') 
                : '<span style="color:#ccc; font-style:italic;">รอการอนุมัติ</span>'}
            </div>
            <div class="sign-line">( ${aName} )</div>
            <div>ผู้อนุมัติ</div>
          </div>
        </div>

        <div class="footer">
          <span>Internal Use Only</span>
          <span>F-AS-013/02</span>
        </div>
      </div>
    </body>
    </html>
    `;
    return html;
  } catch (err) {
    return "<h2 style='color:red; text-align:center;'>Error: " + err.message + "</h2>";
  }
}