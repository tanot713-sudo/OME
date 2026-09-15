// ==========================================
// 🔔 NOTIFICATION SYSTEM
// ==========================================

// 1. ระบุอีเมลของผู้ดูแลระบบที่ต้องการให้ระบบส่งไปแจ้งเตือน
const ADMIN_EMAIL = 'parichat@amrasia.com, pailin@amrasia.com';  // เปลี่ยนเป็นอีเมลของคุณ

function checkMaintenanceMileageAndNotify() {
  const sheetName = 'Vehicles';
  const vehicles = getDataFromSheet(sheetName);
  const sheet = getSheet(sheetName);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  // ตรวจสอบว่ามีคอลัมน์ 'lastNotificationLevel' หรือยัง ถ้ายังให้สร้างขึ้นมาใหม่
  let levelColIndex = headers.indexOf('lastNotificationLevel');
  if (levelColIndex === -1) {
    sheet.getRange(1, headers.length + 1).setValue('lastNotificationLevel');
    headers.push('lastNotificationLevel');
    levelColIndex = headers.length - 1;
  }

  // วนลูปตรวจสอบรถทีละคัน
  vehicles.forEach((vehicle, index) => {
    // แปลงค่าเป็นตัวเลข
    const currentMileage = Number(vehicle.currentMileage) || 0;
    const nextServiceMileage = Number(vehicle.nextServiceMileage) || 0;

    // ถ้ารถคันไหนยังไม่ได้ตั้งค่าระยะรอบถัดไป ให้ข้ามไป
    if (nextServiceMileage === 0) return; 

    // คำนวณระยะทางที่เหลือ
    const remaining = nextServiceMileage - currentMileage;
    let currentLevel = 0;
    let alertMessage = "";
    let alertColor = "#000000";

    // 🎯 แบ่ง Level ตามเงื่อนไข
    if (remaining <= 500 && remaining > 300) {
      currentLevel = 1;
      alertMessage = `เหลืออีก ${remaining} กม. ถึงกำหนดเช็คระยะ`;
      alertColor = "#f39c12"; // สีส้ม
    } else if (remaining <= 300 && remaining > 100) {
      currentLevel = 2;
      alertMessage = `เหลืออีก ${remaining} กม. ถึงกำหนดเช็คระยะ`;
      alertColor = "#e67e22"; // สีส้มเข้ม
    } else if (remaining <= 100 && remaining >= 0) {
      currentLevel = 3;
      alertMessage = `🚨 ด่วน! เหลืออีกเพียง ${remaining} กม. ถึงกำหนดเช็คระยะ`;
      alertColor = "#e74c3c"; // สีแดง
    } else if (remaining < 0 && remaining >= -100) {
      currentLevel = 4;
      alertMessage = `⚠️ เกินกำหนดเช็คระยะมาแล้ว ${Math.abs(remaining)} กม.`;
      alertColor = "#c0392b"; // สีแดงเข้ม
    } else if (remaining < -100 && remaining >= -300) {
      currentLevel = 5;
      alertMessage = `❌ เกินกำหนดเช็คระยะมาแล้ว ${Math.abs(remaining)} กม. (อันตราย)`;
      alertColor = "#900C3F"; // สีแดงเลือดหมู
    } else if (remaining < -300) {
      currentLevel = 6;
      alertMessage = `⛔ ร้ายแรง! เกินกำหนดเช็คระยะมาแล้ว ${Math.abs(remaining)} กม. กรุณานำรถเข้าศูนย์ทันที`;
      alertColor = "#581845"; // สีม่วงเข้ม
    }

    const lastLevel = Number(vehicle.lastNotificationLevel) || 0;

    // ถ้ามีการตกอยู่ใน Level ใดๆ (1-6) และ Level นั้น "ไม่ตรงกับ" ที่เคยแจ้งเตือนไปล่าสุด
    if (currentLevel > 0 && currentLevel !== lastLevel) {
      
      // เตรียมข้อความ Email
      const subject = `[แจ้งเตือน Level ${currentLevel}] รถทะเบียน ${vehicle.licensePlate} กำหนดเช็คระยะ`;
      const htmlBody = `
        <div style="font-family: sans-serif; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">
          <h2 style="color: #4A90E2;">🚗 แจ้งเตือนการเช็คระยะยานพาหนะ</h2>
          <p><strong>รถยนต์:</strong> ${vehicle.brand} ${vehicle.model}</p>
          <p><strong>ทะเบียน:</strong> ${vehicle.licensePlate}</p>
          <hr style="border: 0; border-top: 1px solid #eee; my: 15px;">
          <p><strong>เลขไมล์ปัจจุบัน:</strong> ${currentMileage.toLocaleString()} กม.</p>
          <p><strong>เป้าหมายเช็คระยะ:</strong> ${nextServiceMileage.toLocaleString()} กม.</p>
          <p style="font-size: 18px; font-weight: bold; color: ${alertColor};">
            ${alertMessage}
          </p>
          <br>
          <p>กรุณาดำเนินการตรวจสอบและนำรถเข้าบำรุงรักษาผ่านระบบ Fleet Management</p>
        </div>
      `;

      try {
        // ส่ง Email
        MailApp.sendEmail({
          to: ADMIN_EMAIL,
          subject: subject,
          htmlBody: htmlBody
        });

        // อัปเดต Level ล่าสุดลงใน Sheet (index + 2 เพราะข้าม Header และ Array เริ่มที่ 0)
        sheet.getRange(index + 2, levelColIndex + 1).setValue(currentLevel);
        Logger.log(`✅ Sent email for ${vehicle.licensePlate} (Level ${currentLevel})`);
      } catch (e) {
        Logger.log(`❌ Error sending email for ${vehicle.licensePlate}: ` + e.message);
      }
    } 
    // รีเซ็ต Level เป็น 0 ถ้ารถคันนั้นไปเช็คระยะมาแล้ว (ระยะห่างกลับมามากกว่า 500)
    else if (remaining > 500 && lastLevel !== 0) {
      sheet.getRange(index + 2, levelColIndex + 1).setValue(0);
    }
  });
}

