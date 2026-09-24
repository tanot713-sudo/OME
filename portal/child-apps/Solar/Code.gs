// ============================================================
// AMR ASIA Solar Dashboard — Code.gs v3
// ============================================================
 
const SPREADSHEET_ID = '1cY-HHBKAvLOkTplHs-vN_ex8UAjfxubKO59ex0yqZbY';
 
const SH = {
  PROJECTS  : 'Projects',
  FEAS_PLAN : 'FeasPlan',
  ACTUAL    : 'Actual',
  PROJ      : 'FeasActual_Proj',
  BREAKEVEN : 'Breakeven_Calc',
  BUDGET    : 'Sheet_Budget',
  METERS    : 'Sheet_Meters',
  CONFIG    : 'System_Config',
};
 
const SEASONAL_KWH = {1:1.0,2:1.0,3:0.8,4:0.8,5:1.0,6:1.2,7:1.2,8:1.2,9:1.0,10:0.8,11:1.0,12:1.0};
const CO2_FACTOR      = 0.4999; // kg CO2/kWh (EGAT 2024)

// เดิมทุกฟังก์ชันเรียก SpreadsheetApp.openById(SPREADSHEET_ID) ของตัวเอง (รวม 14 จุด) —
// หน้า dashboard เดียวมักเรียกหลายฟังก์ชันต่อกันในคำขอเดียว แต่ละจุดเลย openById ซ้ำ
// สเปรดชีตเดิมซ้ำๆ ซึ่งมีค่าใช้จ่าย (คล้าย network round-trip) ทุกครั้ง — memo ไว้ในตัวแปร
// ระดับโมดูล เปิดครั้งเดียวต่อการทำงานหนึ่งรอบ (ยังคงเป็นสเปรดชีตตัวเดิม, ID เดิมเป๊ะ ไม่มี
// การเปลี่ยนพฤติกรรมใดๆ)
var _ssCache_ = null;
function _ss_() {
  if (!_ssCache_) _ssCache_ = SpreadsheetApp.openById(SPREADSHEET_ID);
  return _ssCache_;
}

// getHomepageData/getPortfolioProduction อ่านทั้งชีต (Breakeven_Calc, Sheet_Production —
// อาจมีหลายพันแถวสะสมตามเวลา) แล้วคำนวณ IRR/รวมยอดใหม่หมดทุกครั้งที่มีใครเปิดหน้า
// ภาพรวม โดยไม่เคย cache เลย — เป็นข้อมูลระดับพอร์ตที่ทุกคนเห็นเหมือนกัน (ไม่ผูกกับ
// สิทธิ์ต่อโครงการ เพราะ requirePortfolioAccess บังคับว่าต้องเห็นได้ทุกโครงการอยู่แล้ว)
// จึงแคชร่วมกันได้ทั้งระบบด้วย CacheService แบบ TTL สั้นๆ (2 นาที) — ข้อมูลการเงิน/
// การผลิตระดับพอร์ตไม่จำเป็นต้อง real-time ขนาดนั้น แลกกับความเร็วที่เร็วขึ้นมากสำหรับ
// ผู้ใช้เกือบทั้งหมดที่ไม่ใช่คนแรกที่เปิดในรอบ 2 นาทีนั้น
function _cachedPortfolio_(key, ttlSeconds, computeFn) {
  var cache = CacheService.getScriptCache();
  var hit = cache.get(key);
  if (hit) {
    try { return JSON.parse(hit); } catch (e) { /* cache เสีย ไปคำนวณสดแทน */ }
  }
  var result = computeFn();
  try {
    var json = JSON.stringify(result);
    if (json.length < 95000) cache.put(key, json, ttlSeconds); // เผื่อ margin จากลิมิต 100KB/key ของ CacheService
  } catch (e) { /* ข้อมูลใหญ่เกินไปหรือ serialize ไม่ได้ ก็แค่ไม่ cache รอบนี้ ไม่ต้อง fail คำขอ */ }
  return result;
}
function _invalidatePortfolioCache_() {
  CacheService.getScriptCache().removeAll(['solarHomepageData', 'solarPortfolioProduction']);
}
 
// Projects header
const HEADER_ROW = { 
  'Projects'    : 2,
  'Sheet_Budget': 1,  // ← Added
  'Sheet_Meters': 1,  // ← Added
};
 
// PortalGuard.gs ต้องถูกวางไว้ในโปรเจกต์เดียวกับไฟล์นี้
// PORTAL_ENFORCE = false คือโหมด shadow (ไม่บล็อกใครจริง แค่บันทึก log) เปลี่ยนเป็น
// true เมื่อยืนยันแล้วว่า role ของผู้ใช้จริงทุกคนแมปถูกต้องใน Hub
var PORTAL_MENU_ID = 'sec-solar-dash';
var PORTAL_ENFORCE = false;

// ── Entry point ───────────────────────────────────────────────
function doGet(e) {
  var g = portalGuard(e, PORTAL_MENU_ID);
  if (g.deny) return g.deny;

  var bootstrap = JSON.stringify({
    token: (e && e.parameter && e.parameter.portalToken) || '',
    email: g.access.email, name: g.access.name, role: g.access.role,
    isAdmin: isAdminish(g.access), canWrite: canWrite(g.access)
  });

  return HtmlService
    .createHtmlOutputFromFile('index')
    .append('<script>window.PORTAL = ' + bootstrap + ';</script>')
    .setTitle('AMR ASIA — Solar Dashboard')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
 
/// ============================================================
// 1. CONFIG: ดึงตั้งค่าแบบ Dynamic จากชีต System_Config
// ============================================================
let _sysConfigCache = null; // เก็บ Cache ไว้จะได้ไม่ต้องโหลดชีตซ้ำๆ ในการรันรอบเดียวกัน
 
function getSysConfig() {
  if (_sysConfigCache) return _sysConfigCache;
  
  // ค่า Default เผื่อผู้ใช้ยังไม่ได้สร้างชีต หรือลบค่าทิ้ง
  const config = {
    degrad: 0.0045,
    schools: ['NB230004.1', 'NB230004.2', 'NB230003.1', 'NB230003.2', 'NB230002'],
    schoolMult: {1:1, 2:1, 3:0.8, 4:0.8, 5:1, 6:1.2, 7:1.2, 8:1.2, 9:1, 10:0.8, 11:1, 12:1}
  };
 
  try {
    const ss = _ss_();
    const sh = ss.getSheetByName(SH.CONFIG);
    if (sh) {
      const data = sh.getRange(1, 1, sh.getLastRow(), 2).getValues();
      data.forEach(row => {
        const key = String(row[0]).trim();
        const val = row[1];
        if (!key) return;
        
        if (key === 'Default_Degradation') config.degrad = Number(val);
        if (key === 'School_Projects') config.schools = String(val).split(',').map(s => s.trim());
        if (key.startsWith('Mult_School_')) {
          const m = parseInt(key.replace('Mult_School_', ''));
          if (m >= 1 && m <= 12) config.schoolMult[m] = Number(val);
        }
      });
    }
  } catch (e) {
    Logger.log('Error loading config, using defaults: ' + e);
  }
  
  _sysConfigCache = config;
  return _sysConfigCache;
}
 
// ════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════
 
function safe(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Bangkok', 'yyyy-MM');
  if (typeof v === 'number') return (isNaN(v) || !isFinite(v)) ? null : v;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim();
  return s === '' ? null : s;
}
 
function _getSheet(name) {
  const ss = _ss_();
  const sh = ss.getSheetByName(name);
  if (!sh) Logger.log('Sheet not found: ' + name);
  return sh || null;
}
 
function _sheetToObjects(sheetName) {
  const sh = _getSheet(sheetName);
  if (!sh) return [];
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return [];
 
  let hRow = HEADER_ROW[sheetName] || 1;
  const maxHeaderRow = Math.min(5, lastRow);
  const headerCandidates = sh.getRange(1, 1, maxHeaderRow, lastCol).getValues();
 
  const normalizeHeader = row => row.map(h => String(h || '').trim());
  const rowLooksLikeHeader = row => row.filter(cell => cell !== '').length >= 2;
  const rowHasRefCode = row => row.some(cell => /^RefCode$/i.test(cell));
  const rowHasProjectGroup = row => row.some(cell => /^ProjectGroup$/i.test(cell));
 
  let headers = normalizeHeader(headerCandidates[hRow - 1] || []);
  if (!rowLooksLikeHeader(headers) || (sheetName === SH.PROJECTS && !rowHasRefCode(headers))) {
    for (let i = 0; i < headerCandidates.length; i++) {
      const row = normalizeHeader(headerCandidates[i]);
      if (!rowLooksLikeHeader(row)) continue;
      if (sheetName === SH.PROJECTS) {
        if (rowHasRefCode(row)) { hRow = i + 1; headers = row; break; }
      } else {
        if (rowHasRefCode(row) || rowHasProjectGroup(row) || row.some(cell => /^YearMonth$/i.test(cell))) {
          hRow = i + 1; headers = row; break;
        }
      }
    }
  }
 
  const dRow = hRow + 1;
  if (lastRow < dRow) return [];
  const dataRows = sh.getRange(dRow, 1, lastRow - hRow, lastCol).getValues();
  const results  = [];
  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    if (!row[0] && row[0] !== 0) continue;
    const obj = {};
    for (let j = 0; j < headers.length; j++) obj[headers[j]] = safe(row[j]);
    results.push(obj);
  }
  return results;
}
 
function _normalizeKey(str) {
  return String(str || '').toLowerCase().replace(/[^a-z0-9\u0E00-\u0E7F]+/g, '');
}
 
function _val(obj) {
  if (obj === null || obj === undefined) return null;
  for (let i = 1; i < arguments.length; i++) {
    const k = arguments[i];
    if (k in obj) return obj[k];
    const kl = _normalizeKey(k);
    for (const ok in obj) {
      if (_normalizeKey(ok) === kl) return obj[ok];
    }
  }
  return null;
}
 
function getMultiplier(refCode, monthNo) {
  const conf = getSysConfig();
  if (conf.schools.includes(refCode)) {
    return conf.schoolMult[monthNo] || 1.0;
  }
  return 1.0; // โครงการปกติใช้ 1.0 ตลอดปี
}
 
function getDegradationFactor(degradRate, contractYear) {
  const conf = getSysConfig();
  let rate = Number(degradRate);
  // ถ้าไม่มีค่าเสื่อมใน Projects ให้ใช้ค่า Default จาก System_Config
  if (isNaN(rate) || rate === 0) rate = conf.degrad; 
  if (contractYear <= 1) return 1.0;
  return Math.pow(1 - rate, contractYear - 1);
}
 
// ============================================================
// ฟังก์ชันหลักสำหรับคำนวณ kWh_Plan (เป้าหมาย)
// ============================================================
function calcKwhPlan(refCode, kwh_yr1, pr1, deg, currentYear, monthNo) {
  const mult = getMultiplier(refCode, monthNo);
  const degradFactor = getDegradationFactor(deg, currentYear);
  
  const monthlyBase = kwh_yr1 / 12;
  return monthlyBase * mult * degradFactor;
}
 
// ============================================================
// ════════════════════════════════════════════════════════════
// READ FUNCTIONS
// ════════════════════════════════════════════════════════════
 
function getProjects() {
  const rows = _sheetToObjects(SH.PROJECTS);
  return rows.map(r => {
    let startYM = safe(_val(r, 'StartYM', 'StartYearMonth'));
    if (startYM && startYM.length > 7) startYM = startYM.slice(0, 7);
    return {
      refCode     : _val(r, 'AssetCode'),   // ← เดิม 'RefCode' — นี่คือ join key ที่ frontend ใช้ทั้งหมด
      budgetCode  : _val(r, 'RefCode'),     // ← ใหม่ — รหัสงบ ERP เก็บไว้เผื่อโชว์/ทำรายงานภายหลัง
      contractNo  : _val(r, 'ContractNo.', 'ContractNo'),
      group       : _val(r, 'ProjectGroup'),
      contractName: _val(r, 'ContractName'),
      kwp         : _val(r, 'kWp'),
      contractYr  : _val(r, 'ContractYr (Yr)', 'ContractYr(Yr)', 'ContractYr'),
      investment  : _val(r, 'Investment (THB)', 'Investment'),
      irr         : _val(r, 'IRR (%)', 'IRR'),
      payback     : _val(r, 'Payback (Yr)', 'Payback'),
      startYM     : startYM,
    };
  }).filter(p => p.refCode && p.refCode !== 'AssetCode');
}
 
function getYears(refCode) {
  const rows = _sheetToObjects(SH.FEAS_PLAN);
  const seen = {};
  rows.forEach(r => {
    // FeasPlan's own column is still literally named "RefCode" (join-key sheets are unchanged),
    // it just *holds* AssetCode values (e.g. NB230004.1) — same as refCode passed in from the frontend.
    if (_val(r, 'RefCode') === refCode) {
      const y = Number(_val(r, 'Year (Y)', 'Year'));
      if (y > 0) seen[y] = true;
    }
  });
  return Object.keys(seen).map(Number).sort((a, b) => a - b);
}
 
// Calculate contract year from YearMonth and startYM
function calcYrFromYM(ym, startYM) {
  if (!ym || !startYM || ym.length !== 7 || startYM.length !== 7) return null;
  const sy = parseInt(startYM.slice(0,4));
  const sm = parseInt(startYM.slice(5,7));
  const ey = parseInt(ym.slice(0,4));
  const em = parseInt(ym.slice(5,7));
  const months = (ey - sy) * 12 + (em - sm) + 1;
  return Math.ceil(months / 12);
}
 
function normalizeYM(v) {
  if (!v) return null;
  const s = String(v).trim();
  // Accepts "2025-01", "2025-01-02", converted Date object
  if (s.length >= 7) return s.slice(0, 7);
  return null;
}
 
function getPanel1(params) {
  // ระบบ Fallback สำหรับการกดทดสอบรันใน Apps Script Editor
  let refCode = params && params.refCode ? params.refCode : null;
  if (!refCode) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const tempSh = ss.getSheetByName("Projects");
    if (tempSh && tempSh.getLastRow() >= 2) {
      refCode = tempSh.getRange(2, 1).getValue().toString().trim();
      Logger.log("⚠️ แจ้งเตือน: ไม่พบการส่งค่า refCode (เป็นปกติเมื่อรันใน Editor) ระบบจะใช้โปรเจกต์ตัวอย่างเพื่อทดสอบ: " + refCode);
    } else {
      return {};
    }
  }
 
  // 🌟 [เพิ่มใหม่] จัดการกรณีเลือก "รวมทุกโครงการ" (Portfolio View)
  if (refCode === 'all') {
    const hp = getHomepageData();
    const p = hp.portfolio || {};
    const totalCumPlan = (hp.cards || []).reduce((sum, c) => sum + (c.cumPlanToDate || 0), 0);
    return {
      refCode: 'all',
      group: 'Portfolio',
      contractName: 'รวมทุกโครงการ',
      startYM: null,
      contractYr: 20,
      investment: p.totalInvestment || 0,
      payback: null,
      irr: null,
      kwp: p.totalKwp || 0,
      totalActualRevenue: p.totalActual || 0,
      cumPlanToDate: totalCumPlan,
      variancePct: totalCumPlan > 0 ? (p.totalActual - totalCumPlan) / totalCumPlan : 0,
      monthsWithActual: 1
    };
  }
 
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const res = { refCode: refCode };
 
  // 1. ดึงข้อมูลพื้นฐานจากชีต Projects
  const pjSh = ss.getSheetByName("Projects");
  if (pjSh) {
    const pjData = pjSh.getDataRange().getValues();
    const pjHdr = pjData[0].map(h => String(h).trim());
    // refCode here is the AssetCode / join key (e.g. NB230004.1), NOT the budget RefCode (e.g. NB230004)
    const refI = pjHdr.indexOf("AssetCode");
    
    for (let i = 1; i < pjData.length; i++) {
      if (String(pjData[i][refI]).trim() === refCode) {
        res.group = String(pjData[i][pjHdr.indexOf("ProjectGroup")] || "");
        res.contractName = String(pjData[i][pjHdr.indexOf("ContractName")] || "");
        res.startYM = cleanYM(pjData[i][pjHdr.indexOf("StartYM")]);
        res.contractYr = Number(pjData[i][pjHdr.indexOf("ContractYr (Yr)")] || 0);
        res.investment = Number(String(pjData[i][pjHdr.indexOf("Investment (THB)")] || "0").replace(/,/g, "")) || 0;
        res.payback = Number(pjData[i][pjHdr.indexOf("Payback (Yr)")] || 0);
        
        let irrRaw = pjData[i][pjHdr.indexOf("IRR (%)")];
        if (String(irrRaw).includes("%")) {
          res.irr = parseFloat(String(irrRaw).replace(/%/g, "")) / 100;
        } else {
          res.irr = Number(irrRaw) || 0;
        }
        
        res.kwp = Number(pjData[i][pjHdr.indexOf("kWp")] || 0);
        res.annualProduction = Number(String(pjData[i][pjHdr.indexOf("kWh_Y1")] || "0").replace(/,/g, "")) || 0;
        break;
      }
    }
  }
 
  // 2. ดึงข้อมูลต้นทุนตามงบประมาณจากชีต Sheet_Budget
  const bgSh = ss.getSheetByName("Sheet_Budget");
  if (bgSh && res.group) {
    const bgData = bgSh.getDataRange().getValues();
    const bgHdr = bgData[0].map(h => String(h).trim());
    const grpI = bgHdr.indexOf("ProjectGroup");
    const totI = bgHdr.findIndex(h => h.startsWith("Budget_THB"));
    const usdI = bgHdr.findIndex(h => h.startsWith("BudgetUsed_THB"));
    
    for (let i = 1; i < bgData.length; i++) {
      if (String(bgData[i][grpI]).trim() === res.group) {
        res.budgetTotal = Number(String(bgData[i][totI] || "0").replace(/,/g, "")) || 0;
        res.budgetUsed = Number(String(bgData[i][usdI] || "0").replace(/,/g, "")) || 0;
        res.budgetBalance = res.budgetTotal - res.budgetUsed;
        break;
      }
    }
  }
 
  // 3. ดึงอัตราค่าไฟและส่วนลดจากชีต Sheet_Meters
  const mtSh = ss.getSheetByName("Sheet_Meters");
  if (mtSh) {
    const mtData = mtSh.getDataRange().getValues();
    const mtHdr = mtData[0].map(h => String(h).trim());
    const refI = mtHdr.indexOf("RefCode");
    
    for (let i = 1; i < mtData.length; i++) {
      if (String(mtData[i][refI]).trim() === refCode) {
        res.rateEnergyOnPeak = mtData[i][mtHdr.indexOf("Rate_Energy_OnPeak")] || "";
        res.rateEnergyOffPeak = mtData[i][mtHdr.indexOf("Rate_Energy_OffPeak")] || "";
        res.rateEnergy = mtData[i][mtHdr.indexOf("Rate_Energy")] || "";
        res.rateDemandOnPeak = mtData[i][mtHdr.indexOf("Rate_Demand_OnPeak")] || "";
        res.rateDemandOffPeak = mtData[i][mtHdr.indexOf("Rate_Demand_OffPeak")] || "";
        res.rateDemand = mtData[i][mtHdr.indexOf("Rate_Demand")] || "";
        res.rateFT = mtData[i][mtHdr.indexOf("Rate_FT")] || "";
        res.discountElectric = mtData[i][mtHdr.indexOf("Discount_Electric(%)")] || "";
        res.rateService = mtData[i][mtHdr.indexOf("Rate_Service")] || "";
        break; 
      }
    }
  }
 
  // 4. ดึงข้อมูลรายได้จริงสะสมและเดือนล่าสุดที่มีข้อมูลจากชีต FeasActual_Proj
  const prSh = ss.getSheetByName("FeasActual_Proj");
  let lastActualYM = "";
  if (prSh) {
    const prData = prSh.getDataRange().getValues();
    const prHdr = prData[0].map(h => String(h).trim());
    const refI = prHdr.indexOf("RefCode");
    const ymI = prHdr.indexOf("YearMonth");
    const actI = prHdr.indexOf("ActualRevenue");
    
    res.totalActualRevenue = 0;
    res.monthsWithActual = 0;
    
    for (let i = 1; i < prData.length; i++) {
      if (String(prData[i][refI]).trim() === refCode) {
        let actV = prData[i][actI];
        if (actV !== "" && actV !== null && !isNaN(Number(String(actV).replace(/,/g, "")))) {
          res.totalActualRevenue += Number(String(actV).replace(/,/g, ""));
          res.monthsWithActual++;
          lastActualYM = cleanYM(prData[i][ymI]);
        }
      }
    }
  }
 
  // 5. ดึงข้อมูลจุดคุ้มทุนและแผนรายได้สะสมจากชีต Breakeven_Calc
  const bkSh = ss.getSheetByName("Breakeven_Calc");
  if (bkSh) {
    const bkData = bkSh.getDataRange().getValues();
    const bkHdr = bkData[0].map(h => String(h).trim());
    const refI = bkHdr.indexOf("RefCode");
    const ymI = bkHdr.indexOf("YearMonth");
    const yrI = bkHdr.indexOf("Year (Y)");
    const feasI = bkHdr.findIndex(h => h.startsWith("FeasPlan"));
    const bePlanI = bkHdr.findIndex(h => h.startsWith("BE Plan"));
    const beActI = bkHdr.findIndex(h => h.startsWith("BE Actual"));
    
    res.totalPlanRevenue = 0;
    res.cumPlanToDate = 0;
    
    for (let i = 1; i < bkData.length; i++) {
      if (String(bkData[i][refI]).trim() === refCode) {
        const ym = cleanYM(bkData[i][ymI]);
        const yr = Number(bkData[i][yrI]) || 0;
        const feas = Number(String(bkData[i][feasI] || "0").replace(/,/g, "")) || 0;
        
        res.totalPlanRevenue += feas;
        
        if (ym && lastActualYM && ym <= lastActualYM) {
          res.cumPlanToDate += feas;
        }
        
        // ตรวจจับจุดคุ้มทุนแผน (BE Plan)
        if (bePlanI >= 0 && String(bkData[i][bePlanI]).trim() === "BREAKEVEN") {
          res.breakevenPlanYM = ym;
          res.breakevenPlanYr = yr;
        }
        
        // ตรวจจับจุดคุ้มทุนจริง / จุดคุ้มทุนประมาณการ (BE Actual)
        if (beActI >= 0 && String(bkData[i][beActI]).trim() === "BREAKEVEN") {
          if (ym && lastActualYM && ym <= lastActualYM) {
            res.breakevenActualYM = ym;
            res.breakevenActualYr = yr;
          } else {
            res.projectedBEYM = ym;
            res.projectedBEYr = yr;
          }
        }
      }
    }
    
    if (res.cumPlanToDate > 0) {
      res.variancePct = (res.totalActualRevenue - res.cumPlanToDate) / res.cumPlanToDate;
    } else {
      res.variancePct = 0;
    }
  }
 
  Logger.log("getPanel1 ดึงข้อมูลสำเร็จสำหรับโปรเจกต์: " + refCode);
  return res;
}
 
