# Vehicle app — portal retrofit

แอปนี้ใช้ความพยายามมากที่สุดในทั้ง 9 แอป: ก่อนแตะเรื่องสิทธิ์อะไรเลยต้องแก้ไฟล์
`Database.js` ที่พังอยู่ก่อน (ดูหัวข้อ 0) จากนั้นตัด login ของตัวเองที่ส่ง
**รหัสผ่าน plain text ทั้งชีต `Users` ให้ browser ทุกคนตั้งแต่โหลดหน้า** ออกทั้งหมด
แล้วเพิ่มการเช็คสิทธิ์ฝั่งเซิร์ฟเวอร์ให้ endpoint ที่ไม่เคยเช็คอะไรเลยมาก่อนประมาณ 18 จุด
รวมถึง query action ทางอีเมลอีก 3 จุดที่ไม่มีการยืนยันตัวตนเลย (ใครมี booking id ก็
อนุมัติ/จ่ายกุญแจ/ยืนยันรับกุญแจแทนคนอื่นได้)

## 0. `Database.js` — เคลียร์โค้ดที่ซ้ำซ้อนกันก่อนทำอย่างอื่น

ไฟล์เดิมมีนิยาม `getSheet`/`getDataFromSheet`/`addRowToSheet`/`updateRowInSheet`/
`deleteRowInSheet` **ซ้ำกันสองชุด** ชุด "v2.0 cleaned" ถูกวางผิดที่ไปอยู่ใน branch
`if (!sheet) { ... }` ของ `getDataFromSheet` ตัวแรกโดยไม่ตั้งใจ (มีอักขระ `a` หลุด
ติดมาด้วยที่บรรทัดเดียวกัน ทำให้เกิดโครงสร้างแปลกๆ) วิเคราะห์ด้วย Node จริง
(`Function.prototype.toString()` เทียบกับ depth ของวงเล็บปีกกา) แล้วพบว่า:

- ชุด "v2.0" ทั้งหมด (รวม `SHEET_NAMES`, `_getSpreadsheet`, `_getHeaders`,
  `_serializeValue`) เป็น**โค้ดตายที่ไม่เคยถูกเรียกใช้จริง** เพราะติดอยู่ในเงื่อนไข
  `if (!sheet)` ที่เป็นจริงเฉพาะตอนหาชีตไม่เจอ — และถ้าเกิดเงื่อนไขนั้นจริง โค้ดจะ
  `throw ReferenceError: a is not defined` ก่อนถึงส่วนที่ทำงานจริงเสียอีก
- โค้ดที่**ทำงานจริงในโปรดักชันทุกวันนี้**คือชุดแรก/เดิม (`getSheet` ที่สร้างชีตใหม่
  อัตโนมัติถ้าไม่เจอ, `getDataFromSheet` ที่ใช้ `getDisplayValues()` ไม่ใช่
  `getValues()`, ไม่กรองแถวว่าง) กับชุดที่สามที่หลุดอยู่ท้ายไฟล์ (`addRowToSheet`/
  `updateRowInSheet`/`deleteRowInSheet` แบบง่าย)

**การแก้**: เก็บเฉพาะชุดที่ทำงานจริงอยู่แล้วไว้ (ไม่ใช่ชุด "v2.0" ที่ดูสะอาดกว่าแต่
พฤติกรรมต่างกัน — เช่น `getValues()` คืน Date object ดิบ ส่วน `getDisplayValues()`
คืน string ตามฟอร์แมตที่ตั้งไว้ในชีต ถ้าสลับไปใช้ตัวอื่นอาจเปลี่ยนรูปแบบวันที่ที่
หน้าเว็บได้รับโดยไม่ตั้งใจ) ลบโค้ดตายทั้งหมดทิ้ง ไฟล์ใหม่มีฟังก์ชันแต่ละตัวนิยาม
ครั้งเดียว ไม่มี syntax ประหลาดอีกต่อไป — ยืนยันด้วย `node --check` และ harness
ที่เรียก `getDataFromSheet`/`addRowToSheet` จริงแล้วตรวจผลลัพธ์