// ==========================================
// 📧 NOTIFICATION TO PROJECT OWNER
// ==========================================

function notifyProjectOwner(projectId, type, requestData) {
  try {
    // 1. ดึง URL ของ Web App เพื่อทำปุ่มลิ้งก์
    var webAppUrl = ScriptApp.getService().getUrl();
    // ลิงก์เซ็นด้วย HMAC เสมอ (Main.js: _signVehicleActionUrl_) — ผู้รับอีเมลไม่มี
    // portal session ให้ verify สด เดิมลิงก์นี้ไม่มีการยืนยันตัวตนเลย ใครมี id ก็กดอนุมัติแทนได้
    var approveUrl = _signVehicleActionUrl_(webAppUrl, 'approveBooking', requestData.id);
    
    var linkHtml = `
      <br><br>
      <div style="text-align: center;">
        <a href="${approveUrl}" style="display:inline-block; padding:12px 24px; background-color:#2ecc71; color:white; text-decoration:none; border-radius:8px; font-weight:bold; font-size:16px; margin-right:10px; border: 1px solid #27ae60;">✅ อนุมัติทันที</a>
        <a href="${webAppUrl}" style="display:inline-block; padding:12px 24px; background-color:#34495e; color:white; text-decoration:none; border-radius:8px; font-weight:bold; font-size:16px;">🔍 ดูรายละเอียด/ไม่อนุมัติ</a>
      </div>
    `;

    // 2. ถ้าไม่มี Project ID จะไม่สามารถหา Owner ได้ (ในกรณีที่เป็นงานแจ้งซ่อมทั่วไปที่ไม่มีโปรเจกต์)
    if (!projectId) {
      console.log('No Project ID provided. Skip sending email to Project Owner.');
      return; 
    }

    // 3. ดึงข้อมูลเพื่อหาอีเมลของเจ้าของโครงการ
    var projects = getDataFromSheet('Projects');
    var users = getDataFromSheet('Users');
    
    var project = projects.find(p => String(p.id) === String(projectId));
    if (!project || !project.ownerId) return; // ไม่พบโครงการ หรือ โครงการไม่มีเจ้าของ

    // ค้นหา User ที่เป็นเจ้าของโครงการ
    var owner = users.find(u => String(u.id) === String(project.ownerId) || String(u.employeeId) === String(project.ownerId));
    if (!owner || !owner.email) return; // ไม่พบอีเมล

    var ownerEmail = owner.email;
    var subject = "";
    var htmlBody = "";

    // 4. สร้างเนื้อหาอีเมลแยกตามประเภท
    if (type === 'Booking') {
      subject = `[AMR] คำขอจองรถใหม่ - โครงการ: ${project.name}`;
      htmlBody = `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 20px; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 10px;">
          <h2 style="color: #4A90E2; border-bottom: 2px solid #f0f0f0; padding-bottom: 10px;">🚗 มีคำขอใช้งานยานพาหนะใหม่</h2>
          <p>เรียน คุณ ${owner.name},</p>
          <p>มีการส่งคำขอใช้งานยานพาหนะภายใต้โครงการ <strong>${project.name}</strong> โดยมีรายละเอียดดังนี้:</p>
          <ul style="line-height: 1.8;">
            <li><strong>ผู้ขอ:</strong> ${requestData.userName || '-'}</li>
            <li><strong>รถที่ต้องการ:</strong> ${requestData.vehicleName || '-'}</li>
            <li><strong>วันที่ใช้งาน:</strong> ${requestData.startDate || '-'} ถึง ${requestData.endDate || '-'}</li>
            <li><strong>วัตถุประสงค์:</strong> ${requestData.purpose || '-'}</li>
            <li><strong>สถานที่:</strong> ${requestData.destination || '-'}</li>
          </ul>
          ${linkHtml}
        </div>
      `;
    } else if (type === 'Maintenance') {
      subject = `[AMR] แจ้งซ่อม/บำรุงรักษารถ - โครงการ: ${project.name}`;
      htmlBody = `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 20px; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 10px;">
          <h2 style="color: #e74c3c; border-bottom: 2px solid #f0f0f0; padding-bottom: 10px;">🛠️ มีการแจ้งซ่อม/บำรุงรักษายานพาหนะ</h2>
          <p>เรียน คุณ ${owner.name},</p>
          <p>มีการแจ้งซ่อมยานพาหนะภายใต้โครงการ <strong>${project.name}</strong> โดยมีรายละเอียดดังนี้:</p>
          <ul style="line-height: 1.8;">
            <li><strong>ผู้แจ้ง:</strong> ${requestData.requesterName || '-'}</li>
            <li><strong>รถที่แจ้ง:</strong> ${requestData.vehicleName || '-'}</li>
            <li><strong>รายละเอียดปัญหา:</strong> ${requestData.description || '-'}</li>
            <li><strong>ประเภท:</strong> ${requestData.type || '-'}</li>
          </ul>
          ${linkHtml}
        </div>
      `;
    }

    // 5. สั่งส่งอีเมล
    if (subject !== "") {
      MailApp.sendEmail({
        to: ownerEmail,
        subject: subject,
        htmlBody: htmlBody
      });
      console.log('✅ Email notification sent to Project Owner: ' + ownerEmail);
    }
    
  } catch (e) {
    console.error('❌ Error sending notification: ' + e.toString());
  }
}

