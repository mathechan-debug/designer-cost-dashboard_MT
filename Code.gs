/** ================================================================
 *  HLFOCO Design Cost Dashboard — WEB APP
 *  Tab 1: Overview FY27
 *  ================================================================
 *  DEPLOY:
 *    1. Extensions > Apps Script (from your Google Sheet)
 *    2. Paste this file in as Code.gs
 *    3. Create/replace HTML file named exactly "Index" with Index.html content
 *    4. Deploy > Manage deployments > Edit > New version
 *
 *  DATA ASSUMPTIONS:
 *    - "OB Data MOM -FY 27" → row 1 blank/title, row 2 = headers
 *        col A = Cluster, col B = XP, col C onward = month codes (YYYYMM, e.g. 202604)
 *        data starts row 3.
 *    - "Active HC" → row 2 = headers: Cluster | Design Associate | Design Consultant |
 *        Principal Design Consultant | Sr. Design Consultant | Sr. Principal Design Consultant
 *        data starts row 3. CURRENT SNAPSHOT (not month-wise).
 *    - "DCC Associate" → row 1 headers: Employee Id | Company Email Id | Full Name | City |
 *        Job Role | Date of Joining | Direct Manager Name | Direct Manager Email Id | LWD
 *    - "DM List" → auto-detects header row. Expects "XP" and "COUNTA of DM" columns.
 * ================================================================ */

const FY27_MONTHS = ["Apr-26","May-26","Jun-26","Jul-26","Aug-26","Sep-26",
                      "Oct-26","Nov-26","Dec-26","Jan-27","Feb-27","Mar-27"];

const OB_TAB_NAME = "OB Data MOM -FY 27";
const R2P_TAB_NAME = "R2P Data MOM -FY 27";
const ACTIVE_HC_TAB_NAME = "Active HC";
const DCC_ASSOCIATE_TAB_NAME = "DCC Associate";
const DCC_DM_BD_TAB_NAME = "DCC DM & PD";
const DCC_LEAD_PRINCIPAL_SALARY = 85000;
const DM_LIST_TAB_NAME = "DM List";
const DESIGNER_LIST_TAB_NAME = "Designer List";
const CLUSTER_CITY_XP_TAB_NAME = "Cluster-City-XP";

const CTC_TABLE = {
  "Design Consultant": 42833,
  "Sr. Design Consultant": 58333,
  "Principal Design Consultant": 75000,
  "Sr. Principal Design Consultant": 104167,
  "Design Associate": 28800,
  "DCC Associate": 20000,
  "Design Manager": 85000
};

const PAN_INDIA_TARGET_PCT = 0.048;

const GROUP_ALIASES = {
  "Titans":    ["karnataka","ka","tamilnadu","tn","chennai","tnche","tnrotn","kolkata","wbekol","westbengal"],
  "Stalwarts": ["maharashtra","rom","pune","pun","hyderabad","apt","telangana","andhra","restofeast","wberoe","mp","madhyapradesh"],
  "Aspirants": ["gujarat","guj","mumbai","mum","north1","nor1","north2","nor2","kerala","kl"]
};
const GROUP_TARGETS = { "Titans": 0.04, "Stalwarts": 0.05, "Aspirants": 0.06 };
const R2P_PAN_INDIA_TARGET_PCT = 0.071;
const R2P_GROUP_TARGETS = { "Titans": 0.06, "Stalwarts": 0.07, "Aspirants": 0.09 };
const AGGREGATE_LABELS = ["overall","total","all","grandtotal","panindia"];

const SESSION_CACHE_TTL_SECONDS = 6 * 60 * 60;

function ONE_TIME_setPassword() {
  PropertiesService.getScriptProperties().setProperty('DASHBOARD_PASSWORD', 'ChangeMe123');
}

function checkPassword(pw) {
  const stored = PropertiesService.getScriptProperties().getProperty('DASHBOARD_PASSWORD');
  if (!stored) throw new Error('No password set -- run ONE_TIME_setPassword() first.');
  if (pw !== stored) return null;
  const token = Utilities.getUuid();
  CacheService.getScriptCache().put('session_' + token, 'valid', SESSION_CACHE_TTL_SECONDS);
  return token;
}

function requireSession(token) {
  const valid = CacheService.getScriptCache().get('session_' + token);
  if (valid !== 'valid') throw new Error('Session expired -- please log in again.');
}

function doGet(e) {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Design Cost Dashboard')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getCalendarCurrentMonthLabel() {
  const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const now = new Date();
  return monthNames[now.getMonth()] + "-" + String(now.getFullYear()).slice(2);
}

function monthCodeToLabel(code) {
  const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  if (Object.prototype.toString.call(code) === '[object Date]') {
    return monthNames[code.getMonth()] + "-" + String(code.getFullYear()).slice(2);
  }
  const s = String(code).trim();
  if (/^\d{6}$/.test(s)) {
    const year = s.substring(0, 4);
    const month = parseInt(s.substring(4, 6), 10);
    if (month < 1 || month > 12) return null;
    return monthNames[month - 1] + "-" + year.substring(2);
  }
  if (/^[A-Za-z]{3}-\d{2}$/.test(s)) return s.charAt(0).toUpperCase() + s.slice(1, 3).toLowerCase() + s.slice(3);
  const mmYyyy = s.match(/^(\d{1,2})-{1,2}(\d{4})$/);
  if (mmYyyy) {
    const month = parseInt(mmYyyy[1], 10);
    const year = mmYyyy[2];
    if (month < 1 || month > 12) return null;
    return monthNames[month - 1] + "-" + year.substring(2);
  }
  return null;
}