function getPanel2(refCode, year) {
  const isAll = (refCode === 'all');
 
  const fpRows = _sheetToObjects(SH.FEAS_PLAN).filter(r => isAll || _val(r,'RefCode') === refCode);
  const actRows = _sheetToObjects(SH.ACTUAL).filter(r => isAll || _val(r,'RefCode') === refCode);
  const projRows = _sheetToObjects(SH.PROJ).filter(r => isAll || _val(r,'RefCode') === refCode);
  const bkRows = _sheetToObjects(SH.BREAKEVEN).filter(r => isAll || _val(r,'RefCode') === refCode);
 
  const planMap = {};
  const actualMap = {};
  const projMap = {};
  const actualCalcMap = {};
  const byProjectMap = {}; // ym -> { refCode: {plan, actual, proj} } — powers the bar-click drilldown table
 
  function bpEntry(ym, ref) {
    if (!byProjectMap[ym]) byProjectMap[ym] = {};
    if (!byProjectMap[ym][ref]) byProjectMap[ym][ref] = { plan: 0, actual: null, proj: 0 };
    return byProjectMap[ym][ref];
  }
 
  fpRows.forEach(r => {
    const ym = safe(_val(r,'YearMonth'));
    const ref = _val(r,'RefCode');
    const v = Number(_val(r,'FeasPlan (THB)','FeasPlan')) || 0;
    if (ym) planMap[ym] = (planMap[ym] || 0) + v;
    if (ym && ref) bpEntry(ym, ref).plan += v;
  });
 
  actRows.forEach(r => {
    const ym = safe(_val(r,'YearMonth'));
    const ref = _val(r,'RefCode');
    const v = Number(_val(r,'ActualRevenue (THB)','ActualRevenue'));
    if (ym && !isNaN(v) && v > 0) {
      actualMap[ym] = (actualMap[ym] || 0) + v;
      if (ref) { const e = bpEntry(ym, ref); e.actual = (e.actual || 0) + v; }
    }
  });
 
  projRows.forEach(r => {
    const ym = safe(_val(r,'YearMonth'));
    const ref = _val(r,'RefCode');
    const v = Number(_val(r,'ActualProjected (THB)','ActualProjected'));
    if (ym && !isNaN(v)) {
      projMap[ym] = (projMap[ym] || 0) + v;
      if (ref) bpEntry(ym, ref).proj += v;
    }
  });
 
  // ── Cumulative Actual: track each project's own cumulative series first (raw, keyed
  // by ym) — combined into a portfolio sum further down using carry-forward, so a
  // project whose contract has already ended keeps contributing its final accumulated
  // total instead of dropping out of the sum (it doesn't grow anymore, but the money
  // already collected doesn't disappear from the running portfolio total either).
  const projCumRaw = {}; // ref -> { ym: cumActualCalc }
  bkRows.forEach(r => {
    const ym = safe(_val(r,'YearMonth'));
    const ref = _val(r,'RefCode');
    const actCalcVal = Number(_val(r,'ActualCalc'));
    const cumActCalcVal = Number(_val(r,'CumActualCalc'));
    if (ym) {
      if (!isNaN(actCalcVal)) actualCalcMap[ym] = (actualCalcMap[ym] || 0) + actCalcVal;
      if (ref && !isNaN(cumActCalcVal)) {
        if (!projCumRaw[ref]) projCumRaw[ref] = {};
        projCumRaw[ref][ym] = cumActCalcVal;
      }
    }
  });
 
  const byProject = {};
  Object.keys(byProjectMap).forEach(ym => {
    byProject[ym] = Object.keys(byProjectMap[ym]).map(ref => Object.assign({ refCode: ref }, byProjectMap[ym][ref]));
  });
 
  const ymSet = new Set([
    ...Object.keys(planMap),
    ...Object.keys(actualMap),
    ...Object.keys(projMap),
    ...Object.keys(actualCalcMap)
  ]);
  Object.keys(projCumRaw).forEach(ref => Object.keys(projCumRaw[ref]).forEach(ym => ymSet.add(ym)));
 
  const yms = [...ymSet].sort();
 
  // Carry each project's cumulative total forward across the full combined timeline,
  // then sum across projects per month.
  const cumActualCalcMap = {};
  Object.keys(projCumRaw).forEach(ref => {
    let last = 0;
    yms.forEach(ym => {
      if (projCumRaw[ref][ym] !== undefined) last = projCumRaw[ref][ym];
      cumActualCalcMap[ym] = (cumActualCalcMap[ym] || 0) + last;
    });
  });
 
  let cumPlan = 0;
  const rows = [];
  const annualMap = {};
 
  yms.forEach(ym => {
    const plan   = planMap[ym] || 0;
    const actual = ym in actualMap ? actualMap[ym] : null;
    const proj   = projMap[ym] || 0;
    const actualCalc = actualCalcMap[ym] || 0;
    const cumActualCalc = cumActualCalcMap[ym] || 0;
 
    cumPlan += plan;
    const [yrStr, month] = String(ym).split('-');
    const yr = Number(yrStr);
 
    rows.push({
      ym, month, yr, plan, actual, proj, cumPlan, actualCalc, cumActualCalc, cumActual: cumActualCalc
    });
 
    annualMap[yr] = {
      yr, cumPlan, cumActualCalc, cumActual: cumActualCalc
    };
  });
 
  const annualRows = Object.values(annualMap).sort((a, b) => a.yr - b.yr);
 
  return JSON.parse(JSON.stringify({
    refCode, year: Number(year), rows, annualRows, byProject
  }));
}
 
function getPanel3(refCode) {
  const projRows = _sheetToObjects(SH.PROJECTS);
  const bkRows   = _sheetToObjects(SH.BREAKEVEN).filter(r => _val(r,'RefCode')===refCode);
  const projMeta = projRows.find(r => _val(r,'AssetCode')===refCode) || {};
  const investment = Number(_val(projMeta,'Investment (THB)','Investment'))||0;
 
  const rows = bkRows.map(r => ({
    ym: safe(_val(r,'YearMonth')), year: Number(_val(r,'Year (Y)','Year'))||0,
    investment, cumPlan: Number(_val(r,'CumPlan (THB)','CumPlan'))||0,
    cumActual: Number(_val(r,'CumActual (THB)','CumActual'))||0,
    bePlan:   (['BREAKEVEN','BE_PLAN'].indexOf(String(_val(r,'BE Plan?','BE Plan')||'').trim().toUpperCase()) >= 0),
    beActual: (['BREAKEVEN','BE_ACTUAL'].indexOf(String(_val(r,'BE Actual?','BE Actual')||'').trim().toUpperCase()) >= 0),
  }));
  const bePlanRow=rows.find(r=>r.bePlan), beActRow=rows.find(r=>r.beActual);
  return JSON.parse(JSON.stringify({
    refCode, investment, rows,
    breakevenPlanYM: bePlanRow?String(bePlanRow.ym):null,
    breakevenActYM : beActRow ?String(beActRow.ym) :null,
  }));
}
 
// ── getActualRows: Fetch monthly Actual for input form ────────
function getActualRows(refCode) {
  const sh = _getSheet(SH.ACTUAL);
  if (!sh) return { rows: [], sheetName: SH.ACTUAL };
 
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2) return { rows: [], sheetName: SH.ACTUAL };
 
  // --- ส่วนที่ 1: ดึงข้อมูลแผนจากชีต FeasPlan มาเตรียมไว้ (Map ด้วย YearMonth) ---
  const planMap = {};
  const shPlan = _getSheet(SH.FEAS_PLAN);
  
  if (shPlan) {
    const planLastRow = shPlan.getLastRow();
    const planLastCol = shPlan.getLastColumn();
    
    if (planLastRow >= 2) {
      const scanPlanData = shPlan.getRange(1, 1, Math.min(5, planLastRow), planLastCol).getValues();
      let planHeaderRow = 1;
      for (let i = 0; i < scanPlanData.length; i++) {
        if (scanPlanData[i].map(h => String(h).trim()).indexOf('RefCode') >= 0) {
          planHeaderRow = i + 1;
          break;
        }
      }
      
      const planHeaders = shPlan.getRange(planHeaderRow, 1, 1, planLastCol).getValues()[0].map(h => String(h).trim());
      const planData = shPlan.getRange(planHeaderRow + 1, 1, planLastRow - planHeaderRow, planLastCol).getValues();
 
      const pRefIdx = planHeaders.indexOf('RefCode');
      const pYmIdx = planHeaders.indexOf('YearMonth');
      const pPlanIdx = planHeaders.indexOf('FeasPlan (THB)');
 
      if (pRefIdx !== -1 && pYmIdx !== -1 && pPlanIdx !== -1) {
        for (let i = 0; i < planData.length; i++) {
          if (String(planData[i][pRefIdx] || '').trim() === refCode) {
            const ymKey = cleanYM(planData[i][pYmIdx]);
            planMap[ymKey] = safe(planData[i][pPlanIdx]);
          }
        }
      }
    }
  }
  // -----------------------------------------------------------------
 
  // --- ส่วนที่ 2: ค้นหา Header และดึงข้อมูล Actual ---
  const scanData = sh.getRange(1, 1, Math.min(5, lastRow), lastCol).getValues();
  let headerRow = 1;
  for (let i = 0; i < scanData.length; i++) {
    if (scanData[i].map(h => String(h).trim()).indexOf('RefCode') >= 0) {
      headerRow = i + 1;
      break;
    }
  }
 
  const headers  = sh.getRange(headerRow, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
  const dataRows = sh.getRange(headerRow + 1, 1, lastRow - headerRow, lastCol).getValues();
 
  const refIdx  = headers.indexOf('RefCode');
  const ymIdx   = headers.indexOf('YearMonth');
  const yrIdx   = headers.findIndex(h => h.startsWith('Year'));
  const moIdx   = headers.indexOf('Month');
  const actIdx  = headers.findIndex(h => h.toLowerCase().startsWith('actualrevenue'));
 
  if (refIdx === -1) return { rows: [], error: 'RefCode column not found' };
 
  const rows = [];
  for (let i = 0; i < dataRows.length; i++) {
    if (String(dataRows[i][refIdx] || '').trim() !== refCode) continue;
    
    const ymVal = cleanYM(dataRows[i][ymIdx]);
    
    rows.push({
      rowNum  : i + headerRow + 1,
      ym      : ymVal,
      year    : safe(dataRows[i][yrIdx]),
      month   : safe(dataRows[i][moIdx]),
      actual  : safe(dataRows[i][actIdx]),
      actCol  : actIdx + 1,
      plan    : planMap[ymVal] !== undefined ? planMap[ymVal] : null // จับคู่ข้อมูล Plan
    });
  }
  
  return JSON.parse(JSON.stringify({ rows, actCol: actIdx + 1 }));
}
 
// ════════════════════════════════════════════════════════════
// WRITE: saveActual — Save Actual amount to sheet
// ════════════════════════════════════════════════════════════
function saveActual(access, allowedAssets, updates) {
  // updates = [ { rowNum: N, value: V }, ... ]
  if (!canWrite(access)) return { ok: false, error: 'สิทธิ์ไม่พอ' };
  try {
    const sh = _getSheet(SH.ACTUAL);
    if (!sh) return { ok: false, error: 'Sheet Actual not found' };

    // 🔍 ค้นหา Header แบบอัตโนมัติ เพื่อหาคอลัมน์ ActualRevenue ที่ถูกต้อง
    const lastRow = sh.getLastRow();
    const scanData = sh.getRange(1, 1, Math.min(5, lastRow), sh.getLastColumn()).getValues();
    let headerRow = 1;
    for (let i = 0; i < scanData.length; i++) {
      if (scanData[i].map(h => String(h).trim()).indexOf('RefCode') >= 0) {
        headerRow = i + 1;
        break;
      }
    }

    const headers = sh.getRange(headerRow, 1, 1, sh.getLastColumn()).getValues()[0].map(h => String(h).trim());
    const actCol  = headers.findIndex(h => h.toLowerCase().startsWith('actualrevenue')) + 1;
    const refCol  = headers.indexOf('RefCode') + 1; // คอลัมน์นี้เก็บค่า AssetCode จริง (namespace เดียวกับ allowedAssets)

    if (actCol === 0) return { ok: false, error: 'Column ActualRevenue not found' };

    // เช็คสิทธิ์โครงการของทุกแถวก่อนเขียนจริง — ปฏิเสธทั้ง batch ถ้ามีแถวไหนอยู่นอกสิทธิ์
    if (access.projectScope !== 'all') {
      if (refCol === 0) return { ok: false, error: 'ไม่พบคอลัมน์ RefCode สำหรับตรวจสิทธิ์โครงการ' };
      for (const u of updates) {
        const ref = String(sh.getRange(u.rowNum, refCol).getValue() || '').trim();
        if ((allowedAssets || []).indexOf(ref) === -1) {
          return { ok: false, error: 'ไม่มีสิทธิ์แก้ไขโครงการนี้ (แถว ' + u.rowNum + ')' };
        }
      }
    }

    updates.forEach(u => {
      const v = u.value === '' || u.value === null ? '' : Number(u.value);
      sh.getRange(u.rowNum, actCol).setValue(v);
    });

    SpreadsheetApp.flush();
    // After saving → automatically recalculate FeasActual_Proj
    recalcFeasActualProj();
    return { ok: true, saved: updates.length };
 
  } catch(e) {
    Logger.log('saveActual error: ' + e.toString());
    return { ok: false, error: e.toString() };
  }
}
 
