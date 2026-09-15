/*************************************************************
 * OMA Department KPI 2026 — Code.gs
 *
 * Data layer and grading engine.
 * Works with Theme.html, Kit.html, Index.html (OMA Design Kit).
 *
 * Principles
 *   1. Grade bands live in sheet 03_Dim_GradeBand, not in this code.
 *      Change a threshold in the sheet and results follow immediately.
 *   2. Department results are recalculated from raw data on every load,
 *      so the dashboard moves as soon as the team enters a new month.
 *   3. A grade is only reported once its measurement cycle has closed.
 *      Yearly measures show progress, not a grade, until the year ends.
 *
 * Run checkSetup() once before deploying and read the log.
 *************************************************************/

var APP_TITLE = 'Operation & Maintenance Performance';
var TZ        = 'Asia/Bangkok';
var YEAR      = 2026;

/* ------------------------------------------------------------------
   Who can do what — now decided by OMA Portal, not by the two arrays
   this file used to hardcode.

   PORTAL_MENU_ID  the id of this app's menu in the Hub's MASTER_MENUS —
                   canView() checks whether the caller's role has this
                   menu ticked in Sheet_Roles (editable from the Hub's
                   settings page, no redeploy needed).
   PORTAL_ENFORCE  rollout switch (see PortalGuard.gs's header comment).
                   Leave false until real users have been given the
                   right role/menu in the Hub, then flip to true.
   canEdit() below maps to the general "not viewer" write role
   (canWrite()) rather than admin-only (isAdminish()) — tighten that if
   Data Entry should be stricter than every other app's write role.

   PortalGuard.gs (pasted into this same Apps Script project) supplies
   portalGuard/portalAccessFromToken/requireMenu/canWrite/isAdminish.
   ------------------------------------------------------------------ */
var PORTAL_MENU_ID = 'sec-kpi-dash';
var PORTAL_ENFORCE = false;

/* A half-year survey round counts as closed at this coverage */
var ROUND_COMPLETE_AT = 0.8;

var SH = {
  project  : '01_Dim_Project',
  kpi      : '02_Dim_KPI',
  band     : '03_Dim_GradeBand',
  map      : '04_Map_KPI_Project',
  factKpi  : '05_Fact_KPI_Monthly',
  renewal  : '06_Fact_MA01_Renewal',
  budget   : '07_Fact_MA02_Budget',
  survey   : '08_Fact_MA03_Survey',
  responses: '14_Survey_Responses',
  warranty : '09_Fact_MA04_Warranty',
  cashin   : '10_Fact_MA05_CashIn',
  deptSnap : '11_Fact_Dept_Monthly',
  decision : '12_Decision_Log',
  corp     : '13_Map_Corp_KPI'
};

var DEPT_ORDER = ['MA-01', 'MA-02', 'MA-03', 'MA-04', 'MA-05', 'MA-06'];

/* Short, plain-English names for the executive view */
var SHORT_NAME = {
  'MA-01': 'Contract Renewal',
  'MA-02': 'Budget Saving',
  'MA-03': 'Customer Satisfaction',
  'MA-04': 'Warranty Closure',
  'MA-05': 'Cash Collection',
  'MA-06': 'Project Quality'
};

/* ============================================================
   Web app
   ============================================================ */

function doGet(e) {
  var g = portalGuard(e, PORTAL_MENU_ID);
  if (g.deny) return g.deny;

  /* the template variable is still called portalUser for a minimal diff,
     but it now carries the verified portal TOKEN, not a trusted-by-
     convention email — every RPC call below re-verifies it against the
     Hub, live, every time (see whoAmI/canEdit/canView) */
  var t = HtmlService.createTemplateFromFile('Index');
  t.portalUser = (e && e.parameter && e.parameter.portalToken) || '';
  return t.evaluate()
    .setTitle(APP_TITLE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(f) {
  return HtmlService.createHtmlOutputFromFile(f).getContent();
}

/* ============================================================
   Helpers
   ============================================================ */

function _s_(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/\s+/g, ' ').trim();
}

function _num_(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return isNaN(v) ? null : v;
  var n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? null : n;
}

function _date_(v) {
  if (!v) return null;
  if (Object.prototype.toString.call(v) === '[object Date]') return isNaN(v) ? null : v;
  var d = new Date(v);
  return isNaN(d) ? null : d;
}

function _iso_(d) { return d ? Utilities.formatDate(d, TZ, 'yyyy-MM-dd') : ''; }

function _period_(v) {
  if (!v) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, TZ, 'yyyy-MM');
  }
  return _s_(v);
}

function _monthOf_(v) {
  var d = _date_(v);
  return d ? Utilities.formatDate(d, TZ, 'yyyy-MM') : '';
}

function _avg_(a) {
  if (!a || !a.length) return null;
  var s = 0;
  for (var i = 0; i < a.length; i++) s += a[i];
  return s / a.length;
}

function _round_(n, p) {
  if (n === null || n === undefined) return null;
  var f = Math.pow(10, p === undefined ? 2 : p);
  return Math.round(n * f) / f;
}

function _uniq_(a) {
  var seen = {}, out = [];
  a.forEach(function (x) { if (x && !seen[x]) { seen[x] = 1; out.push(x); } });
  return out;
}

/* ============================================================
   Sheet reader — looks columns up by header name, so the sheet
   can gain or reorder columns without breaking the app
   ============================================================ */

function _readSheet_(name) {
  var sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) throw new Error('Sheet not found: ' + name);

  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];

  var head = values[0].map(_s_), out = [];

  for (var r = 1; r < values.length; r++) {
    var row = {}, blank = true;
    for (var c = 0; c < head.length; c++) {
      if (!head[c]) continue;
      var v = values[r][c];
      row[head[c]] = v;
      if (v !== '' && v !== null && v !== undefined) blank = false;
    }
    if (blank) continue;
    row._row = r + 1;
    out.push(row);
  }
  return out;
}

/* 04_Map_KPI_Project decides which contracts each measure covers.
   Change the scope there and the numbers follow, no code edit needed. */
function _scopeSets_() {
  var out = {};
  _readSheet_(SH.map).forEach(function (r) {
    var k = _s_(r['Dept_KPI']), ref = _s_(r['RefCode']);
    if (!k) return;
    out[k] = out[k] || { list: [], has: {} };
    if (ref && !out[k].has[ref]) { out[k].has[ref] = true; out[k].list.push(ref); }
  });
  return out;
}

function _scopeCounts_() {
  var sets = _scopeSets_(), out = {};
  Object.keys(sets).forEach(function (k) { out[k] = sets[k].list.length; });
  out._sets = sets;
  return out;
}

/* true when the contract is inside the declared scope of that measure */
function _inScope_(scope, kpiId, ref) {
  var sets = scope && scope._sets ? scope._sets[kpiId] : null;
  if (!sets || !sets.list.length) return true;
  return !!sets.has[ref];
}

/* ============================================================
   Grading engine — reads sheet 03 and tests grade 5 downwards.
   Anything that matches no rule lands on grade 1, so every
   value always receives a grade and no range is left uncovered.
   ============================================================ */

