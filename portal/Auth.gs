/* ================================================================
   OMA PORTAL HUB — AUTH & ACCESS CONTROL (Google Apps Script)
   ================================================================
   คุมได้ 2 ชั้น
     1) ชั้นหน้า (Page/Menu)  — ใครเห็นเมนูไหนบ้าง (ทีละหน้า หรือ All)
     2) ชั้นโครงการ (Project) — ใครเห็นข้อมูลของโครงการไหนบ้าง

   สรุปสิทธิ์ตามค่าเริ่มต้น
     admin     → ทุกหน้า (รวมหน้าตั้งค่าสิทธิ์) + ทุกโครงการ
     manager   → ทุกหน้า "ยกเว้นหน้าตั้งค่าสิทธิ์" + ทุกโครงการ
     head      → หัวหน้าโครงการ: เห็นเฉพาะโครงการที่ถูกผูกไว้ (คอลัมน์ projects)
     engineer  → Engineer/Tech: เห็นเฉพาะโครงการของตัวเอง และหน้าน้อยกว่า head
     viewer    → ดูอย่างเดียว เฉพาะโครงการของตัวเอง

   วิธีติดตั้ง
     1. script.google.com → New Project → วางไฟล์นี้เป็น Auth.gs
     2. เพิ่มไฟล์ HTML ชื่อ "Portal" แล้ววางเนื้อหาจาก portal/Portal.html
     3. รันฟังก์ชัน setupPortal() หนึ่งครั้ง (สร้างชีต + หัวตาราง + แอดมินคนแรก)
     4. Deploy → New deployment → Web app
          Execute as: Me
          Who has access: Anyone
     5. เอา URL /exec ที่ได้ไปเปิดใช้งาน และส่งให้แอปลูก (iframe) ใช้ verify token
   ================================================================ */

const PORTAL_HUB_ID = "1IZ0p4nQmN3J34BoacZnR7cZRqtsp2h2xjDJk77AZVNA";

const SHEETS = {
  USERS:    'Sheet_Users',
  ROLES:    'Sheet_Roles',
  PROJECTS: 'Sheet_Projects',
  SESSIONS: 'Sheet_Sessions',
  LOG:      'Sheet_Log'
};

const USER_HEADERS    = ['email','password','allowedMenus','firstLogin','role','projects','name','active'];
const ROLE_HEADERS    = ['role','label','menus','projectScope','active'];
const PROJECT_HEADERS = ['code','name','active'];
const SESSION_HEADERS = ['token','email','role','projects','exp'];
const LOG_HEADERS     = ['time','email','action','detail'];

const TOKEN_TTL   = 8 * 60 * 60 * 1000;   // อายุ session 8 ชั่วโมง
const PW_SALT     = 'OMA_PORTAL_2024';
const BOOTSTRAP_ADMIN = { email: 'admin@oma.local', password: 'admin1234' };

/* PERM_VERSION — กันแอปลูก cache สิทธิ์เก่าค้าง (ดู README หัวข้อ "cache เก็บได้ตรงไหน")
   ทุกครั้งที่ admin แก้ user/role/project ให้เรียก bumpPermVersion() เลขจะขยับ
   ทำให้ cache key เดิมทั้งหมด (ทั้งใน apiVerify เองและใน apiVerify ของแอปลูกทุกตัว
   ที่ยิงมาถามผ่าน ?action=verify) เข้าถึงไม่ได้อีกในทันที — คำขอถัดไปจึงอ่านสด
   เสมอ โดยไม่ต้องไล่ล้าง cache key เดิมทีละตัว */
const VERIFY_CACHE_TTL = 300; // วินาที — ปลอดภัยเพราะ key มีเลขเวอร์ชันฝังอยู่แล้ว

function permVersion() {
  return PropertiesService.getScriptProperties().getProperty('PERM_VERSION') || '0';
}
function bumpPermVersion() {
  const props = PropertiesService.getScriptProperties();
  const next  = (parseInt(props.getProperty('PERM_VERSION') || '0', 10) + 1).toString();
  props.setProperty('PERM_VERSION', next);
  return next;
}

/* หน้า/เมนูทั้งหมดของพอร์ทัล
   adminOnly:true = ล็อกไว้ให้ admin เท่านั้น ไม่ว่าจะตั้งค่าอย่างไรก็ตาม
   scoped:true    = เป็นหน้าที่ผูกกับโครงการ (จะส่ง scope โครงการเข้า iframe ด้วย) */