// ════════════════════════════════════════════════════════════
// 1. RECALC: FeasActual_Proj (ลอจิก Month-on-Month Base & รองรับหัวคอลัมน์ยืดหยุ่น)
// ════════════════════════════════════════════════════════════
function recalcFeasActualProj() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const projSh = ss.getSheetByName("FeasActual_Proj");
  const actSh = ss.getSheetByName("Actual");
  const pSh = ss.getSheetByName("Projects");
  const bkSh = ss.getSheetByName("Breakeven_Calc");
 
  if (!projSh || !actSh || !pSh || !bkSh) return;
 
  // 1. โหลด Degradation ของแต่ละโปรเจกต์
  const pRows = pSh.getRange(2, 1, pSh.getLastRow() - 1, pSh.getLastColumn()).getValues();
  const pScan = pSh.getRange(1, 1, 1, pSh.getLastColumn()).getValues()[0].map(h => String(h).trim());
  const pRefI = pScan.findIndex(h => h.includes('AssetCode'));
  const pDegI = pScan.findIndex(h => h.includes('Degradation'));
  const projDegMap = {};
  for (let i = 0; i < pRows.length; i++) {
    const ref = String(pRows[i][pRefI] || '').trim();
    const degStr = String(pRows[i][pDegI] || '').replace(/%/g, '');
    projDegMap[ref] = (Number(degStr) / 100) || 0.0045;
  }
 
  // 2. โหลด FeasPlan ปี 1 ไว้เป็นข้อมูลสำรอง
  const bkData = bkSh.getDataRange().getValues();
  let bkHdrRow = 1;
  for (let i = 0; i < Math.min(5, bkData.length); i++) {
    if (bkData[i].map(h => String(h).trim()).indexOf('RefCode') >= 0) { bkHdrRow = i + 1; break; }
  }
  const bkHdr = bkData[bkHdrRow - 1].map(h => String(h).trim());
  const bkRefI = bkHdr.findIndex(h => h.includes('RefCode'));
  const bkYmI = bkHdr.findIndex(h => h.includes('YearMonth'));
  const bkYrI = bkHdr.findIndex(h => h.includes('Year (Y)'));
  const bkFeasI = bkHdr.findIndex(h => h.includes('FeasPlan'));
  
  const y1FeasMap = {}; 
  for (let i = bkHdrRow; i < bkData.length; i++) {
    const ref = String(bkData[i][bkRefI]).trim();
    const yr = Number(bkData[i][bkYrI]);
    const ym = cleanYM(bkData[i][bkYmI]);
    if (yr === 1 && ym && bkFeasI >= 0) {
      const mNo = Number(ym.split('-')[1]);
      const feas = Number(String(bkData[i][bkFeasI]).replace(/,/g, '')) || 0;
      if (!y1FeasMap[ref]) y1FeasMap[ref] = {};
      y1FeasMap[ref][mNo] = feas;
    }
  }
 
  // 3. โหลด Actual และสร้างฐาน 12 เดือนของปีที่ 1
  const actData = actSh.getDataRange().getValues();
  let actHdrRow = 1;
  for (let i = 0; i < Math.min(5, actData.length); i++) {
    if (actData[i].map(h => String(h).trim()).indexOf('RefCode') >= 0) { actHdrRow = i + 1; break; }
  }
  const actHdr = actData[actHdrRow - 1].map(h => String(h).trim());
  const aRefI = actHdr.findIndex(h => h.includes('RefCode'));
  const aYmI = actHdr.findIndex(h => h.includes('YearMonth'));
  const aYrI = actHdr.findIndex(h => h.includes('Year (Y)'));
  const aActI = actHdr.findIndex(h => h.toLowerCase().includes('actualrevenue'));
 
  const actualMap = {}; 
  const y1Stats = {};   
 
  for (let i = actHdrRow; i < actData.length; i++) {
    const ref = String(actData[i][aRefI] || '').trim();
    const ym = cleanYM(actData[i][aYmI]);
    const yr = Number(actData[i][aYrI]) || 1;
    let v = actData[i][aActI];
 
    if (v !== '' && v !== null && v !== undefined) {
      const numV = Number(String(v).replace(/,/g, ''));
      if (ref && ym && !isNaN(numV) && numV > 0) {
        actualMap[ref + '|' + ym] = numV;
        if (!y1Stats[ref]) y1Stats[ref] = { sum: 0, count: 0, actuals: {} };
        if (yr === 1) {
          const mNo = Number(ym.split('-')[1]);
          y1Stats[ref].sum += numV;
          y1Stats[ref].count++;
          y1Stats[ref].actuals[mNo] = numV;
        }
      }
    }
  }
 
  // ประมวลผลฐานรายเดือนของปีที่ 1
  const baseYear1Map = {}; 
  for (const ref in projDegMap) {
    baseYear1Map[ref] = {};
    const st = y1Stats[ref] || { sum: 0, count: 0, actuals: {} };
    const fMap = y1FeasMap[ref] || {};
    const avg = st.count > 0 ? st.sum / st.count : 0;
 
    for (let m = 1; m <= 12; m++) {
      if (st.actuals[m] !== undefined) {
        baseYear1Map[ref][m] = st.actuals[m]; 
      } else if (st.count > 0) {
        baseYear1Map[ref][m] = avg; 
      } else {
        baseYear1Map[ref][m] = fMap[m] || 0; 
      }
    }
  }
 
  // 4. คำนวณและอัปเดตลงชีต FeasActual_Proj
  const projLR = projSh.getLastRow();
  const projLC = projSh.getLastColumn();
  const projData = projSh.getRange(1, 1, Math.min(5, projLR), projLC).getValues();
  let projHdrRow = 1;
  for (let i = 0; i < projData.length; i++) {
    if (projData[i].map(h => String(h).trim()).indexOf('RefCode') >= 0) { projHdrRow = i + 1; break; }
  }
  const pHeaders = projData[projHdrRow - 1].map(h => String(h).trim());
  const pRefIdx = pHeaders.findIndex(h => h.includes('RefCode'));
  const pYmIdx = pHeaders.findIndex(h => h.includes('YearMonth'));
  const pYrIdx = pHeaders.findIndex(h => h.includes('Year (Y)'));
  
  // ยืดหยุ่นการหาชื่อคอลัมน์
  const pActIdx = pHeaders.findIndex(h => h.includes('ActualRevenue') || h.includes('Actual (Real)'));
  const pLkIdx = pHeaders.findIndex(h => h.includes('LastKnown'));
  const pProjIdx = pHeaders.findIndex(h => h.includes('ActualProjected') || h.includes('Actual (Calc)'));
 
  const projRows = projSh.getRange(projHdrRow + 1, 1, projLR - projHdrRow, projLC).getValues();
  const colAct = [], colLk = [], colProj = [];
 
  for (let i = 0; i < projRows.length; i++) {
    const ref = String(projRows[i][pRefIdx] || '').trim();
    const ym = cleanYM(projRows[i][pYmIdx]);
    const yr = Number(projRows[i][pYrIdx]) || 1;
    let mNo = ym ? Number(ym.split('-')[1]) : 1;
 
    const actV = actualMap[ref + '|' + ym] !== undefined ? actualMap[ref + '|' + ym] : null;
    const baseM = baseYear1Map[ref] ? (baseYear1Map[ref][mNo] || 0) : 0;
    const deg = projDegMap[ref] || 0.0045;
 
    let projectedVal = 0;
    if (yr === 1) {
      projectedVal = actV !== null ? actV : Math.round(baseM);
    } else {
      projectedVal = Math.round(baseM * Math.pow(1 - deg, yr - 1));
    }
 
    colAct.push([actV !== null ? actV : '']);
    colLk.push([projectedVal > 0 ? projectedVal : '']);
    colProj.push([projectedVal > 0 ? projectedVal : '']);
  }
 
  // อัปเดตข้อมูล (มีการใส่ >= 0 เพื่อเช็คว่าหาคอลัมน์เจอถึงจะบันทึก)
  if (projRows.length > 0) {
    if (pActIdx >= 0) projSh.getRange(projHdrRow + 1, pActIdx + 1, projRows.length, 1).setValues(colAct);
    if (pLkIdx >= 0) projSh.getRange(projHdrRow + 1, pLkIdx + 1, projRows.length, 1).setValues(colLk);
    if (pProjIdx >= 0) projSh.getRange(projHdrRow + 1, pProjIdx + 1, projRows.length, 1).setValues(colProj);
    SpreadsheetApp.flush();
  }
  
  recalcBreakevenCalc_(baseYear1Map, projDegMap);
}
 
// ════════════════════════════════════════════════════════════
// 2. RECALC: Breakeven_Calc (ลอจิกรับค่าฐานรายเดือนจากตัวบน & ยืดหยุ่นคอลัมน์)
// ════════════════════════════════════════════════════════════
function recalcBreakevenCalc_(baseYear1Map, projDegMap) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const bkSh = ss.getSheetByName("Breakeven_Calc");
  const pSh = ss.getSheetByName("Projects");
  if (!bkSh || !pSh || !baseYear1Map || !projDegMap) return;
 
  const pRows = pSh.getRange(2, 1, pSh.getLastRow() - 1, pSh.getLastColumn()).getValues();
  const pScan = pSh.getRange(1, 1, 1, pSh.getLastColumn()).getValues()[0].map(h => String(h).trim());
  const pRefI = pScan.findIndex(h => h.includes('AssetCode'));
  const pInvI = pScan.findIndex(h => h.includes('Investment'));
  const invMap = {};
  for (let i = 0; i < pRows.length; i++) {
    const ref = String(pRows[i][pRefI] || '').trim();
    invMap[ref] = Number(String(pRows[i][pInvI] || '').replace(/,/g, '')) || 0;
  }
 
  const bkLR = bkSh.getLastRow();
  const bkLC = bkSh.getLastColumn();
  if (bkLR < 2) return; 
  
  const bkScanData = bkSh.getRange(1, 1, Math.min(5, bkLR), bkLC).getValues();
  let bkHdrRow = 1;
  for (let i = 0; i < Math.min(5, bkScanData.length); i++) {
    if (bkScanData[i].map(h => String(h).trim()).indexOf('RefCode') >= 0) { bkHdrRow = i + 1; break; }
  }
  
  const bkHdr = bkScanData[bkHdrRow - 1].map(h => String(h).trim());
  const bkRefI = bkHdr.indexOf('RefCode');
  const bkYMI = bkHdr.findIndex(h => h.includes('YearMonth'));
  const bkYrI = bkHdr.findIndex(h => h.includes('Year (Y)'));
  const bkFeasPI = bkHdr.findIndex(h => h.includes('FeasPlan'));
  const bkActPI  = bkHdr.findIndex(h => h.includes('Actual (Calc)') || h.includes('ActualCalc') || h.includes('ActualProj')); 
  const bkCumAI  = bkHdr.findIndex(h => h.includes('Cum Actual (Calc)') || h.includes('CumActualCalc') || h.includes('CumActual (THB)'));
  const bkBeAI   = bkHdr.findIndex(h => h.includes('BE Actual'));
  const bkCumPlI = bkHdr.findIndex(h => h.includes('Cum Plan') || h.includes('CumPlan'));
  const bkBePlanI = bkHdr.findIndex(h => h.includes('BE Plan'));
  const bkRealActI = bkHdr.findIndex(h => h.includes('ActualReal') || h.includes('Actual Real'));
 
  const bkData = bkSh.getRange(bkHdrRow + 1, 1, bkLR - bkHdrRow, bkLC).getValues();
  const colActP = [], colCumA = [], colBeA = [], colCumPlan = [], colBePlan = [];
  const cumByRef = {}, cumPlanByRef = {};
  const rollingLastCalc = {}; 
 
  // 🌟 พัฒนาเพิ่ม: เปลี่ยนมาเก็บเป็นระบุสายอักษรเดือน (YYYY-MM)
  const actualBEMonthMap = {};
  const planBEMonthMap = {};
  const lastYrMap = {};
  const lastYmMap = {};
 
  for (let i = 0; i < bkData.length; i++) {
    const ref = String(bkData[i][bkRefI] || '').trim();
    const ymStr = cleanYM(bkData[i][bkYMI]); 
    const yr = Number(bkData[i][bkYrI]) || 1;
    let mNo = ymStr ? Number(ymStr.split('-')[1]) : 1;
 
    const inv = invMap[ref] || 0;
    const feas = bkFeasPI >= 0 ? (Number(String(bkData[i][bkFeasPI] || '0').replace(/,/g, '')) || 0) : 0;
    const deg = projDegMap[ref] || 0.0045;
    
    if (!rollingLastCalc[ref]) rollingLastCalc[ref] = {};
    lastYrMap[ref] = yr;
    lastYmMap[ref] = ymStr;
 
    let finalMonthly = 0;
    let hasReal = false;
    
    if (bkRealActI >= 0) {
      const realActualRaw = bkData[i][bkRealActI];
      if (realActualRaw !== '' && realActualRaw != null) {
        finalMonthly = Number(realActualRaw) || 0;
        hasReal = true;
      }
    }
 
    if (!hasReal) {
      if (yr === 1) {
        finalMonthly = baseYear1Map[ref] ? (baseYear1Map[ref][mNo] || 0) : 0;
      } else {
        const prevYearVal = rollingLastCalc[ref][mNo] !== undefined ? rollingLastCalc[ref][mNo] : (baseYear1Map[ref] ? (baseYear1Map[ref][mNo] || 0) : 0);
        finalMonthly = Math.round(prevYearVal * (1 - deg));
      }
    }
 
    rollingLastCalc[ref][mNo] = finalMonthly;
 
    if (!(ref in cumByRef)) cumByRef[ref] = 0;
    cumByRef[ref] += finalMonthly; 
    const cum = cumByRef[ref];
    const prevCum = cum - finalMonthly;
    
    if (inv > 0 && cum >= inv && prevCum < inv) {
      actualBEMonthMap[ref] = ymStr; // แสตมป์เดือนที่คุ้มทุนจริงในอายุสัญญา
    }
 
    if (!(ref in cumPlanByRef)) cumPlanByRef[ref] = 0;
    cumPlanByRef[ref] += feas;
    const cumPlan = cumPlanByRef[ref];
    const prevCumPlan = cumPlan - feas;
    
    if (inv > 0 && cumPlan >= inv && prevCumPlan < inv) {
      planBEMonthMap[ref] = ymStr; // แสตมป์เดือนที่คุ้มทุนตามแผนในอายุสัญญา
    }
 
    colActP.push([finalMonthly !== 0 ? finalMonthly : '']);
    colCumA.push([Math.round(cum)]);
    colBeA.push([ (inv > 0 && cum >= inv && prevCum < inv) ? 'BREAKEVEN' : '']);
    colCumPlan.push([Math.round(cumPlan)]);
    colBePlan.push([ (inv > 0 && cumPlan >= inv && prevCumPlan < inv) ? 'BREAKEVEN' : '']);
  }
 
  // 🌟 [ระบบจำลองระดับรายเดือนล่วงหน้า] หากพ้นระยะเวลาแถวในตารางแล้วยังไม่คืนทุน
  for (const ref in invMap) {
    const inv = invMap[ref];
    if (inv > 0 && !actualBEMonthMap[ref]) {
      let simCum = cumByRef[ref] || 0;
      let lastYm = lastYmMap[ref] || "2045-12";
      let [currY, currM] = lastYm.split('-').map(Number);
      let deg = projDegMap[ref] || 0.0045;
      let foundSim = false;
      let currentContractYear = lastYrMap[ref] || 20;
 
      // เดินหน้าจำลองทีละเดือน สูงสุด 60 ปีในอนาคต (720 เดือน)
      for (let monthsSimulated = 1; monthsSimulated <= 720; monthsSimulated++) {
        currM++;
        if (currM > 12) {
          currM = 1;
          currY++;
          currentContractYear++;
        }
        
        const baseM = baseYear1Map[ref] ? (baseYear1Map[ref][currM] || 0) : 0;
        const simMonthly = Math.round(baseM * Math.pow(1 - deg, currentContractYear - 1));
        
        simCum += simMonthly;
        if (simCum >= inv) {
          let mmStr = String(currM).padStart(2, '0');
          actualBEMonthMap[ref] = `${currY}-${mmStr}`; // ได้เดือน ค.ศ. คุ้มทุนในอนาคตที่ถูกต้อง
          foundSim = true;
          break;
        }
      }
      if (!foundSim) actualBEMonthMap[ref] = "ไม่คุ้มทุนภายใน 60 ปี";
    }
  }
 
  if (bkData.length > 0) {
    if (bkActPI >= 0) bkSh.getRange(bkHdrRow + 1, bkActPI + 1, bkData.length, 1).setValues(colActP);
    if (bkCumPlI >= 0) bkSh.getRange(bkHdrRow + 1, bkCumPlI + 1, bkData.length, 1).setValues(colCumPlan);
    if (bkBePlanI >= 0) bkSh.getRange(bkHdrRow + 1, bkBePlanI + 1, bkData.length, 1).setValues(colBePlan);
    if (bkCumAI >= 0) bkSh.getRange(bkHdrRow + 1, bkCumAI + 1, bkData.length, 1).setValues(colCumA);
    if (bkBeAI >= 0) bkSh.getRange(bkHdrRow + 1, bkBeAI + 1, bkData.length, 1).setValues(colBeA);
    SpreadsheetApp.flush();
  }
  
  recalcIRRSheet(planBEMonthMap, actualBEMonthMap);
}
 
// ════════════════════════════════════════════════════════════
// 3. PRODUCTION: Sheet_Production — คำนวณคอลลัมน์ kWh_Plan อัตโนมัติ
// ════════════════════════════════════════════════════════════
function initProductionPlan() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const prodSh = ss.getSheetByName("Sheet_Production");
  const pSh = ss.getSheetByName("Projects");
  const cSh = ss.getSheetByName("System_Config");
  if (!prodSh || !pSh || !cSh) return;
 
  // โหลดพารามิเตอร์โครงการ (kWh_Y1, อัตราเสื่อม)
  const pRows = pSh.getRange(2, 1, pSh.getLastRow() - 1, pSh.getLastColumn()).getValues();
  const pScan = pSh.getRange(1, 1, 1, pSh.getLastColumn()).getValues()[0].map(h => String(h).trim());
  // Must match Sheet_Production's RefCode column, which holds AssetCode-style values (join key)
  const pRefI = pScan.indexOf('AssetCode');
  const pKwhI = pScan.indexOf('kWh_Y1');
  const pCodI = pScan.indexOf('StartYM');
  const pDegI = pScan.indexOf('Degradation');
 
  const projMap = {};
  for (let i = 0; i < pRows.length; i++) {
    const ref = String(pRows[i][pRefI] || '').trim();
    if (!ref) continue;
    projMap[ref] = {
      kwhY1: Number(String(pRows[i][pKwhI] || '').replace(/,/g, '')) || 0,
      startYM: String(pRows[i][pCodI] || '').trim(),
      degradation: Number(String(pRows[i][pDegI] || '').replace(/%/g, '')) / 100 || 0.0045
    };
  }
 
  // โหลดตัวคูณฤดูกาล (Seasonal Multiplier)
  const cRows = cSh.getRange(1, 1, cSh.getLastRow(), 2).getValues();
  const multipliers = {};
  for (let i = 0; i < cRows.length; i++) {
    const key = String(cRows[i][0]).trim();
    if (key.startsWith('Mult_School_')) {
      const mNo = key.replace('Mult_School_', '');
      multipliers[mNo] = Number(cRows[i][1]) || 1.0;
    }
  }
 
  // ประมวลผลและใส่สูตรคำนวณ kWh_Plan ใน Sheet_Production
  const prodLR = prodSh.getLastRow();
  const prodLC = prodSh.getLastColumn();
  if (prodLR < 2) return;
 
  const prodScan = prodSh.getRange(1, 1, 1, prodLC).getValues()[0].map(h => String(h).trim());
  const refIdx = prodScan.indexOf('RefCode');
  const ymIdx  = prodScan.indexOf('YearMonth');
  const planIdx = prodScan.indexOf('kWh_Plan');
 
  const prodRange = prodSh.getRange(2, 1, prodLR - 1, prodLC);
  const prodData = prodRange.getValues();
  const updatedPlanCol = [];
 
  for (let i = 0; i < prodData.length; i++) {
    const ref = String(prodData[i][refIdx]).trim();
    const ym  = cleanYM(prodData[i][ymIdx]);
    const pInfo = projMap[ref];
 
    if (pInfo && ym && ym.length >= 7) {
      const [currYear, currMonth] = ym.split('-').map(Number);
      const startYear = parseInt(pInfo.startYM.slice(0, 4)) || currYear;
      const contractYear = Math.max(1, currYear - startYear + 1);
      
      const kwhAvg = pInfo.kwhY1 / 12;
      const mult = multipliers[String(currMonth)] !== undefined ? multipliers[String(currMonth)] : 1.0;
      const degFactor = Math.pow(1 - pInfo.degradation, contractYear - 1);
      
      // ผลลัพธ์ kWh_Plan ตามเป้ารายเดือนและอัตราเสื่อมสะสม
      const kwhPlan = Math.round(kwhAvg * mult * degFactor);
      updatedPlanCol.push([kwhPlan]);
    } else {
      updatedPlanCol.push([prodData[i][planIdx]]);
    }
  }
 
  prodSh.getRange(2, planIdx + 1, updatedPlanCol.length, 1).setValues(updatedPlanCol);
  Logger.log('initProductionPlan ทำงานเรียบร้อย: ประมวลผล ' + updatedPlanCol.length + ' แถว');
}
 
