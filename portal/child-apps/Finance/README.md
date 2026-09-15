# Finance app — portal retrofit

ต้นฉบับ **ไม่มีการเช็คสิทธิ์เลย** — `doGet()` เปิดให้ทุกคน และ `getData()` ไม่รับ
พารามิเตอร์ใดๆ เลย คืนมูลค่าสัญญาทั้งหมด/หนังสือค้ำประกันทุกโครงการให้ทุกคน ข้อมูล
ในแอปนี้อ่อนไหวที่สุดในทั้ง 9 แอป (มูลค่าสัญญา, BG) ไฟล์ต้นฉบับเองก็มีคอมเมนต์บอกไว้
ว่าออกแบบมาให้ "ควบคุมสิทธิ์ด้วยการฝัง iframe ในระบบ OMA" — ตอนนี้ทำตามที่คอมเมนต์
บอกไว้จริงแล้ว

## สิ่งที่แก้

- `doGet(e)` เรียก `portalGuard(e, 'sec-finance-dash')` ก่อนสร้างหน้าเว็บ
- `getData(portalToken)` ยืนยันสิทธิ์กับ Hub ก่อน แล้วกรองทั้ง 4 อาร์เรย์ที่ return
  (`projects`, `trans`, `bonds`, `bondProjects`) ด้วย `scopeRows(..., access, 'ref')`
  ก่อน stringify — ไม่ใช่แค่ `projects` เท่านั้น เพราะ `trans`/`bonds`/`bondProjects`
  ก็มีมูลค่าเงิน/ข้อมูลสัญญาผูกกับแต่ละโครงการเหมือนกัน
- ไม่มี endpoint เขียนข้อมูลในไฟล์นี้ — ไม่ต้องแก้อะไรเพิ่ม

## ทดสอบแล้ว

รัน harness จำลอง Hub จริง: หัวหน้าโครงการที่ผูกกับโครงการ A เห็นเฉพาะ project/
transaction ของ A, admin เห็นทั้งสองโครงการ, token ปลอมถูกปฏิเสธเมื่อเปิดใช้งานจริง

## วิธี deploy

1. เปิด Apps Script project ของแอป Finance เดิม
2. แทนที่ `Code.gs`/`Index.html` ด้วยไฟล์ในโฟลเดอร์นี้
3. วาง `portal/PortalGuard.gs` เพิ่มเข้าไป แล้วแก้ `PORTAL_HUB_URL`
4. Deploy ใหม่ — ยังเป็น shadow mode (`PORTAL_ENFORCE = false`) จนกว่าจะยืนยันสิทธิ์
   ผู้ใช้จริงถูกต้องแล้ว — ยืนยันด้วยว่า `Sheet_Roles` จำกัด `sec-finance-dash`
   ไว้เฉพาะ admin/manager/head เท่านั้นก่อนเปิดใช้งานจริง (ข้อมูลอ่อนไหวสูง)