const MASTER_MENUS = [
  { id: 'sec-projects-dash', label: 'Projects',            icon: 'bi-folder2-open',            isIframe: true, scoped: true,  src: 'https://script.google.com/macros/s/AKfycbzrXj4jFBb8HIjUHpPPoEMOR3-Ux7uYqDGN_uuMLWrPa4JDeDUoUg5eEBEn9QgCwyp1QA/exec' },
  { id: 'sec-finance-dash',  label: 'Finance',             icon: 'bi-currency-dollar',         isIframe: true, scoped: true,  src: 'https://script.google.com/macros/s/AKfycbzcU6hYwKvc80nAcbPykUMdXM0bU_IWtdyEb85GqkofzPuFBVIb5dSpP8ZEC3GNoG4e/exec' },
  { id: 'sec-solar-dash',    label: 'Solar Monitoring',    icon: 'bi-sun',                     isIframe: true, scoped: true,  src: 'https://script.google.com/macros/s/AKfycbypTmkWTTOotfv60aTQDQoX5Q7F6g6a6HEK51TSLrS3e-hw4mWOxkT3YPK5OHq3iw/exec' },
  { id: 'sec-wbs-dash',      label: 'Work Progress',       icon: 'bi-bar-chart-steps',         isIframe: true, scoped: true,  src: 'https://script.google.com/macros/s/AKfycbw5dPl4v-ShgAKjJq5q3Bj49W19ExY6csKqQYNd_iEqQXJGHW-JIA7ne-hVvVlJt24cSQ/exec' },
  { id: 'sec-assets-dash',   label: 'Project Assets',      icon: 'bi-cpu',                     isIframe: true, scoped: true,  src: 'https://script.google.com/macros/s/AKfycbz5JO937Ehs-fhMrkHWKWd017OZPzaIsHORaqZT_tFlyWK5w59CdsEMXgQkjJrhp9SV6A/exec' },
  { id: 'sec-kpi-dash',      label: 'Performance (KPI)',   icon: 'bi-trophy',                  isIframe: true, scoped: true,  src: 'https://script.google.com/macros/s/AKfycbzqcuWDrhXJ9B-dp08i3BvLpIHW2AGosDSBV-18ZN-ChHUxhbr6CVVjQ9nvscrJ7sE3tQ/exec' },
  { id: 'sec-vehicles-dash', label: 'Vehicles',            icon: 'bi-truck',                   isIframe: true, scoped: false, src: 'https://script.google.com/macros/s/AKfycbwqMKTP_4udIABQAql0YIsVD4laV0XyhaLPLnoDSv3YPqBdfKxlyz7j143AzfQsmfw-/exec' },
  { id: 'sec-employee-dash', label: 'Employee Management', icon: 'bi-person-bounding-box',     isIframe: true, scoped: false, src: 'https://script.google.com/macros/s/AKfycbz-CgJ1JgYrOBhNblYfwk-Qs3i78daucbaqFD_-Q4uXKAS2_gjms8QiuZPF74yIjOB9/exec' },
  { id: 'sec-labroom-dash',  label: 'Lab Room',            icon: 'bi-pc-display-horizontal',   isIframe: true, scoped: false, src: 'https://script.google.com/macros/s/AKfycbwWbB9VBqXqWuacYQA36_f2y9BY_XKsvpG_xoRomYkLgFnfhcN2DDGf1z-1fZOERdwwlg/exec' },
  { id: 'sec-settings',      label: 'ตั้งค่าสิทธิ์',           icon: 'bi-shield-lock',             isIframe: false, scoped: false, adminOnly: true }
];

/* ค่าเริ่มต้นของแต่ละ role — แก้ได้ภายหลังจากหน้า "ตั้งค่าสิทธิ์"
   menus: 'All' = ทุกหน้า | 'AllExceptSettings' = ทุกหน้ายกเว้นหน้าตั้งค่า | รายการ id คั่นด้วย ,
   projectScope: 'all' = ทุกโครงการ | 'own' = เฉพาะโครงการที่ผูกไว้กับผู้ใช้ */
