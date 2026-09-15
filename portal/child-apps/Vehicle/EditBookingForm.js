// ==========================================
// ✏️ ฟังก์ชันสร้างหน้าเว็บสำหรับแก้ไขการจอง (แก้ไขได้ทุกช่อง)
// ==========================================
// portalToken: มาจากลิงก์ "แก้ไข" ที่ ReactApp.html แนบ window.PORTAL.token ไว้ให้
// (สิทธิ์เข้าดูฟอร์มนี้ — owner หรือ admin/manager — ถูกเช็คแล้วที่ doGet ก่อนเรียก
// ฟังก์ชันนี้ (Main.js), ที่นี่แค่ต้องส่ง token เดิมต่อเข้าไปในฟอร์มเพื่อใช้ตอน Save)
function createEditFormHTML(reqId, portalToken) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var scriptUrl = ScriptApp.getService().getUrl();
    var sheet = ss.getSheetByName('Bookings');
    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var bk = null;

    // 1. ค้นหาข้อมูลการจองปัจจุบัน
    for(var i=1; i<data.length; i++) {
      if(String(data[i][headers.indexOf('id')]) === String(reqId)) {
        bk = {};
        for(var j=0; j<headers.length; j++) bk[headers[j]] = data[i][j];
        break;
      }
    }
    if(!bk) return "<h2 style='text-align:center; padding: 50px; font-family: sans-serif;'>❌ ไม่พบข้อมูลการจองรหัสนี้</h2>";
    if(bk.status !== 'Pending') return "<h2 style='text-align:center; padding: 50px; font-family: sans-serif; color: red;'>❌ การจองนี้ไม่สามารถแก้ไขได้แล้ว (สถานะ: " + bk.status + ")</h2>";

    // 2. จัดการ Format วันที่
    var sDateStr = "";
    if (bk.startDate) {
      var d1 = new Date(bk.startDate);
      sDateStr = !isNaN(d1.getTime()) ? Utilities.formatDate(d1, Session.getScriptTimeZone(), "yyyy-MM-dd") : String(bk.startDate).split('T')[0];
    }
    var eDateStr = "";
    if (bk.endDate) {
      var d2 = new Date(bk.endDate);
      eDateStr = !isNaN(d2.getTime()) ? Utilities.formatDate(d2, Session.getScriptTimeZone(), "yyyy-MM-dd") : String(bk.endDate).split('T')[0];
    }

    // 3. ดึงรายชื่อโครงการมาทำ Dropdown
    var pSheet = ss.getSheetByName('Projects');
    var pData = pSheet ? pSheet.getDataRange().getValues() : [];
    var pHeaders = pData[0] || [];
    var projOptions = '<option value="">-- เลือกโครงการ --</option>';
    for(var i=1; i<pData.length; i++){
      var pId = pData[i][pHeaders.indexOf('id')];
      var pName = pData[i][pHeaders.indexOf('name')];
      var pCode = pData[i][pHeaders.indexOf('code')];
      var pStatus = pData[i][pHeaders.indexOf('status')];
      if (pStatus === 'Active' || String(pId) === String(bk.projectId)) { // แสดงเฉพาะ Active หรืออันที่เคยเลือกไว้
        var sel = (String(pId) === String(bk.projectId)) ? 'selected' : '';
        projOptions += '<option value="'+pId+'" '+sel+'>'+pName+' ('+pCode+')</option>';
      }
    }

    // 4. ดึงรายชื่อรถมาทำ Dropdown
    var vSheet = ss.getSheetByName('Vehicles');
    var vData = vSheet ? vSheet.getDataRange().getValues() : [];
    var vHeaders = vData[0] || [];
    var vhcOptions = '<option value="">-- เลือกรถ --</option>';
    for(var i=1; i<vData.length; i++){
      var vId = vData[i][vHeaders.indexOf('id')];
      var vPlate = vData[i][vHeaders.indexOf('licensePlate')];
      var vBrand = vData[i][vHeaders.indexOf('brand')];
      var sel = (String(vId) === String(bk.vehicleId)) ? 'selected' : '';
      vhcOptions += '<option value="'+vId+'" '+sel+'>'+vPlate+' - '+vBrand+'</option>';
    }

    var html = `
    <!DOCTYPE html>
    <html lang="th">
    <head>
      <meta charset="UTF-8">
      <title>แก้ไขแบบฟอร์มขอใช้รถ</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap" rel="stylesheet">
      <style>
        body { font-family: 'Sarabun', sans-serif; background-color: rgba(0,0,0,0.6); margin: 0; }
        .input-style { width: 100%; border: 1px solid #d1d5db; border-radius: 0.5rem; padding: 0.625rem; outline: none; background: white; color: #111827; }
        .input-style:focus { border-color: #ef4444; box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.2); }
        .disabled-style { width: 100%; border: 1px solid #e5e7eb; border-radius: 0.5rem; padding: 0.625rem; background: #f3f4f6; color: #6b7280; cursor: not-allowed; }
      </style>
    </head>
    <body class="flex items-center justify-center min-h-screen p-4 backdrop-blur-sm">
      <div class="bg-white w-full max-w-4xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">

        <div class="bg-[#d51929] p-6 text-white flex justify-between items-center shrink-0">
          <div>
            <h3 class="text-2xl font-bold">แบบฟอร์มขอใช้รถ (โหมดแก้ไข)</h3>
            <p class="text-red-100 text-sm">รหัสการจอง: ${bk.id}</p>
          </div>
          <a href="${scriptUrl}" target="_top" class="text-white/80 hover:text-white text-3xl font-bold leading-none no-underline">&times;</a>
        </div>

        <div class="p-6 overflow-y-auto flex-1 bg-gray-50">
          <div class="space-y-6">

            ${bk.adminNote ? `
            <div class="bg-orange-50 border-l-4 border-orange-500 p-4 rounded-r-lg shadow-sm">
              <p class="text-sm text-orange-800 font-bold flex items-center gap-2"><span>💬</span> ข้อความแจ้งเตือนจากแอดมิน:</p>
              <p class="text-sm text-orange-700 mt-1">${bk.adminNote}</p>
            </div>` : ''}

            <section class="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
              <div class="flex items-center gap-2 mb-4 border-b pb-2">
                <div class="w-8 h-8 rounded-full bg-red-100 text-red-600 flex items-center justify-center font-bold">1</div>
                <h4 class="text-lg font-bold text-gray-800">ข้อมูลผู้ขอใช้และโครงการ</h4>
              </div>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label class="block text-xs font-semibold text-gray-500 uppercase mb-1">ชื่อผู้ขอ (แก้ไขไม่ได้)</label>
                  <input disabled value="${bk.userName || ''}" class="disabled-style">
                </div>
                <div>
                  <label class="block text-xs font-semibold text-gray-700 uppercase mb-1">เลือกโครงการ <span class="text-red-500">*</span></label>
                  <select id="projSelect" class="input-style">${projOptions}</select>
                </div>
              </div>
            </section>

            <section class="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
              <div class="flex items-center gap-2 mb-4 border-b pb-2">
                <div class="w-8 h-8 rounded-full bg-red-100 text-red-600 flex items-center justify-center font-bold">2</div>
                <h4 class="text-lg font-bold text-gray-800">รายละเอียดการเดินทาง</h4>
              </div>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">วันที่เริ่ม <span class="text-red-500">*</span></label>
                  <input type="date" id="sDate" class="input-style" value="${sDateStr}">
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">วันที่สิ้นสุด <span class="text-red-500">*</span></label>
                  <input type="date" id="eDate" class="input-style" value="${eDateStr}">
                </div>
              </div>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">เวลารับรถ <span class="text-red-500">*</span></label>
                  <input type="time" id="sTime" class="input-style" value="${bk.pickupTime||'08:00'}">
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">เวลาคืนรถ <span class="text-red-500">*</span></label>
                  <input type="time" id="eTime" class="input-style" value="${bk.returnTime||'17:00'}">
                </div>
              </div>

              <div class="mb-4">
                <label class="block text-sm font-medium text-gray-700 mb-1">เลือกยานพาหนะ <span class="text-red-500">*</span></label>
                <select id="vhcSelect" class="input-style">${vhcOptions}</select>
              </div>

              <div class="mb-4">
                <label class="block text-sm font-medium text-gray-700 mb-1">สถานที่ปลายทาง <span class="text-red-500">*</span></label>
                <input type="text" id="dest" class="input-style" value="${bk.destination || ''}">
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">วัตถุประสงค์การใช้งาน <span class="text-red-500">*</span></label>
                <textarea id="purpose" class="input-style" rows="2">${bk.purpose || ''}</textarea>
              </div>
            </section>

            <div class="flex justify-end gap-3 pt-4">
              <a href="${scriptUrl}" target="_top" class="px-6 py-3 rounded-xl text-gray-600 font-medium hover:bg-gray-100 no-underline inline-block text-center">ยกเลิก</a>
              <button onclick="saveData()" id="saveBtn" class="px-8 py-3 bg-[#d51929] text-white rounded-xl font-bold shadow-lg shadow-red-500/30 hover:bg-red-700 transition-all">บันทึกการแก้ไข</button>
            </div>

          </div>
        </div>
      </div>

      <script>
        var PORTAL_TOKEN = ${JSON.stringify(portalToken || '')};

        function saveData() {
          var btn = document.getElementById('saveBtn');
          btn.innerText = "กำลังบันทึก..."; btn.disabled = true;

          var pSel = document.getElementById('projSelect');
          var vSel = document.getElementById('vhcSelect');

          var data = {
            id: "${bk.id}",
            projectId: pSel.value,
            projectName: pSel.options[pSel.selectedIndex].text.split(' (')[0], // ตัดรหัสโครงการออกเอาแต่ชื่อ
            vehicleId: vSel.value,
            vehicleName: vSel.options[vSel.selectedIndex].text.split(' - ')[0], // ตัดเอาแค่ป้ายทะเบียน
            purpose: document.getElementById('purpose').value,
            dest: document.getElementById('dest').value,
            sDate: document.getElementById('sDate').value,
            sTime: document.getElementById('sTime').value,
            eDate: document.getElementById('eDate').value,
            eTime: document.getElementById('eTime').value
          };

          google.script.run.withSuccessHandler(function(res){
            document.body.innerHTML = "<div class='flex items-center justify-center min-h-screen p-4'><div class='bg-white p-8 rounded-2xl shadow-xl text-center'><h2 class='text-2xl font-bold text-green-600 mb-2'>✅ บันทึกสำเร็จ!</h2><p class='text-gray-600 mb-4'>กำลังกลับหน้าหลัก...</p></div></div>";

            setTimeout(function() {
              window.top.location.href = "${scriptUrl}";
            }, 1500);

          }).withFailureHandler(function(err){
            alert('บันทึกไม่สำเร็จ: ' + (err && err.message || err));
            btn.innerText = "บันทึกการแก้ไข"; btn.disabled = false;
          }).saveBookingEditFromHTML(PORTAL_TOKEN, data);
        }

      </script>
    </body>
    </html>
    `;
    return html;
  } catch (err) { return "Error: " + err.message; }
}

