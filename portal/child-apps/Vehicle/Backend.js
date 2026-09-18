// ==========================================
// 🔌 BACKEND API (หน้าเว็บเรียกใช้ไฟล์นี้)
// ==========================================

// ── ตัวช่วย: หาผู้ใช้ในชีต Users ของแอปนี้จากอีเมลที่ Hub ยืนยันแล้ว ──
// ใช้แทนการเชื่อ userId/userName/adminName ที่ client ส่งมาเอง ทุกจุดที่ต้อง
// บันทึกว่า "ใครเป็นคนทำ" ให้ดึงจากตรงนี้เสมอ ไม่ใช่จากพารามิเตอร์ของ client
function _findVehicleUserByEmail_(email) {
  if (!email) return null;
  var users = getDataFromSheet('Users');
  var target = String(email).trim().toLowerCase();
  for (var i = 0; i < users.length; i++) {
    if (String(users[i].email || '').trim().toLowerCase() === target) return users[i];
  }
  return null;
}

// เจ้าของ booking นี้หรือไม่ (เทียบทั้ง userId และ email ของผู้ใช้ในชีต Users
// เพราะข้อมูลเก่าบางแถวอาจมีแค่ userId ไม่มี email ผูกไว้)
function _isBookingOwner_(access, booking) {
  if (!booking) return false;
  var u = _findVehicleUserByEmail_(access.email);
  if (u && String(u.id) === String(booking.userId)) return true;
  if (booking.userEmail && String(booking.userEmail).trim().toLowerCase() === String(access.email).trim().toLowerCase()) return true;
  return false;
}