const DEFAULT_ROLES = [
  { role: 'admin',    label: 'Admin (ผู้ดูแลระบบ)',       menus: 'All',               projectScope: 'all', active: 'true' },
  { role: 'manager',  label: 'Manager (ผู้บริหาร)',        menus: 'AllExceptSettings', projectScope: 'all', active: 'true' },
  { role: 'head',     label: 'หัวหน้าโครงการ',              menus: 'sec-projects-dash,sec-finance-dash,sec-solar-dash,sec-wbs-dash,sec-assets-dash,sec-kpi-dash', projectScope: 'own', active: 'true' },
  { role: 'engineer', label: 'Engineer / Tech',           menus: 'sec-projects-dash,sec-solar-dash,sec-wbs-dash,sec-assets-dash',                                projectScope: 'own', active: 'true' },
  { role: 'viewer',   label: 'Viewer (ดูอย่างเดียว)',       menus: 'sec-projects-dash,sec-wbs-dash',                                                              projectScope: 'own', active: 'true' }
];

/* ================================================================
   ENTRY POINTS
   ================================================================ */
function doGet(e) {
  const action = e && e.parameter && e.parameter.action;

  // ให้แอปลูก (iframe) เรียกตรวจ token ผ่าน GET ได้ — UrlFetchApp ฝั่ง Apps Script ใช้ง่ายกว่า
  if (action) return respondJSON(route(action, e.parameter || {}));

  return HtmlService.createTemplateFromFile('Portal')
    .evaluate()
    .setTitle('OMA Portal')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return respondJSON({ success: false, message: 'ไม่มีข้อมูล POST request' });
    }
    const data = JSON.parse(e.postData.contents);

    // รองรับของเดิม: ยิง {email, password} มาตรง ๆ โดยไม่มี action ให้ถือว่าเป็น login
    const action = data.action || (data.email && data.password ? 'login' : '');
    return respondJSON(route(action, data));

  } catch (error) {
    return respondJSON({
      success: false,
      message: 'เกิดข้อผิดพลาดที่ระบบหลังบ้าน: ' + (error.message || error.toString())
    });
  }
}

function route(action, data) {
  switch (action) {
    // --- สาธารณะ ---
    case 'login':          return apiLogin(data);
    case 'verify':         return apiVerify(data);
    case 'logout':         return apiLogout(data);
    case 'changePassword': return apiChangePassword(data);
    case 'ping':           return { success: true, message: 'Portal auth service is ready.' };

    // --- เฉพาะ admin (หน้าตั้งค่าสิทธิ์) ---
    case 'getSettings':  return guardAdmin(data, apiGetSettings);
    case 'saveUser':     return guardAdmin(data, apiSaveUser);
    case 'deleteUser':   return guardAdmin(data, apiDeleteUser);
    case 'saveRoles':    return guardAdmin(data, apiSaveRoles);
    case 'saveProjects': return guardAdmin(data, apiSaveProjects);

    default:
      return { success: false, message: 'ไม่รู้จัก action: ' + action };
  }
}

/* ================================================================
   AUTH
   ================================================================ */
function apiLogin(data) {
  const email    = String(data.email || '').toLowerCase().trim();
  const password = String(data.password || '');

  if (!email || !password) {
    return { success: false, message: 'กรุณาส่ง email และ password มาให้ครบ' };
  }

  ensureSetup();
  const user = findUser(email);

  if (!user) return { success: false, code: 'USER_NOT_FOUND', message: 'ไม่พบอีเมลนี้ในระบบ OMA' };
  if (!passwordMatches(user.password, password)) {
    return { success: false, code: 'WRONG_PASSWORD', message: 'รหัสผ่านไม่ถูกต้อง' };
  }
  if (String(user.active).toLowerCase() === 'false') {
    return { success: false, code: 'USER_INACTIVE', message: 'บัญชีนี้ถูกปิดการใช้งาน · ติดต่อผู้ดูแลระบบ' };
  }

  const access = resolveAccess(user);
  if (!access.menus.length) {
    return { success: false, code: 'NO_MENU', message: 'บัญชีนี้ยังไม่ได้รับสิทธิ์เข้าหน้าใดเลย · ติดต่อผู้ดูแลระบบ' };
  }
  if (access.projectScope === 'own' && !access.projects.length) {
    return { success: false, code: 'NO_PROJECT', message: 'บัญชีนี้ยังไม่ได้ผูกกับโครงการใด · ติดต่อผู้ดูแลระบบ' };
  }

  const token = createSession(user, access);
  writeLog(email, 'login', access.role + ' · ' + (access.projectScope === 'all' ? 'ทุกโครงการ' : access.projects.join('|')));

  return {
    success: true,
    token: token,
    email: user.email,
    isFirstLogin: String(user.firstLogin).toUpperCase() === 'Y',
    user: {
      email:        user.email,
      name:         user.name || user.email,
      role:         access.role,
      roleLabel:    access.roleLabel,
      projectScope: access.projectScope,
      projects:     access.projects,
      isAdmin:      access.role === 'admin'
    },
    projects: listVisibleProjects(access),
    menus:    access.menus
  };
}

