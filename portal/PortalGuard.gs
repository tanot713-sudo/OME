/* ================================================================
   PORTAL GUARD — วางไฟล์นี้ใน "แอปลูก" ทุกตัว (Projects/Finance/Solar/…)
   ================================================================
   ทำไมต้องมี: การซ่อนเมนูบนพอร์ทัลเป็นแค่การซ่อน "ปุ่ม" เท่านั้น
   ใครที่รู้ URL ของแอปลูกก็ยังเปิดตรงได้ ดังนั้นแอปลูกต้องตรวจสิทธิ์เองด้วย
   โดยเอา token ที่พอร์ทัลส่งมากับ URL ไปยืนยันกับ Hub ทุกครั้ง

   วิธีใช้ใน doGet ของแอปลูก
   ------------------------------------------------
   function doGet(e) {
     const access = portalAccess(e);
     if (!access.ok) return portalDenied(access.message);

     const project = e.parameter.project || '';
     if (project && !canSeeProject(access, project)) return portalDenied('ไม่มีสิทธิ์ดูโครงการนี้');

     const t = HtmlService.createTemplateFromFile('index');
     t.access = access;                       // ส่งสิทธิ์เข้าไปให้หน้าเว็บใช้ซ่อนปุ่ม
     return t.evaluate().setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
   }

   และตอนอ่านข้อมูลให้กรองด้วย scopeRows() เสมอ
     const rows = scopeRows(allRows, access, 'project');
   ================================================================ */

const PORTAL_HUB_URL = 'https://script.google.com/macros/s/XXXXXXXX/exec';  // ← ใส่ /exec ของ Auth service
const PORTAL_CACHE_SEC = 300;

/* ตรวจ token ที่พอร์ทัลส่งมา → คืนสิทธิ์ของผู้ใช้คนนั้น */
function portalAccess(e) {
  const token = (e && e.parameter && e.parameter.portalToken) || '';
  if (!token) return { ok: false, message: 'กรุณาเข้าใช้งานผ่านหน้า OMA Portal' };

  const cache = CacheService.getScriptCache();
  const key   = 'portal_' + Utilities.base64Encode(token).slice(0, 40);
  const hit   = cache.get(key);
  if (hit) return JSON.parse(hit);

  let result;
  try {
    const res = UrlFetchApp.fetch(
      PORTAL_HUB_URL + '?action=verify&token=' + encodeURIComponent(token),
      { muteHttpExceptions: true, followRedirects: true }
    );
    const json = JSON.parse(res.getContentText());
    result = json.success
      ? { ok: true, email: json.email, name: json.name, role: json.role,
          projectScope: json.projectScope, projects: json.projects || [],
          menuIds: json.menuIds || [], isAdmin: !!json.isAdmin }
      : { ok: false, message: json.message || 'ไม่มีสิทธิ์เข้าใช้งาน' };
  } catch (err) {
    result = { ok: false, message: 'ตรวจสอบสิทธิ์ไม่สำเร็จ: ' + err.message };
  }

  if (result.ok) cache.put(key, JSON.stringify(result), PORTAL_CACHE_SEC);
  return result;
}

/* true ถ้าผู้ใช้คนนี้ดูโครงการนี้ได้ (admin/manager = ทุกโครงการ) */
function canSeeProject(access, project) {
  if (!access || !access.ok) return false;
  if (access.projectScope === 'all') return true;
  const target = String(project || '').trim().toLowerCase();
  return (access.projects || []).some(p => String(p).trim().toLowerCase() === target);
}

/* กรองแถวข้อมูลให้เหลือเฉพาะโครงการที่ผู้ใช้เห็นได้ */
function scopeRows(rows, access, field) {
  if (!access || !access.ok) return [];
  if (access.projectScope === 'all') return rows;
  const key = field || 'project';
  return rows.filter(r => canSeeProject(access, r[key]));
}

/* ตรวจว่าผู้ใช้มีสิทธิ์เข้าหน้านี้ไหม (ใส่ id ของเมนูใน MASTER_MENUS) */
function canSeeMenu(access, menuId) {
  return !!access && access.ok && (access.menuIds || []).indexOf(menuId) !== -1;
}

function portalDenied(message) {
  return HtmlService.createHtmlOutput(
    '<div style="font-family:system-ui;padding:48px;text-align:center;color:#152033">' +
    '<div style="font-size:42px">🔒</div>' +
    '<h2 style="margin:12px 0 6px">ไม่มีสิทธิ์เข้าถึง</h2>' +
    '<p style="color:#6b7a90">' + (message || '') + '</p></div>'
  ).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