## 1. ตัด login ของตัวเองออกทั้งหมด

- **`ReactApp.html`** (React bundle ที่ build มาเป็นไฟล์เดียวขนาด ~800KB บรรทัดเดียว
  ไม่มี source map — แก้ด้วยการแทนที่ string ที่ตรงกันแบบเป๊ะๆ ทีละจุด ไม่ใช่เขียน
  ใหม่ทั้งไฟล์ เพื่อไม่ให้กระทบโค้ดส่วนอื่นที่ไม่เกี่ยวข้อง):
  - ตัดการอ่าน/เขียน `localStorage.getItem/setItem("amr_user_session")` ที่ใช้ auto
    login ตอนโหลดหน้า (เดิมไม่มีวันหมดอายุ ไม่เคยถูกตรวจซ้ำเลย — ตรงข้ามกับ
    ข้อกำหนดเรื่องสิทธิ์ต้องมีผลทันทีที่สุด) ออกจากจุดเข้าเริ่มต้นของแอป — เปลี่ยนเป็น
    seed `currentUser` จาก `ce.currentUser` ที่ `getInitialData()` คำนวณจาก
    `access.email` (อีเมลที่ Hub ยืนยันแล้ว) แทนทันทีที่ข้อมูลโหลดเสร็จ
  - เงื่อนไขที่เคย fallback ไปแสดงฟอร์ม login (`PG`, `.find()` เทียบรหัสผ่านฝั่ง
    client กับข้อมูลทั้งชีต `Users`) เปลี่ยนเป็นข้อความ "ไม่สามารถยืนยันตัวตนได้
    กรุณาเปิดใหม่ผ่าน OMA Portal" แทน (เกิดเฉพาะตอน `getInitialData()` ล้มเหลวจริง)
    — **ไม่ได้ลบ component `PG` ทิ้ง** (มันแค่ไม่ถูกเรียกใช้แล้ว) เพื่อความปลอดภัย
    ในการแก้ไข bundle ที่ minify แล้วโดยไม่มี source map; ยังไงก็ตาม เพราะ
    `getInitialData()` เลิกส่ง `password` ให้ browser แล้ว ต่อให้ `PG` ถูกเรียกใช้
    ขึ้นมาจริงๆ ก็ล็อกอินไม่ได้อยู่ดี (เทียบรหัสผ่านกับ `undefined` เสมอ)
  - จุดเรียก backend ทั้งหมดรวมเป็นจุดเดียว (`class qG { run(t,...n){...} }`,
    instance `ht`) — แก้ตรงนี้จุดเดียวก็ทำให้ทุก endpoint (15 ตัว) ได้รับ
    `window.PORTAL.token` เป็นพารามิเตอร์แรกอัตโนมัติ ไม่ต้องไล่แก้ทีละจุดเรียก
  - จุดที่เรียก `google.script.run` ตรงๆ นอกเหนือจาก `run()` (`handleUploadFile`
    ×2, `getFleetCard`, `notifyMissingItems`) แก้ให้แนบ token ตรงจุดเช่นกัน

## 2. `getInitialData(portalToken)` เลิกส่งรหัสผ่านให้ browser

คอลัมน์ `password` ถูกตัดออกจาก object ผู้ใช้ทุกคนก่อนส่งกลับ (เดิมส่งทั้งก้อนรวม
รหัสผ่าน plain text ให้ทุกคนที่เปิดหน้าเว็บ ไม่ว่าจะ login หรือยัง) `currentUser`
เปลี่ยนจากอ่าน `Session.getActiveUser().getEmail()` (ว่างเปล่าเสมอสำหรับ Web App ที่
deploy แบบ "Anyone" — ไม่เคยถูกใช้จริงฝั่ง client อยู่แล้ว) เป็นจับคู่กับ
`access.email` ที่ Hub ยืนยันแล้วแทน

