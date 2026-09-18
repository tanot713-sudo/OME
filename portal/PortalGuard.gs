/* ================================================================
   PORTAL GUARD — วางไฟล์นี้ใน "แอปลูก" ทุกตัว (Projects/Finance/Solar/…)
   ================================================================
   ทำไมต้องมี: การซ่อนเมนูบนพอร์ทัลเป็นแค่การซ่อน "ปุ่ม" เท่านั้น
   ใครที่รู้ URL ของแอปลูกก็ยังเปิดตรงได้ ดังนั้นแอปลูกต้องตรวจสิทธิ์เองด้วย
   โดยเอา token ที่พอร์ทัลส่งมากับ URL ไปยืนยันกับ Hub ทุกครั้ง

   ⚠️ ไม่มี cache ข้ามคำขอในไฟล์นี้โดยตั้งใจ — เพื่อให้ตรงกับกฎ "แก้สิทธิ์แล้วต้องมีผล
   ทันที ห้ามหน่วง" cache ที่ทำได้อย่างปลอดภัย (แบบมีเลขเวอร์ชัน) อยู่ฝั่ง Hub
   (Auth.gs) เท่านั้น เพราะ Hub เป็นจุดเดียวที่ล้าง cache เดิมทั้งหมดได้ทันทีตอนที่
   admin กดบันทึก ส่วนไฟล์นี้ (รันอยู่คนละ script project กับ Hub) เอื้อมไปล้าง
   cache ของ Hub ไม่ได้ จึงต้องยิงถาม Hub สดทุกครั้งแทน — มีแค่ memo ในหน่วยความจำ
   ระดับการทำงานครั้งเดียว (ถูกทิ้งเมื่อจบ execution) กันแค่การยิงซ้ำซ้อนภายในคำขอ
   เดียวกันเท่านั้น

   วิธีใช้ใน doGet ของแอปลูก
   ------------------------------------------------
   const PORTAL_MENU_ID = 'sec-xxx-dash';   // id เมนูของแอปนี้ใน MASTER_MENUS
   const PORTAL_ENFORCE = false;            // true เมื่อพร้อมเปิดใช้งานจริง (ดูด้านล่าง)

   function doGet(e) {
     const g = portalGuard(e, PORTAL_MENU_ID);
     if (g.deny) return g.deny;               // ถูกปฏิเสธ (และ PORTAL_ENFORCE = true)
     const access = g.access;                 // สิทธิ์จริง หรือสิทธิ์แบบผ่อนปรนช่วง shadow-mode

     const project = (e && e.parameter && e.parameter.project) || '';
     if (project && PORTAL_ENFORCE && !canSeeProject(access, project)) {
       return portalDenied('ไม่มีสิทธิ์ดูโครงการนี้');
     }

     const t = HtmlService.createTemplateFromFile('index');
     t.access = access;                       // ส่งสิทธิ์เข้าไปให้หน้าเว็บใช้ซ่อนปุ่ม
     return t.evaluate().setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
   }

   และตอนอ่านข้อมูลให้กรองด้วย scopeRows() เสมอ
     const rows = scopeRows(allRows, access, 'project');

   ส่วนฟังก์ชันที่ถูกเรียกผ่าน google.script.run (ไม่มี e ให้ใช้) ให้รับ portalToken
   เป็นพารามิเตอร์แรกเสมอ แล้วเรียก portalAccessForCall — ตัวนี้เคารพ PORTAL_ENFORCE
   เหมือน portalGuard ทุกประการ (shadow mode จะไม่บล็อกใครเลย ไม่ใช่แค่ตอนโหลดหน้า):
     function saveTask(portalToken, payload) {
       const access = portalAccessForCall(portalToken);   // ใส่ menuId ด้วยก็ได้
       if (!access.ok) return { ok:false, error: access.message };
       if (!canWrite(access)) return { ok:false, error: 'สิทธิ์ไม่พอ' };
       ...
     }

   PORTAL_ENFORCE คือสวิตช์ rollout ต่อแอป (ไม่ใช่ด่านความปลอดภัยจริง):
   ตอน false ระบบยังยิงไปถาม Hub และตัดสินใจเหมือนเดิมทุกอย่าง (ดู log ได้ว่า
   ถ้าบังคับใช้จริงจะปฏิเสธใครบ้าง) แต่จะไม่บล็อกใคร — คืนสิทธิ์แบบผ่อนปรนเต็มที่
   แทน เพื่อให้แอปทำงานเหมือนวันนี้จนกว่าจะยืนยันว่า role/โครงการของผู้ใช้จริงทุกคน
   แมปถูกต้องแล้ว ค่อยเปลี่ยนเป็น true แล้ว deploy ใหม่
   ================================================================ */

var PORTAL_HUB_URL = 'https://script.google.com/macros/s/XXXXXXXX/exec';  // ← ใส่ /exec ของ Auth service (Hub)

/* memo ระดับการทำงานครั้งเดียว — ไม่ใช่ cache ข้ามคำขอ (ดูคำอธิบายด้านบน) */
var _portalMemo = {};

