# Lab Room Booking app — portal retrofit

ต้นฉบับมีปัญหาหนักสุด 3 เรื่องพร้อมกัน: (1) login ของตัวเอง เทียบรหัสผ่านฝั่ง
client กับข้อมูลทั้งชีต `Users` **ที่ถูกส่งไปให้ browser ทุกคนอยู่แล้วรวมรหัสผ่าน
plain text**, (2) session เก็บใน `localStorage` ถาวรไม่มีวันหมดอายุและไม่เคยถูก
ตรวจซ้ำ, (3) ลิงก์อีเมล (`?action=...`) ไม่มีการยืนยันตัวตนเลย — `approve` เรียก
ฟังก์ชันที่ไม่มีอยู่จริง (ลิงก์พังมาตลอด), `cancel` รับอีเมลผู้กระทำจาก URL ตรงๆ

## สิ่งที่แก้

### 1. ตัด login/session ของตัวเองออกทั้งหมด
- ลบ `handleLogin`, `handleLogout`, การ restore/set `localStorage` (`lab_user`,
  `lab_is_logged_in`) ออกจาก `Index.html`
- `currentUser` ตอนนี้ประกอบจาก `window.PORTAL` (อีเมล/ชื่อ/role ที่ Hub ยืนยันแล้ว)
  ผสมกับข้อมูล team/position/allowedProjects ที่หาได้จากทำเนียบ `Users` (ไม่มี
  password ติดมาแล้ว) — ไม่ใช่แหล่งเดียวที่เชื่อถือได้ของ role อีกต่อไป (role จริง
  มาจาก Hub, ใช้แค่แสดงผล)
- หน้า login ถูกแทนที่ด้วยหน้า "กำลังโหลด" ธรรมดา — login จริงทำที่ OMA Portal แล้ว
- ปุ่ม "ออกจากระบบ" ถูกลบออก (logout ทำที่ Portal หลัก)

### 2. `getDatabaseData(portalToken)` เลิกส่งรหัสผ่านให้ browser
คอลัมน์ `password` ถูกข้ามตอนแปลงชีต `Users` เป็น object ก่อนส่งกลับ — ฟิลด์อื่น
(team/position/allowedProjects/role) ยังส่งอยู่เพราะ UI ยังใช้จริง (เช่น default
โครงการตอนจอง) แต่ password ไม่มีประโยชน์อะไรอีกต่อไปเมื่อ login ย้ายไปที่ Hub แล้ว

### 3. เขียนข้อมูลทั้ง 5 endpoint ยืนยันสิทธิ์กับ Hub จริงทุกครั้ง
- `saveNewBooking(portalToken, booking)` — บังคับ `userEmail` จาก `access.email`
  เสมอ (ทดสอบแล้วว่าต่อให้ client ส่ง `userEmail` ปลอมมา ระบบก็บันทึกอีเมลจริงของ
  ผู้ยืนยันตัวตนแทน)
- `deleteBookingById(portalToken, id)` — ลบการค้นหา role จากชีต `Users` ทิ้งทั้งหมด
  ใช้ `isAdminish(access)` (ยืนยันสดกับ Hub) แทน — เจ้าของคิวเองหรือ admin/manager
  เท่านั้นยกเลิกได้
- `saveStaticAreaData(portalToken, areaData)` — เฉพาะ admin/manager
- `extendBookingCustom(portalToken, bookingId, newEndDateStr, newEndTimeStr,
  extendReason)` — ตัดพารามิเตอร์ `userEmail` ที่ client เคยส่งมาเองทิ้ง อ่านเจ้าของ
  คิวจากชีตแทนแล้วเช็ค เจ้าของเองหรือ admin/manager
- `endBookingById(portalToken, bookingId)` — เพิ่มไว้เผื่ออนาคต (ปัจจุบัน
  `Index.html` ยังไม่มีปุ่มเรียกฟังก์ชันนี้ตรงๆ เข้าถึงได้ทางลิงก์อีเมลเท่านั้น)

