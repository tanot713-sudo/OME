# Project List app — portal retrofit

ต้นฉบับ **ไม่มีการเช็คสิทธิ์เลย** — `doGet()` เปิดให้ทุกคน และ `getDashboardData()`
คืนข้อมูลโครงการทั้งหมด (มูลค่าสัญญา, BG, ผู้รับผิดชอบ) ให้ทุกคนที่เรียกได้

## สิ่งที่แก้

- `doGet(e)` เรียก `portalGuard(e, 'sec-projects-dash')` ก่อนสร้างหน้าเว็บ ฝัง
  `window.PORTAL.token` ผ่าน template variable `portalBootstrap`
- `getDashboardData(portalToken)` ยืนยันสิทธิ์กับ Hub ก่อน แล้วกรอง `projects`
  ด้วย `scopeRows(projects, access, 'ref')` **ก่อน**ที่จะแนบ bonds/closure และ
  **ก่อน**เรียกฟังก์ชันสรุปรวมทั้ง 5 ตัว (`buildMaTrend_`, `buildContinuity_`,
  `buildMonthlyEvents_`, `buildActiveMaLine_`, `buildAlerts_`) — ถ้ากรองแค่ตัว
  `projects` ที่ return สุดท้าย ตัวเลขสรุปภาพรวม (KPI พอร์ตทั้งหมด) จะยังรั่วไปให้
  ผู้ใช้ที่เห็นแค่โครงการเดียวอยู่ดี เพราะฟังก์ชันเหล่านี้รับ `projects` ทั้งก้อนไป
  คำนวณ
- `readFrontlog_` output ก็ถูกกรองด้วย `scopeRows(..., 'ref')` เช่นกัน — แถวที่
  `ref` ว่างเปล่าจะไม่ตรงกับโครงการไหนเลยของผู้ใช้ที่ถูกจำกัดสิทธิ์ จึงถูกกรองออกไป
  เองโดยอัตโนมัติ (ไม่ต้องเช็คแยก)

## ทดสอบแล้ว

รัน harness จำลอง Hub จริง: หัวหน้าโครงการที่ผูกกับโครงการ A เห็นเฉพาะ project A
(ไม่เห็น B), admin เห็นทั้งสองโครงการ, token ปลอมถูกปฏิเสธเมื่อเปิดใช้งานจริง

## วิธี deploy

1. เปิด Apps Script project ของแอป Project List เดิม
2. แทนที่ `Code.gs`/`Index.html` ด้วยไฟล์ในโฟลเดอร์นี้
3. วาง `portal/PortalGuard.gs` เพิ่มเข้าไป แล้วแก้ `PORTAL_HUB_URL`
4. Deploy ใหม่ — ยังเป็น shadow mode (`PORTAL_ENFORCE = false`) จนกว่าจะยืนยันสิทธิ์
   ผู้ใช้จริงถูกต้องแล้ว
