# WBS (Work Breakdown / Work Progress) app — portal retrofit

ต้นฉบับมีระบบ login ของตัวเองที่มีบั๊กร้ายแรงที่สุดในทั้ง 9 แอป: **ถ้าเปิดหน้านี้
นอก Apps Script sandbox (`typeof google === 'undefined'`) ระบบจะ login เป็น
`Admin` สิทธิ์ไม่จำกัด (`assigned:['ALL']`) ให้ทันทีโดยไม่ต้องกรอกอะไรเลย** —
นอกจากนี้ทุก endpoint เขียนข้อมูล (12 จุด) ไม่มีการเช็คสิทธิ์ฝั่งเซิร์ฟเวอร์เลย
เชื่อ role/โครงการที่ client บอกมาทั้งหมด และฟิลด์ "ใครเป็นคนแก้" (`RecordedBy`,
`changedBy`) ก็รับค่าจาก client ตรงๆ

## สิ่งที่แก้

### 1. ตัด login ของตัวเองออกทั้งหมด
- ลบ `doLogin` (Code.gs) ทิ้งทั้งฟังก์ชัน — **รวมถึงจุดที่ร้ายแรงที่สุดคือ branch
  `else { beginSession(email,'Admin',['ALL']); }` ใน `executeAuth()`** ที่ให้สิทธิ์
  Admin ไม่จำกัดกับใครก็ได้ที่เปิดไฟล์นี้นอก Apps Script (ลบทิ้งไปเลย ไม่ต้องแทนที่)
- ลบ `executeAuth`, `resetLogin`, `beginSession`, ฟอร์ม login (`#login-window`,
  `inputEmail`/`inputPassword`/`btnLogin`) ออกจาก `Index.html`
- `CURRENT_USER` ตอนนี้ประกอบจาก `window.PORTAL` ตรงจุดประกาศตัวแปร (แทนที่จะมา
  จาก `beginSession` หลัง login สำเร็จ) — `#app` แสดงผลทันทีที่โหลดหน้า (ไม่ซ่อนรอ
  login อีกต่อไป) แล้วเรียก `loadData()` ทันทีท้ายสคริปต์
- คงตัวกรอง `isAssignedProject` ฝั่ง client ใน `boot()`'s success handler ไว้เป็น
  ด่านที่สอง (defense-in-depth) — จะกลายเป็น no-op เมื่อเซิร์ฟเวอร์กรองถูกต้องแล้ว
  ซึ่งเป็นสถานะปลายทางที่ถูกต้องอยู่แล้ว ไม่ใช่บั๊ก

### 2. `getWBSData(portalToken)` กรองผลลัพธ์ตามโครงการที่มีสิทธิ์
กรอง `tasks`/`progress`/`projects`/`scOverrides` ด้วย `scopeRows(..., access,
'RefProject'/'id')` ก่อน return — **`members` ไม่กรอง** ตามที่ผู้ใช้ยืนยันไว้แล้วว่า
รายชื่อ+อีเมลทีมงานให้ทุกคนที่ล็อกอินเห็นได้หมด ไม่ผูกกับโครงการ

### 3. เพิ่มการเช็คสิทธิ์ฝั่งเซิร์ฟเวอร์ให้ endpoint เขียนข้อมูลครบทั้ง 12 จุด
ทุกจุดเรียก `portalAccessForCall(portalToken, PORTAL_MENU_ID)` ก่อนแตะชีตเสมอ:

- `saveProgress`, `saveTask`, `saveSCOverrides` — `canWrite` + `canSeeProject`
  กับโครงการที่ระบุมาในข้อมูล (`RefProject`/`projID`)
- `deleteTask`, `updateTaskFields`, `toggleTaskFlag`, `getTaskRevisions` — หา
  โครงการของ task จาก `TaskID` ผ่าน helper ใหม่ `_taskRefProject_(taskID)` ก่อน
  เช็ค `canSeeProject` (task ไม่มีฟิลด์โครงการส่งมาตรงๆ จาก client เหมือนตัวอื่น)
