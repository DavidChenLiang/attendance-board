/*
 * attendance-logic.js
 * 员工假期考勤看板的纯逻辑层（无 DOM 依赖）。
 * 同一份代码被页面 (attendance-board.html) 与回归测试 (attendance-logic.test.js) 共用，
 * 以保证测试锁定的是真实运行的逻辑。
 *
 * 浏览器：作为经典 <script> 加载，函数/变量挂到全局，供页面脚本直接调用。
 * Node：通过 module.exports 导出，供测试 require。
 *
 * 版本号：两版页面共用的唯一真相源，与 CHANGELOG.md 的条目一一对应。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.AttendanceLogic = api;
  // 同时把函数挂到全局，方便页面脚本直接按原名调用（toISO / genDates / cellKey ...）
  Object.keys(api).forEach(k => { root[k] = api[k]; });
})(typeof globalThis !== "undefined" ? globalThis : this, function () {

  // 语义化版本 MAJOR.MINOR.PATCH（改结构 / 加功能 / 修问题），与 CHANGELOG.md 同步
  const VERSION = "1.4.0";

  // ---------- 日期工具（基于本地时区，避免 UTC 偏移导致的 ±1 天）----------
  function toISO(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  }
  function parseISO(s) { const [y, m, dd] = s.split("-").map(Number); return new Date(y, m - 1, dd); }
  function addDays(iso, n) { const d = parseISO(iso); d.setDate(d.getDate() + n); return toISO(d); }
  function isWeekend(iso) { const w = parseISO(iso).getDay(); return w === 0 || w === 6; }
  function nextWorkday(iso) { let d = addDays(iso, 1); while (isWeekend(d)) d = addDays(d, 1); return d; }
  function prevWorkday(iso) { let d = addDays(iso, -1); while (isWeekend(d)) d = addDays(d, -1); return d; }

  // 从 startISO 起生成 days 个日期；workdaysOnly=true 时跳过周六周日（中国双休）
  function genDates(startISO, days, workdaysOnly) {
    const out = []; let cur = startISO;
    while (out.length < days) {
      if (!workdaysOnly || !isWeekend(cur)) out.push(cur);
      cur = addDays(cur, 1);
    }
    return out;
  }
  // 向前（更早）生成 days 个日期，结束于 endISO（含），返回升序数组
  function genDatesBackward(endISO, days, workdaysOnly) {
    const out = []; let cur = endISO;
    while (out.length < days) {
      if (!workdaysOnly || !isWeekend(cur)) out.unshift(cur);
      cur = addDays(cur, -1);
    }
    return out;
  }
  // 以 centerISO 为中心，左右各取 half 天（工作日模式下为工作日），center 始终包含、左右对称
  function genDatesAround(centerISO, half, workdaysOnly) {
    const left = genDatesBackward(addDays(centerISO, -1), half, workdaysOnly);
    const right = genDates(addDays(centerISO, 1), half, workdaysOnly);
    return left.concat([centerISO], right);
  }

  // ---------- 状态 / 颜色 ----------
  const COLORS = {
    "":          { bg: "#ffffff", fg: "#ffffff", label: "" },
    work:       { bg: "#2e9e5b", fg: "#ffffff", label: "" },       // 纯绿图标，不显示文字
    leave:      { bg: "#9aa3ad", fg: "#1f2933", label: "事假" },   // 全天事假：整块灰
    leave_am:   { bg: "#9aa3ad", fg: "#1f2933", label: "上午", title: "事假·上午" }, // 上午事假：与全天事假同色（整块灰），仅标签区分
    leave_pm:   { bg: "#9aa3ad", fg: "#1f2933", label: "下午", title: "事假·下午" }, // 下午事假：与全天事假同色（整块灰），仅标签区分
    sick:       { bg: "#ffffff", fg: "#d12e2e", label: "✚病假" },
    sick_am:    { bg: "#ffffff", fg: "#d12e2e", label: "✚上午", title: "病假·上午" }, // 上午病假：与全天病假同色（白底红字），仅标签区分
    sick_pm:    { bg: "#ffffff", fg: "#d12e2e", label: "✚下午", title: "病假·下午" }, // 下午病假：与全天病假同色（白底红字），仅标签区分
    pubhol:     { bg: "#e7def8", fg: "#3d2c5e", label: "法定假", title: "法定假日（休息，独立统计、不计入事假）" }, // 中瑞国定节假日默认状态
  };
  // 空白格按列类型着色（仅当格子未填状态时生效，让周末/节假日底纹可见）
  const COLTINT = { weekend: "#f0f3f7", holiday: "#fdecec", makeup: "#fff6e0", se: "#e7edff" };

  // ---------- 语言包（中 / 英一键切换；zh 为主语言，en 为英文）----------
  // 状态文案：short = 窄单元格下拉用；full = 图例/批量条/统计/CSV 用；title = 悬停标题
  // UI 文案集中在此，React 版与 vanilla 版共用同一份，避免两处翻译漂移。
  const I18N = {
    zh: {
      status: {
        "":       { short: "",       full: "空白",     title: "" },
        work:     { short: "",       full: "上班",     title: "" },
        leave:    { short: "事假",   full: "事假",     title: "" },
        leave_am: { short: "上午",   full: "事假上午", title: "事假·上午" },
        leave_pm: { short: "下午",   full: "事假下午", title: "事假·下午" },
        sick:     { short: "✚病假", full: "病假",     title: "" },
        sick_am:  { short: "✚上午", full: "病假上午", title: "病假·上午" },
        sick_pm:  { short: "✚下午", full: "病假下午", title: "病假·下午" },
        pubhol:   { short: "法定假", full: "法定假",   title: "法定假日（休息，独立统计、不计入事假）" },
      },
      weekdays: ["日", "一", "二", "三", "四", "五", "六"],
      weekdayPrefix: "周",
      holidayNames: {},              // 中文即数据原名，无需映射
      makeupName: "班",
      country: { CN: "中国", SE: "瑞典" },
      makeupPrefix: "中国·调休班",
      noMark: "无特殊标记",
      ui: {
        title: "员工假期考勤看板",
        corner: "员工 \\ 日期",
        empName: "员工姓名",
        addEmp: "＋ 添加员工",
        start: "起始",
        days: "天数",
        generate: "生成日期列",
        goToday: "回到今天",
        workdaysOnly: "仅工作日（隐藏周末）",
        selectMode: "框选模式",
        selectModeOn: "✓ 框选模式",
        resetWork: "重置为工作日",
        resetBoard: "重置看板",
        exportCsv: "导出 CSV",
        cancel: "取消",
        langBtn: "EN",
        clock24: "24小时制",
        csvHeader: "员工",
        csvName: "考勤看板_",
        dataSource: "节假日数据来源：中国 — 国务院办公厅放假安排通知（含调休补班，覆盖 2025–2026）；瑞典 — 瑞典外交部公告（Circular note 2/2025）+ publicholidays.se（覆盖 2025–2027）。数据随官方公布更新，新年度公布后需追加。",
        renameTitle: "点击改名",
        delTitle: "删除员工",
        selected: (n, nEmp, nDay, d0, d1) => `已选 ${n} 格（${nEmp} 人 × ${nDay} 天：${d0} ~ ${d1}）`,
        summary: (w, l, s, p) => `上班 ${w} · 事假 ${l} · 病假 ${s} · 法定假 ${p}`,
        // 汇总卡片里的短标签（窄卡片只放得下两个字）
        sumLabel: { work: "上班", leave: "事假", sick: "病假", pubhol: "法定假" },
        // 人员统计：默认折叠为一行合计条，点击展开每人卡片
        stats: "人员统计",
        statsExpand: "展开每人明细",
        statsCollapse: "收起",
        empExists: "该员工已存在",
        confirmDel: (emp) => `删除员工「${emp}」及其所有考勤记录？`,
        promptRename: "修改员工姓名：",
        confirmClear: "将所有考勤记录重置为默认（正常工作日显示为上班，例外标记清除）？员工与日期列保留。",
        confirmReset: "重置看板将清空所有员工、日期与考勤记录，并恢复默认 8 名员工？",
        alertStart: "请选择起始日期",
        // 提示拆成三行短句，避免一大段文字连在一起
        tips: [
          "<b>状态</b>：每格下拉选 上班 / 事假（全天·上午·下午）/ 病假（全天·上午·下午）/ 法定假 / 空白。只有事假、病假分上午/下午，各计 0.5 天；事假整块灰，病假白底红十字，法定假淡紫且与事假分开统计。",
          "<b>默认</b>：正常工作日 = 上班（绿）；中瑞国定节假日 = 法定假（淡紫）；周末 = 空白；调休补班 = 上班。表头：红底=中国节假日，琥珀底=调休补班，灰底=周末，蓝底黄十字=仅瑞典假期；悬停查看节日名称。",
          "<b>操作</b>：Ctrl + 拖动平移视图（到边缘自动延展）；按住 <b>Shift</b> 点击或拖动可框选批量改状态，也可先开「框选模式」再拖拽；Esc 取消选区。",
        ],
      },
    },
    en: {
      status: {
        "":       { short: "",        full: "Blank",          title: "" },
        work:     { short: "",        full: "Work",           title: "" },
        leave:    { short: "Leave",   full: "Leave",          title: "" },
        leave_am: { short: "AM",      full: "Leave AM",       title: "Leave · AM" },
        leave_pm: { short: "PM",      full: "Leave PM",       title: "Leave · PM" },
        sick:     { short: "✚Sick",  full: "Sick",           title: "" },
        sick_am:  { short: "✚AM",    full: "Sick AM",        title: "Sick · AM" },
        sick_pm:  { short: "✚PM",    full: "Sick PM",        title: "Sick · PM" },
        pubhol:   { short: "Pub",     full: "Public holiday", title: "Public holiday (rest, counted separately, not as Leave)" },
      },
      weekdays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
      weekdayPrefix: "",
      holidayNames: {
        "元旦": "New Year's Day", "新年": "New Year's Day",
        "春节": "Spring Festival", "清明": "Qingming Festival",
        "劳动节": "Labour Day", "端午": "Dragon Boat Festival",
        "中秋": "Mid-Autumn Festival", "国庆": "National Day",
        "国庆中秋": "National Day & Mid-Autumn",
        "主显节": "Epiphany", "耶稣受难日": "Good Friday",
        "复活节": "Easter Sunday", "复活节星期一": "Easter Monday",
        "耶稣升天节": "Ascension Day", "瑞典国庆日": "National Day of Sweden",
        "圣灵降临节": "Whit Sunday", "仲夏节": "Midsummer Day",
        "万圣节": "All Saints' Day", "圣诞节": "Christmas Day", "节礼日": "Boxing Day",
      },
      makeupName: "Workday (adjusted)",
      country: { CN: "China", SE: "Sweden" },
      makeupPrefix: "China · Adjusted workday",
      noMark: "No special marks",
      ui: {
        title: "Attendance Board",
        corner: "Employee \\ Date",
        empName: "Employee name",
        addEmp: "+ Add employee",
        start: "Start",
        days: "Days",
        generate: "Generate dates",
        goToday: "Go to today",
        workdaysOnly: "Weekdays only (hide weekend)",
        selectMode: "Box-select",
        selectModeOn: "✓ Box-select",
        resetWork: "Reset to workdays",
        resetBoard: "Reset board",
        exportCsv: "Export CSV",
        cancel: "Cancel",
        langBtn: "中文",
        clock24: "24-hour",
        csvHeader: "Employee",
        csvName: "attendance-board_",
        dataSource: "Holiday data sources: China — State Council public holiday arrangements (incl. adjusted make-up workdays, 2025–2026); Sweden — Swedish MFA circular note 2/2025 + publicholidays.se (2025–2027). Data follows official releases; new years must be added after publication.",
        renameTitle: "Click to rename",
        delTitle: "Delete employee",
        selected: (n, nEmp, nDay, d0, d1) => `${n} cells selected (${nEmp} people × ${nDay} days: ${d0} ~ ${d1})`,
        summary: (w, l, s, p) => `Work ${w} · Leave ${l} · Sick ${s} · Public hol. ${p}`,
        // Short labels for the summary cards (narrow cards fit short words only)
        sumLabel: { work: "Work", leave: "Leave", sick: "Sick", pubhol: "Pub.hol" },
        // Attendance summary: collapsed to a single totals bar by default; click to expand per-person cards
        stats: "Attendance summary",
        statsExpand: "Show per-person details",
        statsCollapse: "Collapse",
        empExists: "This employee already exists",
        confirmDel: (emp) => `Delete "${emp}" and all their attendance records?`,
        promptRename: "Rename employee:",
        confirmClear: "Reset all marks to defaults (normal working days become Work, exceptions cleared)? Employees and date columns are kept.",
        confirmReset: "Resetting the board clears all employees, dates and marks, and restores the 8 default employees. Continue?",
        alertStart: "Please select a start date",
        // Tip split into three short lines so it is not one wall of text
        tips: [
          "<b>Status</b>: pick Work / Leave (full · AM · PM) / Sick (full · AM · PM) / Public holiday / Blank per cell. Only Leave and Sick split into AM/PM (0.5 day each). Leave = solid grey, Sick = white with red cross, Public holiday = lavender and counted apart from Leave.",
          "<b>Defaults</b>: normal working day = Work (green); Chinese / Swedish public holiday = Public holiday (lavender); weekend = blank; adjusted make-up day = Work. Header colours: red = Chinese holiday, amber = make-up workday, grey = weekend, blue with yellow cross = Sweden-only holiday. Hover to see holiday names.",
          "<b>Actions</b>: Ctrl + drag to pan (auto-extends at the edges). Hold <b>Shift</b> and click / drag to batch-edit a range, or switch on Box-select and drag; Esc clears the selection.",
        ],
      },
    },
  };
  // 取语言包（缺省 zh，保证旧调用签名不变）
  function localeOf(locale) { return I18N[locale] || I18N.zh; }
  // 状态文案：kind = short | full | title
  function statusText(val, locale, kind) {
    const L = localeOf(locale);
    const s = L.status[val] || L.status[""];
    return s[kind] !== undefined ? s[kind] : "";
  }
  // 星期文案（zh：周三；en：Wed）
  function weekdayText(iso, locale) {
    const L = localeOf(locale);
    return L.weekdayPrefix + L.weekdays[parseISO(iso).getDay()];
  }
  // 节日名称本地化（zh 直接返回原名）
  function holidayNameText(name, L) {
    return (L.holidayNames && L.holidayNames[name]) ? L.holidayNames[name] : name;
  }

  // ---------- 实时时钟（按 IANA 时区，自动处理夏令时）----------
  // 中国 Asia/Shanghai（UTC+8，无夏令时）；瑞典 Europe/Stockholm（UTC+1，夏令时 +2）
  const TZ = { CN: "Asia/Shanghai", SE: "Europe/Stockholm" };
  // 取指定时区下的时/分/秒（2 位补零）；hourCycle h23 保证 00-23
  function clockParts(date, timeZone) {
    const dtf = new Intl.DateTimeFormat("en-GB", {
      timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    });
    const parts = dtf.formatToParts(date);
    const get = (t) => { const p = parts.find(x => x.type === t); return p ? p.value : "00"; };
    return { h: get("hour"), m: get("minute"), s: get("second") };
  }
  // 格式化为 HH:MM:SS
  function clockText(date, timeZone) {
    const { h, m, s } = clockParts(date, timeZone);
    return `${h}:${m}:${s}`;
  }
  // 两地时差（小时，取整）：夏时制下中瑞差 6 小时，冬令时差 7 小时
  function tzOffsetHours(date, timeZone) {
    const dtf = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" });
    const local = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", hour: "2-digit", hourCycle: "h23" });
    const a = parseInt(dtf.format(date), 10);
    const b = parseInt(local.format(date), 10);
    let d = a - b;
    if (d > 12) d -= 24; if (d < -12) d += 24;
    return d;
  }

  // ---------- 法定节假日数据（数据源：官方放假安排；两国同显）----------
  // 中国：国务院放假安排通知（覆盖 2025、2026；新年度公布后追加即可）
  const HOLIDAY_PERIODS = [
    // 2025
    ["2025-01-01", "2025-01-01", "元旦"],
    ["2025-01-28", "2025-02-04", "春节"],
    ["2025-04-04", "2025-04-06", "清明"],
    ["2025-05-01", "2025-05-05", "劳动节"],
    ["2025-05-31", "2025-06-02", "端午"],
    ["2025-10-01", "2025-10-08", "国庆中秋"],
    // 2026
    ["2026-01-01", "2026-01-03", "元旦"],
    ["2026-02-15", "2026-02-23", "春节"],
    ["2026-04-04", "2026-04-06", "清明"],
    ["2026-05-01", "2026-05-05", "劳动节"],
    ["2026-06-19", "2026-06-21", "端午"],
    ["2026-09-25", "2026-09-27", "中秋"],
    ["2026-10-01", "2026-10-07", "国庆"],
  ];
  // 中国调休补班：本为周末但需上班的日期（type=makeup）
  const HOLIDAY_MAKEUP = [
    "2025-01-26", "2025-02-08", "2025-04-27", "2025-09-28", "2025-10-11",
    "2026-01-04", "2026-02-14", "2026-02-28", "2026-05-09", "2026-09-20", "2026-10-10",
  ];
  // 瑞典国定假期（röda dagar / 红日；来源：瑞典政府外交部公告 + publicholidays.se；无调休补班）
  // 覆盖 2025、2026、2027（2027 按固定复活节算法推算，与官方一致）
  const SWEDEN_HOLIDAY_PERIODS = [
    // 2025
    ["2025-01-01", "2025-01-01", "新年"],
    ["2025-01-06", "2025-01-06", "主显节"],
    ["2025-04-18", "2025-04-18", "耶稣受难日"],
    ["2025-04-20", "2025-04-20", "复活节"],
    ["2025-04-21", "2025-04-21", "复活节星期一"],
    ["2025-05-01", "2025-05-01", "劳动节"],
    ["2025-05-29", "2025-05-29", "耶稣升天节"],
    ["2025-06-06", "2025-06-06", "瑞典国庆日"],
    ["2025-06-08", "2025-06-08", "圣灵降临节"],
    ["2025-06-21", "2025-06-21", "仲夏节"],
    ["2025-11-01", "2025-11-01", "万圣节"],
    ["2025-12-25", "2025-12-25", "圣诞节"],
    ["2025-12-26", "2025-12-26", "节礼日"],
    // 2026
    ["2026-01-01", "2026-01-01", "新年"],
    ["2026-01-06", "2026-01-06", "主显节"],
    ["2026-04-03", "2026-04-03", "耶稣受难日"],
    ["2026-04-05", "2026-04-05", "复活节"],
    ["2026-04-06", "2026-04-06", "复活节星期一"],
    ["2026-05-01", "2026-05-01", "劳动节"],
    ["2026-05-14", "2026-05-14", "耶稣升天节"],
    ["2026-06-06", "2026-06-06", "瑞典国庆日"],
    ["2026-05-24", "2026-05-24", "圣灵降临节"],
    ["2026-06-20", "2026-06-20", "仲夏节"],
    ["2026-10-31", "2026-10-31", "万圣节"],
    ["2026-12-25", "2026-12-25", "圣诞节"],
    ["2026-12-26", "2026-12-26", "节礼日"],
    // 2027（复活节 2027-03-28，按固定算法）
    ["2027-01-01", "2027-01-01", "新年"],
    ["2027-01-06", "2027-01-06", "主显节"],
    ["2027-03-26", "2027-03-26", "耶稣受难日"],
    ["2027-03-28", "2027-03-28", "复活节"],
    ["2027-03-29", "2027-03-29", "复活节星期一"],
    ["2027-05-01", "2027-05-01", "劳动节"],
    ["2027-05-06", "2027-05-06", "耶稣升天节"],
    ["2027-06-06", "2027-06-06", "瑞典国庆日"],
    ["2027-05-16", "2027-05-16", "圣灵降临节"],
    ["2027-06-26", "2027-06-26", "仲夏节"],
    ["2027-11-06", "2027-11-06", "万圣节"],
    ["2027-12-25", "2027-12-25", "圣诞节"],
    ["2027-12-26", "2027-12-26", "节礼日"],
  ];

  function buildHolidayMap(periods) {
    const m = {};
    periods.forEach(([s, e, name]) => {
      let c = s;
      while (c <= e) { m[c] = name; c = addDays(c, 1); }
    });
    return m;
  }
  const HOLIDAYS = buildHolidayMap(HOLIDAY_PERIODS);          // 中国法定节假日（date -> 名称）
  const SWEDEN_HOLIDAYS = buildHolidayMap(SWEDEN_HOLIDAY_PERIODS);
  const MAKEUP = new Set(HOLIDAY_MAKEUP);
  function isMakeup(iso) { return MAKEUP.has(iso); }

  // 返回某日的所有节假日条目（两国同显）；每条目含 country(CN/SE)、name、type(holiday/makeup)
  function holidayEntries(iso, locale) {
    const L = localeOf(locale);
    const out = [];
    if (HOLIDAYS[iso]) out.push({ country: "CN", name: holidayNameText(HOLIDAYS[iso], L), type: "holiday" });
    if (MAKEUP.has(iso)) out.push({ country: "CN", name: L.makeupName, type: "makeup" });
    if (SWEDEN_HOLIDAYS[iso]) out.push({ country: "SE", name: holidayNameText(SWEDEN_HOLIDAYS[iso], L), type: "holiday" });
    return out;
  }
  // 兼容旧接口：返回首个条目（中国优先）的 { name, type }，无则 null
  function holidayInfo(iso) {
    const e = holidayEntries(iso);
    return e.length ? { name: e[0].name, type: e[0].type } : null;
  }
  // 列类型（用于表头底色与格子 data-coltype）：makeup(琥珀) > CN holiday(红) > weekend(灰) > ""
  // 注意：瑞典国定假期不再返回 se 特殊类型（网格不做特殊处理），仅表头蓝标提示
  function colTypeOf(iso) {
    const es = holidayEntries(iso);
    if (es.some(e => e.type === "makeup")) return "makeup";
    if (es.some(e => e.country === "CN" && e.type === "holiday")) return "holiday";
    if (isWeekend(iso)) return "weekend";
    return "";
  }
  // 未标记单元格的默认状态：
  //   中瑞国定节假日 => 法定假（pubhol，独立状态，自动显示，所有员工无需手动标记，不计入事假）
  //   调休补班 / 正常工作日 => 上班
  //   周末 => 空白（非工作；周末非"国定假日"，不自动标记休假）
  function defaultStateFor(iso) {
    const es = holidayEntries(iso);
    if (es.some(e => e.type === "makeup")) return "work";   // 调休补班：上班
    if (es.some(e => e.type === "holiday")) return "pubhol"; // 中国法定节假日 或 瑞典国定假期：自动显示"法定假"
    if (isWeekend(iso)) return "";                          // 周末：非工作
    return "work";                                          // 正常工作日
  }
  // 计算 select 的展示样式：未填状态时按列类型着底纹色，已填状态用状态色
  // 注意：瑞典国定假期(se)仅表头标注，下方格子不着色（保持白），故此处跳过 se
  function paintSelectStyle(value, coltype) {
    const c = COLORS[value] || COLORS[""];
    let bg = c.bg, fg = c.fg;
    if ((value === "" || value === undefined || value === null) && coltype && coltype !== "se" && COLTINT[coltype]) {
      bg = COLTINT[coltype];
    }
    return { bg, fg };
  }

  function cellKey(emp, iso) { return emp + "|" + iso; }

  function defaultEmployees() {
    return ["张三 Zhang", "李四 Li", "王五 Wang", "周八 Zhou",
            "赵六 Zhao", "Emily Liu", "孙七 Sun", "Michael Wu"];
  }
  function defaultState() {
    return {
      employees: defaultEmployees(),
      dates: genDates(toISO(new Date()), 14, true),
      cells: {},
      workdaysOnly: true,
    };
  }

  // ---------- 边缘自动延展 ----------
  // 向左（更早）补 EXTEND 天，返回与原有左端连续的新数组
  function extendLeft(dates, workdaysOnly, EXTEND) {
    if (!dates.length) return dates;
    const extStart = workdaysOnly ? prevWorkday(dates[0]) : addDays(dates[0], -1);
    const extra = genDatesBackward(extStart, EXTEND, workdaysOnly);
    return extra.concat(dates);
  }
  // 向右（更晚）补 EXTEND 天，返回与原有右端连续的新数组
  function extendRight(dates, workdaysOnly, EXTEND) {
    if (!dates.length) return dates;
    const last = dates[dates.length - 1];
    const extStart = workdaysOnly ? nextWorkday(last) : addDays(last, 1);
    const extra = genDates(extStart, EXTEND, workdaysOnly);
    return dates.concat(extra);
  }

  // 切换 仅工作日 / 日历周：保持原日期跨度，按模式筛选（数据保留）
  function rebuildDates(state) {
    if (!state.dates.length) {
      state.dates = genDates(toISO(new Date()), 14, state.workdaysOnly);
      return state;
    }
    const min = state.dates[0], max = state.dates[state.dates.length - 1];
    const full = []; let c = min;
    while (c <= max) { full.push(c); c = addDays(c, 1); }
    state.dates = state.workdaysOnly ? full.filter(d => !isWeekend(d)) : full;
    return state;
  }

  // ---------- 统计 / 导出 ----------
  // 统计每位员工 上班/休假/病假 天数（空白不计）
  function computeSummary(employees, dates, cells) {
    return employees.map(emp => {
      let work = 0, leave = 0, sick = 0, pubhol = 0;
      for (const iso of dates) {
        let v = cells[cellKey(emp, iso)];
        if (v === undefined) v = defaultStateFor(iso);
        if (v === "work") work++;
        else if (v === "leave") leave++;                       // 全天事假 = 1 天
        else if (v === "leave_am" || v === "leave_pm") leave += 0.5; // 上午/下午事假各计 0.5 天
        else if (v === "sick") sick++;                         // 全天病假 = 1 天
        else if (v === "sick_am" || v === "sick_pm") sick += 0.5;   // 上午/下午病假各计 0.5 天
        else if (v === "pubhol") pubhol++;                     // 法定假日（中瑞国定节假日）：独立统计，不计入事假
      }
      return { emp, work, leave, sick, pubhol };
    });
  }

  // 全员合计：用于「人员统计」折叠条上常显的一行数字
  function computeTotals(employees, dates, cells) {
    return computeSummary(employees, dates, cells).reduce((a, s) => ({
      work: a.work + s.work,
      leave: a.leave + s.leave,
      sick: a.sick + s.sick,
      pubhol: a.pubhol + s.pubhol,
    }), { work: 0, leave: 0, sick: 0, pubhol: 0 });
  }

  // 生成 CSV 文本（不含 BOM；调用方按需加 BOM）。空白格输出为空
  function buildCsv(employees, dates, cells, locale) {
    const L = localeOf(locale);
    let csv = L.ui.csvHeader + "," + dates.join(",") + "\n";
    for (const emp of employees) {
      const row = [emp];
      for (const iso of dates) {
        let v = cells[cellKey(emp, iso)];
        if (v === undefined) v = defaultStateFor(iso);
        if (v === "none") v = "";
        row.push(v === "" ? "" : statusText(v, locale, "full")); // 空白格输出空（沿用原行为）
      }
      csv += row.join(",") + "\n";
    }
    return csv;
  }

  // ---------- 渲染（纯字符串拼装，便于测试）----------
  function escapeHtml(s) { return s.replace(/[&<>]/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m])); }
  function escapeAttr(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#39;");
  }

  function buildBoardHtml(state, todayISO, locale) {
    const L = localeOf(locale);
    let html = `<thead><tr><th class='corner'>${L.ui.corner}</th>`;
    for (const iso of state.dates) {
      const wd = weekdayText(iso, locale);
      const ct = colTypeOf(iso);                 // 用于格子 data-coltype 着色（瑞典不外加）
      const ents = holidayEntries(iso, locale);
      const hasCN = ents.some(e => e.country === "CN" && e.type === "holiday");
      const hasMakeup = ents.some(e => e.type === "makeup");
      const hasSE = ents.some(e => e.country === "SE" && e.type === "holiday");
      // 日期表头底色优先级：调休 > 中国法定节假日 > 仅瑞典节日(国旗配色) > 周末；其余普通
      let hd = "hd";
      if (hasMakeup) hd = "hd makeup";
      else if (hasCN) hd = "hd holiday";
      else if (hasSE) hd = "hd seflag";          // 仅瑞典国定假期 → 瑞典国旗配色
      else if (isWeekend(iso)) hd = "hd weekend";
      const isToday = todayISO && iso === todayISO;
      // 节日名称不再内联（避免撑高表头），改由鼠标悬停浮动窗口显示（见页面 #tipFloat）；此处仅留 data-iso 供提示定位
      html += `<th class='${hd}${isToday ? " today" : ""}' data-iso='${iso}'>${iso.slice(5)}<br>${wd}</th>`;
    }
    html += "</tr></thead><tbody>";
    for (const emp of state.employees) {
      html += `<tr><th class='emp'><div class='emp-inner'><span class='emp-name' title='点击改名'>${escapeHtml(emp)}</span><span class='emp-del' title='删除员工'>✕</span></div></th>`;
      for (const iso of state.dates) {
        let v = state.cells[cellKey(emp, iso)];
        if (v === undefined) v = defaultStateFor(iso);
        if (v === "none") v = "";
        const ct = colTypeOf(iso);
        const isToday = todayISO && iso === todayISO;
        const c = paintSelectStyle(v, ct);                 // 已填状态用状态色；空白按列类型着底纹
        const sel = (val) => {
          const cc = COLORS[val];
          const t = statusText(val, locale, "title");
          const title = t ? ` title='${t}'` : "";
          return `<option value='${val}'${v === val ? " selected" : ""}${title} style='background:${cc.bg};color:${cc.fg}'>${statusText(val, locale, "short")}</option>`;
        };
        html += `<td class='cellwrap${isToday ? " today" : ""}'><select class='cellsel${isToday ? " today" : ""}' data-emp='${escapeAttr(emp)}' data-iso='${iso}' data-coltype='${ct}' style='background:${c.bg};color:${c.fg}'>${sel("")}${sel("work")}${sel("leave")}${sel("leave_am")}${sel("leave_pm")}${sel("sick")}${sel("sick_am")}${sel("sick_pm")}${sel("pubhol")}</select></td>`;
      }
      html += "</tr>";
    }
    html += "</tbody>";
    return html;
  }

  return {
    VERSION,
    toISO, parseISO, addDays, isWeekend, nextWorkday, prevWorkday,
    genDates, genDatesBackward, genDatesAround, COLORS, COLTINT, cellKey,
    HOLIDAYS, SWEDEN_HOLIDAYS, MAKEUP, isMakeup, holidayInfo, holidayEntries, colTypeOf, defaultStateFor, paintSelectStyle,
    I18N, LOCALES: Object.keys(I18N), localeOf, statusText, weekdayText, holidayNameText,
    TZ, clockParts, clockText, tzOffsetHours,
    defaultEmployees, defaultState,
    extendLeft, extendRight, rebuildDates, computeSummary, computeTotals, buildCsv,
    escapeHtml, escapeAttr, buildBoardHtml,
  };
});