/* แอปลูกเรียกมาเช็คว่า token ยังใช้ได้ไหม + ได้สิทธิ์โครงการอะไรบ้าง
   คืน projects: [] พร้อม projectScope 'all' = เข้าได้ทุกโครงการ
   ส่ง data.menuId มาด้วยได้ (optional) เพื่อให้แอปลูกเช็คสิทธิ์หน้าตัวเองในคำขอเดียวกัน
   ================================================================
   หมายเหตุเรื่อง cache: session (token) ยังเช็คสดทุกครั้งเสมอ (ถูก/ผิด/หมดอายุ
   ต้องรู้ทันที) — ที่ cache คือ "ผลการคำนวณสิทธิ์" ของอีเมลนั้น (role/menus/projects)
   ซึ่งขึ้นกับข้อมูลใน Sheet_Users/Sheet_Roles/Sheet_Projects เท่านั้น คีย์ cache
   ฝัง permVersion() ไว้ ทำให้ admin แก้อะไรก็ตามที่กระทบสิทธิ์ (bumpPermVersion())
   จะทำให้ cache เดิมของทุกอีเมลเข้าถึงไม่ได้ทันที ไม่ใช่แค่ของคนที่ถูกแก้ */
function apiVerify(data) {
  const session = getSession(data.token);
  if (!session) return { success: false, code: 'INVALID_TOKEN', message: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' };

  const email    = String(session.email).toLowerCase().trim();
  const cache    = CacheService.getScriptCache();
  const cacheKey = 'v' + permVersion() + '|verify|' + email;

  let result = null;
  try {
    const hit = cache.get(cacheKey);
    if (hit) result = JSON.parse(hit);
  } catch (e) { result = null; }

  if (!result) {
    const user = findUser(session.email);
    if (!user || String(user.active).toLowerCase() === 'false') {
      apiLogout(data);
      return { success: false, code: 'USER_INACTIVE', message: 'บัญชีนี้ถูกปิดการใช้งาน' };
    }

    const access = resolveAccess(user);
    result = {
      success: true,
      email:        user.email,
      name:         user.name || user.email,
      role:         access.role,
      roleLabel:    access.roleLabel,
      projectScope: access.projectScope,
      projects:     access.projects,
      isAdmin:      access.role === 'admin',
      menus:        access.menus,
      menuIds:      access.menus.map(m => m.id),
      projectList:  listVisibleProjects(access)
    };
    try { cache.put(cacheKey, JSON.stringify(result), VERIFY_CACHE_TTL); } catch (e) { /* cache ล้มเหลวไม่ควรทำให้ verify ล่ม */ }
  }

  if (data.menuId) {
    result = Object.assign({}, result, { menuAllowed: result.menuIds.indexOf(data.menuId) !== -1 });
  }
  return result;
}

function apiLogout(data) {
  const sh = sheet(SHEETS.SESSIONS, SESSION_HEADERS);
  const rows = sh.getDataRange().getValues();
  for (let i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][0]) === String(data.token)) sh.deleteRow(i + 1);
  }
  return { success: true };
}

function apiChangePassword(data) {
  const session = getSession(data.token);
  if (!session) return { success: false, code: 'INVALID_TOKEN', message: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' };

  const newPassword = String(data.newPassword || '');
  if (newPassword.length < 8) return { success: false, message: 'รหัสผ่านใหม่ต้องยาวอย่างน้อย 8 ตัวอักษร' };

  const sh   = sheet(SHEETS.USERS, USER_HEADERS);
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).toLowerCase().trim() === String(session.email).toLowerCase()) {
      sh.getRange(i + 1, 2).setValue(hashPw(newPassword));
      sh.getRange(i + 1, 4).setValue('N');
      bumpPermVersion();
      writeLog(session.email, 'changePassword', '');
      return { success: true };
    }
  }
  return { success: false, message: 'ไม่พบผู้ใช้นี้' };
}

