# Employee app — portal retrofit

ไฟล์ในโฟลเดอร์นี้คือแอป **OMA Workforce Dashboard** ฉบับที่แก้ให้ผ่านการยืนยันสิทธิ์
กับ OMA Portal ก่อนเข้าถึงได้ — ต้นฉบับ**ไม่มีการเช็คสิทธิ์อะไรเลย** ใครมี URL ก็เห็น
ข้อมูลพนักงานทั้งหมด รวมวันเกิด/ที่อยู่/เบอร์โทร/ผู้ติดต่อฉุกเฉิน/โรคประจำตัว

## สิ่งที่แก้

- `doGet(e)` เรียก `portalGuard(e, 'sec-employee-dash')` ก่อนสร้างหน้าเว็บ — ปฏิเสธ
  ถ้าไม่มี token หรือ role ของผู้ใช้ไม่ได้รับสิทธิ์เข้าหน้านี้ (ปรับได้จากหน้าตั้งค่า
  ของ Hub) ฝัง token ผ่าน `window.PORTAL.token` ให้ frontend ใช้เรียก RPC ต่อ
- `getEmployeeData(portalToken)` ยืนยันสิทธิ์กับ Hub ก่อนอ่านชีตทุกครั้ง (ผ่าน
  `portalAccessForCall`) และ **กรองข้อมูลส่วนบุคคลตาม role**:
  - `dob` (วันเกิดจริง — แต่ `ageM` อายุที่คำนวณแล้วยังโชว์ได้ปกติ), `phone`,
    `Current address`, `Emergency contact person`, `congenital disease`,
    `Training history` — เห็นได้เฉพาะ admin/manager (`isAdminish`)
  - ลูป "ส่งทุกคอลัมน์ที่เหลือผ่านตรงๆ" เดิม (ที่ทำให้คอลัมน์ใหม่ในชีต เช่น เงินเดือน/
    เลขบัญชี/เลขบัตรประชาชน หลุดไปให้ทุกคนเห็นทันทีที่ HR เพิ่มเข้าไปในชีต) ตอนนี้
    เช็คกับ `SENSITIVE_KEYWORDS` (ทั้งไทย/อังกฤษ) ก่อนส่งผ่าน ถ้าตรงคำที่ดูอ่อนไหว
    (เงินเดือน, ธนาคาร, บัตรประชาชน, ที่อยู่, ฯลฯ) จะถูกกันไว้เหมือนกัน
- `checkSetup()` (รันมือจาก editor) เรียก `getEmployeeData('')` แทน — ทำงานได้เฉพาะ
  ตอน `PORTAL_ENFORCE = false` (shadow mode) เพราะไม่มี token จริงให้ส่งจาก editor

## ทดสอบแล้ว

รัน harness จำลอง Hub จริง: engineer ที่ได้สิทธิ์เข้าหน้านี้แต่ไม่ใช่ admin/manager
เห็นชื่อ/ตำแหน่งปกติ แต่ `dob`/`phone`/ที่อยู่/คอลัมน์ "Salary" ที่จำลองเพิ่มใหม่ (ไม่มี
อยู่ในโค้ดเดิมเลย) ถูกกรองออกหมด ส่วน admin เห็นครบทุกฟิลด์รวม Salary — และยืนยันว่า
`PORTAL_ENFORCE = false` (shadow mode) ทำให้แอปพฤติกรรมเหมือนเดิมทุกอย่าง (ไม่กรอง
อะไรเลย ตรงกับที่แอปเป็นอยู่ทุกวันนี้) จนกว่าจะเปิดใช้งานจริง

## วิธี deploy

1. เปิด Apps Script project ของแอป Employee เดิม
2. แทนที่ `Code.gs` ด้วยไฟล์ในโฟลเดอร์นี้ และแทนที่ไฟล์ HTML หลัก (ชื่อ `Index`
   หรือชื่ออื่นตามที่ `HTML_FILES` ระบุ) ด้วย `Index.html` ที่นี่
3. วาง `portal/PortalGuard.gs` เพิ่มเข้าไปในโปรเจกต์นี้ แล้วแก้ `PORTAL_HUB_URL`
   ให้เป็น URL `/exec` ของ Hub จริง
4. `appsscript.json` ไม่ต้องเปลี่ยน (ยังเป็น `ANYONE_ANONYMOUS`/`USER_DEPLOYING`
   เหมือนเดิม — จำเป็นสำหรับฝัง iframe โดยไม่ต้อง login Google ซ้ำ token ของ portal
   คือตัวล็อกจริงแล้ว)
5. Deploy ใหม่ — ยังเป็น shadow mode (`PORTAL_ENFORCE = false`) จนกว่าจะยืนยันสิทธิ์
   ผู้ใช้จริงถูกต้องแล้วค่อยเปลี่ยนเป็น `true`