// ── ระบบ Auto Update เมื่อมีการแก้ไขชีต ──
function onEditAutoUpdate(e) {
  try {
    const sh = e && e.source ? e.source.getActiveSheet() : null;
    if (!sh) return;
    const name = sh.getName();
 
    // 1. ถ้าแก้ไขข้อมูลในชีต Actual -> อัปเดต FeasActual_Proj และ Breakeven
    if (name === SH.ACTUAL) {
      const range = e.range;
      if (range && range.getColumn() === 6) { // ตรวจสอบว่าแก้ที่คอลัมน์ F (ActualRevenue)
        recalcFeasActualProj();
      }
    }
    
    // 2. ถ้าแก้ไขข้อมูล Projects หรือ System_Config -> อัปเดต Sheet_Production อัตโนมัติ
    else if (name === SH.PROJECTS || name === SH.CONFIG) {
      initProductionPlan();
    }
  } catch(err) {
    Logger.log('onEditAutoUpdate error: ' + err.toString());
  }
}
 
 
// ════════════════════════════════════════════════════════════
// WRITE: addProject — Add new project to Projects sheet + create FeasPlan
// ════════════════════════════════════════════════════════════
function addProject(data) {
  try {
    const ss = _ss_();
    const projSh = ss.getSheetByName(SH.PROJECTS);
    if (!projSh) return { ok:false, error:'Sheet Projects not found' };
 
    // Check for duplicate RefCode
    const existing = _sheetToObjects(SH.PROJECTS);
    if (existing.find(r => _val(r,'RefCode') === data.refCode)) {
      return { ok:false, error:'RefCode ' + data.refCode + ' already exists' };
    }
 
    // Add row in Projects (header row 2, data starts at row 3)
    const newRow = [
      data.refCode, data.group, data.contractName,
      Number(data.kwp), Number(data.contractYr), Number(data.investment),
      Number(data.irr)||'', Number(data.payback)||'', data.startYM,
      'TRUE', 'Feas2 Adjusted'
    ];
    projSh.appendRow(newRow);
 
    // Create FeasPlan rows
    const fpSh  = ss.getSheetByName(SH.FEAS_PLAN);
    const goalY1 = Number(data.goalY1) || 0;
    const cyr    = Number(data.contractYr) || 20;
    const sy     = parseInt(data.startYM.split('-')[0]);
    const sm     = parseInt(data.startYM.split('-')[1]);
    const MULT   = {1:1.0,2:1.0,3:0.8,4:0.8,5:1.0,6:1.2,7:1.2,8:1.2,9:1.0,10:0.8,11:1.0,12:1.0};
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
 
    const newFpRows = [];
    for (let yi=0; yi<cyr; yi++) {
      for (let mi=0; mi<12; mi++) {
        const cm = ((sm-1+mi)%12)+1;
        const cy = sy+Math.floor((sm-1+mi)/12)+yi;
        const ym = cy+'-'+(cm<10?'0':'')+cm;
        const mult = MULT[cm];
        const avg  = goalY1/12;
        const plan = avg*mult;
        newFpRows.push([data.refCode, data.group, ym, yi+1, MONTHS[cm-1], cm, goalY1, avg, plan]);
      }
    }
    if (fpSh && newFpRows.length > 0) {
      fpSh.getRange(fpSh.getLastRow()+1, 1, newFpRows.length, newFpRows[0].length)
          .setValues(newFpRows);
    }
 
    // Create Actual rows (all empty)
    const actSh = ss.getSheetByName(SH.ACTUAL);
    if (actSh) {
      const newActRows = [];
      for (let yi=0; yi<cyr; yi++) {
        for (let mi=0; mi<12; mi++) {
          const cm = ((sm-1+mi)%12)+1;
          const cy = sy+Math.floor((sm-1+mi)/12)+yi;
          const ym = cy+'-'+(cm<10?'0':'')+cm;
          newActRows.push([data.refCode, data.group, ym, yi+1, MONTHS[cm-1], '']);
        }
      }
      actSh.getRange(actSh.getLastRow()+1, 1, newActRows.length, newActRows[0].length)
           .setValues(newActRows);
    }
 
    SpreadsheetApp.flush();
    return JSON.parse(JSON.stringify({ ok:true, refCode:data.refCode }));
  } catch(e) {
    Logger.log('addProject error: '+e.toString());
    return { ok:false, error:e.toString() };
  }
}
 
// recalcOnly — expose recalc via dispatch for Setup panel ────
function recalcOnly() {
  try { recalcFeasActualProj(); return { ok:true }; }
  catch(e) { return { ok:false, error:e.toString() }; }
}
 
 
// ════════════════════════════════════════════════════════════
// HOMEPAGE DATA: ดึงข้อมูลสรุปภาพรวมทั้งหมดสำหรับหน้า Dashboard
// ════════════════════════════════════════════════════════════
function getHomepageData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const res = { cards: [], portfolio: {} };
 
  const pjSh = ss.getSheetByName("Projects");
  if (!pjSh) return res;
  const pjData = pjSh.getDataRange().getValues();
  const pjHdr = pjData[0].map(h => String(h).trim());
  
  const bkSh = ss.getSheetByName("Breakeven_Calc");
  if (!bkSh) return res;
  const bkData = bkSh.getDataRange().getValues();
  
  let bkHdrRow = 1;
  for (let i = 0; i < Math.min(5, bkData.length); i++) {
    if (bkData[i].map(h => String(h).trim()).indexOf('RefCode') >= 0) { bkHdrRow = i + 1; break; }
  }
  const bkHdr = bkData[bkHdrRow - 1].map(h => String(h).trim());
  const bkRefI = bkHdr.indexOf('RefCode');
  const bkYmI = bkHdr.findIndex(h => h.includes('YearMonth'));
  const bkYrI = bkHdr.findIndex(h => h.includes('Year (Y)'));
  const bkFeasI = bkHdr.findIndex(h => h.includes('FeasPlan'));
  const bkRealActI = bkHdr.findIndex(h => h.includes('ActualReal') || h.includes('Actual Real'));
  
  const pRefI = pjHdr.indexOf("AssetCode");
  const pDegI = pjHdr.findIndex(h => h.includes("Degradation"));
  const projDegMap = {};
  for (let i = 1; i < pjData.length; i++) {
    const ref = String(pjData[i][pRefI]).trim();
    const degStr = String(pjData[i][pDegI] || '').replace(/%/g, '');
    projDegMap[ref] = (Number(degStr) / 100) || 0.0045;
  }
 
  const bkRowsByRef = {};
  for (let i = bkHdrRow; i < bkData.length; i++) {
    const ref = String(bkData[i][bkRefI]).trim();
    if (!ref) continue;
    if (!bkRowsByRef[ref]) bkRowsByRef[ref] = [];
    bkRowsByRef[ref].push(bkData[i]);
  }
 
  function jsIRR(cashFlows) {
    if (!cashFlows || cashFlows.length < 2) return 0;
    var guess = 0.05;
    for (var i = 0; i < 100; i++) {
      var npv = 0; var dnpv = 0;
      for (var j = 0; j < cashFlows.length; j++) {
        var factor = Math.pow(1 + guess, j);
        npv += cashFlows[j] / factor;
        dnpv -= (j * cashFlows[j]) / (factor * (1 + guess));
      }
      if (dnpv === 0) break;
      var nextGuess = guess - npv / dnpv;
      if (Math.abs(nextGuess - guess) < 1e-7) return nextGuess;
      guess = nextGuess;
      if (guess > 2 || guess < -0.99) break;
    }
    var low = -0.99, high = 2.0;
    for (var i = 0; i < 100; i++) {
      var mid = (low + high) / 2;
      var npv = 0;
      for (var j = 0; j < cashFlows.length; j++) { npv += cashFlows[j] / Math.pow(mid + 1, j); }
      if (Math.abs(npv) < 1e-4) return mid;
      if (npv > 0) low = mid; else high = mid;
    }
    return guess;
  }
 
  const portfolioFlowsCur = {};
  const portfolioFlowsPrev = {};
  let globalLastYM = "";
  const cardsMap = {};
  
  for (let i = 1; i < pjData.length; i++) {
    const ref = String(pjData[i][pjHdr.indexOf("AssetCode")] || "").trim();
    if (!ref || ref === "RefCode") continue;
 
    const startYM = cleanYM(pjData[i][pjHdr.indexOf("StartYM")]);
    const inv = Number(String(pjData[i][pjHdr.indexOf("Investment (THB)")] || "0").replace(/,/g, "")) || 0;
    const kwp = Number(pjData[i][pjHdr.indexOf("kWp")] || 0);
    const contractYr = Number(pjData[i][pjHdr.indexOf("ContractYr (Yr)")] || 0);
    let feasIRRRaw = pjData[i][pjHdr.indexOf("IRR (%)")];
    let feasIRR = String(feasIRRRaw).includes("%") ? parseFloat(String(feasIRRRaw).replace(/%/g, "")) / 100 : Number(feasIRRRaw) || 0;
 
    const bRows = bkRowsByRef[ref] || [];
    let lastActualIdx = -1;
    for (let j = 0; j < bRows.length; j++) {
      const actVal = bRows[j][bkRealActI];
      if (actVal !== "" && actVal !== null && !isNaN(Number(actVal))) {
        lastActualIdx = j;
      }
    }
 
    let projectLastYM = "";
    if (lastActualIdx >= 0) {
      projectLastYM = cleanYM(bRows[lastActualIdx][bkYmI]);
      if (projectLastYM > globalLastYM) globalLastYM = projectLastYM;
    }
 
    const baseYear1M = {};
    let y1Sum = 0, y1Count = 0;
    for (let j = 0; j < Math.min(12, bRows.length); j++) {
      const actVal = Number(bRows[j][bkRealActI]) || 0;
      if (actVal > 0) { y1Sum += actVal; y1Count++; }
    }
    const y1Avg = y1Count > 0 ? y1Sum / y1Count : 0;
    for (let m = 1; m <= 12; m++) {
      if (bRows[m-1] && Number(bRows[m-1][bkRealActI]) > 0) baseYear1M[m] = Number(bRows[m-1][bkRealActI]);
      else if (y1Count > 0) baseYear1M[m] = y1Avg;
      else baseYear1M[m] = bRows[m-1] ? (Number(bRows[m-1][bkFeasI]) || 0) : 0;
    }
 
    function runSimulation(limitIdx) {
      let cum = 0; let planCum = 0;
      let beMonth = "N/A"; let planBeMonth = "N/A";
      let planCumAtLimit = 0; // 🌟 NEW: แผนสะสม ณ เดือนเดียวกับ Present (apples-to-apples)
      const rolling = {}; const annualCF = {}; const calCF = {};
      let startYear = 2025;
      if (startYM && startYM.length >= 4) {
        let m = startYM.match(/^(\d{4})/);
        if (m) startYear = parseInt(m[1]);
      }
      let totalMonths = Math.max(bRows.length, 60 * 12);
      
      for (let mIdx = 0; mIdx < totalMonths; mIdx++) {
        let ymStr = ""; let yr = Math.floor(mIdx / 12) + 1; let mNo = (mIdx % 12) + 1; let feasVal = 0;
        if (mIdx < bRows.length) {
          ymStr = cleanYM(bRows[mIdx][bkYmI]);
          feasVal = Number(bRows[mIdx][bkFeasI]) || 0;
        } else {
          ymStr = (startYear + Math.floor(mIdx / 12)) + "-" + String(mNo).padStart(2, '0');
        }
        let calYear = parseInt(ymStr.split('-')[0]);
        planCum += feasVal;
        if (mIdx === limitIdx) planCumAtLimit = planCum; // 🌟 NEW
        if (inv > 0 && planCum >= inv && planBeMonth === "N/A") planBeMonth = ymStr;
 
        let monthlyVal = 0;
        let isReal = (mIdx <= limitIdx && mIdx < bRows.length && bRows[mIdx][bkRealActI] !== "" && bRows[mIdx][bkRealActI] !== null);
        if (isReal) {
          monthlyVal = Number(bRows[mIdx][bkRealActI]) || 0;
        } else {
          let deg = projDegMap[ref] || 0.0045;
          if (yr === 1) monthlyVal = baseYear1M[mNo] || 0;
          else monthlyVal = Math.round((rolling[mNo] !== undefined ? rolling[mNo] : (baseYear1M[mNo] || 0)) * (1 - deg));
        }
        rolling[mNo] = monthlyVal;
        let prevCum = cum; cum += monthlyVal;
        if (inv > 0 && cum >= inv && beMonth === "N/A") beMonth = ymStr;
 
        if (yr <= contractYr) {
          if (!annualCF[yr]) annualCF[yr] = 0; annualCF[yr] += monthlyVal;
          if (!calCF[calYear]) calCF[calYear] = 0; calCF[calYear] += monthlyVal;
        }
      }
      const irrCF = [-inv];
      for (let y = 1; y <= contractYr; y++) irrCF.push(annualCF[y] || 0);
      return { beMonth, planBeMonth, computedIRR: jsIRR(irrCF), calCF, planCumAtLimit }; // 🌟 return เพิ่ม
    }
 
    const curSim = runSimulation(lastActualIdx);
    const prevSim = runSimulation(lastActualIdx - 1);
 
    let totalActualRevenue = 0;
    for (let j = 0; j <= lastActualIdx; j++) {
      totalActualRevenue += Number(bRows[j][bkRealActI]) || 0;
    }
 
    // 🌟 คำนวณรายได้เดือนล่าสุดเทียบกับเดือนก่อนหน้า ของแต่ละโครงการ
    let currentMonthRevenue = lastActualIdx >= 0 ? (Number(bRows[lastActualIdx][bkRealActI]) || 0) : 0;
    let prevMonthRevenue = lastActualIdx > 0 ? (Number(bRows[lastActualIdx - 1][bkRealActI]) || 0) : 0;
    let cashInMonthChange = currentMonthRevenue - prevMonthRevenue;
 
    let pStartCalYear = (parseInt(startYM.split('-')[0]) || 2025) - 1;
    if (!portfolioFlowsCur[pStartCalYear]) portfolioFlowsCur[pStartCalYear] = 0;
    portfolioFlowsCur[pStartCalYear] -= inv;
    if (!portfolioFlowsPrev[pStartCalYear]) portfolioFlowsPrev[pStartCalYear] = 0;
    portfolioFlowsPrev[pStartCalYear] -= inv;
 
    for (let cYear in curSim.calCF) {
      portfolioFlowsCur[cYear] = (portfolioFlowsCur[cYear] || 0) + curSim.calCF[cYear];
    }
    for (let cYear in prevSim.calCF) {
      portfolioFlowsPrev[cYear] = (portfolioFlowsPrev[cYear] || 0) + prevSim.calCF[cYear];
    }
 
    let contractEndYear = (parseInt(startYM.split('-')[0]) || 2025) + contractYr - 1;
    let actBeStr = curSim.beMonth;
    if (actBeStr !== "N/A") {
      let actBeYear = parseInt(actBeStr.split('-')[0]);
      if (actBeYear > contractEndYear) actBeStr += " (เกินอายุสัญญา)";
    }
 
    cardsMap[ref] = {
      refCode: ref,
      group: String(pjData[i][pjHdr.indexOf("ProjectGroup")] || ""),
      contractName: String(pjData[i][pjHdr.indexOf("ContractName")] || ""),
      startYM: startYM,
      contractYr: contractYr,
      investment: inv,
      totalActual: totalActualRevenue, 
      totalPlanToDate: curSim.planCumAtLimit,                          // 🌟 NEW: Feas Cash In
      balance: inv - totalActualRevenue, 
      balancePlan: inv - curSim.planCumAtLimit,                        // 🌟 NEW: Feas Balance
      cashInMonthChange: cashInMonthChange,
      cashInMonthChangePlan: curSim.planCumAtLimit - prevSim.planCumAtLimit, // 🌟 NEW: Feas Cash In Δ
      breakevenPlanYM: curSim.planBeMonth, 
      breakevenActYM: actBeStr, 
      realtimeIRR: curSim.computedIRR,
      irrMonthChange: curSim.computedIRR - prevSim.computedIRR,
      kwp: kwp,
      feasIRR: feasIRR
    };
  }
 
  const cardsArr = Object.values(cardsMap);
  const totalInv = cardsArr.reduce((s, c) => s + c.investment, 0);
  const totalActual = cardsArr.reduce((s, c) => s + c.totalActual, 0);
  
  const pYearsCur = Object.keys(portfolioFlowsCur).map(Number).sort((a,b)=>a-b);
  const pCFArrCur = pYearsCur.map(y => portfolioFlowsCur[y]);
  const portfolioIRRCur = jsIRR(pCFArrCur);
 
  const pYearsPrev = Object.keys(portfolioFlowsPrev).map(Number).sort((a,b)=>a-b);
  const pCFArrPrev = pYearsPrev.map(y => portfolioFlowsPrev[y]);
  const portfolioIRRPrev = jsIRR(pCFArrPrev);
  
  let totalPlanCum = 0; let totalActSimCum = 0;
  let portPlanBEMonth = "N/A"; let portProjBEMonth = "N/A";
  const combinedPlan = {}; const combinedActCalc = {};
 
  cardsArr.forEach(c => {
    const bRows = bkRowsByRef[c.refCode] || [];
    const baseYear1M = {}; let y1Sum = 0; let y1Count = 0;
    for (let j = 0; j < Math.min(12, bRows.length); j++) {
      const actVal = Number(bRows[j][bkRealActI]) || 0;
      if (actVal > 0) { y1Sum += actVal; y1Count++; }
    }
    const y1Avg = y1Count > 0 ? y1Sum / y1Count : 0;
    for (let m = 1; m <= 12; m++) {
      if (bRows[m-1] && Number(bRows[m-1][bkRealActI]) > 0) baseYear1M[m] = Number(bRows[m-1][bkRealActI]);
      else if (y1Count > 0) baseYear1M[m] = y1Avg;
      else baseYear1M[m] = bRows[m-1] ? (Number(bRows[m-1][bkFeasI]) || 0) : 0;
    }
    let lastActIdx = -1;
    for (let j = 0; j < bRows.length; j++) { if (bRows[j][bkRealActI] !== "" && bRows[j][bkRealActI] !== null) lastActIdx = j; }
 
    const rolling = {};
    let cStartYear = parseInt(c.startYM.split('-')[0]) || 2025;
    let maxM = Math.max(bRows.length, 60 * 12);
 
    for (let mIdx = 0; mIdx < maxM; mIdx++) {
      let yr = Math.floor(mIdx / 12) + 1; let mNo = (mIdx % 12) + 1; let ymStr = ""; let feasVal = 0;
      if (mIdx < bRows.length) {
        ymStr = cleanYM(bRows[mIdx][bkYmI]); feasVal = Number(bRows[mIdx][bkFeasI]) || 0;
      } else {
        ymStr = (cStartYear + Math.floor(mIdx / 12)) + "-" + String(mNo).padStart(2, '0');
      }
      let actCalcVal = 0;
      let isReal = (mIdx <= lastActIdx && mIdx < bRows.length && bRows[mIdx][bkRealActI] !== "" && bRows[mIdx][bkRealActI] !== null);
      if (isReal) {
        actCalcVal = Number(bRows[mIdx][bkRealActI]) || 0;
      } else {
        let deg = projDegMap[c.refCode] || 0.0045;
        if (yr === 1) actCalcVal = baseYear1M[mNo] || 0;
        else actCalcVal = Math.round((rolling[mNo] !== undefined ? rolling[mNo] : (baseYear1M[mNo] || 0)) * (1 - deg));
      }
      rolling[mNo] = actCalcVal;
      combinedPlan[ymStr] = (combinedPlan[ymStr] || 0) + feasVal;
      combinedActCalc[ymStr] = (combinedActCalc[ymStr] || 0) + actCalcVal;
    }
  });
 
  const allYMKeys = Object.keys(combinedPlan).sort();
  for (let k = 0; k < allYMKeys.length; k++) {
    let ym = allYMKeys[k];
    totalPlanCum += (combinedPlan[ym] || 0);
    totalActSimCum += (combinedActCalc[ym] || 0);
    if (totalPlanCum >= totalInv && portPlanBEMonth === "N/A") portPlanBEMonth = ym;
    if (totalActSimCum >= totalInv && portProjBEMonth === "N/A") portProjBEMonth = ym;
  }
 
  const totalPlanToDate = cardsArr.reduce((s, c) => s + (c.totalPlanToDate || 0), 0);
  const cashInMonthChangePlan = cardsArr.reduce((s, c) => s + (c.cashInMonthChangePlan || 0), 0);
  // ⚠️ Feas IRR ระดับพอร์ต: ไม่มี "IRR รวมของหลายโครงการ" ตามธรรมชาติ (แต่ละโครงการ cashflow คนละช่วงเวลา)
  // ใช้ค่าเฉลี่ยถ่วงน้ำหนักตามเงินลงทุน (investment-weighted average) เป็นค่าประมาณสำหรับแสดงผลเท่านั้น
  const feasIRRPortfolio = totalInv > 0
    ? cardsArr.reduce((s, c) => s + (c.feasIRR || 0) * c.investment, 0) / totalInv
    : 0;
 
  res.cards = cardsArr;
  res.asOfYM = globalLastYM;
  res.portfolio = {
    totalContracts: cardsArr.length,
    totalInvestment: totalInv,
    totalActual: totalActual, 
    totalPlanToDate: totalPlanToDate,                 // 🌟 NEW
    balance: totalInv - totalActual, 
    balancePlan: totalInv - totalPlanToDate,          // 🌟 NEW
    cashInMonthChange: cardsArr.reduce((s, c) => s + c.cashInMonthChange, 0),
    cashInMonthChangePlan: cashInMonthChangePlan,     // 🌟 NEW
    breakevenPlanYM: portPlanBEMonth,
    breakevenActYM: portProjBEMonth,
    realtimeIRR: portfolioIRRCur,
    irrMonthChange: portfolioIRRCur - portfolioIRRPrev,
    feasIRR: feasIRRPortfolio                         // 🌟 NEW
  };
 
  return res;
}
 