/* ================================================================
   ACCESS RESOLUTION — หัวใจของระบบสิทธิ์
   ================================================================ */
function resolveAccess(user) {
  const role    = String(user.role || 'viewer').toLowerCase().trim() || 'viewer';
  const roleCfg = getRoleConfig(role);

  // 1) สิทธิ์ระดับหน้า: ถ้าผู้ใช้ระบุ allowedMenus ไว้เอง ใช้ของผู้ใช้ก่อน ไม่งั้นใช้ของ role
  const userMenuSpec = String(user.allowedMenus || '').trim();
  const menuSpec     = userMenuSpec || roleCfg.menus;
  let menus          = expandMenuSpec(menuSpec);

  // กฎเหล็ก: หน้าที่ตั้ง adminOnly ให้เฉพาะ admin เท่านั้น แม้จะใส่ไว้ในชีตก็ตาม
  if (role !== 'admin') menus = menus.filter(m => !m.adminOnly);

  // 2) สิทธิ์ระดับโครงการ
  const projectScope = roleCfg.projectScope === 'all' ? 'all' : 'own';
  const projects     = splitList(user.projects);

  return {
    role: role,
    roleLabel: roleCfg.label || role,
    menus: menus,
    projectScope: projectScope,
    projects: projectScope === 'all' ? [] : projects
  };
}

function expandMenuSpec(spec) {
  const s = String(spec || '').trim();
  if (!s) return [];
  if (s.toLowerCase() === 'all') return MASTER_MENUS.slice();
  if (s.toLowerCase() === 'allexceptsettings') return MASTER_MENUS.filter(m => !m.adminOnly);
  const ids = splitList(s);
  return MASTER_MENUS.filter(m => ids.indexOf(m.id) !== -1);
}

function getRoleConfig(role) {
  const rows = cachedReadObjects('roles', SHEETS.ROLES, ROLE_HEADERS);
  const rec  = rows.find(r => String(r.role).toLowerCase().trim() === role);
  if (rec && String(rec.active).toLowerCase() !== 'false') {
    return {
      role: role,
      label: rec.label || role,
      menus: rec.menus || '',
      projectScope: String(rec.projectScope || 'own').toLowerCase()
    };
  }
  const def = DEFAULT_ROLES.find(r => r.role === role);
  return def ? { role: role, label: def.label, menus: def.menus, projectScope: def.projectScope }
             : { role: role, label: role, menus: '', projectScope: 'own' };
}

/* รายชื่อโครงการที่ผู้ใช้คนนี้เห็นได้ — admin/manager เห็นทุกโครงการ, ที่เหลือเห็นเฉพาะของตัวเอง */
function listVisibleProjects(access) {
  const all = cachedReadObjects('projects', SHEETS.PROJECTS, PROJECT_HEADERS)
    .filter(p => p.code && String(p.active).toLowerCase() !== 'false')
    .map(p => ({ code: String(p.code).trim(), name: p.name || p.code }));

  if (access.projectScope === 'all') return all;

  const own  = access.projects.map(c => c.toLowerCase());
  const hit  = all.filter(p => own.indexOf(p.code.toLowerCase()) !== -1);
  // โครงการที่ผูกกับผู้ใช้แต่ยังไม่มีในตารางโครงการ ก็ยังให้เห็น (กันข้อมูลตกหล่น)
  const codes = hit.map(p => p.code.toLowerCase());
  access.projects.forEach(c => {
    if (codes.indexOf(c.toLowerCase()) === -1) hit.push({ code: c, name: c });
  });
  return hit;
}

/* ================================================================
   SESSION
   ================================================================ */
function createSession(user, access) {
  const sh    = sheet(SHEETS.SESSIONS, SESSION_HEADERS);
  const token = Utilities.getUuid();
  const exp   = new Date(Date.now() + TOKEN_TTL).toISOString();
  sh.appendRow([token, user.email, access.role, access.projects.join(','), exp]);
  cleanupSessions(sh);
  return token;
}

function findUser(email) {
  const key = String(email || '').toLowerCase().trim();
  return readObjects(SHEETS.USERS, USER_HEADERS)
    .find(u => String(u.email).toLowerCase().trim() === key) || null;
}

/* ตัด session ทั้งหมดของผู้ใช้คนนี้ — ใช้ตอนลบ/ปิดบัญชี/เปลี่ยนตำแหน่ง */
function revokeSessions(email) {
  const key  = String(email || '').toLowerCase().trim();
  const sh   = sheet(SHEETS.SESSIONS, SESSION_HEADERS);
  const rows = sh.getDataRange().getValues();
  for (let i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][1]).toLowerCase().trim() === key) sh.deleteRow(i + 1);
  }
}