**ผลข้างเคียงที่ต้องแก้ตาม**: ฟอร์มแก้ไขผู้ใช้ใน `ReactApp.html` มีช่องกรอกรหัสผ่าน
ที่เดิม auto-fill จากข้อมูลที่ได้รับมา (placeholder "(ไม่เปลี่ยน)" ตอนแก้ไข บอกอยู่แล้ว
ว่าตั้งใจให้เว้นว่าง = ไม่เปลี่ยน) พอไม่ส่งรหัสผ่านมาอีกต่อไป ช่องนี้จะว่างเสมอตอนแก้ไข
— ถ้าไม่กันไว้ `updateUser` จะเขียนรหัสผ่านว่างทับของจริงทุกครั้งที่แก้ไขผู้ใช้ (แม้ไม่ได้
ตั้งใจเปลี่ยนรหัสผ่านเลย) จึงเพิ่มเงื่อนไข: `password` ที่ส่งมาว่าง → ไม่เขียนทับ
ฟิลด์นี้ (ทดสอบแล้ว)

## 3. เพิ่มการเช็คสิทธิ์ฝั่งเซิร์ฟเวอร์ให้ endpoint เขียนข้อมูลทั้งหมด (~18 จุด)

ทุกจุดเรียก `portalAccessForCall(portalToken, PORTAL_MENU_ID)` ก่อนแตะชีตเสมอ:

- **CRUD ระดับองค์กร** (`addVehicle`/`updateVehicle`/`deleteVehicle`,
  `addUser`/`updateUser`/`deleteUser`, `addProject`/`updateProject`/
  `deleteProject`) — `isAdminish(access)` เท่านั้น (`addUser`/`updateUser`
  แก้ role/รหัสผ่านของคนอื่นได้ ห้ามให้คนที่ไม่ใช่ admin/manager เรียกได้เด็ดขาด)
- **`submitBooking`** — `canWrite`; **บังคับ `userId`/`userName`/`userEmail` จาก
  อีเมลที่ Hub ยืนยันแล้วเสมอ** (ทดสอบแล้วว่าเดิม client ส่ง `userId` ปลอมเป็นคนอื่น
  มาจองแทนได้ — ตอนนี้ระบบมองหาแถวในชีต `Users` ของแอปนี้เองที่ email ตรงกับ
  `access.email` แล้วใช้ id/name ของแถวนั้นเสมอ ไม่สนค่าที่ client ส่งมา)
- **`updateBookingStatus`** — การเปลี่ยนสถานะทั่วไปใช้ `canWrite` แต่ **transition
  ระดับอนุมัติ** (Approved/Rejected/KeyIssued/รับกุญแจคืน/Finished) **ต้อง
  `isAdminish` เพิ่มเติม** (แผนต้นฉบับระบุแค่ `canWrite` แต่เมื่ออ่านโค้ดจริงแล้วพบว่า
  `canWrite` แปลว่า "ไม่ใช่ viewer" เท่านั้น — คนขับรถทั่วไปจะอนุมัติ/จ่ายกุญแจ/รับกุญแจ
  คืนให้ตัวเองหรือคนอื่นได้ถ้าใช้แค่เกณฑ์นี้ จึงเข้มขึ้นเป็น admin/manager สำหรับ
  transition เหล่านี้โดยเฉพาะ — เป็นการตัดสินใจที่ต่างจากคำอธิบายในแผนเล็กน้อย
  เพราะแผนเขียนไว้ก่อนอ่านโค้ดไฟล์นี้ละเอียด) **`adminName`/`keyIssuedBy`/
  `keyReceivedBy` ไม่เชื่อค่าที่ client ส่งมาอีกต่อไป** ใช้ชื่อจริงจากอีเมลที่ยืนยัน
  แล้วเสมอ (ทดสอบแล้วว่าเดิม client ปลอมชื่อผู้อนุมัติได้)
