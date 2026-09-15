// ==========================================
// 💦 ดึงข้อมูลและสร้างหน้าเว็บล้างรถ (Master Version)
// ==========================================
function createCarWashHTML(portalToken) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Vehicles');
    var data = sheet.getDataRange().getValues();
    // 🟢 Surgical Check: ตัดช่องว่างหัวตารางป้องกัน Error จากการพิมพ์ใน Sheet
    var headers = data[0].map(function(h) { return String(h).trim(); });

    var vehicles = [];

    // ค้นหา Index ของคอลัมน์ที่จำเป็น
    var idCol = headers.indexOf('id');
    var plateCol = headers.indexOf('licensePlate');
    var brandCol = headers.indexOf('brand');
    var lwDateCol = headers.indexOf('lastWashDate');
    var lwPhotoCol = headers.indexOf('lastWashPhoto');
    var statusCol = headers.indexOf('status');
    var respCol = headers.indexOf('responsibleName');

    for(var i=1; i<data.length; i++) {
      // แสดงเฉพาะรถที่สถานะไม่ใช่ Inactive
      if(String(data[i][statusCol]) !== 'Inactive') {

        // จัดการค่าผู้รับผิดชอบ (ถ้าหาคอลัมน์ไม่เจอให้ใส่ "ไม่ระบุ")
        var respValue = (respCol > -1) ? data[i][respCol] : "ไม่ระบุ";
        if (!respValue || respValue === "") respValue = "ไม่ระบุ";

        vehicles.push({
          id: data[i][idCol],
          plate: data[i][plateCol],
          brand: data[i][brandCol],
          lastWash: lwDateCol > -1 ? data[i][lwDateCol] : '',
          photo: lwPhotoCol > -1 ? data[i][lwPhotoCol] : '',
          responsible: respValue
        });
      }
    }

    var template = HtmlService.createTemplateFromFile('CarWashUI');
    template.vehiclesData = JSON.stringify(vehicles);
    template.scriptUrl = ScriptApp.getService().getUrl();
    template.portalToken = portalToken || '';
    return template.evaluate().getContent();

  } catch (err) {
    console.error("createCarWashHTML Error: " + err.message);
    return "Error: " + err.message;
  }
}

// ==========================================
// 💦 บันทึกรูปล้างรถลง Drive และอัปเดต Sheet
// ==========================================
function saveCarWashRecord(portalToken, vId, dateVal, base64Data, fileName, mimeType) {
  try {
    var access = portalAccessForCall(portalToken, PORTAL_MENU_ID);
    if (!access.ok) return "Error: " + access.message;
    if (!canWrite(access)) return "Error: สิทธิ์ไม่พอ";

    var photoUrl = "";

    if (base64Data) {
      var folders = DriveApp.getFoldersByName("CarWashPhotos");
      var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder("CarWashPhotos");

      var blob = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType, "Wash_" + vId + "_" + dateVal);
      var file = folder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      // คงรูปแบบ URL เดิมตามที่ตกลงกันใน Q2
      photoUrl = "https://drive.google.com/uc?export=view&id=" + file.getId();
    }

    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Vehicles');
    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var idCol = headers.indexOf('id');
    var lwDateCol = headers.indexOf('lastWashDate');
    var lwPhotoCol = headers.indexOf('lastWashPhoto');

    for(var i=1; i<data.length; i++){
      if(String(data[i][idCol]) === String(vId)){
        if(lwDateCol > -1) sheet.getRange(i+1, lwDateCol+1).setValue(dateVal);
        if(lwPhotoCol > -1 && photoUrl !== "") sheet.getRange(i+1, lwPhotoCol+1).setValue(photoUrl);
        return "Success";
      }
    }
  } catch(e) {
    console.error("saveCarWashRecord Error: " + e.message);
    return "Error: " + e.message;
  }
}