/* ยืนยัน token กับ Hub สดทุกครั้ง (ไม่มี cache ข้ามคำขอ)
   ใส่ menuId (optional) เพื่อให้ Hub เช็คสิทธิ์หน้านี้มาให้เลยในคำขอเดียวกัน
   (ผลจะมี access.menuAllowed ติดมาด้วย ใช้แทนการเทียบ access.menuIds เอง) */
function portalAccessFromToken(token, menuId) {
  if (!token) return { ok: false, message: 'กรุณาเข้าใช้งานผ่านหน้า OMA Portal' };

  var memoKey = token + '|' + (menuId || '');
  if (_portalMemo.hasOwnProperty(memoKey)) return _portalMemo[memoKey];

  var result;
  try {
    var payload = { action: 'verify', token: token };
    if (menuId) payload.menuId = menuId;

    var res = UrlFetchApp.fetch(PORTAL_HUB_URL, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
      followRedirects: true
    });
    var json = JSON.parse(res.getContentText());

    result = json.success
      ? { ok: true, email: json.email, name: json.name, role: json.role,
          projectScope: json.projectScope, projects: json.projects || [],
          menuIds: json.menuIds || [], isAdmin: !!json.isAdmin,
          menuAllowed: json.menuAllowed,
          // null = ไม่ถูกจำกัดแถบย่อยเลย (ทุกแถบ) — ต่างจาก [] ที่แปลว่า "ไม่เห็นแถบไหนเลย"
          allowedSections: (menuId && json.allowedSections !== undefined) ? json.allowedSections : null }
      : { ok: false, message: json.message || 'ไม่มีสิทธิ์เข้าใช้งาน', code: json.code };
  } catch (err) {
    result = { ok: false, message: 'ตรวจสอบสิทธิ์ไม่สำเร็จ: ' + err.message };
  }

  _portalMemo[memoKey] = result;
  return result;
}

/* ตรวจ token จาก e.parameter.portalToken (ใช้ใน doGet) */
function portalAccess(e, menuId) {
  var token = (e && e.parameter && e.parameter.portalToken) || '';
  return portalAccessFromToken(token, menuId);
}

/* จุดเรียกหลักสำหรับ doGet — ครบทั้งเช็ค token + เช็คเมนู + สวิตช์ PORTAL_ENFORCE
   คืน { deny, access } เสมอ: ถ้า deny ไม่ใช่ null ให้ return มันตรงๆ ทันที
   ไม่งั้นใช้ access ตัวที่คืนมาไปสร้างหน้าเว็บต่อ (ในโหมด shadow ที่ PORTAL_ENFORCE
   ยังเป็น false นี่จะเป็นสิทธิ์แบบผ่อนปรนเต็มที่ ไม่ใช่สิทธิ์จริงของผู้ใช้) */
function portalGuard(e, menuId) {
  var access  = portalAccess(e, menuId);
  var problem = _portalProblem(access, menuId);
  if (!problem) return { deny: null, access: access };

  if (_portalEnforcing()) return { deny: portalDenied(problem), access: null };
  _portalLogShadow(menuId, problem, access);
  return { deny: null, access: _legacyAccess(access) };
}

/* เหมือน portalGuard แต่สำหรับฟังก์ชันที่เรียกผ่าน google.script.run (ไม่มี e ให้ใช้
   และไม่ต้องสร้างหน้า HTML ปฏิเสธ) — คืนแค่ access object เดียว พฤติกรรม shadow-mode
   (PORTAL_ENFORCE=false) เหมือน portalGuard ทุกประการ: ไม่บล็อกใคร ให้ฟังก์ชันที่
   เรียกใช้ทำงานเหมือนวันนี้จนกว่าจะเปิดใช้งานจริง
     function saveTask(portalToken, payload) {
       const access = portalAccessForCall(portalToken);   // หรือใส่ menuId ด้วยก็ได้
       if (!access.ok) return { ok:false, error: access.message };
       if (!canWrite(access)) return { ok:false, error: 'สิทธิ์ไม่พอ' };
       ...
     } */
function portalAccessForCall(token, menuId) {
  var access  = portalAccessFromToken(token, menuId);
  var problem = _portalProblem(access, menuId);
  if (!problem) return access;

  if (_portalEnforcing()) {
    // access.ok อาจยังเป็น true อยู่ (token ถูกต้อง แค่ไม่มีสิทธิ์เมนูนี้) —
    // ต้องพลิกเป็น ok:false เอง ไม่งั้นผู้เรียกที่เช็คแค่ !access.ok จะหลุดผ่านไป
    return access.ok ? { ok: false, message: problem, code: access.code } : access;
  }
  _portalLogShadow(menuId, problem, access);
  return _legacyAccess(access);
}

function _portalEnforcing() {
  return (typeof PORTAL_ENFORCE !== 'undefined') ? PORTAL_ENFORCE : true; // ลืมประกาศ = เข้มงวดไว้ก่อน
}

function _portalProblem(access, menuId) {
  if (!access.ok) return access.message || 'กรุณาเข้าใช้งานผ่านหน้า OMA Portal';
  if (menuId && !requireMenu(access, menuId)) return 'ไม่มีสิทธิ์เข้าหน้านี้';
  return null;
}