function buildGradeEngine() {
  var bands = {};

  _readSheet_(SH.band).forEach(function (r) {
    var kid = _s_(r['KPI_ID']);
    if (!kid) return;

    var grade = _num_(r['Grade']);
    var op    = _s_(r['Operator']);
    var thr   = _num_(r['Threshold']);

    if (!bands[kid]) {
      bands[kid] = { kpiId: kid, direction: _s_(r['Direction']),
                     unit: _s_(r['Unit']), note: '', rules: [], text: {} };
    }
    if (_s_(r['Revision_Note'])) bands[kid].note = _s_(r['Revision_Note']);
    bands[kid].text[grade] = _s_(r['Band_Text']);

    if (op && op !== 'else' && thr !== null) {
      bands[kid].rules.push({ grade: grade, op: op, thr: thr });
    }
  });

  Object.keys(bands).forEach(function (k) {
    bands[k].rules.sort(function (a, b) { return b.grade - a.grade; });
  });
  return bands;
}

function _test_(op, v, thr) {
  switch (op) {
    case '>=': return v >= thr;
    case '>' : return v >  thr;
    case '<=': return v <= thr;
    case '<' : return v <  thr;
    case '=' : return Math.abs(v - thr) < 1e-9;
  }
  return false;
}

function gradeOf(bands, kpiId, value) {
  if (value === null || value === undefined || value === '') return null;
  var b = bands[kpiId];
  if (!b) return null;

  var v = _num_(value);
  if (v === null) return null;

  for (var i = 0; i < b.rules.length; i++) {
    if (_test_(b.rules[i].op, v, b.rules[i].thr)) return b.rules[i].grade;
  }
  return 1;
}

function gradeLetter(g) {
  return { 5: 'A', 4: 'B', 3: 'C', 2: 'D', 1: 'E' }[g] || '';
}

/* ============================================================
   Measurement cycle — decides whether a grade may be reported
   ============================================================ */

/* a month counts once its last day has passed, so an unfinished month never
   appears as if it were a completed result */
function _monthClosed_(period) {
  if (!/^\d{4}-\d{2}$/.test(period)) return true;
  var y = +period.slice(0, 4), m = +period.slice(5, 7);
  var firstOfNext = new Date(y, m, 1);
  return new Date() >= firstOfNext;
}

function _yearClosed_() {
  var now = new Date();
  return now.getFullYear() > YEAR ||
         (now.getFullYear() === YEAR && now.getMonth() === 11 && now.getDate() >= 31);
}

/**
 * Monthly measures are graded as soon as a month is complete.
 * Half-year measures are graded once the survey round is complete.
 * Yearly measures stay in tracking until the year closes, because
 * a partial year cannot be judged against a full-year target.
 */
function _cycleStatus_(frequency, entry) {
  if (entry.actual === null || entry.actual === undefined) {
    return { status: 'pending', graded: false, label: 'Awaiting Data' };
  }

  var f = (frequency || '').toLowerCase();
  var cov = entry.coverage;
  var isSummary = entry.period.indexOf('YTD') > -1 || entry.period.indexOf('-H') > -1;

  if (f.indexOf('year') === 0) {                     /* Yearly */
    return _yearClosed_()
      ? { status: 'final', graded: true, label: 'Final' }
      : { status: 'tracking', graded: false, label: 'Tracking' };
  }

  if (f.indexOf('half') === 0) {                     /* Half-year */
    var ratio = (cov && cov.inScope) ? cov.measured / cov.inScope : 0;
    return ratio >= ROUND_COMPLETE_AT
      ? { status: 'final', graded: true, label: 'Round Complete' }
      : { status: 'tracking', graded: false, label: 'Round In Progress' };
  }

  /* Monthly and quarterly: every closed period is a real result */
  if (isSummary) {
    return _yearClosed_()
      ? { status: 'final', graded: true, label: 'Final' }
      : { status: 'final', graded: true, label: 'Year To Date' };
  }
  return { status: 'final', graded: true, label: 'Final' };
}


/* ------------------------------------------------------------------
   Data completeness.
   A monthly measure is only reported up to the last month where every
   contract in scope has filed. Later months stay visible as partial so
   nobody mistakes a half-filled month for a drop in performance.
   ------------------------------------------------------------------ */
function _completeness_(byPeriod, inScope, keysOf) {
  var periods = Object.keys(byPeriod).sort();
  if (!periods.length) return { asOf: '', months: [], partial: [], counts: {}, full: inScope || 0 };

  /* When a contract starts or ends mid-year it should not be counted as
     missing outside its own term, so the expected set is worked out from
     the first and last month each contract actually reports. A gap in the
     middle still counts as missing. */
  var span = {}, counts = {};
  periods.forEach(function (p) {
    var ids = keysOf(byPeriod[p]);
    counts[p] = ids.length;
    ids.forEach(function (id) {
      if (!span[id]) span[id] = { first: p, last: p };
      if (p < span[id].first) span[id].first = p;
      if (p > span[id].last) span[id].last = p;
    });
  });

  var expected = {};
  periods.forEach(function (p) {
    var n = 0;
    Object.keys(span).forEach(function (id) {
      if (span[id].first <= p && p <= span[id].last) n++;
    });
    expected[p] = n;
  });

  var complete = periods.filter(function (p) { return counts[p] >= expected[p]; });
  var asOf = complete.length ? complete[complete.length - 1] : periods[periods.length - 1];

  var partial = periods.filter(function (p) { return p > asOf; })
    .map(function (p) { return { period: p, measured: counts[p], inScope: expected[p] }; });

  return {
    asOf: asOf,
    months: periods.filter(function (p) { return p <= asOf; }),
    partial: partial,
    counts: counts,
    expected: expected,
    full: expected[asOf] || counts[asOf] || 0
  };
}

/* ============================================================
   Department calculations
   The method behind each one is recorded in sheet 12_Decision_Log
   ============================================================ */

/* MA-01 — next year's frontlog against this year's backlog */
function _calcMA01_(bands, scope) {
  var rows = _readSheet_(SH.renewal).filter(function (r) { return _s_(r['RefCode']); });
  var pct = [], renewed = 0;

  var detail = rows.map(function (r) {
    var back  = _num_(r['Value_2026_Backlog']) || 0;
    var front = _num_(r['Value_2027_Frontlog']) || 0;
    var p = back ? front / back * 100 : 0;
    if (front > 0) renewed++;
    pct.push(p);
    return {
      refCode: _s_(r['RefCode']),
      backlog: back,
      frontlog: front,
      retention: _round_(p, 1)
    };
  });

  if (!rows.length) return [];
  var avg = _avg_(pct);
  return [{
    kpiId: 'MA-01', period: YEAR + '-YTD', actual: _round_(avg, 2),
    grade: gradeOf(bands, 'MA-01', avg),
    basis: 'Average retention across ' + rows.length + ' projects',
    progress: renewed + ' of ' + rows.length + ' renewed',
    coverage: { measured: renewed, inScope: rows.length, unitLabel: 'projects renewed' },
    detail: detail
  }];
}

/* MA-02 — how much of each contract budget is still unspent.
   The figure is cumulative from the start of the contract, so it already
   carries any spend from an earlier year and must not be averaged across
   months: the latest complete month is the running position. It only
   becomes a real saving once a contract closes, so the year figure stays
   marked as not final while any contract in scope is still running. */