function getSession(token) {
  if (!token) return null;
  const rows = readObjects(SHEETS.SESSIONS, SESSION_HEADERS);
  const rec  = rows.find(r => String(r.token) === String(token));
  if (!rec) return null;
  if (new Date(rec.exp) < new Date()) return null;
  return rec;
}

function cleanupSessions(sh) {
  const rows = sh.getDataRange().getValues();
  const now  = new Date();
  for (let i = rows.length - 1; i >= 1; i--) {
    const exp = rows[i][4];
    if (exp && new Date(exp) < now) sh.deleteRow(i + 1);
  }
}

/* ================================================================
   ADMIN APIs — หน้าตั้งค่าสิทธิ์
   ================================================================ */
function guardAdmin(data, fn) {
  const session = getSession(data.token);
  if (!session) return { success: false, code: 'INVALID_TOKEN', message: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' };

  // อ่านสถานะผู้ใช้สด ๆ เสมอ — บัญชีที่ถูกลบ/ปิด/ลดสิทธิ์ไปแล้ว ต้องใช้ token เดิมต่อไม่ได้
  const user = findUser(session.email);
  if (!user || String(user.active).toLowerCase() === 'false') {
    apiLogout(data);
    return { success: false, code: 'INVALID_TOKEN', message: 'บัญชีนี้ใช้งานไม่ได้แล้ว กรุณาเข้าสู่ระบบใหม่' };
  }
  if (String(user.role).toLowerCase() !== 'admin') {
    return { success: false, code: 'FORBIDDEN', message: 'เฉพาะผู้ดูแลระบบ (Admin) เท่านั้น' };
  }
  return fn(data, { email: user.email, role: 'admin' });
}

function apiGetSettings() {
  ensureSetup();
  const users = readObjects(SHEETS.USERS, USER_HEADERS).map(u => ({
    email:        u.email,
    name:         u.name || '',
    role:         String(u.role || 'viewer').toLowerCase(),
    projects:     splitList(u.projects),
    allowedMenus: String(u.allowedMenus || '').trim(),
    firstLogin:   String(u.firstLogin || 'N').toUpperCase(),
    active:       String(u.active).toLowerCase() !== 'false'
  }));

  const roles = readObjects(SHEETS.ROLES, ROLE_HEADERS).map(r => ({
    role:         String(r.role).toLowerCase(),
    label:        r.label || r.role,
    menus:        String(r.menus || ''),
    menuIds:      expandMenuSpec(r.menus).map(m => m.id),
    projectScope: String(r.projectScope || 'own').toLowerCase(),
    active:       String(r.active).toLowerCase() !== 'false'
  }));

  const projects = readObjects(SHEETS.PROJECTS, PROJECT_HEADERS)
    .filter(p => p.code)
    .map(p => ({ code: String(p.code).trim(), name: p.name || p.code, active: String(p.active).toLowerCase() !== 'false' }));

  return {
    success: true,
    users: users,
    roles: roles,
    projects: projects,
    menus: MASTER_MENUS.map(m => ({ id: m.id, label: m.label, icon: m.icon, adminOnly: !!m.adminOnly, scoped: !!m.scoped }))
  };
}

function apiSaveUser(data, session) {
  const u     = data.user || {};
  const email = String(u.email || '').toLowerCase().trim();
  if (!email || email.indexOf('@') === -1) return { success: false, message: 'อีเมลไม่ถูกต้อง' };

  const role = String(u.role || 'viewer').toLowerCase().trim();
  const scope = getRoleConfig(role).projectScope;
  const projects = Array.isArray(u.projects) ? u.projects.join(',') : String(u.projects || '');
  if (scope === 'own' && !projects.trim()) {
    return { success: false, message: 'role นี้ต้องระบุโครงการอย่างน้อย 1 โครงการ' };
  }

  const sh    = sheet(SHEETS.USERS, USER_HEADERS);
  const rows  = sh.getDataRange().getValues();
  const menus = Array.isArray(u.allowedMenus) ? u.allowedMenus.join(',') : String(u.allowedMenus || '');
  let rowIdx  = -1;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).toLowerCase().trim() === email) { rowIdx = i + 1; break; }
  }

  if (rowIdx === -1) {
    const pwd = String(u.password || '');
    if (pwd.length < 8) return { success: false, message: 'ผู้ใช้ใหม่ต้องตั้งรหัสผ่านอย่างน้อย 8 ตัวอักษร' };
    sh.appendRow([email, hashPw(pwd), menus, 'Y', role, projects, u.name || '', u.active === false ? 'false' : 'true']);
  } else {
    const row = [email, rows[rowIdx - 1][1], menus, rows[rowIdx - 1][3], role, projects, u.name || '', u.active === false ? 'false' : 'true'];
    if (u.password) { row[1] = hashPw(String(u.password)); row[3] = 'Y'; }
    sh.getRange(rowIdx, 1, 1, USER_HEADERS.length).setValues([row]);

    const roleChanged = String(rows[rowIdx - 1][4]).toLowerCase() !== role;
    if (roleChanged || u.active === false || u.password) revokeSessions(email);
  }

  bumpPermVersion();
  writeLog(session.email, 'saveUser', email + ' · ' + role);
  return { success: true };
}