// ==========================================
// 📧 NOTIFICATION TO REQUESTER (อนุมัติ/ปฏิเสธ)
// ==========================================

function notifyRequesterOnStatusChange(requestData, type) {
  try {
    // 1. ดึง URL ของ Web App สำหรับทำปุ่ม
    var webAppUrl = ScriptApp.getService().getUrl();
    var linkHtml = `<br><br><a href="${webAppUrl}" style="display:inline-block; padding:12px 24px; background-color:#4A90E2; color:white; text-decoration:none; border-radius:8px; font-weight:bold; font-size:16px;">View details: AMR Management</a>`;

    // 2. ค้นหาผู้ส่งคำขอ (หาจาก userId หรือ requesterId)
    var users = getDataFromSheet('Users');
    var userId = type === 'Booking' ? requestData.userId : requestData.requesterId;
    
    // ค้นหาจาก ID ก่อน ถ้าไม่เจอให้ลองค้นจากชื่อเผื่อไว้
    var requester = users.find(u => String(u.id) === String(userId) || String(u.employeeId) === String(userId) || u.name === (requestData.userName || requestData.requesterName));
    
    if (!requester || !requester.email) {
      console.log('No email found for requester.');
      return; 
    }

    // 3. กำหนดสีและข้อความตามสถานะ
    var isApproved = requestData.status === 'Approved';
    var statusText = isApproved ? '✅ อนุมัติ' : '❌ ไม่อนุมัติ (ปฏิเสธ)';
    var color = isApproved ? '#2ecc71' : '#e74c3c'; // เขียว หรือ แดง
    var typeText = type === 'Booking' ? 'จองรถ' : 'แจ้งซ่อม/บำรุงรักษา';

    var subject = `[AMR] ผลการพิจารณาคำขอ${typeText} - ${statusText}`;
    
    // 4. เตรียมรายละเอียดที่จะแสดงในอีเมล
    var detailHtml = '';
    if (type === 'Booking') {
      detailHtml = `
        <li><strong>รถที่ขอ:</strong> ${requestData.vehicleName || '-'}</li>
        <li><strong>วันที่ใช้งาน:</strong> ${requestData.startDate || '-'} ถึง ${requestData.endDate || '-'}</li>
        <li><strong>โครงการ:</strong> ${requestData.projectName || '-'}</li>
      `;
    } else {
      detailHtml = `
        <li><strong>รถที่แจ้งซ่อม:</strong> ${requestData.vehicleName || '-'}</li>
        <li><strong>รายละเอียดปัญหา:</strong> ${requestData.description || requestData.repairItems || '-'}</li>
      `;
    }

    // ถ้าไม่อนุมัติ และมีเหตุผล ให้แสดงเหตุผลด้วย
    var reasonHtml = '';
    if (!isApproved && requestData.rejectionReason) {
      reasonHtml = `<p style="color: #c0392b; font-weight: bold; background: #fadbd8; padding: 10px; border-radius: 5px;">เหตุผลที่ปฏิเสธ: ${requestData.rejectionReason}</p>`;
    }

    // 5. ประกอบร่างเนื้อหาอีเมล (HTML)
    var htmlBody = `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 20px; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 10px;">
        <h2 style="color: ${color}; border-bottom: 2px solid #f0f0f0; padding-bottom: 10px;">ผลการพิจารณาคำขอ</h2>
        <p>เรียน คุณ ${requester.name},</p>
        <p>คำขอ${typeText}ของคุณได้รับการพิจารณาเรียบร้อยแล้ว โดยมีสถานะคือ:</p>
        <h3 style="color: ${color}; margin: 10px 0;">${statusText}</h3>
        <ul style="line-height: 1.8; background: #f9f9f9; padding: 15px 15px 15px 35px; border-radius: 5px;">
          ${detailHtml}
        </ul>
        ${reasonHtml}
        ${linkHtml}
      </div>
    `;

    // 6. ส่งอีเมล
    MailApp.sendEmail({
      to: requester.email,
      subject: subject,
      htmlBody: htmlBody
    });
    console.log('✅ Status notification sent to Requester: ' + requester.email);
    
  } catch (e) {
    console.error('❌ Error sending status notification: ' + e.toString());
  }
}

// ==========================================
// 📧 NOTIFICATION TO ADMIN (เตรียมจ่ายกุญแจ)
// ==========================================