function _calcMA02_(bands, scope) {
  var byPeriod = {};

  _readSheet_(SH.budget).forEach(function (r) {
    var period = _period_(r['Period']);
    if (!period) return;

    var ref = _s_(r['RefCode']);
    if (!_inScope_(scope, 'MA-02', ref)) return;

    var budget = _num_(r['Budget_ERP']);
    var actual = _num_(r['Actual_Cost_Cumulative']);
    var purch  = _num_(r['Purchase_Cost_Cumulative']);
    if (!budget || actual === null) return;

    /* a purchase order is already committed even when the cost has not been
       posted yet, so the larger of the two is what the budget has to carry */
    var used = (purch !== null && purch > actual) ? purch : actual;

    var saving = (budget - used) / budget * 100;
    (byPeriod[period] = byPeriod[period] || []).push({
      refCode: ref,
      budget: budget,
      actualCost: actual,
      purchaseCost: purch,
      spent: used,
      costBasis: (purch !== null && purch > actual) ? 'Purchase' : 'Actual',
      remaining: budget - used,
      saving: _round_(saving, 1),
      grade: gradeOf(bands, 'MA-02', saving)
    });
  });

  var cmp = _completeness_(byPeriod, scope['MA-02'], function (l) {
    return _uniq_(l.map(function (x) { return x.refCode; })); });

  var out = [];
  Object.keys(byPeriod).sort().forEach(function (period) {
    var list = byPeriod[period], avg = _avg_(list.map(function (x) { return x.saving; }));
    out.push({
      kpiId: 'MA-02', period: period, actual: _round_(avg, 2),
      grade: gradeOf(bands, 'MA-02', avg),
      basis: 'Average across ' + list.length + ' contracts still holding budget',
      partialMonth: cmp.months.indexOf(period) < 0,
      coverage: { measured: list.length, inScope: cmp.expected[period] || list.length,
                  unitLabel: 'projects reporting' },
      detail: list
    });
  });

  /* A cumulative figure does not disappear when a contract stops filing:
     its last reading is still the true position. So every contract in scope
     is carried at its own latest reading, not only those that reported in
     the newest month. */
  var latestBy = {};
  Object.keys(byPeriod).sort().forEach(function (period) {
    if (!_monthClosed_(period)) return;
    byPeriod[period].forEach(function (d) {
      latestBy[d.refCode] = { row: d, period: period };
    });
  });

  var refs = Object.keys(latestBy);
  if (refs.length) {
    var detail = refs.map(function (ref) {
      var e = latestBy[ref], d = e.row;
      return {
        refCode: ref, budget: d.budget,
        actualCost: d.actualCost, purchaseCost: d.purchaseCost,
        spent: d.spent, costBasis: d.costBasis, remaining: d.remaining,
        saving: d.saving, asOf: e.period, grade: d.grade
      };
    }).sort(function (x, y) { return x.saving - y.saving; });

    var ytd = _avg_(detail.map(function (x) { return x.saving; }));

    /* costs can still be posted after a contract ends, so the saving is only
       settled once the year itself closes */
    var stale = detail.filter(function (x) { return x.asOf !== cmp.asOf; });

    out.push({
      kpiId: 'MA-02', period: YEAR + '-YTD', actual: _round_(ytd, 2),
      grade: gradeOf(bands, 'MA-02', ytd),
      basis: 'Latest reading of each of ' + detail.length + ' contracts',
      progress: detail.length + ' of ' + detail.length + ' projects',
      provisional: !_yearClosed_(),
      asOf: cmp.asOf, partial: cmp.partial,
      coverage: { measured: detail.length, inScope: detail.length,
                  unitLabel: 'projects in scope' },
      detail: detail
    });
  }

  return out;
}

var MONTH_NAMES = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];

function _sheetExists_(name) {
  return !!SpreadsheetApp.getActive().getSheetByName(name);
}

/* the plan column is written loosely, so only the month name is trusted */
function _monthFromText_(v) {
  var t = _s_(v).toLowerCase();
  for (var i = 0; i < 12; i++) if (t.indexOf(MONTH_NAMES[i]) > -1) return i + 1;
  return 0;
}

/* MA-03 — built from the raw survey responses so a new reply changes the
   result on its own. Each reply carries its own RefCode because customers
   type the project name freely. */
function _calcMA03_(bands, scope) {
  if (!_sheetExists_(SH.responses)) return _calcMA03Legacy_(bands, scope);

  var QCOLS = ['Q1_Channel','Q2_Responsiveness','Q3_Punctuality','Q4_Manner','Q5_Advice',
               'Q6_Expertise','Q7_Attentiveness','Q8_Tools','Q9_Care'];

  /* the survey plan decides which round a reply belongs to, so a late
     reply still counts towards the round it was asked for */
  var plan = {};
  _readSheet_(SH.survey).forEach(function (r) {
    var ref = _s_(r['RefCode']), rnd = _num_(r['Round']);
    var pm = _monthFromText_(r['Plan_Month']);
    if (!ref || !rnd || !pm) return;
    (plan[ref] = plan[ref] || []).push({ round: rnd, month: pm });
  });

  function roundFor(ref, month, fallbackHalf) {
    var list = plan[ref];
    if (!list || !list.length || !month) return fallbackHalf;
    var best = null, bestGap = 99;
    list.forEach(function (p) {
      var gap = Math.abs(p.month - month);
      if (gap < bestGap || (gap === bestGap && best !== null && p.round < best)) {
        bestGap = gap; best = p.round;
      }
    });
    return best || fallbackHalf;
  }

  var replies = [];
  _readSheet_(SH.responses).forEach(function (r) {
    var ref = _s_(r['RefCode']);
    if (!ref) return;

    var ex = _s_(r['Exclude']).toUpperCase();
    if (ex === 'Y' || ex === 'TRUE' || ex === 'YES') return;

    var score = _num_(r['Score_%']);
    if (score === null) {
      var vals = [];
      QCOLS.forEach(function (q) {
        var v = _num_(r[q]);
        if (v !== null) vals.push(v);
      });
      if (!vals.length) return;
      score = _avg_(vals) / 5 * 100;
    }

    var d = _date_(r['Completed_On']);
    var rnd = roundFor(ref, d ? d.getMonth() + 1 : 0, (d && d.getMonth() < 6) ? 1 : 2);

    var good = _s_(r['Strengths']);
    var fix  = _s_(r['Improvements']);
    var more = _s_(r['Comments']);
    var notes = [good, fix, more].filter(function (x) { return x; }).join(' · ');

    replies.push({
      refCode: ref,
      half: rnd,
      period: d ? Utilities.formatDate(d, TZ, 'yyyy-MM') : '',
      completedOn: _iso_(d),
      respondent: _s_(r['Respondent']),
      position: _s_(r['Position']),
      score: _round_(score, 1),
      comment: notes,
      strengths: good,
      improvements: fix,
      feedback: more,
      grade: gradeOf(bands, 'MA-03', score)
    });
  });

  if (!replies.length) return _calcMA03Legacy_(bands, scope);

  var inScope = scope['MA-03'] || 0;
  var out = [];

  /* one row per contract per round, averaging every reply in that half */
  [1, 2].forEach(function (rnd) {
    var mine = replies.filter(function (x) { return x.half === rnd; });
    if (!mine.length) return;

    var byRef = {};
    mine.forEach(function (x) { (byRef[x.refCode] = byRef[x.refCode] || []).push(x); });

    var detail = Object.keys(byRef).map(function (ref) {
      var list = byRef[ref];
      var avg = _round_(_avg_(list.map(function (x) { return x.score; })), 1);
      return {
        refCode: ref, responses: list.length, score: avg,
        comment: list.map(function (x) { return x.comment; })
          .filter(function (c) { return c; }).join(' | '),
        grade: gradeOf(bands, 'MA-03', avg)
      };
    }).sort(function (a, b) { return a.score - b.score; });

    var avgAll = _avg_(detail.map(function (x) { return x.score; }));
    var full = inScope || detail.length;

    out.push({
      kpiId: 'MA-03', period: YEAR + '-H' + rnd, actual: _round_(avgAll, 2),
      grade: gradeOf(bands, 'MA-03', avgAll),
      basis: 'Average of ' + detail.length + ' projects from ' + mine.length + ' replies',
      progress: detail.length + ' of ' + full + ' surveyed',
      coverage: { measured: detail.length, inScope: full, unitLabel: 'projects surveyed' },
      detail: detail
    });
  });

  /* and one row per month, so the chart sits on the same axis as the rest */
  var byMonth = {};
  replies.forEach(function (x) {
    if (x.period) (byMonth[x.period] = byMonth[x.period] || []).push(x);
  });

  Object.keys(byMonth).sort().forEach(function (mk) {
    var list = byMonth[mk];
    var avg = _avg_(list.map(function (x) { return x.score; }));
    out.push({
      kpiId: 'MA-03', period: mk, actual: _round_(avg, 2),
      grade: gradeOf(bands, 'MA-03', avg),
      basis: list.length + ' repl' + (list.length > 1 ? 'ies' : 'y') + ' returned this month',
      coverage: { measured: _uniq_(list.map(function (x) { return x.refCode; })).length,
                  inScope: inScope || list.length, unitLabel: 'projects surveyed' },
      detail: list.map(function (x) {
        return { refCode: x.refCode, round: x.half, completedOn: x.completedOn,
                 respondent: x.respondent, position: x.position, score: x.score,
                 comment: x.comment, strengths: x.strengths,
                 improvements: x.improvements, feedback: x.feedback,
                 grade: x.grade };
      })
    });
  });

  return out;
}