function apiDeleteUser(data, session) {
  const email = String(data.email || '').toLowerCase().trim();
  if (email === String(session.email).toLowerCase()) {
    return { success: false, message: 'ลบบัญชีตัวเองไม่ได้' };
  }
  const sh   = sheet(SHEETS.USERS, USER_HEADERS);
  const rows = sh.getDataRange().getValues();

  const admins = rows.slice(1).filter(r => String(r[4]).toLowerCase() === 'admin' && String(r[7]).toLowerCase() !== 'false');
  const target = rows.slice(1).find(r => String(r[0]).toLowerCase().trim() === email);
  if (target && String(target[4]).toLowerCase() === 'admin' && admins.length <= 1) {
    return { success: false, message: 'ต้องเหลือ Admin อย่างน้อย 1 คนในระบบ' };
  }

  for (let i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][0]).toLowerCase().trim() === email) sh.deleteRow(i + 1);
  }
  revokeSessions(email);
  bumpPermVersion();
  writeLog(session.email, 'deleteUser', email);
  return { success: true };
}

function apiSaveRoles(data, session) {
  const roles = data.roles || [];
  if (!roles.length) return { success: false, message: 'ไม่มีข้อมูล role' };

  const admin = roles.find(r => String(r.role).toLowerCase() === 'admin');
  if (!admin) return { success: false, message: 'ห้ามลบ role admin' };

  const sh = sheet(SHEETS.ROLES, ROLE_HEADERS);
  sh.clearContents();
  sh.getRange(1, 1, 1, ROLE_HEADERS.length).setValues([ROLE_HEADERS]);

  const values = roles.map(r => {
    const role  = String(r.role).toLowerCase().trim();
    // admin ถูกล็อกไว้ที่ All + ทุกโครงการเสมอ กันแอดมินเผลอตัดสิทธิ์ตัวเองจนเข้าหน้าตั้งค่าไม่ได้
    if (role === 'admin') return ['admin', r.label || 'Admin (ผู้ดูแลระบบ)', 'All', 'all', 'true'];
    let menus = Array.isArray(r.menuIds) ? r.menuIds.filter(id => {
      const m = MASTER_MENUS.find(x => x.id === id);
      return m && !m.adminOnly;              // role อื่นใส่หน้าตั้งค่าไม่ได้
    }).join(',') : String(r.menus || '');
    return [role, r.label || role, menus, String(r.projectScope || 'own').toLowerCase() === 'all' ? 'all' : 'own', r.active === false ? 'false' : 'true'];
  });
  sh.getRange(2, 1, values.length, ROLE_HEADERS.length).setValues(values);

  bumpPermVersion();
  writeLog(session.email, 'saveRoles', values.map(v => v[0]).join(','));
  return { success: true };
}

function apiSaveProjects(data, session) {
  const projects = data.projects || [];
  const sh = sheet(SHEETS.PROJECTS, PROJECT_HEADERS);
  sh.clearContents();
  sh.getRange(1, 1, 1, PROJECT_HEADERS.length).setValues([PROJECT_HEADERS]);
  const values = projects
    .filter(p => String(p.code || '').trim())
    .map(p => [String(p.code).trim(), p.name || p.code, p.active === false ? 'false' : 'true']);
  if (values.length) sh.getRange(2, 1, values.length, PROJECT_HEADERS.length).setValues(values);

  bumpPermVersion();
  writeLog(session.email, 'saveProjects', values.length + ' โครงการ');
  return { success: true };
}