- `getSCRevisions` — `canSeeProject` กับ `projID` ที่ขอดู
- `bulkSaveImport` — เช็คสิทธิ์โครงการของ**ทุกแถว**ทั้ง `tasks`/`progress`/
  `updates` ก่อนเขียนจริงสักแถวเดียว ปฏิเสธทั้ง batch ถ้ามีแถวไหนอยู่นอกสิทธิ์
- `saveProjectToSheet` — สร้างโครงการใหม่ (`rowIndex === -1`) ต้อง
  `isAdminish(access)`; แก้ไขโครงการเดิมต้อง `canWrite` + `canSeeProject`
- `deleteProjectFromSheet`, `saveMemberToSheet`, `deleteMemberFromSheet` —
  `isAdminish(access)` เท่านั้น (ระดับองค์กร ไม่ผูกกับโครงการใดโครงการหนึ่ง)

### 4. เลิกเชื่อตัวตนที่ client ส่งมา
`RecordedBy` ของ `saveProgress`/`bulkSaveImport`, `changedBy`/`userEmail` ของ
`saveSCOverrides`/`updateTaskFields` เดิมรับค่าจาก client ตรงๆ (ทดสอบแล้วว่าปลอม
อีเมลผ่านได้จริงก่อนแก้) — ตอนนี้ทุกจุดใช้ `access.email` ที่ Hub ยืนยันแล้วเสมอ
พารามิเตอร์ `changedBy`/`userEmail` ที่ client ยังส่งมา (ไม่ได้ตัดออกจากหน้าเว็บ
ทั้งหมดเพื่อลด diff) ถูกเซิร์ฟเวอร์เพิกเฉยแล้ว

### 5. Import จากไฟล์ — รวมเป็นคำขอเดียว ไม่ยิงซ้ำต่อแถว
เดิม `bulkSaveImport` (สร้าง task/progress ใหม่) กับการอัปเดต task ที่มีอยู่แล้ว
(`updateTaskFields`) แยกเป็นคนละคำขอ — import ไฟล์ที่มีการแก้ไข N แถวจะยิง
`updateTaskFields` แยก N ครั้ง ซึ่งแต่ละครั้งต้อง verify สิทธิ์กับ Hub สดใหม่
ทุกครั้ง (ยิ่งมี user จริงเยอะ ยิ่งช้า) — แก้โดยให้ `bulkSaveImport` รับพารามิเตอร์
`updates: [{taskID, fields, revisions}]` เพิ่มเข้ามาในคำขอเดียวกัน เขียนทุกอย่าง
(task ใหม่ + progress ใหม่ + แก้ไข task เดิม) ในการยิงครั้งเดียว จึงเสียค่า verify
สิทธิ์แค่ครั้งเดียวต่อการ import หนึ่งครั้ง ไม่ว่าจะแก้กี่แถวก็ตาม (ตรรกะการเขียน
ฟิลด์/บันทึก revision ถูกแยกเป็น helper ร่วม `_applyTaskFieldsToRow_`/
`_appendTaskRevisions_` ใช้ร่วมกับ `updateTaskFields` เพื่อไม่ให้โค้ดซ้ำกัน)

## ทดสอบแล้ว