- **`submitReturn`** — `canWrite` + **เจ้าของ booking เองหรือ admin/manager
  เท่านั้น** (แผนระบุแค่ `canWrite` แต่การคืนรถเขียนไมล์/น้ำมัน/บัตรน้ำมันของ booking
  คนอื่นได้ถ้าไม่เช็คความเป็นเจ้าของ จึงเพิ่มการเช็คไว้ด้วยเพื่อความถูกต้องของข้อมูล)
- **`addMaintenance`** — `canWrite`. **`updateMaintenance`** — เหมือน
  `updateBookingStatus`: `canWrite` ทั่วไป แต่ transition อนุมัติ (Approved/
  Rejected/Completed/In Progress) ต้อง `isAdminish` (แผนขอให้ยืนยันกับผู้ใช้ว่า
  ควรเป็น `isAdminish` หรือ `canWrite` — เลือก `isAdminish` สำหรับ transition
  เพื่อให้สอดคล้องกับ `updateBookingStatus` และปิดช่องโหว่ privilege escalation
  เดียวกัน ถ้าต้องการเปลี่ยนภายหลังแก้ที่ `isApprovalAction` ในทั้งสองฟังก์ชันได้เลย)
- **`saveBookingEditFromHTML`** (`EditBookingForm.js`) — เจ้าของ booking เองหรือ
  admin/manager เท่านั้น (เดิมเช็คแค่สถานะ `Pending` ใครมี booking id ก็แก้แทนคนอื่น
  ได้หมด) หน้าฟอร์มนี้เปิดจากลิงก์ `target="_blank"` แยกแท็บ ไม่มี iframe/
  `window.PORTAL` ให้ใช้ — `ReactApp.html` จึงแนบ `window.PORTAL.token` เป็น query
  param ตอนสร้างลิงก์ "แก้ไข" แล้ว `doGet`/ฟอร์มส่งต่อ token เดิมเข้าไปใน
  `saveBookingEditFromHTML(token, data)` ตอนกด "บันทึก"
- **`handleUploadFile`** (`doPost` action `UPLOAD_FILE`, Main.js) — `canWrite`
  (เดิมรับไฟล์ base64 อะไรก็ได้จากใครก็ได้ ไปเก็บใน Drive folder แชร์แบบเปิดลิงก์)
- **`saveCarWashRecord`** — `canWrite` (หน้าติดตามล้างรถเปิดแยกแท็บเหมือน editForm
  — `template.portalToken` ถูกฝังเข้า `CarWashUI.html` ตอน render แล้วส่งต่อทุกจุด
  ที่เรียก `google.script.run` รวมถึงตอน refresh หน้าเองหลัง submit)
- **`notifyMissingItems`** — `isAdminish` (แจ้งเตือนพนักงานว่าคืนของไม่ครบ เป็น
  การกระทำระดับแอดมิน ไม่ใช่ทุกคนควรส่งได้)

## 4. ลิงก์อีเมล 3 จุด (`confirmKey`/`approveBooking`/`issueKey`) — เซ็น HMAC

เดิมทั้ง 3 จุดนี้ไม่มีการยืนยันตัวตนใดๆ เลย — ใครก็ตามที่มี booking id (เดา/เห็นจาก
ที่อื่น) เปิด URL `?q=approveBooking&id=<id>` ก็อนุมัติการจองแทนผู้มีอำนาจจริงได้ทันที
เช่นเดียวกับ `issueKey` (บันทึกจ่ายกุญแจ) และ `confirmKey` (ยืนยันรับกุญแจคืน) แก้ด้วย
ลิงก์เซ็น HMAC แบบเดียวกับที่ใช้ใน Lab Room (`_signVehicleActionUrl_`/
`_verifyVehicleLink_` ใน `Main.js`, secret เก็บใน `PropertiesService`, หมดอายุใน
90 วัน — กว้างกว่ากรณี Lab Room เพราะ booking อาจค้างรอจ่าย/รับกุญแจนานกว่าการจองห้อง)
ลิงก์ `confirmKey` เดิมยังถูกสร้างซ้ำอีกจุดในแอป (แสดงในรายการ booking ที่ยังไม่คืน
กุญแจ) ก็เปลี่ยนไปใช้ตัวเซ็นเดียวกันด้วย เพื่อให้มีกลไกยืนยันแบบเดียวไม่ว่าจะเปิดจาก
อีเมลหรือจากในแอป