/* ================================================================
   SETUP & SHEET HELPERS
   ================================================================ */
function setupPortal() {
  ensureSetup(true);
  return 'ติดตั้งเรียบร้อย — เข้าสู่ระบบครั้งแรกด้วย ' + BOOTSTRAP_ADMIN.email + ' / ' + BOOTSTRAP_ADMIN.password;
}

function ensureSetup(force) {
  const usersSh = sheet(SHEETS.USERS, USER_HEADERS);
  sheet(SHEETS.SESSIONS, SESSION_HEADERS);
  sheet(SHEETS.LOG, LOG_HEADERS);

  const rolesSh = sheet(SHEETS.ROLES, ROLE_HEADERS);
  if (rolesSh.getLastRow() <= 1) {
    const values = DEFAULT_ROLES.map(r => [r.role, r.label, r.menus, r.projectScope, r.active]);
    rolesSh.getRange(2, 1, values.length, ROLE_HEADERS.length).setValues(values);
  }

  sheet(SHEETS.PROJECTS, PROJECT_HEADERS);

  if (usersSh.getLastRow() <= 1 || force) {
    const rows = usersSh.getDataRange().getValues().slice(1);
    const hasAdmin = rows.some(r => String(r[4]).toLowerCase() === 'admin');
    if (!hasAdmin) {
      usersSh.appendRow([
        BOOTSTRAP_ADMIN.email, hashPw(BOOTSTRAP_ADMIN.password), 'All', 'Y', 'admin', '', 'Administrator', 'true'
      ]);
    }
  }
}

function sheet(name, headers) {
  const ss = SpreadsheetApp.openById(PORTAL_HUB_ID);
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (headers) {
    const width = sh.getLastColumn();
    const current = width ? sh.getRange(1, 1, 1, width).getValues()[0] : [];
    const missing = headers.some((h, i) => String(current[i] || '') !== h);
    if (missing) sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  }
  return sh;
}

/* เหมือน readObjects แต่ cache ผลไว้ตามเลขเวอร์ชันสิทธิ์ปัจจุบัน — ใช้กับชีตที่
   bumpPermVersion() ครอบคลุมอยู่แล้ว (Sheet_Roles, Sheet_Projects) เพื่อให้แม้แต่
   ตอน cache miss ของ apiVerify ก็ยังไม่ต้องอ่านชีตซ้ำถ้ามีคนเพิ่ง verify ไปหมาดๆ */
function cachedReadObjects(cacheName, name, headers) {
  const cache = CacheService.getScriptCache();
  const key   = 'v' + permVersion() + '|sheet|' + cacheName;
  try {
    const hit = cache.get(key);
    if (hit) return JSON.parse(hit);
  } catch (e) { /* ตกไปอ่านสดด้านล่าง */ }

  const rows = readObjects(name, headers);
  try { cache.put(key, JSON.stringify(rows), VERIFY_CACHE_TTL); } catch (e) { /* ไม่เป็นไรถ้า cache ไม่สำเร็จ */ }
  return rows;
}

function readObjects(name, headers) {
  const sh   = sheet(name, headers);
  const rows = sh.getDataRange().getValues();
  if (rows.length <= 1) return [];
  const head = rows[0].map(h => String(h).trim());
  return rows.slice(1)
    .filter(r => r.some(c => String(c).trim() !== ''))
    .map(r => {
      const o = {};
      head.forEach((h, i) => { o[h] = r[i]; });
      return o;
    });
}

function writeLog(email, action, detail) {
  try {
    sheet(SHEETS.LOG, LOG_HEADERS).appendRow([new Date().toISOString(), email || '', action, detail || '']);
  } catch (err) { /* log ล้มเหลวไม่ควรทำให้ระบบล่ม */ }
}

function splitList(value) {
  return String(value || '').split(',').map(s => s.trim()).filter(Boolean);
}

/* รองรับทั้งรหัสผ่านที่ hash แล้ว และรหัสเดิมที่เก็บเป็น plain text ในชีต */
function passwordMatches(stored, input) {
  const s = String(stored || '');
  return s === hashPw(input) || s === input;
}

function hashPw(pw) {
  return Utilities.base64Encode(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(pw) + PW_SALT)
  );
}

function respondJSON(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
