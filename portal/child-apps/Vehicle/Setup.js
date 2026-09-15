// ==========================================
// 🛠️ SYSTEM SETUP (รันเองจากหน้า Editor)
// ==========================================

function setupSheets() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  
  const definitions = {
      'Vehicles': ['id', 'licensePlate', 'brand', 'model', 'type', 'status', 'currentMileage', 'imageUrl', 'nextServiceMileage', 'taxExpiryDate', 'registrationDate', 'vin', 'gasCard', 'color'],
      'Users': ['id', 'employeeId', 'name', 'email', 'role', 'department', 'password', 'phone'],
      'Projects': ['id', 'code', 'name', 'ownerId', 'status', 'memberIds'],
      'Bookings': ['id', 'userId', 'userName', 'vehicleId', 'vehicleName', 'projectId', 'projectName', 'startDate', 'endDate', 'pickupTime', 'purpose', 'destination', 'status', 'startMileage', 'endMileage', 'preTripChecklist', 'rejectionReason', 'approverId', 'approverName', 'handoverTime', 'returnDate', 'distanceUsed', 'returnCondition', 'returnNote'],
      'Maintenance': ['id', 'vehicleId', 'vehicleName', 'requesterId', 'requesterName', 'type', 'serviceCenter', 'description', 'date', 'finalCost', 'status', 'maintenanceType', 'repairItems', 'rejectionReason', 'completionDate', 'resultDetails'],
      'FuelRecords': ['id', 'bookingId', 'vehicleId', 'date', 'odometer', 'liters', 'pricePerLiter', 'totalCost', 'receiptId', 'driverName', 'vehiclePlate', 'projectName']
  };

  Object.keys(definitions).forEach(name => {
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      sheet.appendRow(definitions[name]);
      if(sheet.getMaxColumns() > definitions[name].length) {
         sheet.deleteColumns(definitions[name].length + 1, sheet.getMaxColumns() - definitions[name].length);
      }
    }
  });
}

/**
 * ⚙️ ฟังก์ชันบันทึกการตั้งค่าระบบลง Sheet 'Settings'
 * รองรับ: alertThreshold, vehicleTypes, serviceCentersList, carServiceGap, motoServiceGap
 */
function updateSettings(newSettings) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('Settings');
    
    // ถ้ายังไม่มี Sheet Settings ให้สร้างใหม่
    if (!sheet) {
      sheet = ss.insertSheet('Settings');
      sheet.appendRow(['setting_name', 'setting_value']);
    }

    var data = sheet.getDataRange().getValues();
    
    // กรณีโครงสร้างเดิมของคุณบันทึกเป็น JSON ในแถวที่ 1 คอลัมน์ที่ 2 (B1)
    sheet.getRange(1, 2).setValue(JSON.stringify(newSettings));

    return { status: "SUCCESS", message: "บันทึกการตั้งค่าเรียบร้อยแล้ว" };
  } catch (e) {
    console.error("Update Settings Error: ", e.message);
    return { status: "ERROR", message: e.message };
  }
}

// รันฟังก์ชันนี้ 1 ครั้งเพื่อล้างค่าเก่าและใช้ค่าใหม่จาก getDefaultSettings
function resetSettingsToDefault() {
  var newSet = getDefaultSettings();
  updateSettings(newSet);
  console.log("✅ อัปเดตโครงสร้าง Settings ใหม่เรียบร้อย!");
}

/**
 * 🔍 ฟังก์ชันดึงการตั้งค่า (สำหรับเรียกใช้ตอนโหลดหน้าเว็บ)
 */
function getSettings() {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Settings');
    if (!sheet) return getDefaultSettings();
    
    var val = sheet.getRange(1, 2).getValue();
    return val ? JSON.parse(val) : getDefaultSettings();
  } catch (e) {
    return getDefaultSettings();
  }
}

function getDefaultSettings() {
  return {
    alertThreshold: 500,
    vehicleTypes: ["Car", "Truck", "Motorcycle"],
    serviceCentersList: ["ศูนย์บริการมาตรฐาน"],
    carServiceGap: 10000,
    motoServiceGap: 4500,
    // โทเคนถูกถอดออกจากซอร์ส 11 ก.ย. 2026 — ของเดิมเป็น plaintext ในไฟล์นี้
    // ต้องเพิกถอนที่ LINE Developers Console ด้วย ไฟล์นี้ไม่ใช่ที่เดียวที่มันอยู่
    lineMessagingToken: "",
    lineTargetCar: "7272b5b4-ace4-43a8-a1e6-231b7a51c08c",    
    lineTargetMoto: "ae0566f4-ba65-42a2-a598-008ab8cf88c9"
  };
}

function debugMySettings() {
  const settings = getSettings();
  Logger.log("Token: " + (settings.lineMessagingToken ? "มีข้อมูล" : "ว่างเปล่า"));
  Logger.log("Target IDs: " + JSON.stringify(settings.lineTargetIds));
  Logger.log("Type of Target IDs: " + typeof settings.lineTargetIds);
}

function forceUpdateLineSettings() {
  // 1. กำหนดค่าที่เราต้องการอัปเดต (ใส่ค่าจริงของคุณลงในนี้)
  const myNewSettings = {
    alertThreshold: 500,
    vehicleTypes: ["Car", "Truck", "Motorcycle"],
    serviceCentersList: ["ศูนย์บริการมาตรฐาน"],
    carServiceGap: 10000,
    motoServiceGap: 4500,
    // โทเคนถูกถอดออกจากซอร์ส 11 ก.ย. 2026 — ของเดิมเป็น plaintext ในไฟล์นี้
    // ต้องเพิกถอนที่ LINE Developers Console ด้วย ไฟล์นี้ไม่ใช่ที่เดียวที่มันอยู่
    lineMessagingToken: "", 
    lineTargetCar: "7272b5b4-ace4-43a8-a1e6-231b7a51c08c",    
    lineTargetMoto: "ae0566f4-ba65-42a2-a598-008ab8cf88c9"};

  // 2. สั่งบันทึกลงชีต Settings ทันที
  const res = updateSettings(myNewSettings);
  
  if (res.status === "SUCCESS") {
    Logger.log("✅ บันทึกค่าใหม่ลงชีต Settings สำเร็จแล้ว!");
    Logger.log("ข้อมูลที่บันทึก: " + JSON.stringify(myNewSettings));
  } else {
    Logger.log("❌ เกิดข้อผิดพลาด: " + res.message);
  }
}