`requireEdit` (แอดมินสั่งตีกลับให้แก้ไข) เดิมไม่มีการเช็คสิทธิ์เลยเช่นกัน แต่เป็น action
ที่ยิงจาก `fetch()` ภายในแอปที่ล็อกอินอยู่แล้ว (ไม่ใช่ลิงก์อีเมล) — ใช้ `portalToken` +
`isAdminish` แทนการเซ็นลิงก์

`?q=pdf`/`?q=bookingPdf`/`?q=maintenancePdf`/`?q=editForm`/`?q=carwash` — เดิมไม่มี
การเช็คสิทธิ์เลยเหมือนกัน (ใครมี booking id ก็เปิดดู/พิมพ์ได้) ตอนนี้ทุกจุดต้องมี
`portalToken` ที่ยืนยันผ่าน Hub แล้ว (`editForm` เพิ่มเช็คเจ้าของ/admin ก่อนแสดงฟอร์ม
ด้วย ไม่ใช่แค่ก่อนบันทึก)

## ทดสอบแล้ว

รัน harness จำลอง Hub จริง (`test-vehicle.js`, 14 กลุ่มทดสอบ): `Database.js`
เหลือ implementation เดียวไม่มีโค้ดตาย, `loginUserBackend` ไม่มีอยู่แล้ว,
`getInitialData` ต้อง token ที่ถูกต้องและไม่ส่ง password, CRUD ระดับองค์กรทั้ง 9 ตัว
ปฏิเสธผู้ใช้ที่ไม่ใช่ admin/manager, `submitBooking` ปฏิเสธการปลอมตัวเป็นคนอื่น
(บังคับ userId/userEmail จากอีเมลจริง), `updateBookingStatus` ปฏิเสธ driver ที่
พยายามอนุมัติเอง และบังคับ `keyIssuedBy` เป็นชื่อจริงแม้ client จะปลอมชื่อมา,
`submitReturn` ปฏิเสธคนที่ไม่ใช่เจ้าของ/admin, `updateMaintenance` เข้มเหมือนกัน,
`saveBookingEditFromHTML` throw จริงเมื่อไม่มีสิทธิ์ (ไม่ใช่คืนค่า error แบบเงียบๆ
ที่ทำให้หน้าเว็บเข้าใจผิดว่าสำเร็จ), `saveCarWashRecord`/`notifyMissingItems`
ปฏิเสธ token ปลอม/สิทธิ์ไม่พอ, ลิงก์เซ็น HMAC ทั้ง 3 action ผ่านการ verify ที่ถูกต้อง
และถูกปฏิเสธเมื่อ id ถูกแก้/ลายเซ็นหาย/หมดอายุ, `updateUser` ไม่เขียนรหัสผ่านว่าง
ทับของจริง, และโหมด shadow (`PORTAL_ENFORCE=false`) ยังทำงานแบบเดิมทุกอย่างแม้
token ปลอม นอกจากนี้ตรวจ syntax ทุกไฟล์ `.js`/`.gs` ด้วย `node --check` และ
`ReactApp.html`'s inline script (ทั้งไฟล์เป็น `<script type="module">` เดียว) ด้วย
`node --check` แบบ ESM

## สิ่งที่ยังไม่ได้ตรวจสอบ / ต้องยืนยันกับผู้ใช้

- **`updateBookingStatus`/`updateMaintenance` ใช้ `isAdminish` สำหรับ transition
  อนุมัติ** ต่างจากคำอธิบายในแผนที่เขียนไว้กว้างๆ ว่า `canWrite` — ถ้าต้องการให้คนขับ
  ทั่วไป (ไม่ใช่ admin/manager) อนุมัติ/จ่ายกุญแจ/ปิดงานซ่อมของตัวเองได้ด้วย ต้องปรับ
  เงื่อนไข `isApprovalAction` ในทั้งสองฟังก์ชัน (Backend.js)
