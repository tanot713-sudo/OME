# KPI app — portal retrofit

ไฟล์ในโฟลเดอร์นี้คือแอป **OMA Department KPI 2026** ฉบับที่แก้ให้ใช้ token จาก
OMA Portal แทนการเชื่อ `?u=<email>` แบบเดิม

## สิ่งที่แก้ (เทียบกับไฟล์ต้นฉบับที่ผู้ใช้ส่งมา)

- `doGet(e)` เรียก `portalGuard(e, PORTAL_MENU_ID)` แทนการเช็ค `canView(portalUser)`
  ด้วยอาร์เรย์ `VIEWERS`/`EDITORS` ที่ hardcode ไว้เดิม
- `whoAmI` / `canEdit` / `canView` รับ **portal token** (ไม่ใช่อีเมลที่เชื่อใจเฉยๆ)
  แล้วเรียก `portalAccessFromToken` ยืนยันกับ Hub สดทุกครั้ง — ไม่มีการ cache สิทธิ์
  ข้ามคำขอเลย
- ลบ `VIEWERS`/`EDITORS` และ `_inList_` ทิ้ง — สิทธิ์ตอนนี้มาจาก `Sheet_Roles`/
  `Sheet_Users` ที่ Hub แก้ได้จากหน้าเว็บ ไม่ต้องแก้โค้ดแล้ว deploy ใหม่อีก
- ลบ `saveKpiResult` ทิ้ง — เป็นโค้ดตาย (ไม่ถูกเรียกจาก `Index.html`) และมีบั๊ก
  (`portalUser` ไม่ได้อยู่ใน scope ของฟังก์ชันนั้น จะ error ทันทีถ้าถูกเรียกจริง)
- `checkSetup()` ปรับข้อความ log ให้ตรงกับความจริงใหม่ (ไม่มี `VIEWERS`/`EDITORS`
  ให้ตรวจอีกแล้ว)
- `Index.html` / `Theme.html` / `Kit.html` **ไม่ต้องแก้อะไรเลย** — ตัวแปร
  `PORTAL_USER` ที่ frontend ใช้อยู่เดิมเป็นแค่ค่าที่ส่งต่อไปมา (opaque) ไม่เคย
  ถูกแสดงผลเป็นอีเมลหรือแกะรูปแบบที่ไหน จึงสลับความหมายจาก "อีเมล" เป็น "token"
  ได้โดยไม่กระทบ UI

## ค่าที่ยังต้องตัดสินใจ / ปรับก่อน deploy จริง

1. **`PORTAL_ENFORCE = false`** ตอนนี้ตั้งเป็นโหมด shadow (ไม่บล็อกใครจริง แค่
   บันทึก log ว่าจะตัดสินใจยังไงถ้าบังคับใช้จริง) — เปลี่ยนเป็น `true` เมื่อยืนยัน
   แล้วว่า role ของผู้ใช้จริงทุกคนแมปถูกต้องใน Hub
2. **`canEdit` ใช้ `canWrite(access)`** (สิทธิ์เขียนทั่วไป ไม่ใช่ admin-only) — ถ้า
   ต้องการให้แก้ผล KPI เข้มกว่านี้ (เฉพาะ admin/manager) ให้เปลี่ยนบรรทัดในฟังก์ชัน
   `canEdit` เป็น `isAdminish(portalAccessFromToken(portalToken))` แทน
3. **ยังไม่ได้ผูกกับโครงการ (project-scoped)** — KPI ตอนนี้เป็นระดับแผนก ทุกคนที่
   เข้าแอปได้ (ตาม `Sheet_Roles`) จะเห็นข้อมูลทุกสัญญา/โครงการเหมือนเดิม ถ้าต้องการ
   จำกัดตาม `refCode` (สัญญา/โครงการ) ด้วย บอกได้ แก้เพิ่มไม่ยาก

## วิธี deploy

1. เปิด Apps Script project ของแอป KPI เดิม
2. แทนที่ `Code.gs` ด้วยไฟล์ `Code.gs` ในโฟลเดอร์นี้
3. วาง `portal/PortalGuard.gs` (ไฟล์เดียวกับที่ใช้กับแอปอื่นๆ) เพิ่มเข้าไปในโปรเจกต์
   นี้ด้วย แล้วแก้ `PORTAL_HUB_URL` ให้เป็น URL `/exec` ของ Hub จริง
4. `Index.html`, `Theme.html`, `Kit.html` ไม่ต้องเปลี่ยน (เหมือนไฟล์ต้นฉบับทุกตัวอักษร)
5. Deploy ใหม่ — ยังเป็น shadow mode (`PORTAL_ENFORCE = false`) จนกว่าจะยืนยันสิทธิ์
   ผู้ใช้จริงถูกต้องแล้ว