function getInitialData(portalToken) {
  var access = portalAccessForCall(portalToken, PORTAL_MENU_ID);
  if (!access.ok) throw new Error(access.message || 'ไม่มีสิทธิ์เข้าถึงข้อมูลนี้');
  try {
    Logger.log('Fetching REAL data...');

    // 1. ดึงข้อมูล
    var vehicles = getDataFromSheet('Vehicles');
    var users = getDataFromSheet('Users');
    var projects = getDataFromSheet('Projects');
    var bookings = getDataFromSheet('Bookings');
    var maintenance = getDataFromSheet('Maintenance');
    var fuelRecords = getDataFromSheet('FuelRecords');

    // 🔒 เลิกส่งรหัสผ่านให้ browser — login ย้ายไปที่ OMA Portal (Hub) แล้ว
    // ฟิลด์นี้ไม่มีประโยชน์อีกต่อไปฝั่ง client (เดิมใช้เทียบรหัสผ่านตอน login เอง)
    users = users.map(function(u) {
      var copy = {};
      Object.keys(u).forEach(function(k) { if (k !== 'password') copy[k] = u[k]; });
      return copy;
    });

    // สร้าง Map สำหรับค้นหารถ (สำรอง)
    var vehicleMap = {};
    vehicles.forEach(function(v) { vehicleMap[v.id] = v; });

    // ============================================
    // 🛠️ MAINTENANCE FIXER (เวอร์ชันแก้ไขใหม่ ไม่ทำลาย ID)
    // ============================================
    maintenance = maintenance.map(function(item) {
      // 1. ซ่อม repairItems
      var items = [];
      try {
        if (item.repairItems && typeof item.repairItems === 'string' && item.repairItems.trim().startsWith('[')) {
          items = JSON.parse(item.repairItems);
        } else if (item.repairItems && item.repairItems.trim() !== '') {
          items = [{ name: item.repairItems, cost: 0, quantity: 1 }];
        }
      } catch (e) { items = []; }

      items = items.map(function(subItem) {
        if (typeof subItem === 'string') {
          return { name: subItem, cost: 0, quantity: 1 };
        }
        var safeCost = Number(subItem.cost || subItem.price || 0) || 0;
        return {
          name: subItem.name || 'รายการไม่ระบุ',
          cost: safeCost,
          quantity: Number(subItem.quantity || 1) || 1
        };
      });
      item.repairItems = JSON.stringify(items);

      // 2. ซ่อมวันที่
      if (item.date) {
        var d = new Date(item.date);
        if (!isNaN(d.getTime())) {
          item.date = d.toISOString();
        } else {
          item.date = new Date().toISOString();
        }
      } else {
        item.date = new Date().toISOString();
      }

      // 3. จัดการรายละเอียดไม่ให้ขึ้นบรรทัดใหม่จนพัง
      if (item.resultDetails) {
        item.resultDetails = item.resultDetails.replace(/\r\n|\r|\n/g, ' ');
      }

      var typeStr = "ซ่อมบำรุง";
      if (typeof item.type === 'string' && item.type) typeStr = item.type;
      item.type = typeStr;
      item.maintenanceType = typeStr;

      // 4. ซ่อมข้อมูลรถ
      var relatedVehicle = vehicleMap[item.vehicleId];
      if (relatedVehicle) {
        if (!item.vehicleName) item.vehicleName = relatedVehicle.brand + ' ' + relatedVehicle.model;
        if (!item.licensePlate) item.licensePlate = relatedVehicle.licensePlate;
      } else {
        if (!item.vehicleName) item.vehicleName = "รถนอกระบบ";
        if (!item.licensePlate) item.licensePlate = "-";
      }

      item.finalCost = Number(item.finalCost) || 0;
      if (!item.status) item.status = 'Pending';

      // เราจะไม่ delete requesterId หรือ projectId อีกต่อไป เพื่อให้หน้าเว็บเอาไป Map ชื่อได้ถูกต้อง
      return item;
    });

    // --- ส่วนตารางอื่นๆ ---
    vehicles = vehicles.map(function(v) {
      v.currentMileage = Number(v.currentMileage) || 0;
      v.nextServiceMileage = Number(v.nextServiceMileage) || 0;
      if (!v.status) v.status = 'Available';
      return v;
    });

    var scriptUrl = ScriptApp.getService().getUrl();
    var pt = encodeURIComponent(portalToken || '');

    bookings = bookings.map(function(b) {
      b.startMileage = Number(b.startMileage) || 0;
      b.endMileage = Number(b.endMileage) || 0;
      b.startDate = b.startDate || "";
      b.endDate = b.endDate || "";
      b.returnDate = b.returnDate || "";

      if (b.status === 'Completed' || b.status === 'Finished') {
        var isKeyReturned = (b.keyReturned && b.keyReturned.toString().toLowerCase() === 'yes');

        if (!isKeyReturned) {
          // confirmKey ตรวจด้วยลายเซ็น HMAC เสมอ (ไม่ใช่ portalToken) เพราะลิงก์เดียวกันนี้
          // ยังถูกส่งไปในอีเมลด้วย (Notifications.js) ซึ่งผู้รับไม่มี portal session — ใช้
          // ตัวเซ็นลิงก์ตัวเดียวกัน (_signVehicleActionUrl_ ใน Main.js) ให้สอดคล้องกันทั้งสองทาง
          var confirmLink = _signVehicleActionUrl_(scriptUrl, 'confirmKey', b.id);
          var btnText = "🔑 Admin: กดยืนยันรับกุญแจ";
          b.projectName = btnText;
          b.project = { name: btnText, code: confirmLink };
          b.vehicleName = "⚠️ รอคืนกุญแจ";
        } else {
          var pdfLink = scriptUrl + "?q=pdf&id=" + b.id + "&portalToken=" + pt;
          var btnText = "✅ ครบถ้วน | พิมพ์ใบงาน";
          b.projectName = btnText;
          b.project = { name: btnText, code: pdfLink };
        }
      }
      return b;
    });

    fuelRecords = fuelRecords.map(function(f) {
      f.liters = Number(f.liters) || 0;
      f.totalCost = Number(f.totalCost) || 0;
      f.odometer = Number(f.odometer) || 0;
      if(f.date) try { f.date = new Date(f.date).toISOString(); } catch(e){}
      else f.date = new Date().toISOString();
      return f;
    });

    projects = projects.map(function(p) {
      if(p.startDate) try { p.startDate = new Date(p.startDate).toISOString(); } catch(e){}
      if(p.endDate) try { p.endDate = new Date(p.endDate).toISOString(); } catch(e){}
      return p;
    });

    // ============================================
    // 🌟 currentUser — มาจากอีเมลที่ Hub ยืนยันแล้ว (access.email) ไม่ใช่
    // Session.getActiveUser() เดิม (ซึ่งกับ Web App ที่ deploy แบบ "Anyone" จะว่างเปล่า
    // เสมออยู่แล้ว และไม่เคยถูกใช้จริงฝั่ง client — role/สิทธิ์แก้ไขจริงตอนนี้เช็คสดกับ
    // Hub ทุกครั้งที่เขียนข้อมูล ไม่ได้พึ่งค่านี้)
    // ============================================
    var currentUser = _findVehicleUserByEmail_(access.email);
    if (!currentUser) {
      currentUser = { id: 'guest', name: access.name || access.email, email: access.email, role: 'Driver', department: 'N/A', status: 'Active' };
    }

    // 🚀 ส่งข้อมูลทั้งหมดกลับไปที่หน้าเว็บ
    return {
      vehicles: vehicles,
      users: users,
      projects: projects,
      bookings: bookings,
      maintenance: maintenance,
      fuelRecords: fuelRecords,
      currentUser: currentUser
    };

  } catch (e) {
    throw new Error('Data Fetch Error: ' + e.toString());
  }
}