- ยังไม่ได้ยืนยันกับชีตจริงว่าคอลัมน์ `keyReturned`/`keyIssuedBy`/`keyReceivedBy`/
  `adminNote`/`createdAt`/`endFuel`/`fuelLevel`/`currentFuel` มีอยู่ในชีต `Bookings`/
  `Vehicles` จริงหรือไม่ (Setup.js ต้นฉบับไม่ได้นิยามคอลัมน์เหล่านี้ไว้ แต่โค้ดส่วนอื่น
  อ้างอิงถึงอยู่แล้ว แปลว่าชีตจริงต้องมีคอลัมน์เหล่านี้เพิ่มมาด้วยมือ) — ถ้าคอลัมน์ไหน
  ไม่มีอยู่จริง `updateRowInSheet`/`getDataFromSheet` จะไม่เขียน/อ่านฟิลด์นั้นแบบ
  เงียบๆ (พฤติกรรมเดิมของ `Database.js` ไม่ใช่สิ่งที่แก้ไขรอบนี้)
- คอมเมนต์ใน `Setup.js` ระบุว่า LINE Messaging token ที่เคยฝังเป็น plain text ในไฟล์นี้
  ถูกถอดออกจากซอร์สไปแล้วก่อนอัปโหลดมาให้ (11 ก.ย. 2026) และควรเพิกถอนที่ LINE
  Developers Console ด้วย — ไม่ใช่สิ่งที่ทำในรอบนี้ (ไม่ใช่ auth ของระบบ Portal) แต่
  แจ้งไว้เผื่อผู้ใช้ยังไม่ได้เพิกถอนจริง
- ระบบล้างรถ/PDF/แก้ไข booking (`?q=carwash`/`?q=pdf`/`?q=bookingPdf`/
  `?q=maintenancePdf`/`?q=editForm`) เปิดในแท็บแยกด้วย `target="_blank"` เสมอ
  ไม่ได้ฝังใน iframe ของ Portal — ต้อง `portalToken` ที่แนบมาในลิงก์ยังไม่หมดอายุ
  (TTL เดียวกับ session ปกติที่ Hub กำหนด) ถ้า token หมดอายุระหว่างเปิดแท็บค้างไว้
  นาน ผู้ใช้ต้องกลับไปเปิดจาก Portal ใหม่

## วิธี deploy

1. เปิด Apps Script project ของแอป Vehicle เดิม
2. แทนที่ไฟล์ทั้งหมดด้วยไฟล์ในโฟลเดอร์นี้ (`Database.js`, `Main.js`, `Backend.js`,
   `Notifications.js`, `EditBookingForm.js`, `CarWash.js`, `CarWashUI.html`,
   `index.html`, `PDF.js`, `Setup.js`, `CustomAlert.html`, `Styles.html`)
   — **`ReactApp.html` มีขนาดใหญ่ (~800KB) วางทับไฟล์เดิมทั้งไฟล์**
3. วาง `portal/PortalGuard.gs` เพิ่มเข้าไป แล้วแก้ `PORTAL_HUB_URL`
4. Deploy ใหม่ — ยังเป็น shadow mode (`PORTAL_ENFORCE = false`) จนกว่าจะยืนยันแล้วว่า
   สิทธิ์ผู้ใช้จริงถูกต้อง **แจ้งผู้ใช้ล่วงหน้าว่าหน้า login ของแอปนี้จะหายไป** (เปลี่ยนไป
   ล็อกอินที่ Portal แทน) และฟอร์มแก้ไขผู้ใช้จะไม่เห็นรหัสผ่านเดิมอีกต่อไป (ตั้งใจ)
5. หลังเปิดใช้งานจริงและมั่นใจแล้ว ค่อยพิจารณาลบคอลัมน์ `password` ออกจากชีต `Users`
   จริง (Phase 3 ตามแผน) เพราะไม่มีโค้ดจุดไหนอ่านมันใช้แล้ว