/* kept so the app still works before the response sheet is added */
function _calcMA03Legacy_(bands, scope) {
  var byRound = {}, byRef = {};

  _readSheet_(SH.survey).forEach(function (r) {
    var score = _num_(r['Score_%']);
    if (score === null) return;
    var rnd = _num_(r['Round']) || 1;
    var ref = _s_(r['RefCode']);
    var cm  = _s_(r['Comment'] || r['Comments'] || '');

    (byRound[rnd] = byRound[rnd] || []).push({
      refCode: ref, responses: _num_(r['Response_Count']),
      score: _round_(score, 1), comment: cm,
      grade: gradeOf(bands, 'MA-03', score)
    });

    var c = byRef[ref] = byRef[ref] || { refCode: ref, responses: 0, comments: [] };
    c['round' + rnd] = _round_(score, 1);
    c.responses += (_num_(r['Response_Count']) || 0);
    if (cm) c.comments.push('R' + rnd + ': ' + cm);
  });

  var perContract = Object.keys(byRef).map(function (ref) {
    var c = byRef[ref], got = [];
    if (c.round1 !== undefined) got.push(c.round1);
    if (c.round2 !== undefined) got.push(c.round2);
    var avg = got.length ? _round_(_avg_(got), 1) : null;
    return { refCode: ref, round1: c.round1 === undefined ? null : c.round1,
             round2: c.round2 === undefined ? null : c.round2,
             average: avg, responses: c.responses, comment: c.comments.join(' | '),
             grade: avg === null ? null : gradeOf(bands, 'MA-03', avg) };
  }).sort(function (a, b) {
    return (a.average === null ? 999 : a.average) - (b.average === null ? 999 : b.average);
  });

  var out = [];
  Object.keys(byRound).sort().forEach(function (rnd) {
    var list = byRound[rnd];
    var avg = _avg_(list.map(function (x) { return x.score; }));
    var inScope = scope['MA-03'] || list.length;
    out.push({
      kpiId: 'MA-03', period: YEAR + '-H' + rnd, actual: _round_(avg, 2),
      grade: gradeOf(bands, 'MA-03', avg),
      basis: 'Average score from ' + list.length + ' surveyed projects',
      progress: list.length + ' of ' + inScope + ' surveyed',
      coverage: { measured: list.length, inScope: inScope, unitLabel: 'projects surveyed' },
      detail: perContract
    });
  });
  return out;
}

/* MA-04 — days taken to close a warranty after it expires */
function _calcMA04_(bands, scope) {
  var rows = _readSheet_(SH.warranty).filter(function (r) { return _s_(r['RefCode']); });
  var days = [], detail = [];

  rows.forEach(function (r) {
    var dd = _num_(r['Closure_Days']);
    var counted = _s_(r['Count_In_KPI']).toUpperCase() === 'Y' && dd !== null;
    if (counted) days.push(dd);
    detail.push({
      refCode: _s_(r['RefCode']),
      warrantyEnd: _iso_(_date_(r['WarrantyEnd'])),
      closedOn: _iso_(_date_(r['ClosedWarrantyDate'])),
      days: dd,
      status: _s_(r['Status']),
      grade: counted ? gradeOf(bands, 'MA-04', dd) : null
    });
  });

  if (!rows.length) return [];
  var avg = days.length ? _avg_(days) : null;
  return [{
    kpiId: 'MA-04', period: YEAR + '-YTD', actual: avg === null ? null : _round_(avg, 2),
    grade: avg === null ? null : gradeOf(bands, 'MA-04', avg),
    basis: 'Average of ' + days.length + ' warranties already closed',
    progress: days.length + ' of ' + rows.length + ' closed',
    coverage: { measured: days.length, inScope: rows.length, unitLabel: 'warranties closed' },
    detail: detail
  }];
}