// ════════════════════════════════════════════════════════════
// debugBreakeven — Check max CumActual of each project
// Run in GAS Editor and view in Logs
// ════════════════════════════════════════════════════════════
function debugBreakeven() {
  const ss = _ss_();
  const bkSh = ss.getSheetByName(SH.BREAKEVEN);
  if (!bkSh) { Logger.log('Breakeven sheet not found'); return; }
 
  const bkLR  = bkSh.getLastRow();
  const bkLC  = bkSh.getLastColumn();
  const bkHdr = bkSh.getRange(3,1,1,bkLC).getValues()[0].map(h=>String(h).trim());
  const bkRefI = bkHdr.indexOf('RefCode');
  const bkYMI  = bkHdr.indexOf('YearMonth');
  const bkCumAI= bkHdr.findIndex(h=>h==='CumActual (THB)');
  const bkBeAI = bkHdr.findIndex(h=>h.startsWith('BE Actual'));
  const bkBePlanI = bkHdr.findIndex(h => h.startsWith('BE Plan'));
  const bkCumPlI  = bkHdr.findIndex(h => h === 'CumPlan (THB)');
 
  const bkData = bkSh.getRange(4,1,bkLR-3,bkLC).getValues();
 
  // Collect max CumActual and total months per ref
  const stats = {};
  for (let i=0;i<bkData.length;i++) {
    const ref  = String(bkData[i][bkRefI]||'').trim();
    const ym   = String(bkData[i][bkYMI ]||'').trim();
    const cum  = Number(bkData[i][bkCumAI]||0);
    const beA  = String(bkData[i][bkBeAI ]||'');
    if (!ref) continue;
    if (!stats[ref]) stats[ref] = { maxCum:0, rows:0, beFound:false, lastYM:'', firstYM:'' };
    if (!stats[ref].firstYM) stats[ref].firstYM = ym;
    stats[ref].lastYM = ym;
    stats[ref].rows++;
    if (cum > stats[ref].maxCum) stats[ref].maxCum = cum;
    if (beA === 'BREAKEVEN') stats[ref].beFound = true;
  }
 
  // Get investment from Projects
  const investmentMap = {};
  const projSh = ss.getSheetByName(SH.PROJECTS);
  if (projSh) {
    const ph = projSh.getRange(2,1,1,projSh.getLastColumn()).getValues()[0].map(h=>String(h).trim());
    const pr = ph.indexOf('RefCode'), pc = ph.findIndex(h=>h.startsWith('Investment'));
    const pd = projSh.getRange(3,1,projSh.getLastRow()-2,projSh.getLastColumn()).getValues();
    pd.forEach(r=>{ if(r[pr]) investmentMap[String(r[pr]).trim()] = Number(r[pc]||0); });
  }
 
  Logger.log('=== Breakeven Debug ===');
  Object.keys(stats).forEach(ref => {
    const s   = stats[ref];
    const inv = investmentMap[ref] || 0;
    const pct = inv > 0 ? (s.maxCum/inv*100).toFixed(1) : '—';
    const gap = inv > 0 ? Math.round(inv - s.maxCum).toLocaleString() : '—';
    Logger.log(
      ref +
      ' | Investment: '     + Math.round(inv).toLocaleString() +
      ' | MaxCumActual: ' + Math.round(s.maxCum).toLocaleString() +
      ' | Reached: '   + pct + '%' +
      ' | Gap to BE: ' + gap +
      ' | Months: '    + s.rows +
      ' | BE found: '  + s.beFound +
      ' | Range: '     + s.firstYM + ' → ' + s.lastYM
    );
  });
}
 
 
// View monthly cumActual during actual→projected transition
function debugCumDetail() {
  const ss = _ss_();
  const bkSh = ss.getSheetByName(SH.BREAKEVEN);
  const prSh = ss.getSheetByName(SH.PROJ);
 
  const bkHdr = bkSh.getRange(3,1,1,bkSh.getLastColumn()).getValues()[0].map(h=>String(h).trim());
  const bkRefI = bkHdr.indexOf('RefCode');
  const bkYMI  = bkHdr.indexOf('YearMonth');
  const bkActPI= bkHdr.findIndex(h=>h.startsWith('ActualProj'));
  const bkCumAI= bkHdr.findIndex(h=>h==='CumActual (THB)');
  const bkData = bkSh.getRange(4,1,bkSh.getLastRow()-3,bkSh.getLastColumn()).getValues();
 
  const prHdr = prSh.getRange(3,1,1,prSh.getLastColumn()).getValues()[0].map(h=>String(h).trim());
  const prRefI = prHdr.indexOf('RefCode');
  const prYMI  = prHdr.indexOf('YearMonth');
  const prPrI  = prHdr.findIndex(h=>h.startsWith('ActualProjected'));
  const prData = prSh.getRange(4,1,prSh.getLastRow()-3,prSh.getLastColumn()).getValues();
 
  // Build projMap from PROJ sheet
  const projMap = {};
  for (let i=0;i<prData.length;i++) {
    const ref = String(prData[i][prRefI]||'').trim();
    const ym  = String(prData[i][prYMI ]||'').trim();
    const v   = prData[i][prPrI];
    if (ref&&ym) projMap[ref+'|'+ym] = (v!==''&&v!==null&&!isNaN(Number(v))) ? Number(v) : 0;
  }
 
  // Show months 7-16 for NB230003.2 (transition zone)
  Logger.log('=== NB230003.2 months 7-20 (BK CumActual vs PROJ projected) ===');
  let count=0;
  for (let i=0;i<bkData.length;i++) {
    const ref = String(bkData[i][bkRefI]||'').trim();
    if (ref !== 'NB230003.2') continue;
    count++;
    if (count < 7 || count > 20) continue;
    const ym    = String(bkData[i][bkYMI]||'').trim();
    const actP  = bkData[i][bkActPI];
    const cumA  = bkData[i][bkCumAI];
    const projV = projMap[ref+'|'+ym];
    Logger.log('  mo'+count+' ym='+ym+' BK_actP='+actP+' BK_cumA='+cumA+' PROJ_proj='+projV+' match='+(actP==projV));
  }
 
  // Same for NB230002
  Logger.log('=== NB230002 months 7-20 ===');
  count=0;
  for (let i=0;i<bkData.length;i++) {
    const ref = String(bkData[i][bkRefI]||'').trim();
    if (ref !== 'NB230002') continue;
    count++;
    if (count < 7 || count > 20) continue;
    const ym    = String(bkData[i][bkYMI]||'').trim();
    const actP  = bkData[i][bkActPI];
    const cumA  = bkData[i][bkCumAI];
    const projV = projMap[ref+'|'+ym];
    Logger.log('  mo'+count+' ym='+ym+' BK_actP='+actP+' BK_cumA='+cumA+' PROJ_proj='+projV+' match='+(actP==projV));
  }
}
// ════════════════════════════════════════════════════════════
// GROUP SUMMARY — Budget + Meters
// ════════════════════════════════════════════════════════════
 
function getGroupSummary(params) {
  try {
    var pg = String(params.projectGroup || '').trim();
    var projRows = _sheetToObjects(SH.PROJECTS);
    var contracts = projRows.filter(function(r) {
      return String(_val(r, 'ProjectGroup') || '').trim() === pg;
    });
    var totalKwp = contracts.reduce(function(s, r) {
      return s + (Number(_val(r, 'kWp') || 0));
    }, 0);
    var contractList = contracts.map(function(r) {
      return {
        refCode      : _val(r, 'AssetCode'),
        budgetCode   : _val(r, 'RefCode'),
        contractName : _val(r, 'ContractName'),
        kwp          : _val(r, 'kWp'),
        contractYr   : _val(r, 'ContractYr (Yr)', 'ContractYr'),
        startYM      : _val(r, 'StartYM', 'StartYearMonth'),
      };
    });
    return JSON.parse(JSON.stringify({
      projectGroup  : pg,
      totalKwp      : totalKwp,
      contractCount : contractList.length,
      contracts     : contractList,
    }));
  } catch(e) {
    return { error: String(e.message), projectGroup: params.projectGroup };
  }
}
 
function getGroupBudget(params) {
  try {
    var pg = String(params.projectGroup || '').trim();
    var budgetSh = _getSheet(SH.BUDGET);
    if (!budgetSh) {
      return JSON.parse(JSON.stringify({ projectGroup: pg, budgetTHB: null, usedTHB: null,
                              balanceTHB: null, balancePct: null, monthlyBreakdown: [] }));
    }
    var rows = _sheetToObjects(SH.BUDGET).filter(function(r) {
      return String(_val(r, 'ProjectGroup') || '').trim() === pg;
    });
    if (!rows.length) {
      return JSON.parse(JSON.stringify({ projectGroup: pg, budgetTHB: null, usedTHB: null,
                              balanceTHB: null, balancePct: null, monthlyBreakdown: [] }));
    }
    // Budget_THB = Same number for all rows in group → use first row
    var budgetTHB = Number(_val(rows[0], 'Budget_THB') || 0);
    // BudgetUsed_THB = sum of all months
    var totalUsed = rows.reduce(function(s, r) {
      return s + (Number(_val(r, 'BudgetUsed_THB') || 0));
    }, 0);
    var balanceTHB = budgetTHB - totalUsed;
    var balancePct = budgetTHB > 0
      ? Math.max(0, Math.min(100, Math.round(balanceTHB / budgetTHB * 100))) : null;
    var usedPct = balancePct != null ? 100 - balancePct : null;
    var monthly = rows
      .filter(function(r) { return _val(r, 'YearMonth'); })
      .map(function(r) {
        return { ym: String(_val(r, 'YearMonth') || ''), used: Number(_val(r, 'BudgetUsed_THB') || 0) };
      })
      .sort(function(a, b) { return a.ym.localeCompare(b.ym); });
    return JSON.parse(JSON.stringify({
      projectGroup     : pg,
      budgetTHB        : budgetTHB  || null,
      usedTHB          : totalUsed  || null,
      balanceTHB       : balanceTHB,
      balancePct       : balancePct,
      usedPct          : usedPct,
      monthlyBreakdown : monthly,
    }));
  } catch(e) {
    return JSON.parse(JSON.stringify({ error: String(e.message), projectGroup: params.projectGroup }));
  }
}
 
function getGroupMeters(params) {
  try {
    var pg = String(params.projectGroup || '').trim();
    var meterSh = _getSheet(SH.METERS);
    if (!meterSh) {
      return JSON.parse(JSON.stringify({ projectGroup: pg, meters: [], touCount: 0, todCount: 0,
                              totalCount: 0, error: 'Sheet_Meters not found' }));
    }
    var rows = _sheetToObjects(SH.METERS).filter(function(r) {
      return String(_val(r, 'ProjectGroup') || '').trim() === pg;
    });
    var meters = rows.map(function(r) {
      return {
        meterId           : _val(r, 'MeterID'),
        refCode           : _val(r, 'RefCode'),
        meterType         : _val(r, 'MeterType'),
        location          : _val(r, 'Location'),
        rateEnergyOnPeak  : _val(r, 'Rate_Energy_OnPeak'),
        rateEnergyOffPeak : _val(r, 'Rate_Energy_OffPeak'),
        rateEnergy        : _val(r, 'Rate_Energy'),
        rateDemandOnPeak  : _val(r, 'Rate_Demand_OnPeak'),
        rateDemandOffPeak : _val(r, 'Rate_Demand_OffPeak'),
        rateDemand        : _val(r, 'Rate_Demand'),
        rateFT            : _val(r, 'Rate_FT'),
        discountPct       : _val(r, 'Discount_Electric(%)'),
        rateService       : _val(r, 'Rate_Service'),
      };
    });
    var touCount = meters.filter(function(m) { return String(m.meterType||'').toUpperCase()==='TOU'; }).length;
    var todCount = meters.filter(function(m) { return String(m.meterType||'').toUpperCase()==='TOD'; }).length;
    return JSON.parse(JSON.stringify({
      projectGroup : pg,
      meters       : meters,
      touCount     : touCount,
      todCount     : todCount,
      totalCount   : meters.length,
    }));
  } catch(e) {
    return { error: String(e.message), meters: [], touCount:0, todCount:0, totalCount:0 };
  }
}
// ── getProduction: Fetch annual Production data (ปรับปรุงให้ดึงข้อมูลทั้งหมดได้) ───────────────
function getProduction(refCode, year) {
  const ss = _ss_();
  const prodSh = ss.getSheetByName('Sheet_Production');
  const projRows = _sheetToObjects(SH.PROJECTS);
  if (!prodSh) return { rows: [], error: 'Sheet_Production not found' };
 
  const isAll = (refCode === 'all');
  let kwp = 0;
  let elecRate = 4.20;
 
  if (isAll) {
    kwp = projRows.reduce((sum, r) => sum + (Number(_val(r, 'kWp')) || 0), 0);
  } else {
    const proj = projRows.find(r => _val(r, 'AssetCode') === refCode);
    if (!proj) return { rows: [], error: 'Project not found' };
    kwp = Number(_val(proj, 'kWp') || 0);
 
    // ดึงค่าไฟโปรเจกต์เดี่ยว
    const meterSh = ss.getSheetByName('Sheet_Meters');
    if (meterSh) {
      const mData = meterSh.getDataRange().getValues();
      const mHeaders = mData[0].map(h => String(h).trim());
      const matchMeter = mData.find((r, i) => i > 0 && String(r[mHeaders.indexOf('RefCode')]).trim() === refCode);
      if (matchMeter) {
        const rateOnPeak = Number(matchMeter[mHeaders.indexOf('Rate_Energy_OnPeak')]) || 0;
        const rateFlat = Number(matchMeter[mHeaders.indexOf('Rate_Energy')]) || 0;
        const rateFt = Number(matchMeter[mHeaders.indexOf('Rate_FT')]) || 0;
        const baseRate = rateOnPeak > 0 ? rateOnPeak : rateFlat;
        if (baseRate > 0) elecRate = baseRate + rateFt;
      }
    }
  }
 
  const headers = prodSh.getRange(1, 1, 1, prodSh.getLastColumn()).getValues()[0].map(h => String(h).trim());
  const lastRow = prodSh.getLastRow();
  if (lastRow < 2) return { rows: [] };
  const data = prodSh.getRange(2, 1, lastRow - 1, headers.length).getValues();
 
  const idx = {
    ref: headers.indexOf('RefCode'),
    ym: headers.indexOf('YearMonth'),
    plan: headers.indexOf('kWh_Plan'),
    actual: headers.indexOf('PV_Out'),
    exported: headers.indexOf('Export_Grid'),
    importGrid: headers.indexOf('Import_Grid'),
    consumption: headers.indexOf('Consumption'),
    co2: headers.indexOf('CO2_Reduction'),
    saving: headers.indexOf('Saving_Baht')
  };
 
  const groupMap = {};
  const byProjectMap = {}; // ym -> { refCode: {plan, actual, consumption, exported, importGrid} } — powers the bar-click drilldown table
  data.forEach(row => {
    const ref = String(row[idx.ref] || '').trim();
    let ymRaw = row[idx.ym];
    let ym = ymRaw instanceof Date ? ymRaw.getFullYear() + '-' + String(ymRaw.getMonth() + 1).padStart(2, '0') : String(ymRaw).trim().slice(0, 7);
 
    if (!isAll && ref !== refCode) return;
    if (!ym) return;
 
    if (!groupMap[ym]) {
      groupMap[ym] = { ym, plan: 0, actual: null, co2: 0, saving: 0, exported: null, consumption: null, importGrid: null };
    }
 
    const plan = Number(row[idx.plan]) || 0;
    const actual = row[idx.actual] !== '' && row[idx.actual] !== null ? Number(row[idx.actual]) : null;
    const co2 = Number(row[idx.co2]) || (actual !== null ? actual * 0.4999 : 0);
    const saving = Number(row[idx.saving]) || (actual !== null ? actual * elecRate : 0);
    const exported = row[idx.exported] !== '' && row[idx.exported] !== null ? Number(row[idx.exported]) : null;
    const consumption = row[idx.consumption] !== '' && row[idx.consumption] !== null ? Number(row[idx.consumption]) : null;
    const importGrid = row[idx.importGrid] !== '' && row[idx.importGrid] !== null ? Number(row[idx.importGrid]) : null;
 
    groupMap[ym].plan += plan;
    if (actual !== null) groupMap[ym].actual = (groupMap[ym].actual || 0) + actual;
    groupMap[ym].co2 += co2;
    groupMap[ym].saving += saving;
    if (exported !== null) groupMap[ym].exported = (groupMap[ym].exported || 0) + exported;
    if (consumption !== null) groupMap[ym].consumption = (groupMap[ym].consumption || 0) + consumption;
    if (importGrid !== null) groupMap[ym].importGrid = (groupMap[ym].importGrid || 0) + importGrid;
 
    if (ref) {
      if (!byProjectMap[ym]) byProjectMap[ym] = {};
      if (!byProjectMap[ym][ref]) byProjectMap[ym][ref] = { plan: 0, actual: null, consumption: null, exported: null, importGrid: null };
      byProjectMap[ym][ref].plan += plan;
      if (actual !== null) byProjectMap[ym][ref].actual = (byProjectMap[ym][ref].actual || 0) + actual;
      if (consumption !== null) byProjectMap[ym][ref].consumption = (byProjectMap[ym][ref].consumption || 0) + consumption;
      if (exported !== null) byProjectMap[ym][ref].exported = (byProjectMap[ym][ref].exported || 0) + exported;
      if (importGrid !== null) byProjectMap[ym][ref].importGrid = (byProjectMap[ym][ref].importGrid || 0) + importGrid;
    }
  });
 
  const byProject = {};
  Object.keys(byProjectMap).forEach(ym => {
    byProject[ym] = Object.keys(byProjectMap[ym]).map(ref => Object.assign({ refCode: ref }, byProjectMap[ym][ref]));
  });
 
  const yms = Object.keys(groupMap).sort();
  const rows = [];
  let totalPlan = 0, totalActual = 0, totalCO2 = 0, totalSavingBaht = 0;
  let cumPlan = 0, cumActual = 0;
 
  yms.forEach(ym => {
    const m = groupMap[ym];
    totalPlan += m.plan;
    cumPlan += m.plan;
    if (m.actual !== null) {
      totalActual += m.actual;
      cumActual += m.actual;
    }
    totalCO2 += m.co2;
    totalSavingBaht += m.saving;
 
    rows.push({
      ym: m.ym,
      plan: m.plan,
      actual: m.actual,
      pr: (m.actual !== null && m.plan > 0) ? (m.actual / m.plan) : null,
      co2: m.co2,
      saving: m.saving,
      cumPlan: cumPlan,
      cumActual: m.actual !== null ? cumActual : null,
      exported: m.exported,
      consumption: m.consumption,
      importGrid: m.importGrid
    });
  });
 
  const totalPR = (totalActual > 0 && totalPlan > 0) ? (totalActual / totalPlan) : null;
  const variancePct = (totalPlan > 0 && totalActual > 0) ? (totalActual - totalPlan) / totalPlan : null;
 
  return JSON.parse(JSON.stringify({
    rows,
    summary: { totalPlan, totalActual, totalPR, totalCO2, totalSavingBaht, variancePct },
    kwp,
    year: 'all',
    elecRate: elecRate,
    byProject
  }));
}
 