// ==========================================
// 🔐 เดิมเป็นระบบ login ของตัวเอง — ตัดออกแล้ว
// ==========================================
// ฟังก์ชัน loginUserBackend เดิม (ไม่เคยถูกเรียกใช้จริง — หน้าเว็บ login ด้วยการ
// .find() เทียบรหัสผ่านฝั่ง client เอง กับข้อมูลทั้งชีต Users รวมรหัสผ่าน plain text
// ที่ getInitialData() ส่งไปให้ตั้งแต่ต้น) ถูกลบทิ้งแล้ว — login ทำที่ OMA Portal
// (Hub) เพียงจุดเดียว ทุก endpoint ด้านล่างยืนยันสิทธิ์กับ Hub สดทุกครั้งแทน

// --- USERS CRUD (ระดับองค์กร — เฉพาะ admin/manager) ---
function addUser(portalToken, user) {
  var access = portalAccessForCall(portalToken, PORTAL_MENU_ID);
  if (!access.ok) throw new Error(access.message);
  if (!isAdminish(access)) throw new Error('เฉพาะ admin/manager เท่านั้น');
  if (!requireSection(access, 'settings:users')) throw new Error('ไม่มีสิทธิ์เข้าแถบ Settings › Users');
  return addRowToSheet('Users', user);
}
function updateUser(portalToken, data) {
  var access = portalAccessForCall(portalToken, PORTAL_MENU_ID);
  if (!access.ok) throw new Error(access.message);
  if (!isAdminish(access)) throw new Error('เฉพาะ admin/manager เท่านั้น');
  if (!requireSection(access, 'settings:users')) throw new Error('ไม่มีสิทธิ์เข้าแถบ Settings › Users');
  // getInitialData() เลิกส่งรหัสผ่านให้ browser แล้ว (ดูด้านบน) ฟอร์มแก้ไขผู้ใช้ใน
  // ReactApp.html จึงเห็นฟิลด์นี้ว่างเสมอตอนแก้ไข ("(ไม่เปลี่ยน)" ตามข้อความ placeholder
  // เดิมของฟอร์มเอง) — ต้องตัดฟิลด์ password ที่ว่างออกก่อนเขียนทับ ไม่งั้นจะไปเขียน ""
  // ทับรหัสผ่านเดิมจริงในชีตทุกครั้งที่แก้ไขผู้ใช้ แม้ไม่ได้ตั้งใจเปลี่ยนรหัสผ่านเลยก็ตาม
  if (!data.password) delete data.password;
  return updateRowInSheet('Users', data.id, data);
}
function deleteUser(portalToken, id) {
  var access = portalAccessForCall(portalToken, PORTAL_MENU_ID);
  if (!access.ok) throw new Error(access.message);
  if (!isAdminish(access)) throw new Error('เฉพาะ admin/manager เท่านั้น');
  if (!requireSection(access, 'settings:users')) throw new Error('ไม่มีสิทธิ์เข้าแถบ Settings › Users');
  return deleteRowInSheet('Users', id);
}

// --- VEHICLES CRUD (ระดับองค์กร — เฉพาะ admin/manager) ---
function addVehicle(portalToken, vehicle) {
  var access = portalAccessForCall(portalToken, PORTAL_MENU_ID);
  if (!access.ok) throw new Error(access.message);
  if (!isAdminish(access)) throw new Error('เฉพาะ admin/manager เท่านั้น');
  if (!requireSection(access, 'settings:vehicles')) throw new Error('ไม่มีสิทธิ์เข้าแถบ Settings › Vehicles');
  return addRowToSheet('Vehicles', vehicle);
}
function updateVehicle(portalToken, data) {
  var access = portalAccessForCall(portalToken, PORTAL_MENU_ID);
  if (!access.ok) throw new Error(access.message);
  if (!isAdminish(access)) throw new Error('เฉพาะ admin/manager เท่านั้น');
  if (!requireSection(access, 'settings:vehicles')) throw new Error('ไม่มีสิทธิ์เข้าแถบ Settings › Vehicles');
  return updateRowInSheet('Vehicles', data.id, data);
}
function deleteVehicle(portalToken, id) {
  var access = portalAccessForCall(portalToken, PORTAL_MENU_ID);
  if (!access.ok) throw new Error(access.message);
  if (!isAdminish(access)) throw new Error('เฉพาะ admin/manager เท่านั้น');
  if (!requireSection(access, 'settings:vehicles')) throw new Error('ไม่มีสิทธิ์เข้าแถบ Settings › Vehicles');
  return deleteRowInSheet('Vehicles', id);
}