function notifyAdminsOnApproval(requestData, type) {
  try {
    // 1. ดึงข้อมูล User เพื่อหาว่าใครเป็น Admin บ้าง
    var users = getDataFromSheet('Users');
    var admins = users.filter(u => u.role === 'Admin' && u.email); // ดึงเฉพาะคนที่เป็น Admin และมีอีเมล

    if (admins.length === 0) {
      console.log('No Admin found in the system to notify.');
      return; 
    }

    // 2. เตรียมปุ่มลิ้งก์
    var webAppUrl = ScriptApp.getService().getUrl();
    var issueKeyUrl = _signVehicleActionUrl_(webAppUrl, 'issueKey', requestData.id);

    var linkHtml = `
      <br><br>
      <div style="text-align: center;">
        <a href="${issueKeyUrl}" style="display:inline-block; padding:12px 24px; background-color:#f39c12; color:white; text-decoration:none; border-radius:8px; font-weight:bold; font-size:16px; margin-right:10px; border: 1px solid #e67e22;">🔑 จ่ายกุญแจแล้ว</a>
        <a href="${webAppUrl}" style="display:inline-block; padding:12px 24px; background-color:#34495e; color:white; text-decoration:none; border-radius:8px; font-weight:bold; font-size:16px;">🔍 เปิดหน้าเว็บ</a>
      </div>
    `;

    // 3. เตรียมข้อความอีเมล
    var subject = `[AMR] 🔑 เตรียมจ่ายกุญแจ - คำขอจองรถถูกอนุมัติแล้ว`;
    var htmlBody = `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 20px; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 10px;">
        <h2 style="color: #f39c12; border-bottom: 2px solid #f0f0f0; padding-bottom: 10px;">🔑 กรุณาเตรียมจ่ายกุญแจยานพาหนะ</h2>
        <p>เรียน ผู้ดูแลระบบ (Admin),</p>
        <p>มีการอนุมัติคำขอใช้งานยานพาหนะเรียบร้อยแล้ว กรุณาเตรียมกุญแจสำหรับรายการต่อไปนี้:</p>
        <ul style="line-height: 1.8; background: #fffbf0; padding: 15px 15px 15px 35px; border-radius: 5px; border-left: 4px solid #f39c12;">
          <li><strong>ผู้ขอใช้งาน:</strong> ${requestData.userName || requestData.requesterName || '-'}</li>
          <li><strong>รถยนต์ที่ต้องเตรียม:</strong> ${requestData.vehicleName || '-'}</li>
          <li><strong>วันที่เริ่มต้นใช้งาน:</strong> ${requestData.startDate || '-'}</li>
          <li><strong>โครงการ:</strong> ${requestData.projectName || '-'}</li>
        </ul>
        <p>ผู้ใช้งานจะเข้ามารับกุญแจก่อนทำการตรวจสภาพรถ</p>
        ${linkHtml}
      </div>
    `;

    // 4. ส่งอีเมลหา Admin ทุกคน
    admins.forEach(admin => {
      MailApp.sendEmail({
        to: admin.email,
        subject: subject,
        htmlBody: htmlBody
      });
      console.log('✅ Key Preparation Email sent to Admin: ' + admin.email);
    });
    
  } catch (e) {
    console.error('❌ Error sending admin notification: ' + e.toString());
  }
}

// ==========================================
// 📧 NOTIFICATION TO REQUESTER (รับกุญแจแล้ว -> แจ้งให้ไปตรวจสภาพรถ)
// ==========================================

function notifyRequesterOnKeyIssued(requestData) {
  try {
    // 1. ค้นหาอีเมลของผู้ขอจอง
    var users = getDataFromSheet('Users');
    var requester = users.find(u => String(u.id) === String(requestData.userId) || String(u.employeeId) === String(requestData.userId));
    
    if (!requester || !requester.email) {
      console.log('No email found for requester to send KeyIssued notification.');
      return; 
    }

    // 2. เตรียมปุ่มลิ้งก์เข้า Web App
    var webAppUrl = ScriptApp.getService().getUrl();
    var linkHtml = `<br><br><a href="${webAppUrl}" style="display:inline-block; padding:12px 24px; background-color:#8e44ad; color:white; text-decoration:none; border-radius:8px; font-weight:bold; font-size:16px;">เปิดหน้าตรวจสภาพรถ: AMR Management</a>`;

    // 3. เตรียมข้อความอีเมล
    var subject = `[AMR] 🔑 รับกุญแจแล้ว - กรุณาตรวจสภาพรถก่อนเริ่มใช้งาน`;
    var htmlBody = `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 20px; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 10px;">
        <h2 style="color: #8e44ad; border-bottom: 2px solid #f0f0f0; padding-bottom: 10px;">🚗 กรุณาตรวจสภาพรถก่อนเริ่มขับขี่</h2>
        <p>เรียน คุณ ${requester.name},</p>
        <p>แอดมินได้ทำการบันทึก <strong>การจ่ายกุญแจ</strong> สำหรับรายการจองของคุณเรียบร้อยแล้ว</p>
        <ul style="line-height: 1.8; background: #fbf5ff; padding: 15px 15px 15px 35px; border-radius: 5px; border-left: 4px solid #8e44ad;">
          <li><strong>ยานพาหนะ:</strong> ${requestData.vehicleName || '-'}</li>
          <li><strong>วันที่จอง:</strong> ${requestData.startDate || '-'} ถึง ${requestData.endDate || '-'}</li>
          <li><strong>โครงการ:</strong> ${requestData.projectName || '-'}</li>
        </ul>
        <p style="color: #d35400; font-weight: bold; margin-top: 20px;">
          ⚠️ ขั้นตอนต่อไป: กรุณาไปที่รถและกดปุ่ม "ตรวจสภาพ" ในระบบ เพื่อบันทึกเลขไมล์และเช็คความเรียบร้อยก่อนนำรถออกไปใช้งาน
        </p>
        ${linkHtml}
      </div>
    `;

    // 4. ส่งอีเมล
    MailApp.sendEmail({
      to: requester.email,
      subject: subject,
      htmlBody: htmlBody
    });
    console.log('✅ KeyIssued Email sent to Requester: ' + requester.email);
    
  } catch (e) {
    console.error('❌ Error sending KeyIssued notification: ' + e.toString());
  }
}