// ── getPortfolioProduction: Summary of all sites by month ────────────
function getPortfolioProduction() {
  const ss = _ss_();
  const prodSh = ss.getSheetByName('Sheet_Production');
  if (!prodSh) return { months: [], error: 'Sheet_Production not found' };
 
  const projRows = _sheetToObjects(SH.PROJECTS);
  const headers  = prodSh.getRange(1, 1, 1, prodSh.getLastColumn()).getValues()[0]
                         .map(h => String(h).trim());
  const lastRow  = prodSh.getLastRow();
  if (lastRow < 2) return { months: [] };
 
  const data = prodSh.getRange(2, 1, lastRow - 1, headers.length).getValues();
  const idx = {
    ref      : headers.indexOf('RefCode'),
    ym       : headers.indexOf('YearMonth'),
    plan     : headers.indexOf('kWh_Plan'),
    actual      : headers.indexOf('PV_Out'),            // เดิมคือ 'kWh_Actual'
    exported    : headers.indexOf('Export_Grid'),  // เดิมคือ 'kWh_Exported'
    importGrid  : headers.indexOf('Import_Grid'),       // คอลัมน์ไฟการไฟฟ้า
    consumption : headers.indexOf('Consumption'),       // คอลัมน์การใช้ไฟรวม
    co2         : headers.indexOf('CO2_Reduction'),
    saving      : headers.indexOf('Saving_Baht')
  };
 
  // Aggregate all sites per month
  const monthMap = {};
  data.forEach(row => {
    const ym     = String(row[idx.ym] || '').trim();
    const plan   = Number(row[idx.plan]  || 0);
    const actual = row[idx.actual] !== '' && row[idx.actual] !== null
                   ? Number(row[idx.actual]) : null;
    if (!ym) return;
    if (!monthMap[ym]) monthMap[ym] = { ym, plan: 0, actual: 0, hasActual: false };
    monthMap[ym].plan   += plan;
    if (actual !== null) { monthMap[ym].actual += actual; monthMap[ym].hasActual = true; }
  });
 
  const months = Object.values(monthMap)
    .sort((a, b) => a.ym.localeCompare(b.ym))
    .map(m => ({
      ...m,
      actual     : m.hasActual ? m.actual : null,
      pr         : m.plan > 0 && m.hasActual ? m.actual / m.plan : null,
      variancePct: m.plan > 0 && m.hasActual ? (m.actual - m.plan) / m.plan : null,
      co2        : m.hasActual ? m.actual * CO2_FACTOR : null,
    }));
 
  return JSON.parse(JSON.stringify({ months }));
}
 
// ── getProductionRows: ดึง kWh รายเดือนสำหรับ Input Panel ──
function getProductionRows(refCode, year) {
  const ss = _ss_();
  const prodSh = ss.getSheetByName('Sheet_Production');
  const projRows = _sheetToObjects(SH.PROJECTS);
  if (!prodSh) return { rows: [] };
 
  const proj    = projRows.find(r => _val(r,'RefCode') === refCode) || {};
  const startYM = safe(_val(proj,'StartYM','StartYearMonth')) || '';
  const yr      = Number(year) || 1;
 
  // YM range สำหรับปีที่ yr
  let yearStartYM = '', yearEndYM = '';
  if (startYM.length >= 7) {
    const sy = parseInt(startYM.slice(0,4));
    const sm = parseInt(startYM.slice(5,7));
    const offset = (yr - 1) * 12;
    const s = new Date(sy, sm - 1 + offset, 1);
    const e = new Date(sy, sm - 1 + offset + 11, 1);
    yearStartYM = s.getFullYear() + '-' + String(s.getMonth()+1).padStart(2,'0');
    yearEndYM   = e.getFullYear() + '-' + String(e.getMonth()+1).padStart(2,'0');
  }
 
  const headers = prodSh.getRange(1, 1, 1, prodSh.getLastColumn()).getValues()[0].map(h => String(h).trim());
  const lastRow = prodSh.getLastRow();
  if (lastRow < 2) return { rows: [] };
 
  const data = prodSh.getRange(2, 1, lastRow-1, headers.length).getValues();
 
  function normYM(v) {
    if (!v) return '';
    if (v instanceof Date)
      return v.getFullYear() + '-' + String(v.getMonth()+1).padStart(2,'0');
    return String(v).trim().slice(0,7);
  }
 
  const idx = {
    ref         : headers.indexOf('RefCode'),
    ym          : headers.indexOf('YearMonth'),
    plan        : headers.indexOf('kWh_Plan'),
    pvOut       : headers.indexOf('PV_Out'),
    exportGrid  : headers.indexOf('Export_Grid'),
    consumption : headers.indexOf('Consumption')
  };
 
  const rows = [];
  for (let i = 0; i < data.length; i++) {
    const ref = String(data[i][idx.ref] || '').trim();
    const ym  = normYM(data[i][idx.ym]);
    if (ref !== refCode) continue;
    if (yearStartYM && (ym < yearStartYM || ym > yearEndYM)) continue;
 
    const plan        = Number(data[i][idx.plan] || 0);
    const pvOut       = data[i][idx.pvOut] !== '' && data[i][idx.pvOut] !== null ? Number(data[i][idx.pvOut]) : null;
    const exportGrid  = data[i][idx.exportGrid] !== '' && data[i][idx.exportGrid] !== null ? Number(data[i][idx.exportGrid]) : null;
    const consumption = data[i][idx.consumption] !== '' && data[i][idx.consumption] !== null ? Number(data[i][idx.consumption]) : null;
 
    rows.push({
      rowNum      : i + 2,
      ym,
      plan,
      pvOut,
      exportGrid,
      consumption
    });
  }
 
  return JSON.parse(JSON.stringify({ rows, yearStartYM, yearEndYM, year: yr }));
}
 
// ── saveProduction: บันทึก PV_Out, Export_Grid, Consumption ──
function saveProduction(access, allowedAssets, updates) {
  if (!canWrite(access)) return { ok: false, error: 'สิทธิ์ไม่พอ' };
  try {
    const ss = _ss_();
    const prodSh = ss.getSheetByName('Sheet_Production');
    if (!prodSh) return { ok: false, error: 'Sheet_Production not found' };

    const headers = prodSh.getRange(1, 1, 1, prodSh.getLastColumn()).getValues()[0].map(h => String(h).trim());

    // หาตำแหน่งคอลัมน์ใหม่
    const pvIdx   = headers.indexOf('PV_Out') + 1;
    const expIdx  = headers.indexOf('Export_Grid') + 1;
    const consIdx = headers.indexOf('Consumption') + 1;
    const refIdx  = headers.indexOf('RefCode') + 1; // เก็บค่า AssetCode จริง (namespace เดียวกับ allowedAssets)

    // เช็คสิทธิ์โครงการของทุกแถวก่อนเขียนจริง — ปฏิเสธทั้ง batch ถ้ามีแถวไหนอยู่นอกสิทธิ์
    if (access.projectScope !== 'all') {
      if (refIdx === 0) return { ok: false, error: 'ไม่พบคอลัมน์ RefCode สำหรับตรวจสิทธิ์โครงการ' };
      for (const u of updates) {
        const ref = String(prodSh.getRange(u.rowNum, refIdx).getValue() || '').trim();
        if ((allowedAssets || []).indexOf(ref) === -1) {
          return { ok: false, error: 'ไม่มีสิทธิ์แก้ไขโครงการนี้ (แถว ' + u.rowNum + ')' };
        }
      }
    }

    let saved = 0;
    updates.forEach(u => {
      const pvVal   = u.pvOut === null ? '' : Number(u.pvOut);
      const expVal  = u.exportGrid === null ? '' : Number(u.exportGrid);
      const consVal = u.consumption === null ? '' : Number(u.consumption);
 
      if (pvIdx > 0) prodSh.getRange(u.rowNum, pvIdx).setValue(pvVal);
      if (expIdx > 0) prodSh.getRange(u.rowNum, expIdx).setValue(expVal);
      if (consIdx > 0) prodSh.getRange(u.rowNum, consIdx).setValue(consVal);
 
      saved++;
    });
 
    SpreadsheetApp.flush();
    return { ok: true, saved };
  } catch(e) {
    return { ok: false, error: e.toString() };
  }
}
 
// ════════════════════════════════════════════════════════════
// PORTAL — สิทธิ์ระดับโครงการ
// ════════════════════════════════════════════════════════════
// getProjects() คืนทั้ง refCode (=AssetCode, join key จริงที่ทุกฟังก์ชันด้านล่างใช้
// เช่น NB230004.1) และ budgetCode (=RefCode จาก ERP เช่น NB230004 รหัสเดียวกับที่
// Project List/Finance ใช้) — Hub อาจให้สิทธิ์ผู้ใช้มาเป็นรหัสแบบใดแบบหนึ่งก็ได้
// จึงต้องเทียบกับทั้งสองคอลัมน์
function filterProjectsByAccess(rows, access) {
  if (!access || !access.ok) return [];
  if (access.projectScope === 'all') return rows;
  return rows.filter(function (p) {
    return canSeeProject(access, p.refCode) || canSeeProject(access, p.budgetCode);
  });
}
function buildAllowedAssets(access) {
  if (!access || !access.ok || access.projectScope === 'all') return null; // null = ไม่จำกัด
  return filterProjectsByAccess(getProjects(), access).map(function (p) { return p.refCode; });
}
// ใช้กับ action ที่รับ refCode เดี่ยว (หรือ 'all'/ว่าง = ภาพรวมทุกโครงการ)
function requireAssetOrPortfolio(access, allowedAssets, refCode) {
  if (access.projectScope === 'all') return; // เห็นทุกอย่างอยู่แล้ว
  if (!refCode || refCode === 'all') {
    throw new Error('ไม่มีสิทธิ์ดูภาพรวมทุกโครงการ (Portfolio View) — เลือกโครงการที่ได้รับสิทธิ์แทน');
  }
  if ((allowedAssets || []).indexOf(refCode) === -1) {
    throw new Error('ไม่มีสิทธิ์ดูโครงการนี้');
  }
}
// ใช้กับ action ที่เป็นภาพรวมทุกโครงการเสมอ ไม่มี refCode ให้เลือก
function requirePortfolioAccess(access) {
  if (access.projectScope !== 'all') {
    throw new Error('ไม่มีสิทธิ์ดูภาพรวมทุกโครงการ (Portfolio View)');
  }
}
function requireAdmin(access) {
  if (!isAdminish(access)) throw new Error('เฉพาะ admin/manager เท่านั้น');
}

// ════════════════════════════════════════════════════════════
// DISPATCHER
// ════════════════════════════════════════════════════════════
function dispatch(action, params) {
  try {
    params = params || {};
    const access = portalAccessForCall(params.portalToken, PORTAL_MENU_ID);
    if (!access.ok) return { error: access.message || 'ไม่มีสิทธิ์เข้าถึงข้อมูลนี้' };
    const allowedAssets = buildAllowedAssets(access); // null = ทุกโครงการ

    Logger.log('dispatch: ' + action + ' params: ' + JSON.stringify(params));
    let result;
    switch (action) {
      case 'getProjects'   : result = filterProjectsByAccess(getProjects(), access);      break;
      case 'getYears'      : requireAssetOrPortfolio(access, allowedAssets, params.refCode);
                              result = getYears(params.refCode);                          break;
      case 'getPanel1'     : requireAssetOrPortfolio(access, allowedAssets, params.refCode);
                              result = getPanel1(params);                                 break;
      case 'getPanel2'     : requireAssetOrPortfolio(access, allowedAssets, params.refCode);
                              result = getPanel2(params.refCode, params.year);            break;
      case 'getPanel3'     : requireAssetOrPortfolio(access, allowedAssets, params.refCode);
                              result = getPanel3(params.refCode);                         break;
      case 'getActualRows' : requireAssetOrPortfolio(access, allowedAssets, params.refCode);
                              result = getActualRows(params.refCode);                     break;
      case 'saveActual'    : result = saveActual(access, allowedAssets, params.updates); _invalidatePortfolioCache_(); break;
      case 'addProject'    : requireAdmin(access); result = addProject(params); _invalidatePortfolioCache_(); break;
      case 'dispatch_recalc'  : requireAdmin(access); result = recalcOnly(); _invalidatePortfolioCache_(); break;
      case 'getHomepageData'  : requirePortfolioAccess(access); result = _cachedPortfolio_('solarHomepageData', 120, getHomepageData); break;
      case 'getGroupSummary'  : requirePortfolioAccess(access); result = getGroupSummary(params); break;
      case 'getGroupBudget'   : requirePortfolioAccess(access); result = getGroupBudget(params); break;
      case 'getGroupMeters'   : requirePortfolioAccess(access); result = getGroupMeters(params); break;
      case 'getProduction'    : requireAssetOrPortfolio(access, allowedAssets, params.refCode);
                                 result = getProduction(params.refCode, params.year);      break;
      case 'getPortfolioProduction': requirePortfolioAccess(access); result = _cachedPortfolio_('solarPortfolioProduction', 120, getPortfolioProduction); break;
      case 'initProductionPlan'    : requireAdmin(access); initProductionPlan(); result = {ok:true}; _invalidatePortfolioCache_(); break;
      case 'getProductionRows': requireAssetOrPortfolio(access, allowedAssets, params.refCode);
                                 result = getProductionRows(params.refCode, params.year);  break;
      case 'saveProduction'   : result = saveProduction(access, allowedAssets, params.updates); _invalidatePortfolioCache_(); break;
      case 'getInstallmentData': requireAssetOrPortfolio(access, allowedAssets, params.refCode);
                                  result = getInstallmentData(params.refCode);             break;
      case 'getBillingChartData': requireAssetOrPortfolio(access, allowedAssets, params.refCode);
                                   result = getBillingChartData(params);                   break;
      case 'getInstallmentsForMonth': requireAssetOrPortfolio(access, allowedAssets, params.refCode);
                                       result = getInstallmentsForMonth(params);           break;
      default              : result = { error: 'Unknown action: ' + action };

    }
    return JSON.parse(JSON.stringify(result));
  } catch(e) {
    Logger.log('dispatch ERROR: ' + e.toString());
    return { error: e.toString() };
  }
}
 
// ════════════════════════════════════════════════════════════
// DEBUG
// ════════════════════════════════════════════════════════════
function debugAllBE() {
  const ss = _ss_();
  const bkSh = ss.getSheetByName('Breakeven_Calc');
  const prSh = ss.getSheetByName('Projects');
 
  const bkHdr  = bkSh.getRange(3,1,1,bkSh.getLastColumn()).getValues()[0].map(h=>String(h).trim());
  const bkRefI = bkHdr.indexOf('RefCode');
  const bkYMI  = bkHdr.indexOf('YearMonth');
  const bkYrI  = bkHdr.findIndex(h=>h.startsWith('Year'));
  const bkCumPI= bkHdr.findIndex(h=>h==='CumPlan (THB)');
  const bkCumAI= bkHdr.findIndex(h=>h==='CumActual (THB)');
  const bkBEPI = bkHdr.findIndex(h=>h.startsWith('BE Plan'));
  const bkBEAI = bkHdr.findIndex(h=>h.startsWith('BE Actual'));
  const bkCapI = bkHdr.findIndex(h=>h.startsWith('Investment'));
 
  const bkData = bkSh.getRange(4,1,bkSh.getLastRow()-3,bkSh.getLastColumn()).getValues();
 
  // Investment from Projects
  const investmentMap = {};
  const ph = prSh.getRange(2,1,1,prSh.getLastColumn()).getValues()[0].map(h=>String(h).trim());
  const pr = ph.indexOf('RefCode'), pc = ph.findIndex(h=>h.startsWith('Investment'));
  prSh.getRange(3,1,prSh.getLastRow()-2,prSh.getLastColumn()).getValues()
    .forEach(r=>{ if(r[pr]) investmentMap[String(r[pr]).trim()] = Number(r[pc]||0); });
 
  // Summary per refCode
  const stats = {};
  for (let i=0;i<bkData.length;i++) {
    const ref  = String(bkData[i][bkRefI]||'').trim();
    const ym   = String(bkData[i][bkYMI ]||'').trim();
    const yr   = Number(bkData[i][bkYrI ]||0);
    const cumP = Number(bkData[i][bkCumPI]||0);
    const cumA = Number(bkData[i][bkCumAI]||0);
    const beP  = String(bkData[i][bkBEPI ]||'');
    const beA  = String(bkData[i][bkBEAI ]||'');
    const cap  = bkCapI>=0 ? bkData[i][bkCapI] : null;  // Check if formula or number
 
    if (!ref) continue;
    if (!stats[ref]) stats[ref] = { bePlanYM:null, breakevenPlanYr:null, beActYM:null, maxCumP:0, maxCumA:0, investmentInSheet:null };
    if (cumP > stats[ref].maxCumP) stats[ref].maxCumP = cumP;
    if (cumA > stats[ref].maxCumA) stats[ref].maxCumA = cumA;
    if (beP === 'BREAKEVEN') { stats[ref].bePlanYM = ym; stats[ref].breakevenPlanYr = yr; }
    if (beA === 'BREAKEVEN') { stats[ref].beActYM  = ym; }
    if (stats[ref].investmentInSheet === null) stats[ref].investmentInSheet = cap; // Store first value
  }
 
  Logger.log('=== All Breakeven Status ===');
  Logger.log('Headers: '+bkHdr.join(' | '));
  Logger.log('');
  Object.keys(stats).forEach(ref => {
    const s   = stats[ref];
    const inv = investmentMap[ref] || 0;
    Logger.log(ref);
    Logger.log('  Investment (Projects): '+Math.round(inv).toLocaleString());
    Logger.log('  Investment (BK sheet first row): '+s.investmentInSheet+' ← if formula, might be incorrect');
    Logger.log('  MaxCumPlan:   '+Math.round(s.maxCumP).toLocaleString());
    Logger.log('  MaxCumActual: '+Math.round(s.maxCumA).toLocaleString());
    Logger.log('  BE Plan?  YM='+s.bePlanYM+' Yr='+s.breakevenPlanYr);
    Logger.log('  BE Actual? YM='+s.beActYM);
    Logger.log('  Plan reachable: '+(s.maxCumP >= inv ? 'YES' : 'NO ('+Math.round(inv-s.maxCumP).toLocaleString()+' short)'));
    Logger.log('');
  });
}
 