function _portalLogShadow(menuId, problem, access) {
  try {
    Logger.log('[PORTAL_ENFORCE=false] จะปฏิเสธถ้าบังคับใช้จริง (' + menuId + '): ' + problem +
      (access && access.email ? ' · ผู้ใช้: ' + access.email : ''));
  } catch (logErr) { /* log ล้มเหลวไม่ควรทำให้แอปล่ม */ }
}

/* โหมดเงา: ปล่อยผ่านด้วยสิทธิ์ผ่อนปรนเต็มที่ ให้แอปทำงานเหมือนวันนี้ทุกอย่าง */
function _legacyAccess(access) {
  return {
    ok: true, email: (access && access.email) || '', name: (access && access.name) || '',
    role: 'legacy', isAdmin: true, projectScope: 'all', projects: [], menuIds: [],
    menuAllowed: true, allowedSections: null
  };
}

/* true ถ้าผู้ใช้คนนี้เข้าหน้านี้ได้ — ใช้ access.menuAllowed ถ้ามีมาแล้ว (จากการยิง
   verify พร้อม menuId คำขอเดียว) ไม่งั้นเทียบกับ access.menuIds เอง */
function requireMenu(access, menuId) {
  if (!access || !access.ok) return false;
  if (typeof access.menuAllowed === 'boolean') return access.menuAllowed;
  return (access.menuIds || []).indexOf(menuId) !== -1;
}

/* คงชื่อเดิมไว้เผื่อโค้ดส่วนอื่นเรียกอยู่ — พฤติกรรมเหมือน requireMenu */
function canSeeMenu(access, menuId) {
  return requireMenu(access, menuId);
}

/* true ถ้าผู้ใช้คนนี้เห็น "แถบย่อย" นี้ได้ภายในแอป — ใช้ทั้งซ่อนปุ่มฝั่ง client และ
   กันการเรียก endpoint เขียนข้อมูลของแถบนั้นตรง ๆ ฝั่งเซิร์ฟเวอร์ (เหมือน requireMenu
   แต่อยู่ลึกลงไปอีกชั้นในแอปเดียว) access.allowedSections ต้องมาจากการยิง verify ที่
   ใส่ menuId ของแอปนี้ไปด้วย (ผ่าน portalAccess(e, menuId) หรือ
   portalAccessForCall(token, menuId)) ไม่งั้นจะเป็น undefined เสมอ (ตีความว่าไม่ถูกจำกัด) */
function requireSection(access, sectionId) {
  if (!access || !access.ok) return false;
  var allowed = access.allowedSections;
  if (allowed === null || allowed === undefined) return true; // ไม่ถูกจำกัด = เห็นทุกแถบ
  return allowed.indexOf(sectionId) !== -1;
}

/* true ถ้าผู้ใช้คนนี้ดูโครงการนี้ได้ (admin/manager/legacy = ทุกโครงการ) */
function canSeeProject(access, project) {
  if (!access || !access.ok) return false;
  if (access.projectScope === 'all') return true;
  var target = String(project || '').trim().toLowerCase();
  return (access.projects || []).some(function (p) { return String(p).trim().toLowerCase() === target; });
}

/* กรองแถวข้อมูลให้เหลือเฉพาะโครงการที่ผู้ใช้เห็นได้ */
function scopeRows(rows, access, field) {
  if (!access || !access.ok) return [];
  if (access.projectScope === 'all') return rows;
  var key = field || 'project';
  return rows.filter(function (r) { return canSeeProject(access, r[key]); });
}

/* สิทธิ์เขียนข้อมูล — ค่าเริ่มต้น: ทุก role ยกเว้น viewer เขียนได้
   (ปรับ default ตรงนี้ได้ถ้าบางแอปต้องการกฎเข้มกว่านี้) */
function canWrite(access) {
  if (!access || !access.ok) return false;
  if (access.role === 'legacy') return true; // shadow mode เท่านั้น
  return access.role !== 'viewer';
}

/* สิทธิ์ระดับองค์กร (เพิ่ม/ลบโครงการ, จัดการสมาชิก, ตั้งค่าที่กระทบทุกคน) */
function isAdminish(access) {
  return !!access && access.ok && (access.isAdmin || access.role === 'manager' || access.role === 'legacy');
}

/* กรองรายการรหัสโครงการให้เหลือเฉพาะที่ผู้ใช้เห็นได้ — ใช้แทนการวนเช็คทีละอันเอง */
function allowedProjectSet(access, codes) {
  if (!access || !access.ok) return [];
  if (access.projectScope === 'all') return codes.slice();
  return codes.filter(function (c) { return canSeeProject(access, c); });
}

function portalDenied(message) {
  return HtmlService.createHtmlOutput(
    '<div style="font-family:system-ui;padding:48px;text-align:center;color:#152033">' +
    '<div style="font-size:42px">🔒</div>' +
    '<h2 style="margin:12px 0 6px">ไม่มีสิทธิ์เข้าถึง</h2>' +
    '<p style="color:#6b7a90">' + (message || '') + '</p></div>'
  ).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