const CONSULTANT_TIER_ROLES = ["Design Consultant", "Sr. Design Consultant", "Principal Design Consultant", "Sr. Principal Design Consultant"];
function displayRole(role) {
  return CONSULTANT_TIER_ROLES.indexOf(role) !== -1 ? "Design Consultant" : role;
}

function mergeRoleBreakdown(roleBreakdown) {
  const map = {};
  (roleBreakdown || []).forEach(rb => {
    const role = displayRole(rb.role);
    if (!map[role]) map[role] = { role: role, count: 0, cost: 0 };
    map[role].count += rb.count;
    map[role].cost += rb.cost;
  });
  return Object.values(map);
}

function ragFromAchievement(achievementPct) {
  if (achievementPct === null || achievementPct === undefined) return 'grey';
  if (achievementPct >= 100) return 'green';
  if (achievementPct >= 80) return 'amber';
  return 'red';
}

function normKey(s) {
  return String(s || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function effectiveRevenue(revenue, cost) {
  return (revenue === 0 && cost > 0) ? 1 : revenue;
}

function isAggregateLabel(clusterName) {
  const k = normKey(clusterName);
  return AGGREGATE_LABELS.indexOf(k) !== -1;
}

function matchGroup(clusterName) {
  const k = normKey(clusterName);
  for (const group in GROUP_ALIASES) {
    if (GROUP_ALIASES[group].some(alias => k.indexOf(alias) !== -1)) return group;
  }
  return null;
}

function computeScopedTargetPct(revenueData, months, clusterFilters, showroomFilters, groupTargets, panIndiaPct) {
  clusterFilters = clusterFilters || [];
  showroomFilters = showroomFilters || [];
  if (!clusterFilters.length) return panIndiaPct;
  const byClusterNorm = obByClusterMapNormalized(revenueData, months, showroomFilters);
  let weightedSum = 0, sum = 0;
  clusterFilters.forEach(cn => {
    const rev = byClusterNorm[normKey(cn)] || 0;
    const group = matchGroup(cn);
    const pct = group ? groupTargets[group] : panIndiaPct;
    weightedSum += rev * pct;
    sum += rev;
  });
  return sum > 0 ? weightedSum / sum : panIndiaPct;
}

function getAvailableMonths(token) {
  requireSession(token);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const obData = readObRows(ss);
  const present = new Set(obData.monthCols.map(mc => mc.label));
  return FY27_MONTHS.filter(m => present.has(m));
}

function getR2pAvailableMonths(token) {
  requireSession(token);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const r2pData = readR2pRows(ss);
  const present = new Set(r2pData.monthCols.map(mc => mc.label));
  return FY27_MONTHS.filter(m => present.has(m));
}

function readPivotRows(ss, tabName, clusterCol, showroomCol, monthStartCol) {
  const sheet = ss.getSheetByName(tabName);
  if (!sheet) throw new Error('Tab "' + tabName + '" not found — check exact name.');
  const data = sheet.getDataRange().getValues();
  if (data.length < 3) return { monthCols: [], rows: [] };
  const header = data[1];
  const monthCols = [];
  for (let c = monthStartCol; c < header.length; c++) {
    const label = monthCodeToLabel(header[c]);
    if (label) monthCols.push({ index: c, label: label });
  }
  if (monthCols.length === 0) throw new Error('No month columns recognized in row 2 of "' + tabName + '".');
  const rows = [];
  let currentCluster = '';
  for (let r = 2; r < data.length; r++) {
    const clusterCell = String(data[r][clusterCol]).trim();
    const showroomCell = String(data[r][showroomCol]).trim();
    if (clusterCell) currentCluster = clusterCell;
    if (!currentCluster) continue;
    if (!showroomCell || isAggregateLabel(showroomCell)) continue;
    if (isAggregateLabel(currentCluster)) continue;
    rows.push({ cluster: currentCluster, xp: showroomCell, values: data[r] });
  }
  return { monthCols: monthCols, rows: rows };
}

const MANUAL_SHOWROOM_OVERRIDES = [
  { showroom: "Bhopal Showroom", cluster: "Rest of Maharahtra and MP", assumedValue: 1 },
  { showroom: "Navi Mumbai Showroom", cluster: "Mumbai", assumedValue: 1 },
  { showroom: "HomeLane Indore", cluster: "Rest of Maharahtra and MP", assumedValue: 1 },
  { showroom: "Greater Noida Showroom", cluster: "North 2", assumedValue: 1 }
];

function injectManualShowrooms(pivotData, tabName) {
  MANUAL_SHOWROOM_OVERRIDES.forEach(o => {
    if (!o.cluster) return;
    const already = pivotData.rows.some(r => normKey(r.xp) === normKey(o.showroom));
    if (already) return;
    const maxIdx = Math.max.apply(null, pivotData.monthCols.map(mc => mc.index).concat([0]));
    const values = new Array(maxIdx + 1).fill(0);
    pivotData.monthCols.forEach(mc => { values[mc.index] = o.assumedValue; });
    pivotData.rows.push({ cluster: o.cluster, xp: o.showroom, values: values });
  });
  return pivotData;
}

function readObRows(ss) {
  return injectManualShowrooms(readPivotRows(ss, OB_TAB_NAME, 0, 1, 2), OB_TAB_NAME);
}

function readR2pRows(ss) {
  return readPivotRows(ss, R2P_TAB_NAME, 8, 9, 10);
}

function sumOb(obData, months, clusterFilters, showroomFilters) {
  clusterFilters = (clusterFilters || []).filter(Boolean).map(normKey);
  showroomFilters = (showroomFilters || []).filter(Boolean).map(normKey);
  let total = 0;
  const relevant = obData.monthCols.filter(mc => months.indexOf(mc.label) !== -1);
  obData.rows.forEach(row => {
    if (clusterFilters.length && clusterFilters.indexOf(normKey(row.cluster)) === -1) return;
    if (showroomFilters.length && showroomFilters.indexOf(normKey(row.xp)) === -1) return;
    relevant.forEach(mc => { total += Number(row.values[mc.index]) || 0; });
  });
  return total;
}

function obByClusterMap(obData, months, showroomFilters) {
  showroomFilters = (showroomFilters || []).filter(Boolean).map(normKey);
  const result = {};
  const relevant = obData.monthCols.filter(mc => months.indexOf(mc.label) !== -1);
  obData.rows.forEach(row => {
    if (showroomFilters.length && showroomFilters.indexOf(normKey(row.xp)) === -1) return;
    let sum = 0;
    relevant.forEach(mc => { sum += Number(row.values[mc.index]) || 0; });
    result[row.cluster] = (result[row.cluster] || 0) + sum;
  });
  return result;
}

function obByClusterMapNormalized(obData, months, showroomFilters) {
  const raw = obByClusterMap(obData, months, showroomFilters);
  const result = {};
  Object.keys(raw).forEach(cluster => {
    const key = normKey(cluster);
    result[key] = (result[key] || 0) + raw[cluster];
  });
  return result;
}

function obByClusterAndXp(obData, months, cluster) {
  const relevant = obData.monthCols.filter(mc => months.indexOf(mc.label) !== -1);
  const clusterKey = normKey(cluster);
  const result = {};
  obData.rows.forEach(row => {
    if (normKey(row.cluster) !== clusterKey) return;
    let sum = 0;
    relevant.forEach(mc => { sum += Number(row.values[mc.index]) || 0; });
    result[row.xp || '(unspecified)'] = (result[row.xp || '(unspecified)'] || 0) + sum;
  });
  return Object.keys(result).map(xp => ({ xp: xp, ob: result[xp] })).sort((a, b) => b.ob - a.ob);
}

function getDistinctClusters(obData) {
  const set = new Set();
  obData.rows.forEach(r => set.add(r.cluster));
  return Array.from(set).sort();
}

function getCityShowroomMap(token) {
  requireSession(token);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CLUSTER_CITY_XP_TAB_NAME);
  if (!sheet) return { cities: [], cityToShowrooms: {} };
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return { cities: [], cityToShowrooms: {} };
  let headerRowIdx = -1, clusterCol = -1, cityCol = -1, xpCol = -1;
  for (let r = 0; r < Math.min(data.length, 6); r++) {
    const row = (data[r] || []).map(h => String(h).trim());
    const cCluster = row.findIndex(h => /^cluster$/i.test(h));
    const cCity = row.findIndex(h => /^city$/i.test(h));
    const cXp = row.findIndex(h => /^xp$|showroom|outlet|store/i.test(h));
    if (cCluster !== -1 && cCity !== -1 && cXp !== -1) {
      headerRowIdx = r; clusterCol = cCluster; cityCol = cCity; xpCol = cXp; break;
    }
  }
  if (headerRowIdx === -1) return { cities: [], cityToShowrooms: {} };
  const cityToShowrooms = {};
  for (let r = headerRowIdx + 1; r < data.length; r++) {
    const row = data[r] || [];
    const city = String(row[cityCol] || '').trim();
    const xp = String(row[xpCol] || '').trim();
    if (!city || !xp) continue;
    if (!cityToShowrooms[city]) cityToShowrooms[city] = [];
    if (cityToShowrooms[city].indexOf(xp) === -1) cityToShowrooms[city].push(xp);
  }
  return { cities: Object.keys(cityToShowrooms).sort(), cityToShowrooms: cityToShowrooms };
}

function getDistinctXpValues(obData, clusterFilters) {
  clusterFilters = (clusterFilters || []).filter(Boolean);
  const set = new Set();
  obData.rows.forEach(r => {
    if (!r.xp) return;
    if (clusterFilters.length && clusterFilters.indexOf(r.cluster) === -1) return;
    set.add(r.xp);
  });
  return Array.from(set).sort();
}

function getHcCostByClusterAndRole(ss, monthCount) {
  const result = {};
  const sheet = ss.getSheetByName(ACTIVE_HC_TAB_NAME);
  if (!sheet) return result;
  const data = sheet.getDataRange().getValues();
  if (data.length < 3) return result;
  const header = data[1].map(h => String(h).trim());
  const clusterCol = header.indexOf("Cluster");
  if (clusterCol === -1) return result;
  const roleCols = [];
  header.forEach((h, idx) => {
    if (idx === clusterCol) return;
    if (CTC_TABLE.hasOwnProperty(h)) roleCols.push({ index: idx, role: h });
  });
  for (let r = 2; r < data.length; r++) {
    const clusterRaw = String(data[r][clusterCol]).trim();
    if (!clusterRaw) continue;
    const key = normKey(clusterRaw);
    if (!result[key]) result[key] = { displayCluster: clusterRaw, roles: {} };
    roleCols.forEach(rc => {
      const hc = Number(data[r][rc.index]) || 0;
      if (hc === 0) return;
      const cost = hc * CTC_TABLE[rc.role] * monthCount;
      if (!result[key].roles[rc.role]) result[key].roles[rc.role] = { count: 0, cost: 0 };
      result[key].roles[rc.role].count += hc;
      result[key].roles[rc.role].cost += cost;
    });
  }
  return result;
}

function getShowroomToClusterMap(obData) {
  const map = {};
  obData.rows.forEach(row => { map[normKey(row.xp)] = row.cluster; });
  return map;
}

function getCombinedShowroomToClusterMap(ss) {
  const obMap = getShowroomToClusterMap(readObRows(ss));
  const r2pMap = getShowroomToClusterMap(readR2pRows(ss));
  return Object.assign({}, r2pMap, obMap);
}

function getHcCostByShowroom(ss, monthCount, showroomToCluster) {
  const sheet = ss.getSheetByName(ACTIVE_HC_TAB_NAME);
  if (!sheet) return null;
  const data = sheet.getDataRange().getValues();
  if (data.length < 3) return null;
  const header = data[1].map(h => String(h).trim());
  let showroomCol = header.findIndex(h => /showroom|outlet|store/i.test(h));
  if (showroomCol === -1 && header.length > 10) showroomCol = 10;
  if (showroomCol === -1) return null;
  const roleCols = [];
  header.forEach((h, idx) => {
    if (idx <= showroomCol) return;
    if (CTC_TABLE.hasOwnProperty(h)) roleCols.push({ index: idx, role: h });
  });
  if (roleCols.length === 0) return null;
  const clusterCost = {}, showroomCost = {};
  for (let r = 2; r < data.length; r++) {
    const showroomRaw = String(data[r][showroomCol]).trim();
    if (!showroomRaw || isAggregateLabel(showroomRaw)) continue;
    const cluster = showroomToCluster[normKey(showroomRaw)];
    if (!cluster) continue;
    const clusterKey = normKey(cluster);
    if (!clusterCost[clusterKey]) clusterCost[clusterKey] = { displayCluster: cluster, roles: {} };
    if (!showroomCost[clusterKey]) showroomCost[clusterKey] = [];
    const roleBreakdown = [];
    let showroomTotal = 0;
    roleCols.forEach(rc => {
      const hc = Number(data[r][rc.index]) || 0;
      if (hc === 0) return;
      const cost = hc * CTC_TABLE[rc.role] * monthCount;
      showroomTotal += cost;
      roleBreakdown.push({ role: rc.role, count: hc, cost: cost });
      if (!clusterCost[clusterKey].roles[rc.role]) clusterCost[clusterKey].roles[rc.role] = { count: 0, cost: 0 };
      clusterCost[clusterKey].roles[rc.role].count += hc;
      clusterCost[clusterKey].roles[rc.role].cost += cost;
    });
    if (roleBreakdown.length > 0) {
      showroomCost[clusterKey].push({ showroom: showroomRaw, roleBreakdown: roleBreakdown, totalCost: showroomTotal });
    }
  }
  return { clusterCost: clusterCost, showroomCost: showroomCost };
}

const FIXED_DCC_LEAD_COUNT = 7;
const FIXED_DCC_PRINCIPAL_COUNT = 7;

function getDccDmBdHeadcount(ss, monthCount) {
  return {
    leadCount: FIXED_DCC_LEAD_COUNT, leadCost: FIXED_DCC_LEAD_COUNT * DCC_LEAD_PRINCIPAL_SALARY * monthCount,
    principalCount: FIXED_DCC_PRINCIPAL_COUNT, principalCost: FIXED_DCC_PRINCIPAL_COUNT * DCC_LEAD_PRINCIPAL_SALARY * monthCount
  };
}

function getDmCostByCluster(ss, monthCount) {
  const result = {};
  const sheet = ss.getSheetByName(DM_LIST_TAB_NAME);
  if (!sheet) return result;
  const data = sheet.getDataRange().getValues();
  const COL_XP = 13, COL_COUNT = 14, COL_CLUSTER = 15;
  let headerRowIdx = -1;
  for (let r = 0; r < Math.min(data.length, 6); r++) {
    const cellO = String((data[r] || [])[COL_COUNT] || '').trim().toLowerCase();
    if (cellO.indexOf('counta of dm') !== -1) { headerRowIdx = r; break; }
  }
  if (headerRowIdx === -1) return result;
  const rate = CTC_TABLE["Design Manager"];
  for (let r = headerRowIdx + 1; r < data.length; r++) {
    const row = data[r] || [];
    const clusterRaw = String(row[COL_CLUSTER] || '').trim();
    if (!clusterRaw || isAggregateLabel(clusterRaw)) continue;
    const count = Number(row[COL_COUNT]) || 0;
    if (count === 0) continue;
    const key = normKey(clusterRaw);
    if (!result[key]) result[key] = { count: 0, cost: 0 };
    result[key].count += count;
    result[key].cost += count * rate * monthCount;
  }
  return result;
}

function getDesignerListData(token) {
  requireSession(token);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(DESIGNER_LIST_TAB_NAME);
  if (!sheet) throw new Error('Tab "' + DESIGNER_LIST_TAB_NAME + '" not found.');
  const data = sheet.getDataRange().getValues();
  if (data.length === 0) return { headers: [], rows: [], clusterCol: -1, showroomCol: -1, statusCol: -1, jobRoleCol: -1 };
  const rawHeaders = data[0].map(h => String(h).trim());
  const EXCLUDE = [/^responsibility$/i, /^lwd$/i, /bu\s*head/i, /business\s*unit\s*head/i, /^doj$/i, /date\s*of\s*joining/i, /date\s*of\s*resignation/i, /^dor$/i, /^buh\b/i, /buh\s*input/i];
  const keepIdx = rawHeaders.reduce((acc, h, idx) => { if (!EXCLUDE.some(p => p.test(h))) acc.push(idx); return acc; }, []);
  const headers = keepIdx.map(i => rawHeaders[i]);
  const rows = data.slice(1).filter(r => r.some(c => String(c).trim() !== '')).map(r => keepIdx.map(i => {
    const cell = r[i];
    if (Object.prototype.toString.call(cell) === '[object Date]') return Utilities.formatDate(cell, Session.getScriptTimeZone(), 'dd-MMM-yyyy');
    return cell;
  }));
  return {
    headers: headers, rows: rows,
    clusterCol: headers.findIndex(h => /^cluster$/i.test(h)),
    showroomCol: headers.findIndex(h => /showroom|outlet|store|^xp$/i.test(h)),
    statusCol: headers.findIndex(h => /status/i.test(h)),
    jobRoleCol: headers.findIndex(h => /job\s*role|^role$/i.test(h))
  };
}

function buildShowroomSummary(obData, months, clusterName, costList, clusterTargetPct) {
  const obList = obByClusterAndXp(obData, months, clusterName);
  const obMap = {};
  obList.forEach(e => { obMap[normKey(e.xp)] = { display: e.xp, ob: e.ob }; });
  const costMap = {};
  costList.forEach(e => { costMap[normKey(e.showroom)] = e; });
  const keys = new Set(Object.keys(obMap).concat(Object.keys(costMap)));
  const result = [];
  keys.forEach(k => {
    const obEntry = obMap[k], costEntry = costMap[k];
    const showroomCost = costEntry ? costEntry.totalCost : 0;
    const showroomOb = effectiveRevenue(obEntry ? obEntry.ob : 0, showroomCost);
    const targetOB = (clusterTargetPct !== null && clusterTargetPct > 0) ? showroomCost / clusterTargetPct : null;
    const obRequired = targetOB !== null ? targetOB - showroomOb : null;
    const achievementPct = (targetOB !== null && targetOB > 0) ? (showroomOb / targetOB) * 100 : (showroomCost > 0 ? 0 : 100);
    result.push({
      showroom: obEntry ? obEntry.display : costEntry.showroom,
      ob: showroomOb, cost: showroomCost,
      costPct: showroomOb ? showroomCost / showroomOb : 0,
      targetPct: clusterTargetPct, targetOB: targetOB, obRequired: obRequired,
      achievementPct: achievementPct, ragStatus: ragFromAchievement(achievementPct),
      roleBreakdown: mergeRoleBreakdown(costEntry ? costEntry.roleBreakdown : [])
    });
  });
  return result.sort((a, b) => b.ob - a.ob);
}

function deriveBudgetMetrics(ob, cost, targetPct) {
  if (targetPct === null || targetPct === undefined) {
    return { targetCost: null, targetOB: null, obRequired: null, achievementPct: null, ragStatus: 'grey', targetCostPct: null, targetOBPct: null, obRequiredPct: null };
  }
  const targetCost = ob * targetPct;
  const targetOB = targetPct > 0 ? cost / targetPct : 0;
  const obRequired = targetOB - ob;
  const achievementPct = targetOB > 0 ? (ob / targetOB) * 100 : (cost > 0 ? 0 : 100);
  let ragStatus = achievementPct >= 100 ? 'green' : achievementPct >= 80 ? 'amber' : 'red';
  return { targetCost, targetOB, obRequired, achievementPct, ragStatus, targetCostPct: targetPct, targetOBPct: ob > 0 ? (targetOB / ob) : null, obRequiredPct: ob > 0 ? (obRequired / ob) : null };
}

function getCurrentMonthData(clusterFilters, showroomFilters, token) {
  requireSession(token);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const obData = readObRows(ss);
  const presentSet = new Set(obData.monthCols.map(mc => mc.label));
  const orderedPresent = FY27_MONTHS.filter(m => presentSet.has(m));
  if (orderedPresent.length === 0) throw new Error('No month columns found in "' + OB_TAB_NAME + '".');
  const month = orderedPresent[orderedPresent.length - 1];
  const months = [month];
  clusterFilters = (clusterFilters || []).filter(Boolean);
  showroomFilters = (showroomFilters || []).filter(Boolean);
  const allClusters = getDistinctClusters(obData);
  const obByCluster = obByClusterMap(obData, months, showroomFilters);
  const showroomToCluster = getShowroomToClusterMap(obData);
  const showroomLevel = getHcCostByShowroom(ss, 1, showroomToCluster);
  const hcByCluster = showroomLevel ? showroomLevel.clusterCost : getHcCostByClusterAndRole(ss, 1);
  const showroomCostByCluster = showroomLevel ? showroomLevel.showroomCost : {};
  const dmByCluster = getDmCostByCluster(ss, 1);
  function costForClusterKey(key) {
    let cost = 0;
    const hcEntry = hcByCluster[key];
    if (hcEntry) Object.keys(hcEntry.roles).forEach(role => { cost += hcEntry.roles[role].cost; });
    const dm = dmByCluster[key];
    if (dm) cost += dm.cost;
    return cost;
  }
  const activeClusters = clusterFilters.length ? allClusters.filter(c => clusterFilters.indexOf(c) !== -1) : allClusters;
  const clusters = activeClusters.map(clusterName => {
    const key = normKey(clusterName);
    const ob = obByCluster[clusterName] || 0;
    const cost = costForClusterKey(key);
    const group = matchGroup(clusterName);
    const targetPct = group ? GROUP_TARGETS[group] : null;
    const m = deriveBudgetMetrics(ob, cost, targetPct);
    const showroomSummary = buildShowroomSummary(obData, months, clusterName, showroomCostByCluster[key] || [], targetPct)
      .filter(sr => !showroomFilters.length || showroomFilters.indexOf(sr.showroom) !== -1);
    return { cluster: clusterName, group, ob, cost, targetPct, ...m, showroomSummary };
  }).sort((a, b) => b.ob - a.ob);
  const totalOB = sumOb(obData, months, clusterFilters, showroomFilters);
  let totalCost = 0;
  activeClusters.forEach(c => { totalCost += costForClusterKey(normKey(c)); });
  const panIndia = deriveBudgetMetrics(totalOB, totalCost, PAN_INDIA_TARGET_PCT);
  return {
    month, filtered: (clusterFilters.length > 0 || showroomFilters.length > 0),
    panIndia: { ob: totalOB, cost: totalCost, targetPct: PAN_INDIA_TARGET_PCT, ...panIndia },
    clusters, allClusters, xpValues: getDistinctXpValues(obData, clusterFilters)
  };
}

function getSummaryYtdMonths(token) {
  requireSession(token);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const obData = readObRows(ss);
  const presentOb = new Set(obData.monthCols.map(mc => mc.label));
  const orderedOb = FY27_MONTHS.filter(m => presentOb.has(m));
  return { allMonths: orderedOb, ytdMonths: orderedOb };
}

// AOP Sheet constants
const AOP_TAB_NAME = "AOP Sheet";
const AOP_MONTH_COLUMNS = { "Apr": "Apr-26", "May": "May-26", "Jun": "Jun-26" };
const FIXED_MONTHS = ["Apr-26", "May-26", "Jun-26"];
const AOP_DIRECT_COST_METRIC_TO_ROLE = {
  "People Cost FTE $ : Design Associate": "Design Associate (AOP FTE)",
  "People Cost FNF $ : Design Associate": "Design Associate (FNF)",
  "People Cost FTE $ : Design Consultant": "Design Consultant (AOP FTE)",
  "People Cost FNF $ : Design Consultant": "Design Consultant (FNF)",
  "People Cost FTE $ : Measurement Executive": "Measurement Executive",
  "People Cost FNF $ : Measurement Executive": "Measurement Executive (FNF)",
  "People Cost $ : DCC Principal": "DCC Principal",
  "People Cost $ : DCC Associate": "DCC Associate",
  "People Cost $ : DCC Lead": "DCC Lead",
  "People Cost $ : Design Attrition/Retention": "Design Attrition/Retention",
  "People Cost $ : Design Partner": "Design Partner",
  "People Incentive $ : Design": "Design Incentive",
  "People Cost FTE $ : Community Manager": "Community Manager",
  "People Cost FNF $ : Community Manager": "Community Manager (FNF)"
};
const AOP_COUNT_METRIC_TO_ROLE = {};

function readAopDirectCosts(ss) {
  const sheet = ss.getSheetByName(AOP_TAB_NAME);
  if (!sheet) return null;
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return null;
  const header = data[0].map(h => String(h).trim());
  const l1Col = header.indexOf("L1");
  const newXpCol = header.indexOf("New XP");
  const newClusterCol = header.indexOf("New Cluster");
  const monthCols = {};
  Object.keys(AOP_MONTH_COLUMNS).forEach(short => { monthCols[AOP_MONTH_COLUMNS[short]] = header.indexOf(short); });
  if (l1Col === -1 || newXpCol === -1 || newClusterCol === -1 || Object.values(monthCols).some(c => c === -1)) return null;
  const result = {};
  FIXED_MONTHS.forEach(m => { result[m] = {}; });
  function addEntry(monthLabel, showroomKey, role, cost, count) {
    if (!result[monthLabel][showroomKey]) result[monthLabel][showroomKey] = {};
    if (!result[monthLabel][showroomKey][role]) result[monthLabel][showroomKey][role] = { cost: 0, count: 0 };
    result[monthLabel][showroomKey][role].cost += cost;
    result[monthLabel][showroomKey][role].count += count;
  }
  for (let r = 1; r < data.length; r++) {
    const l1 = String(data[r][l1Col]).trim();
    const costRole = AOP_DIRECT_COST_METRIC_TO_ROLE[l1];
    if (!costRole) continue;
    const showroomRaw = String(data[r][newXpCol]).trim();
    if (!showroomRaw) continue;
    const key = normKey(showroomRaw);
    FIXED_MONTHS.forEach(monthLabel => {
      const raw = Number(data[r][monthCols[monthLabel]]);
      if (isNaN(raw) || raw === 0) return;
      if (costRole) addEntry(monthLabel, key, costRole, raw * 1e7, 0);
    });
  }
  return result;
}

function buildAopMonthlyAverage(aop) {
  const sums = {}, counts = {};
  FIXED_MONTHS.forEach(monthLabel => {
    const monthData = aop[monthLabel] || {};
    Object.keys(monthData).forEach(showroomKey => {
      if (!sums[showroomKey]) { sums[showroomKey] = {}; counts[showroomKey] = {}; }
      Object.keys(monthData[showroomKey]).forEach(role => {
        const entry = monthData[showroomKey][role];
        if (!sums[showroomKey][role]) { sums[showroomKey][role] = { cost: 0, count: 0 }; counts[showroomKey][role] = { costMonths: 0, countMonths: 0 }; }
        if (entry.cost) { sums[showroomKey][role].cost += entry.cost; counts[showroomKey][role].costMonths++; }
        if (entry.count) { sums[showroomKey][role].count += entry.count; counts[showroomKey][role].countMonths++; }
      });
    });
  });
  const avg = {};
  Object.keys(sums).forEach(showroomKey => {
    avg[showroomKey] = {};
    Object.keys(sums[showroomKey]).forEach(role => {
      const c = counts[showroomKey][role];
      avg[showroomKey][role] = {
        cost: c.costMonths ? sums[showroomKey][role].cost / c.costMonths : 0,
        count: c.countMonths ? Math.round(sums[showroomKey][role].count / c.countMonths) : 0
      };
    });
  });
  return avg;
}

function getCombinedRoleCosts(ss, months, showroomToCluster) {
  const clusterCost = {}, showroomCost = {};
  function findOrCreateShowroomEntry(clusterKey, showroomKey, displayShowroom) {
    if (!showroomCost[clusterKey]) showroomCost[clusterKey] = [];
    let entry = showroomCost[clusterKey].find(e => normKey(e.showroom) === showroomKey);
    if (!entry) { entry = { showroom: displayShowroom, roleBreakdown: [], totalCost: 0 }; showroomCost[clusterKey].push(entry); }
    return entry;
  }
  function addRoleCost(showroomKey, role, entry, displayShowroom) {
    const displayCluster = showroomToCluster[showroomKey];
    if (!displayCluster) return;
    const clusterKey = normKey(displayCluster);
    if (!clusterCost[clusterKey]) clusterCost[clusterKey] = { displayCluster: displayCluster, roles: {} };
    if (!clusterCost[clusterKey].roles[role]) clusterCost[clusterKey].roles[role] = { count: 0, cost: 0 };
    clusterCost[clusterKey].roles[role].cost += entry.cost;
    clusterCost[clusterKey].roles[role].count += entry.count;
    const showroomEntry = findOrCreateShowroomEntry(clusterKey, showroomKey, displayShowroom || showroomKey);
    let rb = showroomEntry.roleBreakdown.find(r => r.role === role);
    if (!rb) { rb = { role: role, count: 0, cost: 0 }; showroomEntry.roleBreakdown.push(rb); }
    rb.cost += entry.cost; rb.count += entry.count; showroomEntry.totalCost += entry.cost;
  }
  const currentMonth = getCalendarCurrentMonthLabel();
  const pastMonthsInSelection = months.filter(m => m !== currentMonth);
  const currentMonthSelected = months.indexOf(currentMonth) !== -1;
  const aop = readAopDirectCosts(ss);
  if (aop && pastMonthsInSelection.length > 0) {
    const average = buildAopMonthlyAverage(aop);
    pastMonthsInSelection.forEach(month => {
      const isFixed = FIXED_MONTHS.indexOf(month) !== -1;
      const monthData = isFixed ? (aop[month] || {}) : average;
      Object.keys(monthData).forEach(showroomKey => {
        Object.keys(monthData[showroomKey]).forEach(role => { addRoleCost(showroomKey, role, monthData[showroomKey][role]); });
      });
    });
  }
  if (currentMonthSelected) {
    const liveLevel = getHcCostByShowroom(ss, 1, showroomToCluster);
    if (liveLevel) {
      Object.keys(liveLevel.showroomCost).forEach(clusterKey => {
        liveLevel.showroomCost[clusterKey].forEach(sc => {
          sc.roleBreakdown.forEach(rb => { addRoleCost(normKey(sc.showroom), rb.role, { cost: rb.cost, count: rb.count }, sc.showroom); });
        });
      });
    }
    if (aop) {
      const average = buildAopMonthlyAverage(aop);
      const isFixed = FIXED_MONTHS.indexOf(currentMonth) !== -1;
      const monthData = isFixed ? (aop[currentMonth] || {}) : average;
      const nonHeadcountRoles = ["Measurement Executive", "Measurement Executive (FNF)", "DCC Principal", "DCC Associate", "DCC Lead", "Design Attrition/Retention", "Design Partner", "Design Incentive", "Community Manager", "Community Manager (FNF)"];
      Object.keys(monthData).forEach(showroomKey => {
        Object.keys(monthData[showroomKey]).forEach(role => {
          if (nonHeadcountRoles.indexOf(role) !== -1) addRoleCost(showroomKey, role, monthData[showroomKey][role]);
        });
      });
    }
  }
  return { clusterCost: clusterCost, showroomCost: showroomCost };
}

function getOverviewData(months, clusterFilters, xpFilters, token) {
  requireSession(token);
  if (!months || months.length === 0) throw new Error('Select at least one month.');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  clusterFilters = (clusterFilters || []).filter(Boolean);
  xpFilters = (xpFilters || []).filter(Boolean).map(normKey);
  const obData = readObRows(ss);
  const allClusters = getDistinctClusters(obData);
  const obByCluster = obByClusterMap(obData, months, xpFilters);
  const totalOB = sumOb(obData, months, clusterFilters, xpFilters);
  const showroomToCluster = getCombinedShowroomToClusterMap(ss);
  const combined = getCombinedRoleCosts(ss, months, showroomToCluster);
  const hcByCluster = combined.clusterCost;
  const showroomCostByCluster = combined.showroomCost;
  function inScope(clusterName, showroomName) {
    if (clusterFilters.length && clusterFilters.indexOf(clusterName) === -1) return false;
    if (xpFilters.length && xpFilters.indexOf(normKey(showroomName)) === -1) return false;
    return true;
  }
  const roleTotals = {};
  Object.keys(showroomCostByCluster).forEach(key => {
    const displayCluster = hcByCluster[key] ? hcByCluster[key].displayCluster : key;
    showroomCostByCluster[key].forEach(sc => {
      if (!inScope(displayCluster, sc.showroom)) return;
      sc.roleBreakdown.forEach(rb => {
        const role = displayRole(rb.role);
        if (!roleTotals[role]) roleTotals[role] = { count: 0, cost: 0 };
        roleTotals[role].count += rb.count; roleTotals[role].cost += rb.cost;
      });
    });
  });
  let totalCostAll = 0;
  Object.values(roleTotals).forEach(rt => totalCostAll += rt.cost);
  const clusterCards = allClusters
    .filter(c => !clusterFilters.length || clusterFilters.indexOf(c) !== -1)
    .map(clusterName => {
      const key = normKey(clusterName);
      const rawOb = obByCluster[clusterName] || 0;
      const hcEntry = hcByCluster[key];
      const roles = hcEntry ? hcEntry.roles : {};
      let cost = 0;
      const roleBreakdownMap = {};
      Object.keys(roles).forEach(role => {
        cost += roles[role].cost;
        const dispRole = displayRole(role);
        if (!roleBreakdownMap[dispRole]) roleBreakdownMap[dispRole] = { role: dispRole, count: 0, cost: 0 };
        roleBreakdownMap[dispRole].count += roles[role].count;
        roleBreakdownMap[dispRole].cost += roles[role].cost;
      });
      const ob = effectiveRevenue(rawOb, cost);
      const group = matchGroup(clusterName);
      const targetPct = group ? GROUP_TARGETS[group] : null;
      const costPct = ob ? cost / ob : 0;
      const targetOB = (targetPct !== null && targetPct > 0) ? cost / targetPct : null;
      const achievementPct = (targetOB !== null && targetOB > 0) ? (ob / targetOB) * 100 : (cost > 0 ? 0 : 100);
      return {
        cluster: clusterName, group, ob, cost, costPct, targetPct,
        targetCost: targetPct !== null ? ob * targetPct : null,
        targetOB, obRequired: targetOB !== null ? targetOB - ob : null,
        achievementPct, ragStatus: ragFromAchievement(achievementPct),
        roleBreakdown: Object.values(roleBreakdownMap).sort((a, b) => b.cost - a.cost),
        showroomSummary: buildShowroomSummary(obData, months, clusterName, showroomCostByCluster[key] || [], targetPct)
      };
    }).sort((a, b) => b.ob - a.ob);
  const costPct = totalOB ? totalCostAll / totalOB : 0;
  const targetPct = computeScopedTargetPct(obData, months, clusterFilters, xpFilters, GROUP_TARGETS, PAN_INDIA_TARGET_PCT);
  const targetOB = targetPct > 0 ? totalCostAll / targetPct : null;
  const achievementPct = (targetOB !== null && targetOB > 0) ? (totalOB / targetOB) * 100 : (totalCostAll > 0 ? 0 : 100);
  return {
    totalOB, totalCost: totalCostAll, costPct, targetPct,
    targetCost: totalOB * targetPct, targetOB, obRequired: targetOB !== null ? targetOB - totalOB : null,
    achievementPct, ragStatus: ragFromAchievement(achievementPct),
    variance: totalCostAll - (totalOB * targetPct),
    components: Object.keys(roleTotals).map(role => ({ role, count: roleTotals[role].count, cost: roleTotals[role].cost, costPct: totalOB ? roleTotals[role].cost / totalOB : 0 })).sort((a, b) => b.cost - a.cost),
    clusterCards, allClusters, xpValues: getDistinctXpValues(obData, clusterFilters)
  };
}

function getActiveHcDiagnostics(token) {
  requireSession(token);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(ACTIVE_HC_TAB_NAME);
  if (!sheet) return { tabFound: false, message: 'Tab "' + ACTIVE_HC_TAB_NAME + '" not found.' };
  return { tabFound: true, message: 'Use this endpoint to debug Active HC matching issues.' };
}