/* MA-05 — days between the planned and the actual collection date */
function _calcMA05_(bands, scope) {
  var byPeriod = {};

  _readSheet_(SH.cashin).forEach(function (r) {
    var v = _num_(r['Variance_Payment']);
    var period = _monthOf_(r['Plan_Receive_Date']);
    if (v === null || period.indexOf(YEAR) !== 0) return;
    if (!_inScope_(scope, 'MA-05', _s_(r['RefCode']))) return;

    (byPeriod[period] = byPeriod[period] || []).push({
      refCode: _s_(r['RefCode']),
      installment: _num_(r['Installment_No']),
      amount: _num_(r['Amount_ExVat']),
      dueOn: _iso_(_date_(r['Plan_Receive_Date'])),
      receivedOn: _iso_(_date_(r['Actual_Receive_Date'])),
      daysEarlyLate: v,
      grade: gradeOf(bands, 'MA-05', v)
    });
  });

  var cmp = _completeness_(byPeriod, 0, function (l) {
    return _uniq_(l.map(function (x) { return x.refCode; })); });
  var out = [], monthly = [];

  Object.keys(byPeriod).sort().forEach(function (period) {
    var list = byPeriod[period],
        avg = _avg_(list.map(function (x) { return x.daysEarlyLate; }));
    if (cmp.months.indexOf(period) > -1 && _monthClosed_(period)) monthly.push(avg);
    out.push({
      kpiId: 'MA-05', period: period, actual: _round_(avg, 2),
      grade: gradeOf(bands, 'MA-05', avg),
      basis: list.length + ' instalments due this month',
      partialMonth: cmp.months.indexOf(period) < 0,
      coverage: { measured: _uniq_(list.map(function (x) { return x.refCode; })).length,
                  inScope: cmp.expected[period] || 0, unitLabel: 'projects billing' },
      detail: list
    });
  });

  if (monthly.length) {
    var ytd = _avg_(monthly);
    out.push({
      kpiId: 'MA-05', period: YEAR + '-YTD', actual: _round_(ytd, 2),
      grade: gradeOf(bands, 'MA-05', ytd),
      basis: 'Average of ' + monthly.length + ' complete months',
      progress: monthly.length + ' months',
      asOf: cmp.asOf, partial: cmp.partial,
      coverage: { measured: cmp.counts[cmp.asOf] || 0, inScope: cmp.full,
                  unitLabel: 'projects billing' },
      detail: byPeriod[cmp.asOf]
    });
  }
  return out;
}

/* MA-06 — average grade of every project measure, expressed as a percentage */
function _calcMA06_(bands, scope, factRows) {
  /* a contract with a live KPI set is expected every month its term covers,
     whether or not it filed, so a silent contract still counts against cover */
  var term = {};
  _readSheet_(SH.project).forEach(function (p) {
    var ref = _s_(p['RefCode']);
    if (!ref) return;
    term[ref] = { from: _iso_(_date_(p['ContractStart'])),
                  to:   _iso_(_date_(p['ContractEnd'])) };
  });

  var inScopeList = (scope && scope._sets && scope._sets['MA-06'])
    ? scope._sets['MA-06'].list : [];

  function expectedAt(period) {
    if (!inScopeList.length) return 0;
    var first = period + '-01', last = period + '-31';
    var n = 0;
    inScopeList.forEach(function (ref) {
      var t = term[ref];
      if (!t) { n++; return; }
      if (t.from && t.from > last) return;
      if (t.to && t.to < first) return;
      n++;
    });
    return n;
  }

  var byPeriod = {};

  /* a project KPI that already rolls into another department measure is
     calculated there from its own source sheet, so it is not counted twice */
  factRows.forEach(function (f) {
    if (f.parentKpi !== 'MA-06' || f.grade === null || !f.refCode) return;
    if (!_inScope_(scope, 'MA-06', f.refCode)) return;
    (byPeriod[f.period] = byPeriod[f.period] || []).push(f);
  });

  var cmp = _completeness_(byPeriod, scope['MA-06'], function (l) {
    return _uniq_(l.map(function (x) { return x.refCode; })); });
  /* project quality is worked out from whatever has been filed, so a single
     late project never wipes a whole month. The result stays marked as
     preliminary until every project has reported. */
  var allP = Object.keys(byPeriod).sort();
  cmp.expected = {};
  allP.forEach(function (p) { cmp.expected[p] = expectedAt(p); });
  cmp.months = allP;
  cmp.asOf = allP.length ? allP[allP.length - 1] : '';
  cmp.partial = allP.filter(function (p) {
      return _uniq_(byPeriod[p].map(function (x) { return x.refCode; })).length
             < expectedAt(p);
    }).map(function (p) {
      return { period: p,
               measured: _uniq_(byPeriod[p].map(function (x) { return x.refCode; })).length,
               inScope: expectedAt(p) };
    });
  var out = [], monthly = [];

  Object.keys(byPeriod).sort().forEach(function (period) {
    var list = byPeriod[period],
        avgGrade = _avg_(list.map(function (x) { return x.grade; })),
        pct = avgGrade / 5 * 100;
    if (cmp.months.indexOf(period) > -1 && _monthClosed_(period)) monthly.push(pct);

    var byProject = {};
    list.forEach(function (x) { (byProject[x.refCode] = byProject[x.refCode] || []).push(x.grade); });

    var detail = Object.keys(byProject).map(function (ref) {
      var g = _avg_(byProject[ref]);
      return { refCode: ref, measures: byProject[ref].length,
               avgGrade: _round_(g, 2), score: _round_(g / 5 * 100, 1),
               grade: Math.round(g) };
    }).sort(function (a, b) { return a.score - b.score; });

    out.push({
      kpiId: 'MA-06', period: period, actual: _round_(pct, 2),
      grade: gradeOf(bands, 'MA-06', pct),
      basis: 'Average grade ' + _round_(avgGrade, 2) + ' across ' + list.length + ' measures',
      partialMonth: cmp.months.indexOf(period) < 0,
      coverage: { measured: detail.length,
                  inScope: expectedAt(period) || cmp.expected[period] || detail.length,
                  unitLabel: 'projects measured' },
      detail: detail
    });
  });

  if (monthly.length) {
    var ytd = _avg_(monthly);
    var base = null;
    out.forEach(function (r) { if (r.period === cmp.asOf) base = r; });
    out.push({
      kpiId: 'MA-06', period: YEAR + '-YTD', actual: _round_(ytd, 2),
      grade: gradeOf(bands, 'MA-06', ytd),
      basis: 'Average of ' + monthly.length + ' month' + (monthly.length === 1 ? '' : 's'),
      progress: monthly.length + ' months',
      provisional: cmp.partial.length > 0,
      asOf: cmp.asOf, partial: cmp.partial,
      coverage: base ? base.coverage : null,
      detail: base ? base.detail : []
    });
  }
  return out;
}

/* ============================================================
   Assemble the payload for the front end
   ============================================================ */