// --- PROJECTS CRUD (ระดับองค์กร — เฉพาะ admin/manager) ---
function addProject(portalToken, project) {
  var access = portalAccessForCall(portalToken, PORTAL_MENU_ID);
  if (!access.ok) throw new Error(access.message);
  if (!isAdminish(access)) throw new Error('เฉพาะ admin/manager เท่านั้น');
  if (!requireSection(access, 'settings:projects')) throw new Error('ไม่มีสิทธิ์เข้าแถบ Settings › Projects');
  return addRowToSheet('Projects', project);
}
function updateProject(portalToken, data) {
  var access = portalAccessForCall(portalToken, PORTAL_MENU_ID);
  if (!access.ok) throw new Error(access.message);
  if (!isAdminish(access)) throw new Error('เฉพาะ admin/manager เท่านั้น');
  if (!requireSection(access, 'settings:projects')) throw new Error('ไม่มีสิทธิ์เข้าแถบ Settings › Projects');
  return updateRowInSheet('Projects', data.id, data);
}
function deleteProject(portalToken, id) {
  var access = portalAccessForCall(portalToken, PORTAL_MENU_ID);
  if (!access.ok) throw new Error(access.message);
  if (!isAdminish(access)) throw new Error('เฉพาะ admin/manager เท่านั้น');
  if (!requireSection(access, 'settings:projects')) throw new Error('ไม่มีสิทธิ์เข้าแถบ Settings › Projects');
  return deleteRowInSheet('Projects', id);
}

// --- BOOKINGS & TRANSACTIONS ---
// ==========================================
// 🚦 ตัวช่วย: ตรวจสอบการจองซ้อนทับ (Overlap Check)
// ==========================================
function isVehicleAvailable(vehicleId, reqStartDate, reqEndDate, reqStartTime, reqEndTime, ignoreBookingId) {
  try {
    var bookings = getDataFromSheet('Bookings');
    var activeStatuses = ['Pending', 'Approved', 'KeyIssued', 'Inspected', 'Active', 'Completed'];

    var reqStart = new Date(reqStartDate + 'T' + (reqStartTime || '00:00') + ':00').getTime();
    var reqEnd = new Date(reqEndDate + 'T' + (reqEndTime || '23:59') + ':00').getTime();

    for (var i = 0; i < bookings.length; i++) {
      var b = bookings[i];
      if (ignoreBookingId && String(b.id) === String(ignoreBookingId)) continue;
      if (activeStatuses.indexOf(b.status) === -1) continue;
      if (String(b.vehicleId) !== String(vehicleId)) continue;

      var bStart = new Date(b.startDate + 'T' + (b.pickupTime || '00:00') + ':00').getTime();
      var bEnd = new Date(b.endDate + 'T' + (b.returnTime || '23:59') + ':00').getTime();

      // เช็คว่าเวลาชนกันไหม
      if (!isNaN(bStart) && !isNaN(bEnd) && reqStart <= bEnd && reqEnd >= bStart) {
        return false; // ชนกัน = รถไม่ว่าง!
      }
    }
    return true; // ไม่ชน = ว่าง
  } catch (err) {
    console.error("Overlap Check Error: ", err);
    return true;
  }
}

function submitBooking(portalToken, bookingData) {
  var access = portalAccessForCall(portalToken, PORTAL_MENU_ID);
  if (!access.ok) return { success: false, error: access.message };
  if (!canWrite(access)) return { success: false, error: 'สิทธิ์ไม่พอ' };

  // 🔒 ห้ามเชื่อ userId/userName ที่ client ส่งมา (ปลอมเป็นคนอื่นจองได้) — บังคับใช้
  // ผู้ใช้จริงที่ Hub ยืนยันแล้วเสมอ (เทียบจากชีต Users ของแอปนี้ด้วยอีเมล)
  var vUser = _findVehicleUserByEmail_(access.email);
  bookingData.userId = vUser ? vUser.id : ('guest-' + access.email);
  bookingData.userName = vUser ? vUser.name : (access.name || access.email);
  bookingData.userEmail = access.email;

  bookingData.id = bookingData.id || ('BK-' + new Date().getTime());
  bookingData.createdAt = new Date().toISOString();
  if(!bookingData.status) bookingData.status = 'Pending';

  // บันทึกลง Sheet
  // 🚦 ด่านตรวจคิวรถ: เช็คว่ารถว่างจริงๆ ไหมในช่วงเวลาที่ระบุมา
  var isAvailable = isVehicleAvailable(
    bookingData.vehicleId,
    bookingData.startDate,
    bookingData.endDate,
    bookingData.pickupTime,
    bookingData.returnTime,
    bookingData.id
  );

  // ❌ ถ้ารถไม่ว่าง ให้ดีดกลับทันที พร้อมส่งข้อความ Error ไปเตือนหน้าเว็บ
  if (!isAvailable) {
    return {
      success: false,
      error: "รถคันนี้ติดคิวจอง/ใช้งาน ในช่วงเวลาที่คุณเลือก กรุณาเปลี่ยนรถหรือปรับเวลาใหม่ค่ะ"
    };
  }

  // ✅ ถ้าตรวจผ่าน (รถว่าง) ค่อยบันทึกลง Sheet ปกติ
  addRowToSheet('Bookings', bookingData);

  // 💥 (เพิ่มใหม่) สั่งส่งอีเมลแจ้งเตือน
  if (bookingData.projectId) {
    // ใช้คำสั่ง try...catch ครอบไว้ เผื่อเมลส่งไม่ผ่านจะได้ไม่ทำให้การจองพัง
    try {
      notifyProjectOwner(bookingData.projectId, 'Booking', bookingData);
    } catch(err) { console.error("Email Error: ", err); }
  }

  return { success: true, data: bookingData };
}