// ==========================================
// 💾 ตัวช่วย: บันทึกข้อมูลที่แก้ไขจากหน้า Edit Form (รองรับทุกฟิลด์)
// ==========================================
function saveBookingEditFromHTML(portalToken, data) {
  // เช็คสิทธิ์นอก try/catch ด้านล่างตั้งใจ — ต้องการให้ throw หลุดออกไปจริงๆ
  // เพื่อให้ withFailureHandler ฝั่งหน้าเว็บ (EditBookingForm's saveData()) ทำงาน
  // ไม่ใช่ถูก catch(e){} กลืนแล้วคืนค่า "Error" แบบเงียบๆ เหมือน error อื่นในฟังก์ชันนี้
  var access = portalAccessForCall(portalToken, PORTAL_MENU_ID);
  if (!access.ok) throw new Error(access.message);

  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Bookings');
    var sheetData = sheet.getDataRange().getValues();
    var headers = sheetData[0];

    var idCol = headers.indexOf('id');
    var userIdCol = headers.indexOf('userId');
    var userEmailCol = headers.indexOf('userEmail');
    var pIdCol = headers.indexOf('projectId');
    var pNameCol = headers.indexOf('projectName');
    var vIdCol = headers.indexOf('vehicleId');
    var vNameCol = headers.indexOf('vehicleName');
    var purposeCol = headers.indexOf('purpose');
    var destCol = headers.indexOf('destination');
    var sDateCol = headers.indexOf('startDate');
    var sTimeCol = headers.indexOf('pickupTime');
    var eDateCol = headers.indexOf('endDate');
    var eTimeCol = headers.indexOf('returnTime');
    var noteCol = headers.indexOf('adminNote');

    for(var i=1; i<sheetData.length; i++){
      if(String(sheetData[i][idCol]) === String(data.id)){
        // 🔒 เจ้าของ booking เองหรือ admin/manager เท่านั้น (เดิมเช็คแค่สถานะ Pending
        // ใครมี booking id ก็แก้แทนคนอื่นได้)
        var bookingRow = {};
        headers.forEach(function(h, ci) { bookingRow[h] = sheetData[i][ci]; });
        if (!isAdminish(access) && !_isBookingOwner_(access, bookingRow)) {
          throw new Error("ไม่มีสิทธิ์แก้ไขการจองนี้");
        }

        // อัปเดตข้อมูลทั้งหมดกลับลง Sheet
        if(pIdCol > -1) sheet.getRange(i+1, pIdCol+1).setValue(data.projectId);
        if(pNameCol > -1) sheet.getRange(i+1, pNameCol+1).setValue(data.projectName);
        if(vIdCol > -1) sheet.getRange(i+1, vIdCol+1).setValue(data.vehicleId);
        if(vNameCol > -1) sheet.getRange(i+1, vNameCol+1).setValue(data.vehicleName);
        if(purposeCol > -1) sheet.getRange(i+1, purposeCol+1).setValue(data.purpose);
        if(destCol > -1) sheet.getRange(i+1, destCol+1).setValue(data.dest);
        if(sDateCol > -1) sheet.getRange(i+1, sDateCol+1).setValue(data.sDate);
        if(sTimeCol > -1) sheet.getRange(i+1, sTimeCol+1).setValue(data.sTime);
        if(eDateCol > -1) sheet.getRange(i+1, eDateCol+1).setValue(data.eDate);
        if(eTimeCol > -1) sheet.getRange(i+1, eTimeCol+1).setValue(data.eTime);

        if(noteCol > -1) sheet.getRange(i+1, noteCol+1).setValue(""); // ล้าง Note เก่าทิ้ง
        return "Success";
      }
    }
  } catch(e) { throw e; } // ปล่อยให้หลุดออกไปจริง (เช่น ปฏิเสธสิทธิ์) แทนที่จะกลืนเงียบๆ แบบเดิม
  return "Error";
}