function getAppData(portalUser) {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('appdata');
  if (hit) {
    try {
      var cached = JSON.parse(hit);
      /* the cache is shared by everyone, so rights are never taken from it */
      cached.canEdit = canEdit(portalUser);
      return cached;
    } catch (e) { /* stale cache */ }
  }

  var bands = buildGradeEngine();
  var scope = _scopeCounts_();
  var projects = _readSheet_(SH.project);
  var kpiDefs  = _readSheet_(SH.kpi);

  var kpiById = {};
  var kpiList = kpiDefs.map(function (k) {
    var o = {
      kpiId: _s_(k['KPI_ID']),
      refCode: _s_(k['RefCode']),
      level: _s_(k['Level']),
      parentKpi: _s_(k['Parent_KPI']),
      description: _s_(k['Description']),
      shortName: SHORT_NAME[_s_(k['KPI_ID'])] || '',
      target: _s_(k['Target']),
      unit: _s_(k['Unit']),
      frequency: _s_(k['Frequency']),
      weight: _num_(k['Weight_%']),
      direction: _s_(k['Direction']),
      method: _s_(k['Calculation_Method']),
      revisionNote: _s_(k['Revision_Note']),
      bandText: bands[_s_(k['KPI_ID'])] ? bands[_s_(k['KPI_ID'])].text : {}
    };
    kpiById[o.kpiId] = o;
    return o;
  });

  /* Project results — grades recalculated every load */
  var factRows = _readSheet_(SH.factKpi).map(function (f) {
    var kid = _s_(f['KPI_ID']), actual = _num_(f['Actual']), def = kpiById[kid] || {};
    return {
      kpiId: kid,
      refCode: _s_(f['RefCode']) || def.refCode || '',
      /* 02_Dim_KPI is the single source of truth for which measure a
         project KPI rolls into, so the fact sheet never has to be edited */
      parentKpi: def.parentKpi || _s_(f['Parent_KPI']) || '',
      description: _s_(f['Description']) || def.description || '',
      period: _period_(f['Period']),
      actual: actual,
      unit: _s_(f['Unit']) || def.unit || '',
      target: _s_(f['Target']) || def.target || '',
      grade: gradeOf(bands, kid, actual),
      evidence: _s_(f['Evidence'] || f['Evidence_Link'] || ''),
      updatedBy: _s_(f['Updated_By']),
      updatedAt: (function () {
        var d = _date_(f['Updated_At']);
        return d ? Utilities.formatDate(d, TZ, 'd MMM yyyy, HH:mm') : '';
      })(),
      dataQuality: _s_(f['Data_Quality']),
      row: f._row
    };
  }).filter(function (f) { return f.kpiId && f.period; });

  var dept = []
    .concat(_calcMA01_(bands, scope))
    .concat(_calcMA02_(bands, scope))
    .concat(_calcMA03_(bands, scope))
    .concat(_calcMA04_(bands, scope))
    .concat(_calcMA05_(bands, scope))
    .concat(_calcMA06_(bands, scope, factRows));

  dept.forEach(function (d) {
    d.monthClosed = _monthClosed_(d.period);
    var def = kpiById[d.kpiId] || {};
    d.name        = def.shortName || def.description || d.kpiId;
    d.description = def.description || '';
    d.unit        = def.unit || '';
    d.target      = def.target || '';
    d.weight      = def.weight || null;
    d.frequency   = def.frequency || '';
    d.method      = def.method || '';

    if (!d.asOf) d.asOf = d.period;
    var cs = _cycleStatus_(d.frequency, d);
    d.status      = cs.status;
    d.graded      = cs.graded;
    d.statusLabel = d.provisional ? 'Not final' : cs.label;
    d.letter      = cs.graded ? gradeLetter(d.grade) : '';
  });

  /* Headline score counts only measures whose cycle has closed */
  var headline = {}, counted = [], wSum = 0, wScore = 0;
  /* the headline is the latest cycle that has actually closed, and only
     falls back to an open one when nothing has closed yet */
  dept.forEach(function (d) {
    var isSummary = d.period.indexOf('YTD') > -1 || d.period.indexOf('-H') > -1;
    if (!isSummary) return;
    var cur = headline[d.kpiId];
    if (!cur) { headline[d.kpiId] = d; return; }
    if (d.graded && !cur.graded) { headline[d.kpiId] = d; return; }
    if (d.graded === cur.graded && d.period > cur.period) headline[d.kpiId] = d;
  });

  DEPT_ORDER.forEach(function (kid) {
    var d = headline[kid];
    if (!d || !d.graded || d.grade === null) return;
    var w = (kpiById[kid] || {}).weight || 0;
    wSum += w; wScore += d.grade * w;
    counted.push(kid);
  });

  var payload = {
    updated: Utilities.formatDate(new Date(), TZ, 'd MMM yyyy, HH:mm'),
    year: YEAR,
    canEdit: canEdit(portalUser),
    yearClosed: _yearClosed_(),
    projects: projects.map(function (p) {
      return {
        refCode: _s_(p['RefCode']),
        shortName: _s_(p['ShortName']),
        projectName: _s_(p['ProjectName_TH']),
        customer: _s_(p['Customer']),
        type: _s_(p['Type']),
        owner: _s_(p['Owner']),
        contractStart: _iso_(_date_(p['ContractStart'])),
        contractEnd: _iso_(_date_(p['ContractEnd'])),
        contractValue: _num_(p['ContractValue_ExVat']),
        budget: _num_(p['Budget']),
        kpiGroup: _s_(p['KPI_Group']),
        note: _s_(p['Note'])
      };
    }),
    kpis: kpiList,
    scope: (function () {
      var sets = scope._sets || {}, out = {};
      Object.keys(sets).forEach(function (k) { out[k] = sets[k].list; });
      return out;
    })(),
    bands: bands,
    facts: factRows,
    dept: dept,
    headlineOrder: DEPT_ORDER,
    score: {
      value: wSum ? _round_(wScore / wSum, 2) : null,
      counted: counted.length,
      total: DEPT_ORDER.length,
      weightCovered: wSum
    },
    corp: _readSheet_(SH.corp).map(function (c) {
      return {
        corpCode: _s_(c['Corp_Code']),
        corpName: _s_(c['Corp_KPI_Name']),
        group: _s_(c['กลุ่ม']),
        corpTarget: _num_(c['Corp_Target']),
        corpWeight: _num_(c['Corp_Weight_%']),
        kpiId: _s_(c['KPI_ID']),
        deptWeight: _num_(c['Dept_Weight_%']),
        note: _s_(c['Note'])
      };
    }).filter(function (c) { return c.kpiId; })
  };

  try { cache.put('appdata', JSON.stringify(payload), 300); } catch (e) { /* too large */ }
  return payload;
}

function refreshData(portalUser) {
  CacheService.getScriptCache().remove('appdata');
  return getAppData(portalUser);
}

/* ============================================================
   Access
   ============================================================ */

function currentUser() {
  try { return Session.getActiveUser().getEmail() || ''; } catch (e) { return ''; }
}

/* portalUser is now a verified portal TOKEN (see doGet), not a trusted
   string — every call below re-verifies it against the Hub, live. The
   old hardcoded VIEWERS/EDITORS arrays and the Google-identity fallback
   are gone: role/menu access lives in the Hub's Sheet_Roles now (editable
   from the portal's settings page, effective on the very next call — no
   redeploy). A blank/invalid token always resolves to "no access". */
function whoAmI(portalToken) {
  var access = portalAccessFromToken(portalToken);
  return access.ok ? access.email : '';
}

function canEdit(portalToken) {
  return canWrite(portalAccessFromToken(portalToken));
}

function canView(portalToken) {
  return requireMenu(portalAccessFromToken(portalToken, PORTAL_MENU_ID), PORTAL_MENU_ID);
}

/* saveKpiResult() was removed here — it was dead code (never called from
   Index.html; only saveKpiBatch is) and referenced an out-of-scope
   `portalUser` variable, so it would have thrown if it ever ran. Leaving
   a second, weaker write path into 05_Fact_KPI_Monthly around while
   retrofitting real authorization would have been a step backwards. */

/* rows that sit next to each other go in a single delete call */
function _deleteRows_(sh, rowNumbers) {
  var list = rowNumbers.slice().sort(function (a, b) { return b - a; });
  var i = 0;
  while (i < list.length) {
    var end = list[i], count = 1;
    while (i + count < list.length && list[i + count] === end - count) count++;
    sh.deleteRows(end - count + 1, count);
    i += count;
  }
}