// ==========================================
// 🚗 API: อัปเดตสถานะการจอง (รับ-ส่งกุญแจ)
// ==========================================
function updateBookingStatus(portalToken, data) {
  var access = portalAccessForCall(portalToken, PORTAL_MENU_ID);
  if (!access.ok) return { success: false, error: access.message };
  if (!canWrite(access)) return { success: false, error: 'สิทธิ์ไม่พอ' };

  // 🔒 การเปลี่ยนสถานะจริง (อนุมัติ/ปฏิเสธ/จ่ายกุญแจ/รับคืน) เป็นงานของ admin/manager
  // เท่านั้น — canWrite (ไม่ใช่ viewer) อย่างเดียวเบากว่านี้เกินไปสำหรับการกระทำ
  // ระดับอนุมัติ จึงเพิ่ม isAdminish ไว้เฉพาะ transition เหล่านี้
  var isApprovalAction = (data.status === 'Approved' || data.status === 'Rejected' ||
    data.status === 'KeyIssued' || String(data.keyReturned).toLowerCase() === 'yes' || data.status === 'Finished');
  if (isApprovalAction && !isAdminish(access)) {
    return { success: false, error: 'เฉพาะ admin/manager เท่านั้นที่อนุมัติ/จ่ายกุญแจ/รับคืนได้' };
  }

  // 🔒 ไม่เชื่อ data.adminName ที่ client ส่งมาอีกต่อไป — ใช้ชื่อจริงของผู้ยืนยันตัวตน
  // กับ Hub แทนเสมอ (ทดสอบแล้วว่าเดิม client ปลอมชื่อผู้อนุมัติได้)
  data.adminName = (_findVehicleUserByEmail_(access.email) || {}).name || access.name || access.email;
  return _internalUpdateBookingStatus_(data);
}

// ตรรกะจริงของการอัปเดตสถานะ booking — เรียกได้จากสองทาง: ผ่าน updateBookingStatus()
// ข้างบน (ตรวจ portalToken แล้ว) หรือจาก processActionFromEmail() (Main.js) สำหรับ
// ลิงก์ 1-คลิกในอีเมลที่ตรวจลายเซ็น HMAC แทน (ไม่มี portal session ให้ verify)
// ทั้งสองทางบังคับ data.adminName จากตัวตนที่ยืนยันแล้วเสมอ ไม่ใช่ค่าที่ client ส่งมา
function _internalUpdateBookingStatus_(data) {
  var currentAdminName = data.adminName || "แอดมิน (ตรวจสอบจากระบบ)";

  // กรณีที่ 1: แอดมินกด "ให้กุญแจ"
  if (data.status === 'KeyIssued') {
    data.keyIssuedBy = currentAdminName;
    if (!data.handoverTime) data.handoverTime = new Date().toISOString();

    // สั่งเปลี่ยนสถานะรถเป็น "ถูกใช้งานอยู่" (In Use)
    if (data.vehicleId) updateVehicleStatusInSheet(data.vehicleId, 'In Use');
  }

  // กรณีที่ 2: แอดมินกด "รับกุญแจคืน"
  if (String(data.keyReturned).toLowerCase() === 'yes' || data.status === 'Finished') {
    data.keyReceivedBy = currentAdminName;
    if (!data.keyReceivedAt) data.keyReceivedAt = new Date().toISOString();
    data.status = 'Finished';

    // สั่งเปลี่ยนสถานะรถกลับเป็น "พร้อมใช้งาน" (Available)
    if (data.vehicleId) updateVehicleStatusInSheet(data.vehicleId, 'Available');
  }
  // ---------------------------------------------------------

  // อัปเดตข้อมูลลง Sheet
  var result = updateRowInSheet('Bookings', data.id, data);

  // จัดการเรื่องส่งอีเมล (โค้ดเดิมของคุณ)
  if (data.status === 'Approved' || data.status === 'Rejected' || data.status === 'KeyIssued') {
    try {
      var bookings = getDataFromSheet('Bookings');
      var fullBooking = bookings.find(b => String(b.id) === String(data.id));

      if (fullBooking) {
        fullBooking.status = data.status;
        fullBooking.rejectionReason = data.rejectionReason || fullBooking.rejectionReason;

        if (data.status === 'Approved' || data.status === 'Rejected') {
          notifyRequesterOnStatusChange(fullBooking, 'Booking');
          if (data.status === 'Approved') {
            notifyAdminsOnApproval(fullBooking, 'Booking');
          }
        } else if (data.status === 'KeyIssued') {
          notifyRequesterOnKeyIssued(fullBooking);
        }
      }
    } catch(err) { console.error("Email Error: ", err); }
  }
  return result;
}

