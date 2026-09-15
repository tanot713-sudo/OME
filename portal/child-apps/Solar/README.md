# Solar Monitoring app — portal retrofit

ต้นฉบับ **ไม่มีการเช็คสิทธิ์เลย** — `doGet()` เปิดให้ทุกคน และทุก action (อ่าน/เขียน)
เดินผ่านจุดเดียวคือ `dispatch(action, params)` ซึ่งไม่เช็คตัวตนผู้เรียกเลย

## สิ่งที่แก้

- `doGet(e)` เรียก `portalGuard(e, 'sec-solar-dash')` ก่อนสร้างหน้าเว็บ ฝัง
  `window.PORTAL` ด้วย `.append()` (ไฟล์ยังใช้ `createHtmlOutputFromFile` เหมือนเดิม)
- Frontend มีจุดเรียก RPC จุดเดียว: `call(action, params, ...)` — เพิ่ม
  `portalToken` เข้าไปใน `params` ทุกครั้งที่เรียกตรงนั้น ไม่ต้องแก้ทีละที่เรียก
- `dispatch()` ยืนยันสิทธิ์กับ Hub ครั้งเดียวตรงต้นฟังก์ชัน สร้าง `allowedAssets`
  (รายการ `AssetCode` ที่ผู้ใช้เห็นได้) แล้วเช็คตาม action:
  - **`getProjects`** — กรองด้วย `filterProjectsByAccess()` ซึ่งเทียบทั้ง `refCode`
    (=AssetCode เช่น `NB230004.1`) และ `budgetCode` (=RefCode จาก ERP เช่น
    `NB230004`) เพราะ Hub อาจให้สิทธิ์มาเป็นรหัสแบบใดแบบหนึ่งก็ได้
  - **action ที่รับ `refCode` เดี่ยว** (`getYears`, `getPanel1/2/3`, `getActualRows`,
    `getProduction`, `getProductionRows`, `getInstallmentData`,
    `getBillingChartData`, `getInstallmentsForMonth`) — ผ่าน
    `requireAssetOrPortfolio()`: ปฏิเสธถ้า `refCode` ไม่อยู่ใน `allowedAssets`
    **และปฏิเสธถ้า `refCode` เป็น `'all'`/ว่าง** (แปลว่าขอดูภาพรวมทุกโครงการ)
    สำหรับผู้ใช้ที่ไม่ใช่ `projectScope:'all'`
  - **action ที่เป็นภาพรวมทุกโครงการเสมอ ไม่มี `refCode`** (`getHomepageData`,
    `getGroupSummary/Budget/Meters`, `getPortfolioProduction`) — ผ่าน
    `requirePortfolioAccess()`: อนุญาตเฉพาะ `projectScope === 'all'`
    (admin/manager) เท่านั้น **แอปนี้ไม่มีการกรองข้อมูลบางส่วนสำหรับ action กลุ่มนี้
    — เลือกปฏิเสธทั้งหมดแทนการพยายามคำนวณผลรวมจากชุดโครงการที่กรองแล้ว** เพื่อไม่
    เสี่ยงคำนวณตัวเลขการเงิน/IRR ผิดจากการแก้สูตรที่ยังไม่ได้ตรวจสอบครบ
  - **`addProject` / `dispatch_recalc` / `initProductionPlan`** — เฉพาะ
    admin/manager (`isAdminish`)
  - **`saveActual` / `saveProduction`** — ต้องมีสิทธิ์เขียน (`canWrite`) และเช็ค
    คอลัมน์ `RefCode` (ซึ่งเก็บค่า AssetCode จริง) ของ**ทุกแถว**ที่จะเขียนก่อนเขียน
    จริง ปฏิเสธทั้ง batch ถ้ามีแถวไหนอยู่นอกสิทธิ์

## สิ่งที่ต้องยืนยันก่อนเปิดใช้งานจริง

- **Mapping รหัสโครงการ**: `AssetCode` (เช่น `NB230004.1`) vs `RefCode`/ERP budget
  code (เช่น `NB230004`) — ยืนยันว่า `Sheet_Projects.code` ของ Hub ใช้รหัสไหน หรือ
  ทั้งสองแบบ (ถ้าไม่ตรงกันเลย ต้องเพิ่ม `aliases` ใน `Sheet_Projects`)
- Action ภาพรวมทุกโครงการ (`getHomepageData` ฯลฯ) ตอนนี้**ปฏิเสธทั้งหมด**สำหรับ
  ผู้ใช้ที่ไม่ใช่ scope 'all' — ถ้าต้องการให้ head/engineer เห็นภาพรวมของ*แค่*
  โครงการตัวเอง (ไม่ใช่ทุกโครงการ) ต้องแจ้งมา จะแก้เพิ่มให้กรองใน
  `getHomepageData()`/`getGroupSummary()` ฯลฯ เอง แทนที่จะปฏิเสธเฉยๆ

## ทดสอบแล้ว

รัน harness จำลอง Hub จริง: engineer ที่ผูกกับ `NB230004` เห็นเฉพาะโครงการตัวเองใน
`getProjects`, ดึง `getYears` ของโครงการตัวเองได้แต่โครงการอื่นไม่ได้, ขอ `refCode:
'all'` ไม่ได้, เข้า `getHomepageData` (ภาพรวม) ไม่ได้ (admin เข้าได้), แก้ไข
`saveActual` แถวของโครงการตัวเองได้แต่แถวโครงการอื่นถูกปฏิเสธทั้ง batch, token ปลอม
ถูกปฏิเสธ

## วิธี deploy

1. เปิด Apps Script project ของแอป Solar เดิม
2. แทนที่ `Code.gs`/`Index.html` (ไฟล์ HTML หลักชื่อ `index`) ด้วยไฟล์ในโฟลเดอร์นี้
3. วาง `portal/PortalGuard.gs` เพิ่มเข้าไป แล้วแก้ `PORTAL_HUB_URL`
4. Deploy ใหม่ — ยังเป็น shadow mode (`PORTAL_ENFORCE = false`) จนกว่าจะยืนยัน
   mapping รหัสโครงการและสิทธิ์ผู้ใช้จริงถูกต้องแล้ว