// ==========================================
// 📧 NOTIFICATION TO ADMIN (ผู้ใช้คืนรถแล้ว รอแอดมินรับกุญแจ)
// ==========================================

function notifyAdminsOnReturn(bookingData) {
  try {
    // 1. ดึงข้อมูล User เพื่อหา Admin
    var users = getDataFromSheet('Users');
    var admins = users.filter(u => u.role === 'Admin' && u.email);

    if (admins.length === 0) {
      console.log('No Admin found to receive return notification.');
      return; 
    }

    // 2. สร้างลิงก์สำหรับ "กดยืนยันรับกุญแจ" (เมื่อกดแล้วจะไปเรียกฟังก์ชัน confirmKeyReturn ทันที)
    var webAppUrl = ScriptApp.getService().getUrl();
    var confirmKeyUrl = _signVehicleActionUrl_(webAppUrl, 'confirmKey', bookingData.id);
    
    var linkHtml = `
      <br><br>
      <div style="text-align: center;">
        <a href="${confirmKeyUrl}" style="display:inline-block; padding:14px 28px; background-color:#27ae60; color:white; text-decoration:none; border-radius:8px; font-weight:bold; font-size:18px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">🔑 ยืนยันรับกุญแจคืน</a>
      </div>
      <br>
      <div style="text-align: center;">
        <a href="${webAppUrl}" style="color:#7f8c8d; text-decoration:underline; font-size:14px;">หรือ เปิดหน้าเว็บ AMR Management</a>
      </div>
    `;

    // 3. เตรียมข้อความอีเมล
    var subject = `[AMR] 🚙 มีการคืนรถ - รอการยืนยันรับกุญแจ (${bookingData.vehicleName || '-'})`;
    var htmlBody = `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 20px; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 10px;">
        <h2 style="color: #27ae60; border-bottom: 2px solid #f0f0f0; padding-bottom: 10px;">🚙 แจ้งเตือนการคืนยานพาหนะ</h2>
        <p>เรียน ผู้ดูแลระบบ (Admin),</p>
        <p>ผู้ใช้งานได้ทำการบันทึก <strong>การคืนรถ</strong> เข้าสู่ระบบเรียบร้อยแล้ว กรุณาตรวจสอบความเรียบร้อยและกดยืนยันการรับกุญแจคืน:</p>
        <ul style="line-height: 1.8; background: #f9fbf9; padding: 15px 15px 15px 35px; border-radius: 5px; border-left: 4px solid #27ae60;">
          <li><strong>ผู้คืนรถ:</strong> ${bookingData.userName || '-'}</li>
          <li><strong>ยานพาหนะ:</strong> ${bookingData.vehicleName || '-'}</li>
          <li><strong>เลขไมล์ตอนคืน:</strong> ${bookingData.endMileage ? Number(bookingData.endMileage).toLocaleString() : '-'} km</li>
          <li><strong>น้ำมันคงเหลือ:</strong> ${bookingData.endFuel ? Number(bookingData.endFuel).toLocaleString() : '-'} ลิตร</li>
          <li><strong>สภาพรถ:</strong> <span style="color: ${bookingData.returnCondition === 'Normal' ? '#27ae60' : '#c0392b'}; font-weight: bold;">${bookingData.returnCondition === 'Normal' ? '✅ ปกติ' : '❌ ผิดปกติ (' + (bookingData.returnNote || '') + ')'}</span></li>
        </ul>
        ${linkHtml}
      </div>
    `;

    // 4. ส่งอีเมลหา Admin ทุกคน
    admins.forEach(admin => {
      MailApp.sendEmail({
        to: admin.email,
        subject: subject,
        htmlBody: htmlBody
      });
      console.log('✅ Return Notification sent to Admin: ' + admin.email);
    });
    
  } catch (e) {
    console.error('❌ Error sending return notification: ' + e.toString());
  }
}