// ==========================================
// 🚗 API: บันทึกข้อมูลการคืนรถ และอัปเดตสถานะรถล่าสุด
// ==========================================
function submitReturn(portalToken, bookingId, returnData, fuelData) {
  var access = portalAccessForCall(portalToken, PORTAL_MENU_ID);
  if (!access.ok) return { success: false, error: access.message };
  if (!canWrite(access)) return { success: false, error: 'สิทธิ์ไม่พอ' };

  // 🔒 เฉพาะเจ้าของ booking เองหรือ admin/manager เท่านั้นที่คืนรถแทนได้ —
  // กันคนอื่นมาแก้ไมล์/น้ำมัน/รูปถ่ายของการจองที่ไม่ใช่ของตัวเอง
  try {
    var bookings0 = getDataFromSheet('Bookings');
    var targetBooking = bookings0.find(function(b) { return String(b.id) === String(bookingId); });
    if (!targetBooking) return { success: false, error: 'ไม่พบข้อมูลการจองนี้' };
    if (!isAdminish(access) && !_isBookingOwner_(access, targetBooking)) {
      return { success: false, error: 'คืนรถได้เฉพาะเจ้าของการจองหรือ admin/manager เท่านั้น' };
    }
  } catch (e) {
    return { success: false, error: e.message };
  }

  try {
    returnData.status = 'Completed';
    returnData.actualReturnTime = new Date().toISOString();
    returnData.endFuel = returnData.endFuel || returnData.returnFuelLevel || "";

    // 1. จัดระเบียบข้อมูลน้ำมัน
    if (fuelData && fuelData.usedGasCard) {
      returnData.fuelFilled = true;
      returnData.usedGasCard = fuelData.usedGasCard;
      returnData.newFuelBalance = (fuelData.newFuelBalance !== undefined && fuelData.newFuelBalance !== null && fuelData.newFuelBalance !== '')
                                   ? Number(fuelData.newFuelBalance)
                                   : null;
      returnData.liters = fuelData.liters || 0;
      returnData.totalCost = fuelData.totalCost || 0;
      returnData.receiptId = fuelData.receiptId || "-";
      fuelData.id = 'FUEL-' + new Date().getTime();
    } else {
      returnData.fuelFilled = false;
      returnData.usedGasCard = "-";
      returnData.newFuelBalance = null;
      returnData.liters = 0;
      returnData.totalCost = 0;
      returnData.receiptId = "-";
    }

    // 2. เซฟลง Bookings และ FuelRecords
    updateRowInSheet('Bookings', bookingId, returnData);
    if (fuelData && fuelData.usedGasCard) {
      var bookings = getDataFromSheet('Bookings');
      var fullBooking = bookings.find(b => String(b.id) === String(bookingId));
      if (fullBooking) {
        fuelData.vehiclePlate = fullBooking.vehicleName || fullBooking.vehiclePlate || "";
        fuelData.projectName = fullBooking.projectName || "";
      }
      addRowToSheet('FuelRecords', fuelData);
    }

    // 3. อัปเดตข้อมูลลง Vehicles
    var vSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Vehicles');
    var vData = vSheet.getDataRange().getValues();
    var vHeaders = vData[0];
    var bookingsData = getDataFromSheet('Bookings');
    var currentBooking = bookingsData.find(b => String(b.id) === String(bookingId));

    if (currentBooking && currentBooking.vehicleId) {
      var vRowIndex = vData.findIndex(row => String(row[vHeaders.indexOf('id')]) === String(currentBooking.vehicleId));

      if (vRowIndex !== -1) {
        var targetRow = vRowIndex + 1;
        var mileCol = vHeaders.indexOf('currentMileage') + 1;
        var fuelLevelCol = vHeaders.indexOf('fuelLevel') + 1;
        var currentFuelCol = vHeaders.indexOf('currentFuel') + 1;
        var gasCardCol = vHeaders.indexOf('gasCard') + 1;

        // ✅ เป้าหมายที่ 1: endFuel -> fuelLevel (ระดับน้ำมันหลังคืนรถ เช่น 3/4 ถัง)
        if (fuelLevelCol > 0 && returnData.endFuel) {
          vSheet.getRange(targetRow, fuelLevelCol).setValue(returnData.endFuel);
          Logger.log('✅ Updated fuelLevel: ' + returnData.endFuel);
        }

        // ✅ เป้าหมายที่ 2: newFuelBalance -> currentFuel (ยอดเงินคงเหลือในบัตร)
        // แก้เงื่อนไขเป็น null check แทน !== ""
        if (currentFuelCol > 0 && returnData.newFuelBalance !== null && returnData.newFuelBalance !== undefined) {
          vSheet.getRange(targetRow, currentFuelCol).setValue(returnData.newFuelBalance);
          Logger.log('✅ Updated currentFuel: ' + returnData.newFuelBalance);
        }

        // อัปเดตเลขไมล์
        if (mileCol > 0 && returnData.endMileage) {
          vSheet.getRange(targetRow, mileCol).setValue(returnData.endMileage);
        }

        // อัปเดตเลขบัตรน้ำมัน (เฉพาะกรณีที่ใช้จริง)
        if (gasCardCol > 0 && returnData.usedGasCard && returnData.usedGasCard !== "-") {
          vSheet.getRange(targetRow, gasCardCol).setValue(returnData.usedGasCard);
        }
      }
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function addMaintenance(portalToken, data) {
  var access = portalAccessForCall(portalToken, PORTAL_MENU_ID);
  if (!access.ok) return { success: false, error: access.message };
  if (!canWrite(access)) return { success: false, error: 'สิทธิ์ไม่พอ' };

  data.requesterEmail = access.email;

  // 1. บันทึกข้อมูลการแจ้งซ่อมลง Sheet 'Maintenance'
  var result = addRowToSheet('Maintenance', data);

  // 2. 💥 อัปเดตเลขไมล์ และ "สถานะรถ" ให้เป็นซ่อมบำรุงทันที
  if (data.vehicleId) {
    try {
      var vehicles = getDataFromSheet('Vehicles');
      var vehicle = vehicles.find(v => String(v.id) === String(data.vehicleId));

      if (vehicle) {
        // อัปเดตเลขไมล์ถ้ามีการส่งมา
        if (data.currentMileage) vehicle.currentMileage = data.currentMileage;
        if (data.nextServiceMileage) vehicle.nextServiceMileage = data.nextServiceMileage;

        // 🚀 บังคับเปลี่ยนสถานะรถเป็นซ่อมบำรุง
        vehicle.status = 'Maintenance';

        // บันทึกการเปลี่ยนแปลงกลับไปที่ Sheet 'Vehicles'
        updateRowInSheet('Vehicles', vehicle.id, vehicle);
      }
    } catch(err) { console.error("Update Vehicle Error: ", err); }
  }

  // 3. ส่งอีเมลแจ้งเตือนเจ้าของโครงการ (ถ้ามี)
  if (data.projectId) {
    try {
      notifyProjectOwner(data.projectId, 'Maintenance', data);
    } catch(err) { console.error("Email Error: ", err); }
  }

  return result;
}

// =======================================================

// แทนที่ฟังก์ชัน updateMaintenance เดิม
function updateMaintenance(portalToken, data) {
  var access = portalAccessForCall(portalToken, PORTAL_MENU_ID);
  if (!access.ok) return { success: false, error: access.message };
  if (!canWrite(access)) return { success: false, error: 'สิทธิ์ไม่พอ' };

  // 🔒 การอนุมัติ/ปฏิเสธ/เปลี่ยนสถานะงานซ่อมเป็นงานของ admin/manager เท่านั้น
  // (เหมือน updateBookingStatus) — การแก้ไขฟิลด์อื่นที่ไม่ใช่ transition เหล่านี้
  // (เช่น requester แก้รายละเอียดของตัวเอง) ยังใช้แค่ canWrite ตามเดิม
  var isApprovalAction = ['Approved', 'Rejected', 'Completed', 'In Progress'].indexOf(data.status) !== -1;
  if (isApprovalAction && !isAdminish(access)) {
    return { success: false, error: 'เฉพาะ admin/manager เท่านั้นที่อนุมัติ/ปิดงานซ่อมได้' };
  }

  return _internalUpdateMaintenance_(data);
}

// ตรรกะจริงของการอัปเดตงานซ่อม — เรียกจาก updateMaintenance() ข้างบน (ตรวจ
// portalToken แล้ว) หรือจาก processActionFromEmail() (Main.js) สำหรับลิงก์ 1-คลิก
// ในอีเมลที่ตรวจลายเซ็น HMAC แทน
function _internalUpdateMaintenance_(data) {
  // 1. อัปเดตข้อมูลลง Sheet Maintenance ก่อน
  var result = updateRowInSheet('Maintenance', data.id, data);

  try {
    // ดึงข้อมูลเต็มของ Maintenance นี้ออกมาเพื่อส่งเมลและเช็คข้อมูลรถ
    var maintenance = getDataFromSheet('Maintenance');
    var fullMaint = maintenance.find(m => String(m.id) === String(data.id));

    if (fullMaint) {
      // 2. อัปเดตตัวแปรเพื่อใช้ส่งอีเมล
      if (data.status === 'Approved' || data.status === 'Rejected') {
        fullMaint.status = data.status;
        fullMaint.rejectionReason = data.rejectionReason || fullMaint.rejectionReason;
        notifyRequesterOnStatusChange(fullMaint, 'Maintenance');
      }

      // 3. 🚀 จัดการสถานะรถยนต์ในชีท Vehicles แบบอัตโนมัติ
      if (fullMaint.vehicleId) {
        var vehicles = getDataFromSheet('Vehicles');
        var vehicle = vehicles.find(v => String(v.id) === String(fullMaint.vehicleId));

        if (vehicle) {
          var isVehicleUpdated = false;

          // 🔍 ตรวจสอบสถานะที่แท้จริงจากชีต Bookings ก่อนเสมอ (มีใครกำลังถือกุญแจอยู่ไหม?)
          var realStatus = getCorrectVehicleStatus(vehicle.id);

          // ถ้างานซ่อมเสร็จสิ้น หรือ ถูกตีกลับ(ไม่อนุมัติ) ให้คืนสถานะตามจริง
          // (ถ้ามีคนขับอยู่จะเป็น 'In Use', ถ้าไม่มีจะเป็น 'Available')
          if (data.status === 'Completed' || data.status === 'Rejected') {
            vehicle.status = realStatus;
            isVehicleUpdated = true;
          }
          // ถ้าแอดมินกดอนุมัติ หรือ เริ่มดำเนินการซ่อม
          else if (data.status === 'Approved' || data.status === 'In Progress') {
            // ถ้ารถกำลังถูกใช้งานอยู่ (In Use) ก็ให้แสดงเป็นกำลังใช้งานต่อไปก่อน (จนกว่าจะคืนกุญแจ)
            // แต่ถ้าไม่ได้วิ่งอยู่ ให้เปลี่ยนเป็นส่งซ่อม (Maintenance) ตามปกติ
            vehicle.status = (realStatus === 'In Use') ? 'In Use' : 'Maintenance';
            isVehicleUpdated = true;
          }

          // ถ้ามีการอัปเดตข้อมูลเลขไมล์รอบถัดไปตอนปิดงาน
          if (data.nextServiceMileage) {
             vehicle.nextServiceMileage = data.nextServiceMileage;
             isVehicleUpdated = true;
          }

          // บันทึกกลับไปที่ชีท
          if (isVehicleUpdated) {
            updateRowInSheet('Vehicles', vehicle.id, vehicle);
          }
        }
      }
    }
  } catch(err) { console.error("Update Maint Status/Email Error: ", err); }

  return result;
}

// ==========================================
// 🚗 ตัวช่วย: อัปเดตสถานะรถในชีต Vehicles
// ==========================================
function updateVehicleStatusInSheet(vehicleId, newStatus) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Vehicles');
    if (!sheet) return;

    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var idColIdx = headers.indexOf('id');
    var statusColIdx = headers.indexOf('status');

    if (idColIdx === -1 || statusColIdx === -1) return;

    // วนหาบรรทัดของรถคันนั้น แล้วเปลี่ยนสถานะ
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][idColIdx]) === String(vehicleId)) {
        sheet.getRange(i + 1, statusColIdx + 1).setValue(newStatus);
        break;
      }
    }
  } catch (err) {
    console.error("Error updating vehicle status: ", err);
  }
}