/* removing a reading takes the whole row out, so the month reads as not filed
   rather than as a contract that reported nothing */
function clearKpiResult(kpiId, period, portalUser) {
  if (!canEdit(portalUser)) throw new Error('This account cannot change results.');

  kpiId = _s_(kpiId);
  period = _s_(period);
  if (!kpiId || !period) throw new Error('Nothing to clear.');

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);

  try {
    var sh = SpreadsheetApp.getActive().getSheetByName(SH.factKpi);
    var values = sh.getDataRange().getValues();
    var head = values[0].map(_s_);
    var cKpi = head.indexOf('KPI_ID'), cPeriod = head.indexOf('Period');
    if (cKpi < 0 || cPeriod < 0) throw new Error('Columns not found in ' + SH.factKpi);

    var hits = [];
    for (var r = 1; r < values.length; r++) {
      if (_s_(values[r][cKpi]) === kpiId && _period_(values[r][cPeriod]) === period) {
        hits.push(r + 1);
      }
    }
    _deleteRows_(sh, hits);
    CacheService.getScriptCache().remove('appdata');
    return { kpiId: kpiId, period: period, removed: hits.length };

  } finally {
    lock.releaseLock();
  }
}

/* clears every reading a contract filed for one month */
function clearKpiMonth(refCode, period, portalUser) {
  if (!canEdit(portalUser)) throw new Error('This account cannot change results.');

  refCode = _s_(refCode);
  period = _s_(period);
  if (!refCode || !period) throw new Error('Nothing to clear.');

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);

  try {
    var sh = SpreadsheetApp.getActive().getSheetByName(SH.factKpi);
    var values = sh.getDataRange().getValues();
    var head = values[0].map(_s_);
    var cRef = head.indexOf('RefCode'), cPeriod = head.indexOf('Period');
    if (cRef < 0 || cPeriod < 0) throw new Error('Columns not found in ' + SH.factKpi);

    var hits = [];
    for (var r = 1; r < values.length; r++) {
      if (_s_(values[r][cRef]) === refCode && _period_(values[r][cPeriod]) === period) {
        hits.push(r + 1);
      }
    }
    _deleteRows_(sh, hits);
    CacheService.getScriptCache().remove('appdata');
    return { refCode: refCode, period: period, removed: hits.length };

  } finally {
    lock.releaseLock();
  }
}

/* One pass for a whole month: the sheet is read once, the grade rules are
   built once, and the fresh payload rides back with the result so the client
   does not have to ask for it again. */
function saveKpiBatch(rows, portalUser) {
  if (!canEdit(portalUser)) throw new Error('This account cannot save results.');
  rows = rows || [];

  var out = { saved: 0, failed: [], rows: [], evidenceColumn: true, auditColumns: true };
  if (!rows.length) return out;

  var bands = buildGradeEngine();
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);

  try {
    var sh = SpreadsheetApp.getActive().getSheetByName(SH.factKpi);
    var values = sh.getDataRange().getValues();
    var head = values[0].map(_s_);

    function idx(n) { return head.indexOf(n); }
    var cKpi = idx('KPI_ID'), cPeriod = idx('Period'),
        cActual = idx('Actual'), cGrade = idx('Grade_New');
    if (cKpi < 0 || cPeriod < 0 || cActual < 0 || cGrade < 0)
      throw new Error('Required columns not found in ' + SH.factKpi);

    var cEvid = idx('Evidence'); if (cEvid < 0) cEvid = idx('Evidence_Link');
    var cBy = idx('Updated_By'), cAt = idx('Updated_At');
    out.evidenceColumn = cEvid > -1;
    out.auditColumns = cBy > -1 && cAt > -1;

    /* where each measure and month already lives */
    var where = {};
    for (var r = 1; r < values.length; r++) {
      var key = _s_(values[r][cKpi]) + '|' + _period_(values[r][cPeriod]);
      where[key] = r;
    }

    var defs = _readSheet_(SH.kpi), defBy = {};
    defs.forEach(function (d) { defBy[_s_(d['KPI_ID'])] = d; });

    var who = whoAmI(portalUser) || 'unknown';
    var when = new Date();
    var touched = {}, appended = [];

    rows.forEach(function (r) {
      var kpiId = _s_(r.kpiId), period = _s_(r.period), evidence = _s_(r.evidence);
      var val = _num_(r.actual);
      try {
        if (!kpiId) throw new Error('Missing measure');
        if (!/^\d{4}-\d{2}$/.test(period)) throw new Error('Bad period');
        if (val === null) throw new Error('Enter a number');
        if (evidence && !/^https?:\/\//i.test(evidence))
          throw new Error('Evidence link must start with http:// or https://');
        if (!bands[kpiId]) throw new Error('No grade band in ' + SH.band);

        var grade = gradeOf(bands, kpiId, val);
        var at = where[kpiId + '|' + period];

        if (at !== undefined) {
          values[at][cActual] = val;
          values[at][cGrade] = grade;
          if (cEvid > -1) values[at][cEvid] = evidence;
          if (cBy > -1) values[at][cBy] = who;
          if (cAt > -1) values[at][cAt] = when;
          touched[at] = true;
        } else {
          var row = new Array(head.length).fill('');
          row[cKpi] = kpiId; row[cPeriod] = period;
          row[cActual] = val; row[cGrade] = grade;
          if (cEvid > -1) row[cEvid] = evidence;
          if (cBy > -1) row[cBy] = who;
          if (cAt > -1) row[cAt] = when;
          var def = defBy[kpiId];
          if (def) {
            ['RefCode', 'Parent_KPI', 'Description', 'Unit', 'Target'].forEach(function (n) {
              var i = idx(n);
              if (i > -1) row[i] = _s_(def[n]);
            });
          }
          var dq = idx('Data_Quality');
          if (dq > -1) row[dq] = 'OK';
          appended.push(row);
        }
        var def0 = defBy[kpiId] || {};
        out.rows.push({
          kpiId: kpiId, period: period, actual: val, grade: grade,
          evidence: evidence, refCode: _s_(def0['RefCode']),
          parentKpi: _s_(def0['Parent_KPI']),
          description: _s_(def0['Description']),
          unit: _s_(def0['Unit']), target: _s_(def0['Target']),
          updatedBy: who,
          updatedAt: Utilities.formatDate(when, TZ, 'd MMM yyyy, HH:mm')
        });
        out.saved++;
      } catch (e) {
        out.failed.push({ kpiId: kpiId, message: e.message });
      }
    });

    /* one write per changed row, and one write for everything new */
    Object.keys(touched).forEach(function (at) {
      var r2 = Number(at);
      sh.getRange(r2 + 1, 1, 1, head.length).setValues([values[r2]]);
    });
    if (appended.length) {
      sh.getRange(sh.getLastRow() + 1, 1, appended.length, head.length)
        .setValues(appended);
    }

    CacheService.getScriptCache().remove('appdata');
  } finally {
    lock.releaseLock();
  }

  /* only the changed rows travel back; the dashboards recompute when someone
     actually opens them, which keeps saving quick */
  return out;
}

/* ============================================================
   Run once before deploying
   ============================================================ */