### 4. ลิงก์อีเมล — จุดเดียวที่ใช้ลายเซ็น HMAC แทนการ verify สด
เพราะผู้รับอีเมลไม่มี portal session ให้ยืนยัน:
- `checkAndSendReminders()` เซ็นลิงก์ `extend`/`end` ด้วย
  `Utilities.computeHmacSha256Signature` (secret เก็บใน
  `PropertiesService`, สร้างอัตโนมัติครั้งแรกที่ใช้) หมดอายุใน 48 ชม.
- `doGet`'s `?action=` branch ตรวจลายเซ็นแบบ constant-time ก่อนทำงาน ปฏิเสธถ้า
  หมดอายุหรือถูกแก้พารามิเตอร์
- **ลบ `approve`/`cancel` branch ทิ้งทั้งคู่** — `approve` เรียกฟังก์ชันที่ไม่มีอยู่
  จริงในโค้ด (ยืนยันด้วย grep แล้วว่าไม่เคยทำงาน), `cancel` รับอีเมลผู้กระทำจาก URL
  ตรงๆ ไม่ตรวจสอบอะไรเลย (ใครก็ยกเลิกคิวคนอื่นแทนได้ถ้ารู้ booking id)
- **`extend` ที่แต่เดิมเรียก `extendBooking(id)` ซึ่งไม่มีอยู่จริง (ลิงก์พังมาตลอด)**
  ตอนนี้ implement ใหม่เป็น `_extendByEmailLink_(id)` — ต่อเวลาอัตโนมัติ +30 นาที
  จากเวลาสิ้นสุดปัจจุบัน (ตรงกับข้อความบนปุ่มในอีเมล "+30 นาที") แล้วเรียกตรรกะ
  เดียวกับปุ่มบนหน้าเว็บ (`_extendBookingCore_`)

## ทดสอบแล้ว

รัน harness จำลอง Hub จริง: `getDatabaseData` ไม่ส่ง password, `saveNewBooking`
บังคับใช้อีเมลจริงแม้ client พยายามปลอม, ยกเลิก/ต่อเวลาคิวของคนอื่นถูกปฏิเสธ (เจ้าของ
เองหรือ admin ทำได้), `saveStaticAreaData` เฉพาะ admin, ลิงก์เซ็น HMAC ผ่านการ
verify ถูกต้อง/ถูกปฏิเสธเมื่อถูกแก้ id หรือหมดอายุ, ลิงก์ `extend` จริงผ่าน `doGet`
ต่อเวลาได้ถูกต้อง +30 นาที และลิงก์ที่ถูกแก้ลายเซ็นไม่ทำอะไรเลย (ยืนยันว่าเวลาไม่ขยับ
ซ้ำ) นอกจากนี้รัน Babel ผ่านไฟล์ JSX จริงยืนยันว่าโครงสร้าง React ยังถูกต้อง

## วิธี deploy

1. เปิด Apps Script project ของแอป Lab Room เดิม
2. แทนที่ `Code.gs`/`Index.html` ด้วยไฟล์ในโฟลเดอร์นี้ (`appsscript.json` แนบมาด้วย
   เพื่ออ้างอิง ไม่ต้องเปลี่ยนอะไร)
3. วาง `portal/PortalGuard.gs` เพิ่มเข้าไป แล้วแก้ `PORTAL_HUB_URL`
4. Deploy ใหม่ — ยังเป็น shadow mode (`PORTAL_ENFORCE = false`) จนกว่าจะยืนยันสิทธิ์
   ผู้ใช้จริงถูกต้องแล้ว **แจ้งผู้ใช้ล่วงหน้าด้วยว่าหน้า login ของแอปนี้จะหายไป**
   (เปลี่ยนไปล็อกอินที่ Portal แทน) เป็นการเปลี่ยนแปลง UX ที่เห็นได้ชัด
5. หลังเปิดใช้งานจริงและมั่นใจแล้ว ค่อยพิจารณาลบคอลัมน์ `password` ออกจากชีต `Users`
   จริง (Phase 3 ตามแผน) เพราะไม่มีโค้ดจุดไหนอ่านมันใช้แล้ว