รัน harness จำลอง Hub จริง (`test-wbs.js`): ยืนยันว่า `doLogin` ไม่มีอยู่ในโค้ด
อีกต่อไป, `getWBSData` กรอง tasks/progress/projects ตามโครงการที่มีสิทธิ์ถูกต้อง
(members ไม่กรอง), เขียนข้อมูลข้ามโครงการถูกปฏิเสธทุก endpoint (`saveProgress`,
`saveTask`, `deleteTask`, `updateTaskFields`, `toggleTaskFlag`,
`saveSCOverrides`, `getSCRevisions`, `getTaskRevisions`), `RecordedBy`/
revision log ใช้อีเมลที่ Hub ยืนยันแล้วแม้ client จะพยายามปลอมค่ามา,
`viewer` (canWrite=false) เขียนข้อมูลไม่ได้, endpoint ระดับองค์กร
(`saveProjectToSheet` สร้างใหม่, `deleteProjectFromSheet`,
`saveMemberToSheet`) ต้อง admin/manager เท่านั้น ส่วนแก้ไขโครงการที่มีอยู่แล้ว
เจ้าของโครงการทำได้ปกติ, `bulkSaveImport` ปฏิเสธทั้ง batch ถ้ามีแถวไหนอยู่นอก
สิทธิ์ (ไม่เขียนข้อมูลครึ่งเดียว) และการอัปเดต task เดิมผ่านพารามิเตอร์ `updates`
ใหม่ทำงานถูกต้องในคำขอเดียว, และโหมด shadow (`PORTAL_ENFORCE=false`) ยัง
ทำงานแบบเดิมทุกอย่างแม้ token ปลอม (ไม่ล็อกใครออกโดยไม่ตั้งใจก่อนเปิดใช้งานจริง)
นอกจากนี้ตรวจ syntax ทั้ง `Code.gs` (`node --check`) และ inline script ทั้งสอง
บล็อกของ `Index.html` ผ่านแล้ว

## สิ่งที่ยังไม่ได้ตรวจสอบ / ต้องยืนยันกับผู้ใช้

- **ชีต `WBS_SCurveOverride`/`WBS_SCurveRevisions`/`WBS_TaskRevisions`** —
  โค้ดเช็คว่าชีตมีอยู่หรือไม่ก่อนอ่าน/เขียน (ถ้ายังไม่มีจะถือว่า "ยังไม่มีข้อมูล"
  ไม่ error) แต่ยังไม่ได้ยืนยันกับชีตจริงว่าชื่อคอลัมน์ตรงกันเป๊ะ
- **รูปแบบรหัสโครงการของ `Projects.id`** เทียบกับ `Ref. Code` ของ Project
  List/Finance — ตามแผน Phase 0 ถ้าไม่ตรงกันต้องเพิ่ม `aliases` ใน
  `Sheet_Projects` ของ Hub ไม่ใช่แก้โค้ดจุดนี้
- ปุ่มเรียก `saveMemberToSheet`/`deleteMemberFromSheet`/`getProjects` ยังไม่มี
  ใน `Index.html` ปัจจุบัน (เหมือนกรณี Equipment/Assets) — เพิ่ม guard สิทธิ์ไว้
  ล่วงหน้าแล้วเผื่ออนาคต เพราะ Apps Script เปิดให้เรียกได้อยู่ดีแม้ UI จะยังไม่ใช้

## วิธี deploy

1. เปิด Apps Script project ของแอป WBS เดิม
2. แทนที่ `Code.gs`/`Index.html` ด้วยไฟล์ในโฟลเดอร์นี้
3. วาง `portal/PortalGuard.gs` เพิ่มเข้าไป แล้วแก้ `PORTAL_HUB_URL`
4. ลบชีต `User_Roles` เดิม (แหล่งข้อมูล role/โครงการเก่า) ออกจากการใช้งานจริง —
   **แต่อย่าเพิ่งลบชีตทิ้ง** เก็บไว้อ้างอิงตอน migrate ข้อมูลเข้า `Sheet_Users`
   ของ Hub ก่อน (คอลัมน์ D เดิมเป็น CSV แบบ `ProjectID_ProjectName`)
5. Deploy ใหม่ — ยังเป็น shadow mode (`PORTAL_ENFORCE = false`) จนกว่าจะยืนยัน
   สิทธิ์ผู้ใช้จริงถูกต้องแล้ว **แจ้งผู้ใช้ล่วงหน้าด้วยว่าหน้า login ของแอปนี้จะหายไป**
   (เปลี่ยนไปล็อกอินที่ Portal แทน) เป็นการเปลี่ยนแปลง UX ที่เห็นได้ชัด