function debugProduction() {
  const ss = _ss_();
  const prodSh = ss.getSheetByName('Sheet_Production');
  
  // Show header
  const headers = prodSh.getRange(1, 1, 1, prodSh.getLastColumn()).getValues()[0];
  Logger.log('Headers: ' + JSON.stringify(headers));
  
  // Show first 3 rows
  const rows = prodSh.getRange(2, 1, 3, prodSh.getLastColumn()).getValues();
  rows.forEach((r, i) => Logger.log('Row '+(i+2)+': ' + JSON.stringify(r)));
  
  // View lastRow
  Logger.log('LastRow: ' + prodSh.getLastRow());
}
 
function debugKwhPlan() {
  const ss = _ss_();
  const prodSh = ss.getSheetByName('Sheet_Production');
  const projRows = _sheetToObjects(SH.PROJECTS);
 
  // Build maps
  const startYearMap = {}, kwpMap = {};
  projRows.forEach(proj => {
    const ref     = _val(proj, 'RefCode');
    const startYM = safe(_val(proj, 'StartYM', 'StartYearMonth'));
    const kwp     = Number(_val(proj, 'kWp') || 0);
    if (ref && startYM) startYearMap[ref] = parseInt(startYM.slice(0, 4));
    if (ref && kwp)     kwpMap[ref]       = kwp;
  });
 
  // Check first 5 rows
  const headers = prodSh.getRange(1, 1, 1, prodSh.getLastColumn()).getValues()[0]
                        .map(h => String(h).trim());
  const refIdx = headers.indexOf('RefCode');
  const ymIdx  = headers.indexOf('YearMonth');
  const data   = prodSh.getRange(2, 1, 5, headers.length).getValues();
 
  data.forEach((row, i) => {
    const ref  = String(row[refIdx] || '').trim();
    const ymRaw = row[ymIdx];
    const ym   = ymRaw instanceof Date
                 ? ymRaw.getFullYear() + '-' + String(ymRaw.getMonth()+1).padStart(2,'0')
                 : String(ymRaw).trim().slice(0,7);
 
    const kwp       = kwpMap[ref] || 0;
    const startYear = startYearMap[ref] || 0;
    const calYear   = parseInt(ym.slice(0,4));
    const calMonth  = parseInt(ym.slice(5,7));
    const contractYear = calYear - startYear + 1;
    const degradation  = 1 - DEGRADATION_RATE * (contractYear - 1);
    const plan = calcKwhPlan(kwp, contractYear, calMonth);
 
    Logger.log(`Row${i+2}: ref=${ref} ym=${ym} startYear=${startYear} contractYear=${contractYear} degradation=${degradation.toFixed(4)} plan=${plan}`);
  });
}
 
// ============================================================
// UTILITY: คำนวณชีต FeasPlan ใหม่ทั้งหมด (รันครั้งเดียว)
// ============================================================
function rebuildFeasPlanAll() {
  const ss = _ss_();
  const fpSh = ss.getSheetByName(SH.FEAS_PLAN);
  if (!fpSh) { Logger.log('Sheet FeasPlan not found'); return; }
  
  const lastRow = fpSh.getLastRow();
  const lastCol = fpSh.getLastColumn();
  const data = fpSh.getRange(1, 1, Math.min(lastRow, 20), lastCol).getValues(); 
  
  // 1. ค้นหาแถวที่เป็น Header จริงๆ (ที่มีคำว่า RefCode)
  let headerRowIndex = -1;
  for (let i = 0; i < data.length; i++) {
    if (data[i].includes('RefCode')) {
      headerRowIndex = i;
      break;
    }
  }
  
  if (headerRowIndex === -1) {
    Logger.log('ไม่พบคำว่า RefCode ใน 20 แถวแรกของชีต FeasPlan');
    return;
  }
  
  // 2. ดึง Header และข้อมูล
  const headers = data[headerRowIndex].map(String);
  const idx = {
    ref: headers.indexOf('RefCode'),
    avg: headers.indexOf('FeasAVG (THB/mo)'),
    plan: headers.indexOf('FeasPlan (THB)'),
    mo: headers.indexOf('MonthNo')
  };
  
  if (idx.ref === -1 || idx.plan === -1 || idx.avg === -1) {
    Logger.log('หาชื่อคอลัมน์ไม่พบ: โปรดตรวจสอบว่ามีคอลัมน์ RefCode, FeasAVG (THB/mo), FeasPlan (THB)');
    return;
  }
  
  // 3. เริ่มวนลูปคำนวณตั้งแต่อ่านแถวถัดจาก Header
  const numRows = lastRow - (headerRowIndex + 1);
  if (numRows <= 0) return;
  
  const rows = fpSh.getRange(headerRowIndex + 2, 1, numRows, lastCol).getValues();
  const updates = [];
  
  for (let i = 0; i < rows.length; i++) {
    const refCode = String(rows[i][idx.ref] || '').trim();
    const monthNo = Number(rows[i][idx.mo] || 1);
    const feasAvg = Number(rows[i][idx.avg] || 0);
    
    // คำนวณ (ใช้ Multiplier จากชีต Config)
    const mult = getMultiplier(refCode, monthNo);
    updates.push([feasAvg * mult]);
  }
  
  // 4. เขียนทับลงไป
  fpSh.getRange(headerRowIndex + 2, idx.plan + 1, updates.length, 1).setValues(updates);
  SpreadsheetApp.flush();
  
  Logger.log('rebuildFeasPlanAll: อัปเดตสำเร็จ ' + updates.length + ' แถว');
  
  // เรียกคำนวณ Breakeven ต่อทันที
  if (typeof dispatch_recalc === 'function') dispatch_recalc();
}
 
// ════════════════════════════════════════════════════════════
// ฟังก์ชันเสริม: ปรับฟอร์แมต YearMonth ให้เป็นข้อความ "YYYY-MM" เสมอ ป้องกันปัญหา Date Object
// ════════════════════════════════════════════════════════════
function cleanYM(val) {
  if (!val) return '';
  if (val instanceof Date) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    return y + '-' + m;
  }
  const s = String(val).trim();
  const match = s.match(/^(\d{4})[-/](\d{1,2})/);
  if (match) {
    return match[1] + '-' + match[2].padStart(2, '0');
  }
  return s;
}
 
function debugProjectData() {
  var targetRef = 'NB230001'; // ⚠️ เปลี่ยนเป็น RefCode ตัวที่มีปัญหา
  
  var ss = _ss_();
  var prodSh = ss.getSheetByName('Sheet_Production');
  var projSh = ss.getSheetByName('Sheet_Projects'); // หรือชื่อชีตโครงการของคุณ
  
  Logger.log("=== เริ่มตรวจสอบโครงการ: " + targetRef + " ===");
  
  // 1. ตรวจสอบในชีตโครงการ
  if (projSh) {
    var projData = projSh.getDataRange().getValues();
    var foundProj = projData.find(r => String(r[0]).trim() === targetRef || String(r[1]).trim() === targetRef); // ปรับ Index ตามคอลัมน์ RefCode
    if (foundProj) {
      Logger.log("พบโครงการในชีตหลัก! ข้อมูลแถว: " + JSON.stringify(foundProj));
    } else {
      Logger.log("❌ ไม่พบ RefCode นี้ในชีตโครงการหลัก กรุณาเช็กตัวสะกดหรือช่องว่าง");
    }
  }
 
  // 2. ตรวจสอบใน Sheet_Production
  if (prodSh) {
    var data = prodSh.getDataRange().getValues();
    var headers = data[0].map(h => String(h).trim());
    var refIdx = headers.indexOf('RefCode');
    var ymIdx = headers.indexOf('YearMonth');
    
    var matchCount = 0;
    var yearsFound = [];
    
    for (var i = 1; i < data.length; i++) {
      var rowRef = String(data[i][refIdx]).trim();
      if (rowRef === targetRef) {
        matchCount++;
        var ymVal = data[i][ymIdx];
        yearsFound.push(ymVal);
      }
    }
    
    Logger.log("พบข้อมูลใน Sheet_Production ทั้งหมด: " + matchCount + " แถว");
    if (matchCount > 0) {
      Logger.log("ตัวอย่างข้อมูลวันที่ที่เจอ (5 แถวแรก): " + JSON.stringify(yearsFound.slice(0, 5)));
    } else {
      Logger.log("❌ 0 แถว! ชีต Production ไม่มีข้อมูลที่ตรงกับ RefCode นี้เลย (อาจมีช่องว่างพิมพ์เกินในชีต)");
    }
  }
}
 
// IRR //
function recalcIRRSheet(planBEMonthMap, actualBEMonthMap) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  planBEMonthMap = planBEMonthMap || {};
  actualBEMonthMap = actualBEMonthMap || {};
  
  const pSh = ss.getSheetByName("Projects");
  if (!pSh) return;
  const pData = pSh.getDataRange().getValues();
  const pHdr = pData[0].map(h => String(h).trim());
  
  // Must key by AssetCode (join key) — Breakeven_Calc's "RefCode" column holds AssetCode values,
  // not the Projects budget RefCode (e.g. NB230004 vs NB230004.1)
  const refI = pHdr.indexOf("AssetCode");
  const grpI = pHdr.indexOf("ProjectGroup");
  const nameI = pHdr.indexOf("ContractName");
  const invI = pHdr.findIndex(h => h.includes("Investment"));
  const irrI = pHdr.findIndex(h => h.includes("IRR"));
  const yrI = pHdr.findIndex(h => h.includes("ContractYr"));
  const startYMI = pHdr.findIndex(h => h.toLowerCase().includes("startym") || h.toLowerCase().includes("startyearmonth"));
  
  const projMeta = {};
  let minTimelineYear = 9999;
  let maxTimelineYear = 0;
  
  for (let i = 1; i < pData.length; i++) {
    const ref = String(pData[i][refI]).trim();
    if (!ref || ref === "RefCode") continue;
    
    let irrRaw = pData[i][irrI];
    let irrVal = 0;
    if (String(irrRaw).includes("%")) {
      irrVal = parseFloat(String(irrRaw).replace(/%/g, "")) / 100;
    } else {
      irrVal = Number(irrRaw) || 0;
    }
    
    const cYr = Number(pData[i][yrI]) || 20;
    let startYM = cleanYM(pData[i][startYMI]);
    let startYear = new Date().getFullYear(); 
    if (startYM && startYM.length >= 4) {
      let match = startYM.match(/^(\d{4})/);
      if (match) startYear = parseInt(match[1]);
    }
    
    let investYear = startYear - 1;
    let endYear = startYear + cYr - 1;
    
    if (investYear < minTimelineYear) minTimelineYear = investYear;
    if (endYear > maxTimelineYear) maxTimelineYear = endYear;
    
    projMeta[ref] = {
      group: pData[i][grpI] || "",
      name: pData[i][nameI] || "",
      investment: Number(String(pData[i][invI]).replace(/,/g, "")) || 0,
      feasIRR: irrVal,
      contractYr: cYr,
      startYear: startYear,
      investYear: investYear,
      endYear: endYear,
      cashFlows: {} 
    };
  }
  
  if (minTimelineYear === 9999) { minTimelineYear = 2022; maxTimelineYear = 2045; }
  
  const bkSh = ss.getSheetByName("Breakeven_Calc");
  if (!bkSh) return;
  const bkData = bkSh.getDataRange().getValues();
  
  let bkHdrRow = 1;
  for (let i = 0; i < Math.min(5, bkData.length); i++) {
    if (bkData[i].map(h => String(h).trim()).indexOf('RefCode') >= 0) { bkHdrRow = i + 1; break; }
  }
  
  const bkHdr = bkData[bkHdrRow - 1].map(h => String(h).trim());
  const bkRefI = bkHdr.indexOf('RefCode');
  const bkYrI = bkHdr.findIndex(h => h.includes('Year (Y)'));
  const bkActPI = bkHdr.findIndex(h => h.includes('Actual (Calc)') || h.includes('ActualCalc') || h.includes('ActualProj'));
  
  for (let i = bkHdrRow; i < bkData.length; i++) {
    const ref = String(bkData[i][bkRefI]).trim();
    const yr = Number(bkData[i][bkYrI]) || 1;
    const actCalc = Number(String(bkData[i][bkActPI] || "0").replace(/,/g, "")) || 0;
    
    if (projMeta[ref]) {
      if (!projMeta[ref].cashFlows[yr]) projMeta[ref].cashFlows[yr] = 0;
      projMeta[ref].cashFlows[yr] += actCalc;
    }
  }
  
  let irrSh = ss.getSheetByName("Sheet_IRR");
  if (!irrSh) {
    irrSh = ss.insertSheet("Sheet_IRR");
  } else {
    irrSh.clear();
  }
  
  // 🌟 ปรับเปลี่ยนหัวตารางจุดคุ้มทุนระบุชัดเจนระดับเดือน (Plan BE Month / Projected BE Month)
  const headers = ["RefCode", "ProjectGroup", "ContractName", "Investment (THB)", "Original Feas IRR", "ActualCalc IRR (New)", "IRR Variance", "Plan BE Month", "Projected BE Month"];
  for (let y = minTimelineYear; y <= maxTimelineYear; y++) {
    headers.push(String(y));
  }
  irrSh.appendRow(headers);
  
  const rowsToWrite = [];
  const refs = Object.keys(projMeta).sort();
  
  refs.forEach(ref => {
    const p = projMeta[ref];
    let contractEndYear = p.startYear + p.contractYr - 1;
    
    let planBeVal = planBEMonthMap[ref] || "N/A";
    let actBeVal = actualBEMonthMap[ref] || "N/A";
    
    // ตรวจสอบและแสดงป้ายกำกับกรณีการคืนทุนจริงหลุดปีสัญญา
    if (actBeVal !== "N/A" && !actBeVal.includes("ไม่คุ้มทุน")) {
      let match = actBeVal.match(/^(\d{4})/);
      if (match) {
        let actBeYear = parseInt(match[1]);
        if (actBeYear > contractEndYear) {
          actBeVal = actBeVal + " (เกินอายุสัญญา)";
        }
      }
    }
    
    const row = [
      ref,
      p.group,
      p.name,
      p.investment,
      p.feasIRR,
      "", 
      "", 
      planBeVal,
      actBeVal
    ];
    
    for (let y = minTimelineYear; y <= maxTimelineYear; y++) {
      if (y === p.investYear) {
        row.push(-p.investment);
      } else if (y >= p.startYear && y <= p.endYear) {
        const projYrIndex = y - p.startYear + 1;
        row.push(Math.round(p.cashFlows[projYrIndex] || 0));
      } else {
        row.push(0);
      }
    }
    rowsToWrite.push(row);
  });
  
  if (rowsToWrite.length > 0) {
    irrSh.getRange(2, 1, rowsToWrite.length, headers.length).setValues(rowsToWrite);
    
    for (let idx = 0; idx < rowsToWrite.length; idx++) {
      const rowNum = idx + 2;
      const p = projMeta[refs[idx]];
      
      const startColLetter = getColumnLetter_(10 + (p.investYear - minTimelineYear));
      const endColLetter = getColumnLetter_(10 + (p.endYear - minTimelineYear));
      
      const irrFormula = `=IFERROR(IRR(${startColLetter}${rowNum}:${endColLetter}${rowNum}), "N/A")`;
      const varFormula = `=IF(ISNUMBER(F${rowNum}), F${rowNum}-E${rowNum}, "")`;
      
      irrSh.getRange(rowNum, 6).setFormula(irrFormula);
      irrSh.getRange(rowNum, 7).setFormula(varFormula);
    }
    
    irrSh.getRange(2, 4, rowsToWrite.length, 1).setNumberFormat("#,##0"); 
    irrSh.getRange(2, 5, rowsToWrite.length, 3).setNumberFormat("0.00%"); 
    irrSh.getRange(2, 8, rowsToWrite.length, 2).setHorizontalAlignment("center"); 
    irrSh.getRange(2, 10, rowsToWrite.length, (maxTimelineYear - minTimelineYear) + 1).setNumberFormat("#,##0"); 
    
    irrSh.getRange(1, 1, 1, headers.length)
         .setBackground("#D62828")
         .setFontColor("#FFFFFF")
         .setFontWeight("bold")
         .setHorizontalAlignment("center");
         
    irrSh.autoResizeColumns(1, headers.length);
  }
}
 
function getColumnLetter_(colNum) {
  let letter = "";
  while (colNum > 0) {
    let temp = (colNum - 1) % 26;
    letter = String.fromCharCode(65 + temp) + letter;
    colNum = Math.floor((colNum - temp) / 26);
  }
  return letter;
}
 
// Sum FeasPlan (Feasibility) monthly values, per AssetCode, keyed by YearMonth ("YYYY-MM")
function _getFeasPlanByAssetCode_() {
  const rows = _sheetToObjects(SH.FEAS_PLAN);
  const map = {}; // ref -> { 'YYYY-MM': value }
  rows.forEach(r => {
    const ref = _val(r, 'RefCode'); // FeasPlan's "RefCode" column holds AssetCode values
    const ym = safe(_val(r, 'YearMonth'));
    const v = Number(_val(r, 'FeasPlan (THB)', 'FeasPlan')) || 0;
    if (!ref || !ym) return;
    if (!map[ref]) map[ref] = {};
    map[ref][ym] = (map[ref][ym] || 0) + v;
  });
  return map;
}
 
// Return every "YYYY-MM" month string spanned by [startDate, endDate] inclusive
function _monthsInRange_(startDate, endDate) {
  const months = [];
  if (!startDate || !endDate) return months;
  let y = startDate.getFullYear(), m = startDate.getMonth();
  const endY = endDate.getFullYear(), endM = endDate.getMonth();
  let guard = 0;
  while ((y < endY || (y === endY && m <= endM)) && guard < 1200) {
    months.push(y + '-' + String(m + 1).padStart(2, '0'));
    m++;
    if (m > 11) { m = 0; y++; }
    guard++;
  }
  return months;
}

// Sum FeasPlan values for a given AssetCode across all months spanned by [startDate, endDate] inclusive
function _sumFeasForPeriod_(feasByRef, ref, startDate, endDate) {
  if (!feasByRef[ref]) return 0;
  return _monthsInRange_(startDate, endDate).reduce((sum, ym) => sum + (feasByRef[ref][ym] || 0), 0);
}
 