// ==========================================
// 📧 NOTIFICATION TO USED (แอดมินแจ้งคืนของไม่ครบ ก่อนรับกุญแจคืน)
// ==========================================
function notifyMissingItems(portalToken, bookingId, missingItemsText) {
  var access = portalAccessForCall(portalToken, PORTAL_MENU_ID);
  if (!access.ok) throw new Error(access.message);
  if (!isAdminish(access)) throw new Error('เฉพาะ admin/manager เท่านั้น');
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const bookingSheet = ss.getSheetByName('Bookings');
    const userSheet = ss.getSheetByName('Users');
    
    // 1. ดึงข้อมูลจากชีต Bookings เพื่อหา userId และ vehicleName
    const bData = bookingSheet.getDataRange().getValues();
    const bHeaders = bData[0];
    const bIdCol = bHeaders.indexOf('id');
    const bUserIdCol = bHeaders.indexOf('userId');
    const bVehicleCol = bHeaders.indexOf('vehicleName');

    const bookingRow = bData.find(row => String(row[bIdCol]) === String(bookingId));
    if (!bookingRow) throw new Error("ไม่พบรหัสการจอง: " + bookingId);

    const targetUserId = bookingRow[bUserIdCol];
    const vehicleName = bookingRow[bVehicleCol] || "รถยนต์ของบริษัท";

    // 2. ไปที่ชีต Users เพื่อหาอีเมลจาก userId
    const uData = userSheet.getDataRange().getValues();
    const uHeaders = uData[0];
    const uIdCol = uHeaders.indexOf('id');
    const uEmailCol = uHeaders.indexOf('email'); // 🟢 ตรวจสอบว่าในชีต Users มีคอลัมน์ชื่อ email
    const uNameCol = uHeaders.indexOf('name');

    const userRow = uData.find(row => String(row[uIdCol]) === String(targetUserId));
    if (!userRow) throw new Error("ไม่พบข้อมูลผู้ใช้งานรหัส: " + targetUserId);

    const userEmail = userRow[uEmailCol];
    const userName = userRow[uNameCol] || "พนักงาน";

    if (!userEmail) throw new Error("ผู้ใช้งานท่านนี้ไม่ได้ระบุอีเมลในระบบ");

    // 3. ส่งอีเมลแจ้งเตือน
    const subject = "⚠️ แจ้งเตือน: รายการสิ่งของส่งคืนไม่ครบ (Booking #" + bookingId + ")";
    const htmlBody = `
      <div style="font-family: 'Prompt', sans-serif; border: 1px solid #eee; border-radius: 15px; overflow: hidden; max-width: 500px;">
        <div style="background-color: #d51929; color: white; padding: 20px; text-align: center;">
          <h2 style="margin: 0;">แจ้งเตือนของไม่ครบ</h2>
        </div>
        <div style="padding: 25px; color: #444;">
          <p>เรียน คุณ <b>${userName}</b></p>
          <p>จากการตรวจสอบการคืนรถ <b>${vehicleName}</b> แอดมินพบว่าท่านยังไม่ได้ส่งคืนสิ่งของดังนี้:</p>
          <div style="background-color: #fff5f5; border-left: 5px solid #d51929; padding: 15px; margin: 15px 0;">
            <b style="color: #d51929;">❌ รายการที่ขาด:</b><br/>
            <span style="font-size: 18px;">${missingItemsText}</span>
          </div>
          <p style="font-size: 12px; color: #888;">* สถานะรถจะเปลี่ยนเป็น "พร้อมใช้งาน" เมื่อแอดมินได้รับของครบถ้วนแล้วเท่านั้น</p>
        </div>
      </div>
    `;

    MailApp.sendEmail({
      to: userEmail,
      subject: subject,
      htmlBody: htmlBody
    });

    return "SUCCESS";

  } catch (error) {
    console.error("Notify Error: " + error.message);
    throw new Error("เกิดข้อผิดพลาด: " + error.message);
  }
}


// ==========================================
// 📧 NOTIFICATION FOR TAX EXPIRY (แจ้งเตือนต่อภาษีประจำปี 5 Levels)
// ==========================================

// 📍 1. กำหนดกลุ่มอีเมลสำหรับรับแจ้งเตือนเรื่อง "ภาษี" โดยเฉพาะ (แยกจากระบบอื่น)
const TAX_ADMIN_EMAIL = 'itsarin@amrasia.com, Vilasinee.S@amrasia.com, parichat@amrasia.com, pailin@amrasia.com' ; // เปลี่ยนเป็นอีเมลของทีมที่ดูแลเรื่องต่อภาษี

