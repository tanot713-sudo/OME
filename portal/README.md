# OMA Portal — ระบบคุมสิทธิ์การเข้าถึง (หน้า × โครงการ)

ต่อยอดจากสคริปต์ auth เดิม (`Sheet_Users` + `MASTER_MENUS`) ให้คุมได้ 2 ชั้นพร้อมกัน

| ชั้น | คุมอะไร | เก็บที่ไหน |
|---|---|---|
| **Page / Menu** | ผู้ใช้เห็นหน้าไหนได้บ้าง (ทีละหน้า หรือทุกหน้า) | `Sheet_Roles.menus` (ตามตำแหน่ง) และ `Sheet_Users.allowedMenus` (กำหนดเองรายคน) |
| **Project** | ผู้ใช้เห็นข้อมูลของโครงการไหนได้บ้าง | `Sheet_Roles.projectScope` + `Sheet_Users.projects` |

## สิทธิ์ตามค่าเริ่มต้น

| ตำแหน่ง (role) | หน้าที่เห็น | โครงการที่เห็น |
|---|---|---|
| `admin` | **ทุกหน้า** รวมหน้า “ตั้งค่าสิทธิ์” | ทุกโครงการ |
| `manager` | ทุกหน้า **ยกเว้นหน้าตั้งค่าสิทธิ์** | ทุกโครงการ |
| `head` (หัวหน้าโครงการ) | Projects, Finance, Solar, Work Progress, Assets, KPI | **เฉพาะโครงการที่ผูกไว้** — หัวหน้าโครงการ A เห็นแค่ A |
| `engineer` (Engineer/Tech) | Projects, Solar, Work Progress, Assets | เฉพาะโครงการของตัวเอง |
| `viewer` | Projects, Work Progress | เฉพาะโครงการของตัวเอง |

ค่าทั้งหมดนี้แก้ได้จากหน้าเว็บ (แท็บ “สิทธิ์ตามตำแหน่ง”) ยกเว้นกฎเหล็ก 2 ข้อที่ล็อกไว้ในโค้ด

1. หน้า `sec-settings` (ตั้งค่าสิทธิ์) เปิดได้เฉพาะ `admin` เท่านั้น ต่อให้ไปติ๊กให้ role อื่นก็จะถูกตัดทิ้ง
2. `admin` ถูกล็อกไว้ที่ “ทุกหน้า + ทุกโครงการ” กันเผลอตัดสิทธิ์ตัวเองจนเข้าหน้าตั้งค่าไม่ได้อีก

## ไฟล์ในโฟลเดอร์นี้

| ไฟล์ | วางไว้ที่ไหน |
|---|---|
| `Auth.gs` | Apps Script ของ **Portal Hub** (ตัวที่ผูกกับ `PORTAL_HUB_ID`) |
| `Portal.html` | ไฟล์ HTML ชื่อ **`Portal`** ในโปรเจกต์เดียวกับ `Auth.gs` |
| `PortalGuard.gs` | **แอปลูกทุกตัว** (Projects / Finance / Solar / …) เพื่อให้บังคับสิทธิ์จริงฝั่งเซิร์ฟเวอร์ |

## ติดตั้ง

1. เปิด Apps Script ของ Portal Hub → วาง `Auth.gs` แทนโค้ดเดิม
2. เพิ่มไฟล์ HTML ชื่อ `Portal` → วางเนื้อหาจาก `Portal.html`
3. รันฟังก์ชัน `setupPortal()` หนึ่งครั้ง จะสร้างชีตให้ครบ พร้อมแอดมินตั้งต้น
   `admin@oma.local` / `admin1234` (ระบบจะบังคับเปลี่ยนรหัสตอนล็อกอินครั้งแรก)
4. Deploy → New deployment → **Web app**, Execute as: *Me*, Who has access: *Anyone*
5. เปิด URL `/exec` → เข้าสู่ระบบ → ไปที่เมนู **ตั้งค่าสิทธิ์**
   - แท็บ **โครงการ** — ใส่รหัสโครงการก่อน (เช่น `A`, `B`)
   - แท็บ **สิทธิ์ตามตำแหน่ง** — ติ๊กหน้าที่แต่ละตำแหน่งเห็นได้
   - แท็บ **ผู้ใช้งาน** — เพิ่มคน เลือกตำแหน่ง และติ๊กโครงการที่ให้เข้าถึง

## โครงสร้างชีต

`Sheet_Users` — 4 คอลัมน์แรกเป็นของเดิม ข้อมูลเก่าจึงใช้ต่อได้เลย

| email | password | allowedMenus | firstLogin | role | projects | name | active |
|---|---|---|---|---|---|---|---|
| `somchai@…` | (hash) | เว้นว่าง = ใช้ตามตำแหน่ง | `Y`/`N` | `head` | `A` | สมชาย | `true` |

- `allowedMenus` — เว้นว่าง = ใช้ของตำแหน่ง, `All` = ทุกหน้า, หรือใส่ id คั่นด้วย `,`
- `projects` — รหัสโครงการคั่นด้วย `,` (ตำแหน่งที่ scope = ทุกโครงการ ไม่ต้องใส่)
- `password` — เก็บเป็น SHA-256 แต่ยังอ่านรหัส plain text ของเดิมได้ (บันทึกใหม่ครั้งหน้าจะถูก hash ให้)

`Sheet_Roles` = `role, label, menus, projectScope, active` · `Sheet_Projects` = `code, name, active`
`Sheet_Sessions` = token ที่ยังไม่หมดอายุ (8 ชม.) · `Sheet_Log` = บันทึกการเข้าใช้และการแก้สิทธิ์

## สำคัญ — การซ่อนเมนูไม่ใช่การกันเข้า

พอร์ทัลส่ง token + ขอบเขตโครงการเข้าไปกับ URL ของ iframe

```
…/exec?portalToken=<token>&portalUser=<email>&role=head&scope=own&projects=A&project=A
```

ถ้าแอปลูกไม่ตรวจอะไรเลย คนที่รู้ URL ก็ยังเปิดตรงและเห็นข้อมูลทุกโครงการอยู่ดี
จึงต้องวาง `PortalGuard.gs` ในแอปลูกทุกตัว แล้วเรียก `portalAccess(e)` ใน `doGet`
และกรองข้อมูลด้วย `scopeRows(rows, access, 'project')` ทุกครั้งก่อนส่งกลับ
ตัว guard จะเอา token ไปยืนยันกับ Hub (`?action=verify&token=…`) และ cache ไว้ 5 นาที

## API ที่ Hub เปิดให้

| action | ใคร | ทำอะไร |
|---|---|---|
| `login` | ทุกคน | คืน token + เมนู + โครงการที่เห็นได้ (รองรับ payload แบบเดิมที่ส่งแค่ email/password) |
| `verify` | แอปลูก | ตรวจ token → คืนสิทธิ์ล่าสุด (แก้สิทธิ์แล้วมีผลทันที ไม่ต้องรอ login ใหม่) |
| `changePassword` / `logout` | เจ้าของ token | เปลี่ยนรหัส / ออกจากระบบ |
| `getSettings`, `saveUser`, `deleteUser`, `saveRoles`, `saveProjects` | `admin` เท่านั้น | หน้าตั้งค่าสิทธิ์ |