function getInstallmentData(filterRef) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName("Sheet_FinancialPlan");
  if (!sh) return { collections: [], billings: [], details: [] };
  
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return { collections: [], billings: [], details: [] };
  
  const hdrs = data[0].map(h => String(h).trim());
  const idx = {
    ref: hdrs.indexOf("RefCode"), name: hdrs.indexOf("ProjectName"), inst: hdrs.indexOf("Installment"),
    wpStart: hdrs.indexOf("WorkPeriodStart"), wpEnd: hdrs.indexOf("WorkPeriodEnd"),
    bPlanD: hdrs.indexOf("BillingPlanDate"), bPlanV: hdrs.indexOf("BillingPlanValue"),
    bActD: hdrs.indexOf("BillingActualDate"), bActV: hdrs.indexOf("BillingActualValue"),
    cPlanD: hdrs.indexOf("CashInPlanDate"), cActD: hdrs.indexOf("CashInDate"), cActV: hdrs.indexOf("CashInValue"),
    invoice: hdrs.indexOf("InvoiceNo") // 🌟 ปรับตามโครงสร้างคอลัมน์ใหม่
  };
  
  const collections = []; const billings = []; const details = [];
  const nextBillingByRef = {}; // refCode -> soonest not-yet-billed installment
  const feasByRef = _getFeasPlanByAssetCode_(); // for Installment Detail's "Billing Plan Value" (uses Feas, not Sheet_FinancialPlan's BillingPlanValue)
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  function fmtDt(d) {
    if (!d || !(d instanceof Date)) return "";
    const m = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return d.getDate() + " " + m[d.getMonth()] + " " + String(d.getFullYear()).slice(-2);
  }
  
  // Verified via debugRefCodeIntegrity: Sheet_FinancialPlan.RefCode holds AssetCode values
  // directly (NB230004.1, NB230004.2, ...) — the SAME join key as Projects.AssetCode used
  // elsewhere on this dashboard. Filter strictly; do not fall back to showing all projects.
  const scopeRef = (filterRef && filterRef !== "all") ? filterRef : null;
 
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const ref = String(row[idx.ref]).trim();
    if (!ref || row[0] === "") continue;
    if (scopeRef && ref !== scopeRef) continue;
    
    const pName = row[idx.name] || "";
    const inst = row[idx.inst] || "";
    const wpS = row[idx.wpStart] instanceof Date ? row[idx.wpStart] : null;
    const wpE = row[idx.wpEnd] instanceof Date ? row[idx.wpEnd] : null;
    const bPlanD = row[idx.bPlanD] instanceof Date ? row[idx.bPlanD] : null;
    const bPlanV = Number(row[idx.bPlanV]) || 0;
    const bActD = row[idx.bActD] instanceof Date ? row[idx.bActD] : null;
    const bActV = row[idx.bActV] !== "" ? Number(row[idx.bActV]) : null;
    const cPlanD = row[idx.cPlanD] instanceof Date ? row[idx.cPlanD] : null;
    const cActD = row[idx.cActD] instanceof Date ? row[idx.cActD] : null;
    const cActV = row[idx.cActV] !== "" ? Number(row[idx.cActV]) : null;
    const invoiceNo = row[idx.invoice] || ""; // 🌟 ดึงข้อมูลเลขที่ Invoice
    
    const wpStr = (wpS && wpE) ? `${wpS.getDate()} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][wpS.getMonth()]} ${String(wpS.getFullYear()).slice(-2)} - ${wpE.getDate()} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][wpE.getMonth()]} ${String(wpE.getFullYear()).slice(-2)}` : "—";
    
    const feasPlanValue = _sumFeasForPeriod_(feasByRef, ref, wpS, wpE);
    details.push({
      refCode: ref, installment: inst, workPeriod: wpStr,
      bPlanDate: fmtDt(bPlanD), bPlanValue: feasPlanValue,
      bActualDate: fmtDt(bActD), bActualValue: bActV,
      cPlanDate: fmtDt(cPlanD), cActualDate: fmtDt(cActD), cActualValue: cActV
    });
    
    if (bActD && !cActD) {
      const due = cPlanD ? new Date(cPlanD.getFullYear(), cPlanD.getMonth(), cPlanD.getDate()) : today;
      const diffTime = due.getTime() - today.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      
      collections.push({
        refCode: ref, projectName: pName, installment: inst,
        period: wpStr, dateLabel: fmtDt(due), invoiceNo: invoiceNo, // 🌟 ส่งต่อให้กับ UI กรงนี้
        value: (bActV != null ? bActV : 0), // ← ใช้ BillingActualValue จริง แทน FeasPlan (ยอดที่ตั้งบิลไปแล้วรอเก็บเงิน)
        days: Math.abs(diffDays), isOverdue: diffDays < 0
      });
    }
    
    if (!bActD) {
      const plan = bPlanD ? new Date(bPlanD.getFullYear(), bPlanD.getMonth(), bPlanD.getDate()) : today;
      const diffTime = plan.getTime() - today.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      const candidate = {
        refCode: ref, projectName: pName, installment: inst,
        period: wpStr, dateLabel: fmtDt(plan), value: feasPlanValue,
        days: Math.abs(diffDays), isOverdue: diffDays < 0,
        _planTime: plan.getTime()
      };
      // Keep only the soonest not-yet-billed installment per project ("next up to invoice")
      if (!nextBillingByRef[ref] || candidate._planTime < nextBillingByRef[ref]._planTime) {
        nextBillingByRef[ref] = candidate;
      }
    }
  }
  Object.values(nextBillingByRef)
    .sort((a, b) => a._planTime - b._planTime)
    .forEach(c => { delete c._planTime; billings.push(c); });
  return JSON.parse(JSON.stringify({ collections, billings, details }));
}
 
// ════════════════════════════════════════════════════════════
// BILLING & COLLECTION CHART — monthly aggregate + per-month drilldown
// (Sheet_FinancialPlan.RefCode holds AssetCode values directly — verified via
//  debugRefCodeIntegrity — so it is the SAME join key as Projects.AssetCode used
//  by the solar panels elsewhere. Filter strictly by AssetCode; do not fall back
//  to showing all installments when a project has none.)
// ════════════════════════════════════════════════════════════
function _readFinancialPlanRows_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName("Sheet_FinancialPlan");
  if (!sh) return [];
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return [];
  const hdrs = data[0].map(h => String(h).trim());
  const idx = {
    ref: hdrs.indexOf("RefCode"), name: hdrs.indexOf("ProjectName"), inst: hdrs.indexOf("Installment"),
    wpStart: hdrs.indexOf("WorkPeriodStart"), wpEnd: hdrs.indexOf("WorkPeriodEnd"),
    bPlanD: hdrs.indexOf("BillingPlanDate"), bPlanV: hdrs.indexOf("BillingPlanValue"),
    bActD: hdrs.indexOf("BillingActualDate"), bActV: hdrs.indexOf("BillingActualValue"),
    cPlanD: hdrs.indexOf("CashInPlanDate"), cActD: hdrs.indexOf("CashInDate"), cActV: hdrs.indexOf("CashInValue"),
    invoice: hdrs.indexOf("InvoiceNo")
  };
  const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  function fmtDt(d) { return (d instanceof Date) ? (d.getDate() + " " + MON[d.getMonth()] + " " + String(d.getFullYear()).slice(-2)) : ""; }
  function ymOf(d) { return (d instanceof Date) ? (d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,'0')) : null; }
 
  const feasByRef = _getFeasPlanByAssetCode_();
 
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const ref = String(row[idx.ref] || "").trim();
    if (!ref) continue;
 
    const wpS = row[idx.wpStart] instanceof Date ? row[idx.wpStart] : null;
    const wpE = row[idx.wpEnd] instanceof Date ? row[idx.wpEnd] : null;
    
    // 🛑 คืนค่าเดิม: ดึงค่า Billing Plan จากชีตตรงๆ เพื่อไม่ให้กราฟแท่งหลักเพี้ยน
    const bPlanV = Number(row[idx.bPlanV]) || 0; 
    
    // ✅ แยกคำนวณ Feas ล่วงหน้าไว้ในตัวแปรใหม่
    const feasPlanValue = _sumFeasForPeriod_(feasByRef, ref, wpS, wpE);
 
    const bPlanD = row[idx.bPlanD] instanceof Date ? row[idx.bPlanD] : null;
    const bActD  = row[idx.bActD] instanceof Date ? row[idx.bActD] : null;
    const bActV  = row[idx.bActV] !== "" && row[idx.bActV] != null ? Number(row[idx.bActV]) : null;
    const cPlanD = row[idx.cPlanD] instanceof Date ? row[idx.cPlanD] : null;
    const cActD  = row[idx.cActD] instanceof Date ? row[idx.cActD] : null;
    const cActV  = row[idx.cActV] !== "" && row[idx.cActV] != null ? Number(row[idx.cActV]) : null;
 
    const wpStr = (wpS && wpE)
      ? `${wpS.getDate()} ${MON[wpS.getMonth()]} ${String(wpS.getFullYear()).slice(-2)} - ${wpE.getDate()} ${MON[wpE.getMonth()]} ${String(wpE.getFullYear()).slice(-2)}`
      : "—";
 
    // billingValComputed = the real invoiced amount: BillingActualValue once billed, otherwise
    // the pre-billing BillingPlanValue estimate. Used both for the Billing bar and as the
    // Cash In target/fallback, since Sheet_FinancialPlan has no separate "Cash In plan value"
    // column and some billed installments have no BillingPlanValue on record at all.
    const billingValComputed = bActD ? (bActV != null ? bActV : bPlanV) : bPlanV;

    rows.push({
      refCode: ref, projectName: row[idx.name] || "", installment: row[idx.inst] || "", workPeriod: wpStr,
      invoiceNo: row[idx.invoice] || "",
      wpS, wpE, // raw Date objects — used to test whether a given YearMonth falls inside this installment's period
      bPlanD, bPlanV, bActD, bActV,
      cPlanD, cActD, cActV,
      billingYM: ymOf(bActD || bPlanD),
      billingVal: billingValComputed,
      billingIsActual: !!bActD,
      billingDateLabel: fmtDt(bActD || bPlanD),
      cashInYM: ymOf(cActD || cPlanD),
      cashInVal: cActD ? (cActV != null ? cActV : billingValComputed) : billingValComputed,
      cashInIsActual: !!cActD,
      cashInDateLabel: fmtDt(cActD || cPlanD),
      bPlanDateLabel: fmtDt(bPlanD), cPlanDateLabel: fmtDt(cPlanD),
      feasPlanValue: feasPlanValue // ส่งตัวแปรแยกต่างหาก (ผลรวมทั้งงวด — ใช้ในตาราง Installment Detail)
    });
  }
  return rows;
}
 
function getBillingChartData(params) {
  params = params || {};
  const filterAssetCode = params.refCode; // ค่าที่เลือกจาก Dashboard (เช่น NB230004.1)
 
  let rows = _readFinancialPlanRows_();
 
  // Sheet_FinancialPlan.RefCode holds AssetCode values directly (verified via
  // debugRefCodeIntegrity — NB230004.1, NB230004.2, ... match Projects.AssetCode 1:1).
  // No mapping through Projects.RefCode (the separate ERP budget code) is needed or correct here.
  if (filterAssetCode && filterAssetCode !== "all") {
    rows = rows.filter(r => r.refCode === filterAssetCode);
  }
 
  const monthMap = {};
  function ensure(ym) {
    if (!ym) return null;
    if (!monthMap[ym]) monthMap[ym] = { ym, billing: 0, cashIn: 0, billingPlan: 0, billingActual: 0, cashInPlan: 0, cashInActual: 0, feasPlan: 0 };
    return monthMap[ym];
  }
 
  // 1. Feas Plan — scoped strictly to each installment's own WorkPeriodStart..WorkPeriodEnd
  //    (Sheet_FinancialPlan: RefCode, Installment, WorkPeriodStart, WorkPeriodEnd), matched
  //    into the FeasPlan sheet's own RefCode + YearMonth + FeasPlan (THB) rows for that exact
  //    month. This ties the visible chart timeline to the project's real billing/installment
  //    schedule (instead of its full, often much longer, O&M contract length), and is the SAME
  //    lookup the drilldown uses — so bar and drilldown always agree.
  const feasByRef = _getFeasPlanByAssetCode_();
  const seenRefMonth = {}; // ref+ym already attributed once, in case installment periods overlap
  rows.forEach(r => {
    _monthsInRange_(r.wpS, r.wpE).forEach(ym => {
      const key = r.refCode + '|' + ym;
      if (seenRefMonth[key]) return;
      seenRefMonth[key] = true;
      const feasVal = (feasByRef[r.refCode] && feasByRef[r.refCode][ym]) || 0;
      if (feasVal) ensure(ym).feasPlan += feasVal;
    });
  });
 
  // 2. Billing / Cash In — as before, keyed by each installment's own billing/cash-in date.
  rows.forEach(r => {
    const bEntry = ensure(r.billingYM);
    if (bEntry) {
      bEntry.billing += (r.billingVal || 0);
      bEntry.billingPlan += (r.bPlanV || 0);
      if (r.billingIsActual) bEntry.billingActual += (r.bActV != null ? r.bActV : r.bPlanV);
    }
    // Sheet_FinancialPlan has no separate "Cash In plan value" column — the target amount to
    // collect is the invoiced amount: BillingActualValue once the installment is actually
    // billed, otherwise the pre-billing BillingPlanValue estimate (same fallback r.billingVal
    // already uses for the Billing bar itself). Using bPlanV directly here was wrong for
    // installments billed without ever having a BillingPlanValue on record (BillingActualValue
    // filled in, BillingPlanValue left blank) — those rows silently contributed 0 to Cash In
    // Plan even though a real CashInPlanDate/amount was expected, which is why some months'
    // Cash In Plan bar went missing despite having outstanding collections.
    const cEntry = ensure(r.cashInYM);
    if (cEntry) {
      cEntry.cashIn += (r.cashInVal || 0);
      cEntry.cashInPlan += (r.billingVal || 0);
      if (r.cashInIsActual) cEntry.cashInActual += (r.cActV != null ? r.cActV : r.billingVal);
    }
  });
 
  const yms = Object.keys(monthMap).sort();
  const chartRows = yms.map(ym => monthMap[ym]);
  return JSON.parse(JSON.stringify({ rows: chartRows }));
}
 
function getInstallmentsForMonth(params) {
  params = params || {};
  const ym = params.ym;
  const metric = params.metric === 'billing' ? 'billing'
               : params.metric === 'cashIn'  ? 'cashIn'
               : 'feasibility'; // was: any non-'billing' value silently became 'cashIn', so
                                 // 'feasibility' clicks were wrongly matched against cashInYM
                                 // and showed the whole-period feasPlanValue instead of this
                                 // one month's figure — root cause of the bar/drilldown mismatch.
  const filterRef = params.refCode; // AssetCode, e.g. NB230004.1 — same namespace as Sheet_FinancialPlan.RefCode
  let rows = _readFinancialPlanRows_();
  if (filterRef && filterRef !== "all") {
    // Strict filter — if this project has no installments this month, return none.
    // (Previously fell back to ALL projects' rows when nothing matched, which is why
    // unrelated months/projects were leaking into the drilldown.)
    rows = rows.filter(r => r.refCode === filterRef);
  }
 
  // ── Feasibility Plan drilldown ────────────────────────────────────────────
  // Matched the same way the Feas bar is built: find which installment's own
  // WorkPeriodStart..WorkPeriodEnd covers this exact month, then look up that project's
  // FeasPlan (THB) for that RefCode+YearMonth directly from the FeasPlan sheet — NOT the
  // whole-period feasPlanValue sum used elsewhere (e.g. Installment Detail table).
  if (metric === 'feasibility') {
    const feasByRef = _getFeasPlanByAssetCode_();
    const seenRef = {}; // one row per project for this month, even if periods overlap
    const out = [];
    rows.forEach(r => {
      if (seenRef[r.refCode]) return;
      if (_monthsInRange_(r.wpS, r.wpE).indexOf(ym) === -1) return; // this installment doesn't cover ym
      seenRef[r.refCode] = true;
      out.push({
        refCode: r.refCode,
        installment: r.installment,
        workPeriod: r.workPeriod,
        feasPlanValue: (feasByRef[r.refCode] && feasByRef[r.refCode][ym]) || 0
      });
    });
    return JSON.parse(JSON.stringify({ rows: out, metric, ym }));
  }
 
  const ymField = metric === 'billing' ? 'billingYM' : 'cashInYM';
  const valField = metric === 'billing' ? 'billingVal' : 'cashInVal';
  const isActualField = metric === 'billing' ? 'billingIsActual' : 'cashInIsActual';
 
  function daysStatus(planD, actD) {
    if (!(planD instanceof Date) || !(actD instanceof Date)) return '';
    const diffDays = Math.round((actD.getTime() - planD.getTime()) / 86400000);
    if (diffDays < 0) return Math.abs(diffDays) + 'd early';
    if (diffDays > 0) return diffDays + 'd late';
    return 'on time';
  }
 
  const out = rows.filter(r => r[ymField] === ym).map(r => {
    const billingStatus = r.billingIsActual ? daysStatus(r.bPlanD, r.bActD) : 'planned';
    const cashInStatus = r.cashInIsActual ? daysStatus(r.cPlanD, r.cActD) : 'planned';
    return {
      refCode: r.refCode, installment: r.installment, workPeriod: r.workPeriod, invoiceNo: r.invoiceNo,
      billingPlanDate: r.bPlanDateLabel, billingActualDate: r.billingIsActual ? r.billingDateLabel : null,
      billingStatus: billingStatus, billingValue: r.billingVal,
      cashInPlanDate: r.cPlanDateLabel, cashInActualDate: r.cashInIsActual ? r.cashInDateLabel : null,
      cashInStatus: cashInStatus, cashInValue: r.cashInVal,
      cashInPlan: metric === 'billing' ? r.bPlanDateLabel : r.cPlanDateLabel,
      status: metric === 'billing' ? billingStatus : cashInStatus,
      amount: r[valField], isActual: r[isActualField],
      feasPlanValue: r.feasPlanValue // ยังคงเป็นผลรวมทั้งงวด — ใช้เฉพาะ metric billing/cashIn ที่ไม่ใช่ตารางเทียบ Feas รายเดือน
    };
  });
  return JSON.parse(JSON.stringify({ rows: out, metric, ym }));
}
 
function debugRefCodeIntegrity() {
  const joinSheets = ['FeasPlan','Actual','FeasActual_Proj','Breakeven_Calc',
                       'Sheet_Production','Sheet_Meters','Sheet_FinancialPlan'];
 
  const projRows = _sheetToObjects(SH.PROJECTS);
  const assetCodes = {};
  projRows.forEach(r => {
    const code = _val(r, 'AssetCode');
    if (code) assetCodes[code] = (assetCodes[code] || 0) + 1;
  });
 
  const dupes = Object.keys(assetCodes).filter(c => assetCodes[c] > 1);
  Logger.log(dupes.length
    ? '⚠️ Projects.AssetCode ซ้ำ (ห้ามเกิด): ' + dupes.join(', ')
    : '✅ AssetCode ทุกตัวไม่ซ้ำกัน');
 
  const assetList = Object.keys(assetCodes);
  joinSheets.forEach(name => {
    const rows = _sheetToObjects(name);
    const refs = {};
    rows.forEach(r => { const ref = _val(r,'RefCode'); if (ref) refs[ref] = true; });
    const missing = Object.keys(refs).filter(r => assetList.indexOf(r) === -1);
    if (missing.length) Logger.log('❌ ' + name + ' มีค่าที่ไม่ตรงกับ Projects.AssetCode: ' + missing.join(', '));
  });
 
  Logger.log('ตรวจสอบเสร็จสิ้น');
}