function checkSetup() {
  var ss = SpreadsheetApp.getActive(), missing = [];

  Logger.log('Access is now managed by the OMA Portal Hub (Sheet_Roles/Sheet_Users) — ' +
    'this script no longer decides who can view or edit on its own. To check a ' +
    'specific person\'s access, look them up on the Hub\'s settings page instead; ' +
    'canView()/canEdit() here need a real portal token as their argument and will ' +
    'report "no access" when called with none, which is expected from this editor.');
  Logger.log('PORTAL_MENU_ID: ' + PORTAL_MENU_ID + ' · PORTAL_ENFORCE: ' + PORTAL_ENFORCE +
    (PORTAL_ENFORCE ? '' : ' (shadow mode — not yet enforced for real users)'));

  Object.keys(SH).forEach(function (k) {
    if (!ss.getSheetByName(SH[k])) missing.push(SH[k]);
  });
  if (missing.length) { Logger.log('Missing sheets: ' + missing.join(', ')); return; }
  Logger.log('All ' + Object.keys(SH).length + ' sheets found');

  var bands = buildGradeEngine(), ids = Object.keys(bands);
  Logger.log('Grade bands loaded for ' + ids.length + ' measures');

  var incomplete = ids.filter(function (k) { return bands[k].rules.length < 4; });
  Logger.log(incomplete.length
    ? 'Incomplete bands (fewer than 4 levels): ' + incomplete.join(', ')
    : 'Every measure has all 4 threshold levels');

  var orphan = {};
  _readSheet_(SH.factKpi).forEach(function (f) {
    var k = _s_(f['KPI_ID']);
    if (k && !bands[k]) orphan[k] = true;
  });
  var ok = Object.keys(orphan);
  Logger.log(ok.length ? 'Results with no matching band: ' + ok.join(', ')
                       : 'Every result row matches a grade band');

  /* any RefCode used in a result but missing from the register would show
     as a bare code in the app, so it is worth catching before deploy */
  var known = {};
  _readSheet_(SH.project).forEach(function (p) { known[_s_(p['RefCode'])] = true; });

  var unknown = {};
  [SH.factKpi, SH.renewal, SH.budget, SH.survey, SH.warranty, SH.cashin]
    .concat(_sheetExists_(SH.responses) ? [SH.responses] : [])
    .forEach(function (name) {
      _readSheet_(name).forEach(function (r) {
        var ref = _s_(r['RefCode']);
        if (ref && !known[ref]) unknown[ref] = (unknown[ref] || 0) + 1;
      });
    });
  var bad = Object.keys(unknown);
  Logger.log(bad.length
    ? 'RefCodes not in 01_Dim_Project: ' + bad.map(function (k) {
        return k + ' (' + unknown[k] + ')'; }).join(', ')
    : 'Every RefCode used in the results exists in 01_Dim_Project');

  /* contracts that have data but sit outside the declared scope would be
     dropped silently, so they are listed here instead */
  var sets = _scopeSets_();
  [['MA-02', SH.budget], ['MA-05', SH.cashin]].forEach(function (pair) {
    var set = sets[pair[0]];
    if (!set || !set.list.length) return;
    var outside = {};
    _readSheet_(pair[1]).forEach(function (r) {
      var ref = _s_(r['RefCode']);
      if (ref && !set.has[ref]) outside[ref] = true;
    });
    var list = Object.keys(outside);
    if (list.length) {
      Logger.log(pair[0] + ' ignores data from ' + list.join(', ') +
                 ' because they are not listed in ' + SH.map);
    }
  });

  /* a duplicated short name usually means an old RefCode is still around */
  var byName = {};
  _readSheet_(SH.project).forEach(function (r) {
    var n = _s_(r['ShortName']).toLowerCase();
    if (!n) return;
    (byName[n] = byName[n] || []).push(_s_(r['RefCode']));
  });
  Object.keys(byName).forEach(function (n) {
    if (byName[n].length > 1) {
      Logger.log('Duplicate contract name in ' + SH.project + ': "' + n +
                 '" used by ' + byName[n].join(' and '));
    }
  });

  /* contracts inside a scope that never filed, and the reverse */
  var setsB = _scopeSets_();
  ['MA-02', 'MA-05', 'MA-06'].forEach(function (kid) {
    var set = setsB[kid];
    if (!set || !set.list.length) return;
    var seen = {};
    getAppData().dept.forEach(function (d) {
      if (d.kpiId !== kid) return;
      (d.detail || []).forEach(function (x) { if (x.refCode) seen[x.refCode] = true; });
    });
    var silent = set.list.filter(function (ref) { return !seen[ref]; });
    if (silent.length) {
      Logger.log(kid + ' has no data from ' + silent.join(', ') +
                 ' even though ' + SH.map + ' lists them');
    }
  });

  var data = getAppData();
  Logger.log('Contracts ' + data.projects.length +
             ' | Measures ' + data.kpis.length +
             ' | Result rows ' + data.facts.length);
  Logger.log('Department score ' + data.score.value +
             ' (from ' + data.score.counted + ' of ' + data.score.total + ' measures)');

  DEPT_ORDER.forEach(function (kid) {
    var s = data.dept.filter(function (d) {
      return d.kpiId === kid &&
             (d.period.indexOf('YTD') > -1 || d.period.indexOf('-H') > -1);
    });
    if (!s.length) { Logger.log('  ' + kid + ' — no data'); return; }

    /* report the cycle the score actually uses, not simply the newest one */
    var done = s.filter(function (d) { return d.graded; });
    var d = done.length ? done[done.length - 1] : s[s.length - 1];

    Logger.log('  ' + kid + ' ' + d.name + ' | ' + d.period + ' = ' +
               d.actual + ' ' + d.unit + ' | ' + d.statusLabel +
               (d.graded ? ' | Grade ' + d.grade + ' (' + d.letter + ') | counted in the score'
                         : ' | grade withheld until cycle closes') +
               (d.progress ? ' | ' + d.progress : ''));

    s.forEach(function (o) {
      if (o.period > d.period && !o.graded) {
        Logger.log('        next cycle ' + o.period + ' = ' + o.actual + ' ' + o.unit +
                   ' | ' + o.statusLabel + (o.progress ? ' | ' + o.progress : ''));
      }
    });
  });
}

function testGradeEngine() {
  var b = buildGradeEngine();
  var cases = [
    ['MA-01', 0, 1], ['MA-01', 100, 3], ['MA-01', 114, 3], ['MA-01', 121, 5],
    ['MA-03', 95, 4], ['MA-03', 96, 5],
    ['MA-04', 90, 3], ['MA-04', 121, 1],
    ['MA-05', 1, 2], ['MA-05', 0, 3], ['MA-05', -6, 4], ['MA-05', -10, 5],
    ['MA-06', 95, 4]
  ];
  var fail = 0;
  cases.forEach(function (c) {
    var got = gradeOf(b, c[0], c[1]);
    if (got !== c[2]) {
      fail++;
      Logger.log('Failed: ' + c[0] + ' value ' + c[1] + ' expected ' + c[2] + ' got ' + got);
    }
  });
  Logger.log(fail ? fail + ' case(s) failed' : 'All ' + cases.length + ' cases passed');
}