// ==========================================
// 🕵️ ตัวช่วย: ค้นหาชื่อจริงแอดมินจากอีเมลในชีต Users
// ==========================================
function getAdminNameByEmail(email) {
  if (!email) return null;
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Users');
    if (!sheet) return null;
    var data = sheet.getDataRange().getValues();
    var emailCol = data[0].indexOf('email');
    var nameCol = data[0].indexOf('name');

    if (emailCol > -1 && nameCol > -1) {
      for (var i = 1; i < data.length; i++) {
        // หาบรรทัดที่อีเมลตรงกัน แล้วส่งชื่อนั้นกลับไป
        if (String(data[i][emailCol]).toLowerCase() === String(email).toLowerCase()) {
          return data[i][nameCol];
        }
      }
    }
  } catch (err) {}
  return null;
}

// ==========================================
// 💳 API: ดึงเลขบัตรฟลีทการ์ดจากรหัสรถแบบ Real-time
// ==========================================
function getFleetCard(portalToken, vehicleId) {
  var access = portalAccessForCall(portalToken, PORTAL_MENU_ID);
  if (!access.ok) return "";
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Vehicles');
    var data = sheet.getDataRange().getValues();
    var headers = data[0];

    var idCol = headers.indexOf('id');
    var cardCol = headers.indexOf('gasCard');

    if (idCol === -1 || cardCol === -1) return "";

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][idCol]) === String(vehicleId)) {
        return data[i][cardCol] || ""; // ส่งเลขบัตรกลับไปที่หน้าเว็บ
      }
    }
  } catch (e) {
    return "";
  }
  return "";
}