function checkTaxAndSendEmail() {
  try {
    const sheetName = 'Vehicles';
    const vehicles = getDataFromSheet(sheetName);
    
    // ใช้ SpreadsheetApp ดึง sheet เพื่อให้แน่ใจว่าอ้างอิงถูกต้อง
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

    // ตรวจสอบว่ามีคอลัมน์ 'lastTaxNotiLevel' หรือยัง
    let levelColIndex = headers.indexOf('lastTaxNotiLevel');
    if (levelColIndex === -1) {
      sheet.getRange(1, headers.length + 1).setValue('lastTaxNotiLevel');
      headers.push('lastTaxNotiLevel');
      levelColIndex = headers.length - 1;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    vehicles.forEach((vehicle, index) => {
      if (!vehicle.taxExpiryDate) return; 

      const taxDate = new Date(vehicle.taxExpiryDate);
      if (isNaN(taxDate.getTime())) return;
      
      const diffTime = taxDate.getTime() - today.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      let currentLevel = 0;
      let alertMessage = "";
      let alertColor = "#000000";

      // 🎯 แบ่ง Level 5 ระดับ
      if (diffDays <= 60 && diffDays > 30) {
        currentLevel = 1;
        alertMessage = `เหลือเวลาอีก ${diffDays} วัน จะครบกำหนด (ล่วงหน้า 2 เดือน)`;
        alertColor = "#f1c40f"; 
      } else if (diffDays <= 30 && diffDays > 15) {
        currentLevel = 2;
        alertMessage = `เหลือเวลาอีก ${diffDays} วัน จะครบกำหนด (ล่วงหน้า 1 เดือน)`;
        alertColor = "#f39c12"; 
      } else if (diffDays <= 15 && diffDays >= 0) {
        currentLevel = 3;
        alertMessage = `🚨 ด่วน! เหลือเวลาอีกเพียง ${diffDays} วัน จะหมดอายุ`;
        alertColor = "#e74c3c"; 
      } else if (diffDays < 0 && diffDays > -7) {
        currentLevel = 4;
        alertMessage = `⚠️ ขาดต่อภาษีมาแล้ว ${Math.abs(diffDays)} วัน!`;
        alertColor = "#c0392b"; 
      } else if (diffDays <= -7) {
        currentLevel = 5;
        alertMessage = `❌ ร้ายแรง! ขาดต่อภาษีเกิน 7 วันแล้ว (${Math.abs(diffDays)} วัน)`;
        alertColor = "#900C3F"; 
      }

      const lastLevel = Number(vehicle.lastTaxNotiLevel) || 0;

      // ถ้ามีการตกอยู่ใน Level ใดๆ และไม่ซ้ำกับที่เคยแจ้ง
      if (currentLevel > 0 && currentLevel !== lastLevel) {
        
        const subject = `[แจ้งเตือนภาษี Level ${currentLevel}] รถทะเบียน ${vehicle.licensePlate}`;
        
        const htmlBody = `
          <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 20px; border: 1px solid #ddd; border-radius: 8px; max-width: 600px; margin: 0 auto;">
            <h2 style="color: ${alertColor}; border-bottom: 2px solid #f0f0f0; padding-bottom: 10px;">⚠️ แจ้งเตือนการต่อภาษียานพาหนะ</h2>
            <p>เรียน ทีมผู้รับผิดชอบการต่อภาษี,</p>
            <p>ระบบขอแจ้งเตือนสถานะภาษีประจำปีของยานพาหนะ ดังนี้:</p>
            <ul style="line-height: 1.8; background: #f9f9f9; padding: 15px 15px 15px 35px; border-radius: 5px; border-left: 4px solid ${alertColor};">
              <li><strong>ยานพาหนะ:</strong> ${vehicle.brand || ''} ${vehicle.model || ''}</li>
              <li><strong>ทะเบียนรถ:</strong> ${vehicle.licensePlate || '-'}</li>
              <li><strong>วันที่หมดอายุ:</strong> ${taxDate.toLocaleDateString('th-TH')}</li>
            </ul>
            <p style="font-size: 18px; font-weight: bold; color: ${alertColor}; text-align: center; margin: 20px 0;">
              ${alertMessage}
            </p>
            <p>กรุณาดำเนินการต่อภาษีประจำปี เพื่อให้ยานพาหนะพร้อมใช้งานและหลีกเลี่ยงค่าปรับค่ะ</p>
          </div>
        `;

        try {
          // 📍 2. เปลี่ยนมาใช้ TAX_ADMIN_EMAIL ตรงนี้ค่ะ!
          MailApp.sendEmail({
            to: TAX_ADMIN_EMAIL, 
            subject: subject,
            htmlBody: htmlBody
          });

          sheet.getRange(index + 2, levelColIndex + 1).setValue(currentLevel);
          console.log(`✅ Sent Tax alert for ${vehicle.licensePlate} to ${TAX_ADMIN_EMAIL} (Level ${currentLevel})`);
        } catch (e) {
          console.error(`❌ Error sending Tax email for ${vehicle.licensePlate}: ` + e.message);
        }
      } 
      else if (diffDays > 60 && lastLevel !== 0) {
        sheet.getRange(index + 2, levelColIndex + 1).setValue(0);
      }
    });
  } catch (e) {
    console.error('❌ Error in checkTaxAndSendEmail: ' + e.toString());
  }
}


// 🟢 1. ปรับฟังก์ชันส่งให้รับ targetId ได้โดยตรง
function sendLineMessageAPI(message, targetId) {
  try {
    const settings = getSettings();
    const token = settings.lineMessagingToken;

    if (!token || !targetId || targetId.includes("ใส่_")) return;

    const url = "https://api.line.me/v2/bot/message/push";
    const payload = {
      "to": targetId,
      "messages": [{ "type": "text", "text": message }]
    };

    const options = {
      "method": "post",
      "contentType": "application/json",
      "headers": { "Authorization": "Bearer " + token },
      "payload": JSON.stringify(payload),
      "muteHttpExceptions": true
    };

    const response = UrlFetchApp.fetch(url, options);
    console.log(`📤 ส่งไปที่ ${targetId}: Code ${response.getResponseCode()}`);
  } catch (err) {
    console.error("LINE API Error: " + err.toString());
  }
}

// 🟢 เวอร์ชันเพิ่ม "วันที่ล้างล่าสุด" และแยกตารางในเมลเดียว
function checkCarWashAndNotifyNEW() {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Vehicles');
    const data = sheet.getDataRange().getValues();
    const headers = data[0];

    const plateIdx = headers.indexOf('licensePlate');
    const washDateIdx = headers.indexOf('lastWashDate');
    const respIdx = headers.indexOf('responsibleName');
    const brandIdx = headers.indexOf('brand');
    const typeIdx = headers.indexOf('type');
    const statusIdx = headers.indexOf('status');
    const levelColIdx = headers.indexOf('lastWashNotiLevel');

    const today = new Date();
    today.setHours(0,0,0,0);

    let carAlerts = [];
    let motoAlerts = [];

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][statusIdx]) === 'Inactive') continue;

      const plate = data[i][plateIdx];
      const brand = data[i][brandIdx];
      const type = String(data[i][typeIdx]).toLowerCase();
      const respName = data[i][respIdx] || "ไม่ระบุผู้ดูแล";
      const lastWash = data[i][washDateIdx];
      const lastLevel = Number(data[i][levelColIdx]) || 0;

      // คำนวณจำนวนวัน
      let diffDays = (lastWash instanceof Date) 
        ? Math.floor((today - lastWash) / (1000 * 60 * 60 * 24)) 
        : 999;

      let currentLevel = 0;
      let alertMsg = "";

      // เกณฑ์การตัดสิน Level
      if (diffDays >= 23 && diffDays <= 30) { currentLevel = 1; alertMsg = `⏳ อีก ${30-diffDays} วันครบกำหนด`; }
      else if (diffDays > 30 && diffDays <= 40) { currentLevel = 2; alertMsg = `🚨 เกินกำหนด ${diffDays-30} วัน`; }
      else if (diffDays > 40 && diffDays <= 50) { currentLevel = 3; alertMsg = `🔥 เกินกำหนด ${diffDays-30} วัน (ด่วน)`; }
      else if (diffDays > 50 && diffDays <= 60) { currentLevel = 4; alertMsg = `📢 เกินกำหนดกว่า 50 วัน!`; }
      else if (diffDays > 60) { currentLevel = 5; alertMsg = `❌ เกินกำหนดนานมาก`; }

      // ส่งแจ้งเตือนเมื่อ Level เปลี่ยน
      if (currentLevel > 0 && currentLevel !== lastLevel) {
        // จัดรูปแบบวันที่ล้างล่าสุดให้อ่านง่าย (dd/MM/yyyy)
        let formattedDate = (lastWash instanceof Date)
          ? Utilities.formatDate(lastWash, Session.getScriptTimeZone(), "dd/MM/yyyy")
          : "ไม่เคยบันทึก";

        let item = { 
          plate: plate, 
          brand: brand, 
          resp: respName, 
          status: alertMsg,
          lastWashDate: formattedDate 
        };
        
        if (type.includes("motorcycle") || type.includes("มอเตอร์ไซค์")) {
          motoAlerts.push(item);
        } else {
          carAlerts.push(item);
        }
        
        sheet.getRange(i + 1, levelColIdx + 1).setValue(currentLevel);
      } 
      else if (diffDays < 23 && lastLevel !== 0) {
        sheet.getRange(i + 1, levelColIdx + 1).setValue(0);
      }
    }

    // --- ส่วนการสร้างเนื้อหาอีเมล ---
    if (carAlerts.length > 0 || motoAlerts.length > 0) {
      let htmlBody = `<div style="font-family:sans-serif; padding:20px;"><h2 style="color:#2c3e50;">🚿 รายงานสรุปรายการรถที่ต้องล้าง</h2>`;

      const createTable = (title, items, color) => {
        if (items.length === 0) return "";
        let rows = items.map(item => `
          <tr>
            <td style="padding:10px; border:1px solid #ddd;">${item.plate} (${item.brand})</td>
            <td style="padding:10px; border:1px solid #ddd; text-align:center;">${item.lastWashDate}</td>
            <td style="padding:10px; border:1px solid #ddd;">${item.resp}</td>
            <td style="padding:10px; border:1px solid #ddd; font-weight:bold; color:#d35400;">${item.status}</td>
          </tr>`).join("");
        
        return `
          <h3 style="color:${color}; margin-top:25px;">${title}</h3>
          <table style="width:100%; border-collapse:collapse;">
            <thead><tr style="background:#f8f9fa;">
              <th style="padding:10px; border:1px solid #ddd; text-align:left;">ทะเบียน/ยี่ห้อ</th>
              <th style="padding:10px; border:1px solid #ddd; text-align:center;">วันที่ล้างล่าสุด</th>
              <th style="padding:10px; border:1px solid #ddd; text-align:left;">ผู้ดูแล</th>
              <th style="padding:10px; border:1px solid #ddd; text-align:left;">สถานะ</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>`;
      };

      htmlBody += createTable("🚗 รายการรถยนต์", carAlerts, "#2980b9");
      htmlBody += createTable("🛵 รายการรถจักรยานยนต์", motoAlerts, "#8e44ad");
      htmlBody += `<p style="margin-top:25px; color:#666; font-size:12px;">* ระบบส่งแจ้งเตือนเฉพาะเมื่อระดับความรุนแรงเปลี่ยนแปลงเท่านั้น</p></div>`;

      MailApp.sendEmail({
        to: ADMIN_EMAIL,
        subject: `[AMR] สรุปค้างล้างรถ: รถยนต์ (${carAlerts.length}) | มอเตอร์ไซค์ (${motoAlerts.length})`,
        htmlBody: htmlBody
      });
      console.log("✅ ส่งอีเมลสรุปพร้อมวันที่ล้างล่าสุดเรียบร้อยแล้ว");
    }
  } catch (err) { console.error("Wash Notification Error: " + err.toString()); }
}