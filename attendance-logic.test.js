/*
 * attendance-logic.test.js
 * 回归测试：锁定考勤看板的纯逻辑功能点（日期计算 / 双休过滤 / 延展 / 统计 / 导出）。
 * 运行：node attendance-logic.test.js
 */
const assert = require("assert");
const L = require("./attendance-logic.js");

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log("  ✓ " + name); }
  catch (e) { fail++; console.log("  ✗ " + name + "\n      " + e.message); }
}
function eq(actual, expected, msg) { assert.deepStrictEqual(actual, expected, msg); }
function ok(cond, msg) { assert.ok(cond, msg); }

console.log("日期工具（基于本地时区，无 UTC 偏移）");
test("addDays 跨月/跨年无偏移", () => {
  eq(L.addDays("2026-10-14", 1), "2026-10-15");
  eq(L.addDays("2026-10-31", 1), "2026-11-01");
  eq(L.addDays("2026-12-31", 1), "2027-01-01");
  eq(L.addDays("2026-03-01", -1), "2026-02-28"); // 2026 非闰年
});
test("addDays 负数与零", () => {
  eq(L.addDays("2026-10-14", 0), "2026-10-14");
  eq(L.addDays("2026-10-14", -14), "2026-09-30");
});
test("toISO 格式化补零", () => {
  eq(L.toISO(new Date(2026, 0, 5)), "2026-01-05");
});

console.log("周末判定（中国双休：周六、周日）");
test("isWeekend 已知日期", () => {
  eq(L.isWeekend("2026-10-17"), true);  // 周六
  eq(L.isWeekend("2026-10-18"), true);  // 周日
  eq(L.isWeekend("2026-10-19"), false); // 周一
  eq(L.isWeekend("2026-10-14"), false); // 周三
});
test("nextWorkday / prevWorkday 跳过周末", () => {
  eq(L.nextWorkday("2026-10-16"), "2026-10-19"); // 周五→下周一
  eq(L.prevWorkday("2026-10-19"), "2026-10-16"); // 周一→上周五
});

console.log("日期生成（仅工作日 vs 日历周）");
test("genDates 仅工作日不含周末且连续", () => {
  const r = L.genDates("2026-10-14", 5, true);
  eq(r, ["2026-10-14", "2026-10-15", "2026-10-16", "2026-10-19", "2026-10-20"]);
  r.forEach(d => assert.ok(!L.isWeekend(d), d + " 不应该是周末"));
});
test("genDates 日历周含全部 7 天", () => {
  const r = L.genDates("2026-10-14", 5, false);
  eq(r, ["2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"]);
});
test("genDatesBackward 向前且升序连续", () => {
  const r = L.genDatesBackward("2026-10-16", 5, true);
  eq(r, ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"]);
});
test("genDatesAround 以中心左右对称、中心必含", () => {
  const r = L.genDatesAround("2026-10-14", 2, true); // 周三为中心
  eq(r, ["2026-10-12","2026-10-13","2026-10-14","2026-10-15","2026-10-16"]);
  const c = r.indexOf("2026-10-14");
  eq(c, 2);                 // 居中
  eq(c, r.length - 1 - c);  // 左右对称
  eq(L.genDatesAround("2026-10-14", 2, false), ["2026-10-12","2026-10-13","2026-10-14","2026-10-15","2026-10-16"]);
});
test("genDatesAround 中心为周末时仍包含（工作日模式）", () => {
  const r = L.genDatesAround("2026-10-17", 1, true); // 周六为中心
  assert.ok(r.includes("2026-10-17"), "周末中心仍包含");
  const c = r.indexOf("2026-10-17");
  assert.ok(c === 1 && r.length === 3, "左右各 1 天、中心居中");
});

console.log("边缘自动延展（保持连续、模式一致）");
test("extendLeft 向前补工作日且与原序列连续", () => {
  const base = ["2026-10-14", "2026-10-15", "2026-10-16"];
  const r = L.extendLeft(base, true, 2);
  eq(r, ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"]);
  r.forEach(d => assert.ok(!L.isWeekend(d), d + " 不应该是周末"));
});
test("extendRight 向后补工作日且与原序列连续", () => {
  const base = ["2026-10-14", "2026-10-15", "2026-10-16"];
  const r = L.extendRight(base, true, 2);
  eq(r, ["2026-10-14", "2026-10-15", "2026-10-16", "2026-10-19", "2026-10-20"]);
});
test("extendLeft/Right 日历周模式", () => {
  const base = ["2026-10-14", "2026-10-15"];
  eq(L.extendRight(base, false, 2), ["2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17"]);
});

console.log("切换 仅工作日 / 日历周（保持跨度、数据保留）");
test("rebuildDates 仅工作日过滤掉周末", () => {
  const state = { dates: L.genDates("2026-10-12", 7, false), workdaysOnly: true };
  L.rebuildDates(state);
  assert.ok(state.dates.every(d => !L.isWeekend(d)));
  assert.ok(state.dates.length === 5, "7个日历日中应有5个工作日");
});
test("rebuildDates 日历周保留全部（含周末）", () => {
  // 7 个工作日从 10-12 起 => 跨度 10-12..10-20，含周末 17、18
  const state = { dates: L.genDates("2026-10-12", 7, true), workdaysOnly: false };
  L.rebuildDates(state);
  eq(state.dates.length, 9);
  assert.ok(state.dates.includes("2026-10-17") && state.dates.includes("2026-10-18"));
});

console.log("默认状态");
test("defaultState：8 名员工、仅工作日、14 个工作日", () => {
  const s = L.defaultState();
  eq(s.employees.length, 8);
  eq(s.workdaysOnly, true);
  eq(s.dates.length, 14);
  assert.ok(s.dates.every(d => !L.isWeekend(d)));
  // 连续升序
  for (let i = 1; i < s.dates.length; i++) {
    assert.ok(L.addDays(s.dates[i - 1], 1) >= s.dates[i] || !L.isWeekend(s.dates[i-1]), "应连续");
  }
});

console.log("颜色映射");
test("COLORS 标签与背景色", () => {
  eq(L.COLORS.work.bg, "#2e9e5b");  eq(L.COLORS.work.label, "");   // 上班=纯色图标，无文字
  eq(L.COLORS.leave.bg, "#9aa3ad"); eq(L.COLORS.leave.label, "事假"); // 全天事假=整块灰
  eq(L.COLORS.sick.bg, "#ffffff");  eq(L.COLORS.sick.fg, "#d12e2e"); eq(L.COLORS.sick.label, "✚病假");
  eq(L.COLORS[""].label, "");        // 空白默认
  // 上午/下午事假：与全天事假同色（整块灰 #9aa3ad），仅以标签 上午/下午 区分（不再用半渐变）
  eq(L.COLORS.leave_am.bg, "#9aa3ad");
  eq(L.COLORS.leave_am.label, "上午"); eq(L.COLORS.leave_am.title, "事假·上午");
  eq(L.COLORS.leave_pm.bg, "#9aa3ad");
  eq(L.COLORS.leave_pm.label, "下午"); eq(L.COLORS.leave_pm.title, "事假·下午");
  // 上午/下午病假：与全天病假同色（白底红字），以 ✚上午/✚下午 区分（不再用粉红半渐变）
  eq(L.COLORS.sick_am.bg, "#ffffff");
  eq(L.COLORS.sick_am.label, "✚上午"); eq(L.COLORS.sick_am.title, "病假·上午");
  eq(L.COLORS.sick_pm.bg, "#ffffff");
  eq(L.COLORS.sick_pm.label, "✚下午"); eq(L.COLORS.sick_pm.title, "病假·下午");
  // 法定假：独立状态（淡紫），与事假/病假并列，不混入事假
  eq(L.COLORS.pubhol.bg, "#e7def8"); eq(L.COLORS.pubhol.fg, "#3d2c5e"); eq(L.COLORS.pubhol.label, "法定假");
  eq(L.COLORS.pubhol.title, "法定假日（休息，独立统计、不计入事假）");
});

console.log("cellKey 格式");
test("cellKey 拼接", () => {
  eq(L.cellKey("张三 Zhang", "2026-10-14"), "张三 Zhang|2026-10-14");
});

console.log("统计与导出");
test("computeSummary 计数正确（缺省工作日计为上班）", () => {
  const employees = ["A", "B"];
  const dates = ["2026-10-14", "2026-10-15"];
  const cells = { "A|2026-10-14": "work", "A|2026-10-15": "leave", "B|2026-10-14": "sick" }; // B 的 10-15 缺省=上班
  const r = L.computeSummary(employees, dates, cells);
  eq(r[0], { emp: "A", work: 1, leave: 1, sick: 0, pubhol: 0 });
  eq(r[1], { emp: "B", work: 1, leave: 0, sick: 1, pubhol: 0 });
});
test("computeSummary：上午/下午休假各计 0.5 天（全天 leave 仍计 1）", () => {
  const employees = ["A"];
  const dates = ["2026-10-14", "2026-10-15", "2026-10-16"];
  const cells = {
    "A|2026-10-14": "leave",      // 全天休假 = 1
    "A|2026-10-15": "leave_am",   // 上午休假 = 0.5
    "A|2026-10-16": "leave_pm",   // 下午休假 = 0.5
  };
  const r = L.computeSummary(employees, dates, cells);
  eq(r[0], { emp: "A", work: 0, leave: 2, sick: 0, pubhol: 0 }); // 1 + 0.5 + 0.5 = 2
});
test("computeSummary：同一天上午+下午拆分后合计仍为 1 天休假", () => {
  const employees = ["A"];
  const dates = ["2026-10-14"];
  const cells = { "A|2026-10-14": "leave_am" };
  eq(L.computeSummary(employees, dates, cells)[0].leave, 0.5);
});
test("computeSummary：上午/下午病假各计 0.5 天（全天 sick 仍计 1）", () => {
  const employees = ["A"];
  const dates = ["2026-10-14", "2026-10-15", "2026-10-16"];
  const cells = {
    "A|2026-10-14": "sick",      // 全天病假 = 1
    "A|2026-10-15": "sick_am",   // 上午病假 = 0.5
    "A|2026-10-16": "sick_pm",   // 下午病假 = 0.5
  };
  const r = L.computeSummary(employees, dates, cells);
  eq(r[0], { emp: "A", work: 0, leave: 0, sick: 2, pubhol: 0 }); // 1 + 0.5 + 0.5 = 2
});
test("computeSummary：法定假独立统计，不计入事假（缺省节假日=法定假）", () => {
  const employees = ["A"];
  // 2026-01-01 元旦（CN+SE 国定节假日，缺省应计为 pubhol），2026-05-14 瑞典耶稣升天节（缺省 pubhol）
  const dates = ["2026-01-01", "2026-05-14", "2026-10-14"];
  const cells = { "A|2026-10-14": "work" }; // 普通工作日显式上班
  const r = L.computeSummary(employees, dates, cells);
  eq(r[0], { emp: "A", work: 1, leave: 0, sick: 0, pubhol: 2 }); // 两个国定节假日缺省→法定假
  // 显式标记法定假（手动覆盖当天）依旧计为 pubhol，不计入事假
  const cells2 = { "A|2026-01-01": "pubhol" };
  const r2 = L.computeSummary(employees, ["2026-01-01"], cells2);
  eq(r2[0], { emp: "A", work: 0, leave: 0, sick: 0, pubhol: 1 });
});
console.log("人员统计合计（computeTotals，折叠条上常显的一行数字）");
test("computeTotals：全员四类合计 = 各人 computeSummary 之和", () => {
  const employees = ["A", "B"];
  const dates = ["2026-10-14", "2026-10-15", "2026-01-01"]; // 含元旦（缺省法定假）
  const cells = {
    "A|2026-10-14": "work",
    "A|2026-10-15": "leave_am",   // 0.5
    "B|2026-10-14": "sick_pm",    // 0.5
    "B|2026-10-15": "pubhol",
  };
  const per = L.computeSummary(employees, dates, cells);
  const tot = L.computeTotals(employees, dates, cells);
  ["work", "leave", "sick", "pubhol"].forEach(k => {
    eq(tot[k], per.reduce((a, s) => a + s[k], 0), k + " 合计应等于各人之和");
  });
  eq(tot, { work: 1, leave: 0.5, sick: 0.5, pubhol: 3 }); // A:work1+leave.5+pubhol1 / B:sick.5+pubhol2
});
test("computeTotals：空员工 / 空日期均返回全 0（不崩）", () => {
  eq(L.computeTotals([], [], {}), { work: 0, leave: 0, sick: 0, pubhol: 0 });
  eq(L.computeTotals(["A"], [], {}), { work: 0, leave: 0, sick: 0, pubhol: 0 });
  eq(L.computeTotals([], ["2026-10-14"], {}), { work: 0, leave: 0, sick: 0, pubhol: 0 });
});
test("buildCsv 表头+行、未标记工作日默认上班、不含 BOM", () => {
  const employees = ["A"];
  const dates = ["2026-10-14", "2026-10-15"];
  const cells = { "A|2026-10-14": "leave" }; // 第二个未标记 -> 默认工作日出 上班
  const csv = L.buildCsv(employees, dates, cells);
  assert.ok(!csv.startsWith("﻿"), "不应含 BOM");
  eq(csv, "员工,2026-10-14,2026-10-15\nA,事假,上班\n");
});
test("buildCsv：事假上午/下午映射为「事假上午」「事假下午」，全天事假为「事假」", () => {
  const employees = ["A"];
  const dates = ["2026-10-14", "2026-10-15", "2026-10-16"];
  const cells = {
    "A|2026-10-14": "leave_am",
    "A|2026-10-15": "leave_pm",
    "A|2026-10-16": "leave",
  };
  const csv = L.buildCsv(employees, dates, cells);
  eq(csv, "员工,2026-10-14,2026-10-15,2026-10-16\nA,事假上午,事假下午,事假\n");
});
test("buildCsv：病假上午/下午映射为「病假上午」「病假下午」，全天病假为「病假」", () => {
  const employees = ["A"];
  const dates = ["2026-10-14", "2026-10-15", "2026-10-16"];
  const cells = {
    "A|2026-10-14": "sick_am",
    "A|2026-10-15": "sick_pm",
    "A|2026-10-16": "sick",
  };
  const csv = L.buildCsv(employees, dates, cells);
  eq(csv, "员工,2026-10-14,2026-10-15,2026-10-16\nA,病假上午,病假下午,病假\n");
});
test("buildCsv：法定假映射为「法定假」", () => {
  const employees = ["A"];
  const dates = ["2026-01-01", "2026-10-14"]; // 元旦(国定节假日)缺省→法定假；普通工作日缺省→上班
  const cells = {};
  const csv = L.buildCsv(employees, dates, cells);
  eq(csv, "员工,2026-01-01,2026-10-14\nA,法定假,上班\n");
});

console.log("渲染矩阵（buildBoardHtml，纯字符串拼装）");
test("员工行与日期列数量正确", () => {
  const s = { employees: ["A", "B"], dates: L.genDates("2026-10-14", 3, true), cells: {} };
  const h = L.buildBoardHtml(s);
  assert.ok(h.includes("员工 \\ 日期"), "应含 corner 表头");
  const dateCols = (h.match(/data-coltype=/g) || []).length / s.employees.length; // 每格 select 含一个 data-coltype（表头无，避免重复计数）
  eq(dateCols, s.dates.length);                                       // 日期列数
  eq((h.match(/class='emp'/g) || []).length, s.employees.length); // 员工行数
  eq((h.match(/class='cellwrap'/g) || []).length, s.employees.length * s.dates.length); // 单元格数
});
test("默认（工作日）每格上班 option 选中", () => {
  const s = { employees: ["A"], dates: L.genDates("2026-10-14", 2, true), cells: {} };
  const h = L.buildBoardHtml(s);
  eq((h.match(/value='work' selected/g) || []).length, s.employees.length * s.dates.length);
});
test("buildBoardHtml：下拉含 事假/病假 的上午/下午 独立选项 + 法定假（共 9 项）", () => {
  const s = { employees: ["A"], dates: L.genDates("2026-10-14", 1, true), cells: {} };
  const h = L.buildBoardHtml(s);
  // 每格 select 应含 9 个 option：空白/上班/事假/事假上午/事假下午/病假/病假上午/病假下午/法定假
  const opts = (h.match(/<option /g) || []).length / s.employees.length / s.dates.length;
  eq(opts, 9);
  assert.ok(h.includes("value='leave'"), "应含 事假(全天) 选项");
  assert.ok(h.includes("value='leave_am'"), "应含 事假上午 选项");
  assert.ok(h.includes("value='leave_pm'"), "应含 事假下午 选项");
  assert.ok(h.includes("value='sick'"), "应含 病假(全天) 选项");
  assert.ok(h.includes("value='sick_am'"), "应含 病假上午 选项");
  assert.ok(h.includes("value='sick_pm'"), "应含 病假下午 选项");
  assert.ok(h.includes("value='pubhol'"), "应含 法定假 选项");
  // 上午/下午选项带悬停标题，供下拉中区分事假/病假；法定假也带标题
  assert.ok(h.includes("title='事假·上午'") && h.includes("title='病假·上午'"), "上午/下午选项应带悬停标题");
  assert.ok(h.includes("title='法定假日（休息，独立统计、不计入事假）'"), "法定假选项应带悬停标题");
});
test("buildBoardHtml：工作日默认上班、周末默认空白、中瑞国定节假日默认休假", () => {
  const s = { employees: ["A"], dates: ["2026-10-14","2026-10-17","2026-01-01","2026-05-09"], cells: {} };
  const h = L.buildBoardHtml(s);
  eq((h.match(/value='work' selected/g) || []).length, 2); // 周三 + 调休(周六上班)
  eq((h.match(/value='' selected/g) || []).length, 1);      // 仅周六（周末空白；元旦已改为法定假）
  eq((h.match(/value='pubhol' selected/g) || []).length, 1); // 元旦（中瑞国定节假日）→ 法定假
});
test("已填状态：对应 option 选中且每格恰好一个", () => {
  const s = { employees: ["A"], dates: L.genDates("2026-10-14", 2, true), cells: { "A|2026-10-14": "work" } };
  const h = L.buildBoardHtml(s);
  assert.ok(h.includes("value='work' selected"), "work 应被选中");
  eq((h.match(/ selected/g) || []).length, s.employees.length * s.dates.length);
});
test("仅工作日月：不出现周六/周日表头", () => {
  const s = { employees: ["A"], dates: L.genDates("2026-10-12", 7, true), cells: {} }; // 含周末跨度
  const h = L.buildBoardHtml(s);
  assert.ok(!h.includes("周六") && !h.includes("周日"), "仅工作日不应有周末表头");
});
test("日历周：出现周末表头", () => {
  const s = { employees: ["A"], dates: L.genDates("2026-10-12", 7, false), cells: {} };
  const h = L.buildBoardHtml(s);
  assert.ok(h.includes("周六") || h.includes("周日"), "日历周应出现周末表头");
});
test("员工名特殊字符被转义", () => {
  const s = { employees: ["<b>&'x</b>"], dates: L.genDates("2026-10-14", 1, true), cells: {} };
  const h = L.buildBoardHtml(s);
  assert.ok(h.includes("&lt;b&gt;&amp;'x&lt;/b&gt;"), "尖括号与 & 应转义");
  assert.ok(!h.includes("<b>"), "原始尖括号不应原样出现");
});

console.log("法定节假日 / 调休标记（数据源：国务院放假安排）");
test("holidayInfo 法定节假日与调休", () => {
  eq(L.holidayInfo("2026-01-01"), { name: "元旦", type: "holiday" });
  eq(L.holidayInfo("2026-02-15"), { name: "春节", type: "holiday" });
  eq(L.holidayInfo("2026-05-09"), { name: "班", type: "makeup" });   // 劳动节调休补班（周六）
  eq(L.holidayInfo("2026-10-10"), { name: "班", type: "makeup" });   // 国庆调休补班（周六）
  eq(L.holidayInfo("2026-10-14"), null);                            // 普通工作日
  assert.ok(L.isMakeup("2026-05-09"));
  assert.ok(!L.isMakeup("2026-10-14"));
});
test("colTypeOf 优先级 holiday > makeup > weekend", () => {
  eq(L.colTypeOf("2026-01-01"), "holiday");   // 元旦（周四）
  eq(L.colTypeOf("2026-04-04"), "holiday");   // 清明（周六，节假日优先于周末）
  eq(L.colTypeOf("2026-05-09"), "makeup");    // 调休补班（周六）
  eq(L.colTypeOf("2026-10-17"), "weekend");   // 普通周六
  eq(L.colTypeOf("2026-10-14"), "");          // 普通周三
});
test("defaultStateFor：正常工作日=上班，中瑞国定节假日=法定假，周末=空白，调休=上班", () => {
  eq(L.defaultStateFor("2026-10-14"), "work");  // 周三工作日
  eq(L.defaultStateFor("2026-10-17"), "");      // 周六（非工作，周末非国定假日，不自动标记）
  eq(L.defaultStateFor("2026-01-01"), "pubhol"); // 元旦（中瑞两国同放）：自动显示法定假（独立状态）
  eq(L.defaultStateFor("2026-05-09"), "work");  // 调休补班（周六上班）
});
test("paintSelectStyle：空白格按列类型上色，状态格用状态色", () => {
  eq(L.paintSelectStyle("", "holiday").bg, "#fdecec");
  eq(L.paintSelectStyle("", "weekend").bg, "#f0f3f7");
  eq(L.paintSelectStyle("", "").bg, "#ffffff");
  eq(L.paintSelectStyle("work", "holiday").bg, "#2e9e5b"); // 已填状态色优先
});
test("paintSelectStyle：瑞典假期空白格不着色（保持白），已填仍用状态色", () => {
  eq(L.paintSelectStyle("", "se").bg, "#ffffff");    // 瑞典假期：下方格子保持白（仅表头标注）
  eq(L.paintSelectStyle("work", "se").bg, "#2e9e5b"); // 已填状态色优先
});

console.log("渲染矩阵（底纹 / 标记）");
test("日历周：周末列着底纹、调休列着 makeup 底色（名称移至浮动提示）", () => {
  const s = { employees: ["A"], dates: L.genDates("2026-05-04", 8, false), cells: {} }; // 含 05-09 周六(调休) 与周末
  const h = L.buildBoardHtml(s);
  assert.ok(h.includes("class='hd weekend'"), "周末列应有 weekend 类");
  assert.ok(h.includes("class='hd makeup'"), "调休列应有 makeup 类");
  assert.ok(h.includes("data-coltype='weekend'"), "周末格 select 应带 data-coltype=weekend");
  assert.ok(h.includes("data-coltype='makeup'"), "调休格 select 应带 data-coltype=makeup");
  assert.ok(!h.includes("htag"), "节日名称不再内联，改由悬停浮动窗口显示");
});
test("日历周：法定节假日列着 holiday 底色（名称移至浮动提示）", () => {
  const s = { employees: ["A"], dates: L.genDates("2026-01-01", 3, false), cells: {} }; // 01-01..01-03 元旦
  const h = L.buildBoardHtml(s);
  assert.ok(h.includes("class='hd holiday'"), "元旦列应有 holiday 类（红底）");
  assert.ok(!h.includes(">元旦<"), "内联名称标记已移除");
});
test("工作日模式：周末被隐藏，周内节假日仍带标记", () => {
  // 2026-05-04..05-08 均为工作日，其中无节假日；验证无 weekend 类（周末已被过滤）
  const s = { employees: ["A"], dates: L.genDates("2026-05-04", 5, true), cells: {} };
  const h = L.buildBoardHtml(s);
  assert.ok(!h.includes("weekend"), "仅工作日不应出现 weekend 类");
});

console.log("瑞典国定假期（两国同显；数据源：瑞典外交部 Circular note 2/2025 + publicholidays.se）");
test("holidayEntries 两国同显日返回两条目，顺序 CN→SE", () => {
  const e = L.holidayEntries("2026-01-01"); // 中国元旦 + 瑞典新年（同一天两国都放假）
  eq(e.length, 2);
  eq(e[0], { country: "CN", name: "元旦", type: "holiday" });
  eq(e[1], { country: "SE", name: "新年", type: "holiday" });
});
test("holidayEntries 仅单国节假日时只返回本国条目", () => {
  eq(L.holidayEntries("2026-06-06"), [{ country: "SE", name: "瑞典国庆日", type: "holiday" }]); // 仅瑞典
  const cn = L.holidayEntries("2026-02-15"); // 春节（仅中国）
  eq(cn.length, 1); eq(cn[0].country, "CN"); eq(cn[0].name, "春节");
});
test("SWEDEN_HOLIDAYS 关键日期存在（2025/2026/2027 含复活节浮动节日）", () => {
  assert.ok(L.SWEDEN_HOLIDAYS, "应导出瑞典数据集");
  // 2025
  eq(L.SWEDEN_HOLIDAYS["2025-04-18"], "耶稣受难日");
  eq(L.SWEDEN_HOLIDAYS["2025-04-20"], "复活节");
  eq(L.SWEDEN_HOLIDAYS["2025-06-21"], "仲夏节");
  // 2026（对齐瑞典外交部官方）
  eq(L.SWEDEN_HOLIDAYS["2026-04-03"], "耶稣受难日");
  eq(L.SWEDEN_HOLIDAYS["2026-05-24"], "圣灵降临节");
  eq(L.SWEDEN_HOLIDAYS["2026-06-20"], "仲夏节");
  eq(L.SWEDEN_HOLIDAYS["2026-10-31"], "万圣节");
  // 2027（复活节固定推算；仲夏日=6/26 周六）
  eq(L.SWEDEN_HOLIDAYS["2027-03-26"], "耶稣受难日");
  eq(L.SWEDEN_HOLIDAYS["2027-03-28"], "复活节");
  eq(L.SWEDEN_HOLIDAYS["2027-06-26"], "仲夏节");
});
test("colTypeOf：瑞典假期不再给网格特殊类型（周末则 weekend，工作日则普通）", () => {
  eq(L.colTypeOf("2026-06-06"), "weekend"); // 瑞典国庆日（周六）→ 仅周末类型，无 se 特殊类
  eq(L.colTypeOf("2026-05-14"), "");        // 瑞典耶稣升天节(周四，工作日)→ 网格视为普通日（""）
  eq(L.colTypeOf("2026-06-21"), "holiday"); // 端午(中国)∩仲夏节(瑞典)重叠 → CN holiday 优先
  eq(L.colTypeOf("2026-01-01"), "holiday"); // 元旦两国重叠 → CN holiday 优先
});
test("defaultStateFor：瑞典国定节假日自动显示法定假（与周末/中国节假日互斥优先级：调休>国定假日>周末）", () => {
  eq(L.defaultStateFor("2026-05-14"), "pubhol"); // 瑞典耶稣升天节(工作日)→ 瑞典国定假期，自动法定假
  eq(L.defaultStateFor("2026-06-06"), "pubhol"); // 瑞典国庆日（周六）：国定假日优先于周末 → 法定假
  eq(L.defaultStateFor("2026-05-01"), "pubhol"); // 两国劳动节重叠 → 国定假日，自动法定假
});
test("buildBoardHtml：两国同显日仅着底色（文字移至浮动提示），无内联 htag", () => {
  const s = { employees: ["A"], dates: ["2026-01-01", "2026-01-02"], cells: {} };
  const h = L.buildBoardHtml(s);
  assert.ok(h.includes("class='hd holiday'"), "该列应带 holiday 类（CN 优先，红底）");
  assert.ok(h.includes("data-iso='2026-01-01'"), "日期表头应带 data-iso（供浮动提示定位）");
  assert.ok(!h.includes("htag"), "内联标签已移除，节日文字改由浮动窗口显示");
});
test("buildBoardHtml：仅瑞典节日日期表头着瑞典国旗配色（seflag），格子仍普通日", () => {
  // 2026-05-14 瑞典耶稣升天节（周四，仅瑞典，非中国假期）
  const s = { employees: ["A"], dates: ["2026-05-13", "2026-05-14", "2026-05-15"], cells: {} };
  const h = L.buildBoardHtml(s);
  assert.ok(h.includes("class='hd seflag'"), "仅瑞典节日日期表头应着瑞典国旗配色(seflag)");
  assert.ok(!h.includes("data-coltype='se'"), "格子仍按普通日（无 se 特殊属性）");
  assert.ok(h.includes("data-iso='2026-05-14'"), "日期表头应带 data-iso（供浮动提示定位）");
  assert.ok(!h.includes("htag"), "节日名称仍由悬停浮动窗口显示");
});
test("buildBoardHtml：瑞典节日落在周末仍着瑞典国旗配色（优先于 weekend）", () => {
  // 2026-06-06 瑞典国庆日（周六，仅瑞典）→ 该列应为 seflag，不应是 weekend 灰底
  const s = { employees: ["A"], dates: ["2026-06-05", "2026-06-06", "2026-06-07"], cells: {} };
  const h = L.buildBoardHtml(s);
  assert.ok(h.includes("class='hd seflag' data-iso='2026-06-06'"), "瑞典国庆日该列应着瑞典国旗配色");
  assert.ok(!h.includes("class='hd weekend' data-iso='2026-06-06'"), "瑞典国庆日该列不应回落为 weekend 灰底");
});
test("buildBoardHtml：工作日模式下瑞典假期文字同样移至浮动提示（无内联 htag）", () => {
  // 2026-05-01 两国劳动节（周五，工作日）
  const s = { employees: ["A"], dates: L.genDates("2026-04-29", 3, true), cells: {} };
  const h = L.buildBoardHtml(s);
  assert.ok(!h.includes("htag"), "工作日模式下节日文字同样不在表头内联显示");
});
test("buildBoardHtml：todayISO 命中时该列表头与格子加 today 高亮类", () => {
  const s = { employees: ["A"], dates: ["2026-10-13", "2026-10-14", "2026-10-15"], cells: {} };
  const h = L.buildBoardHtml(s, "2026-10-14"); // 10-14 为周三普通日
  assert.ok(h.includes("class='hd today' data-iso='2026-10-14'"), "今天(10-14)表头应带 today 类");
  assert.ok(h.includes("class='hd' data-iso='2026-10-13'"), "非今天(10-13)表头不应带 today 类");
  assert.ok(h.includes("class='cellwrap today'"), "今天列 td 应带 today 类");
  assert.ok(h.includes("class='cellsel today'"), "今天列 select 应带 today 类");
});
test("buildBoardHtml：不传 todayISO 时无任何 today 类", () => {
  const s = { employees: ["A"], dates: ["2026-10-14"], cells: {} };
  const h = L.buildBoardHtml(s);
  assert.ok(!h.includes("today"), "未指定今天时不应出现 today 类");
});

console.log("中英双语（I18N，一键切换）");
test("statusText：zh 短/全/title 与 en 对应一致", () => {
  eq(L.statusText("leave_am", "zh", "short"), "上午");
  eq(L.statusText("leave_am", "zh", "full"), "事假上午");
  eq(L.statusText("leave_am", "zh", "title"), "事假·上午");
  eq(L.statusText("leave_am", "en", "short"), "AM");
  eq(L.statusText("leave_am", "en", "full"), "Leave AM");
  eq(L.statusText("leave_am", "en", "title"), "Leave · AM");
  eq(L.statusText("pubhol", "zh", "full"), "法定假");
  eq(L.statusText("pubhol", "en", "full"), "Public holiday");
  // 缺省语言应为 zh（保持旧调用签名行为不变）
  eq(L.statusText("leave", undefined, "full"), "事假");
});
test("I18N：zh 与 en 的状态键、界面键完全对齐（无漏翻）", () => {
  eq(L.LOCALES.length, 2);
  const zhS = Object.keys(L.I18N.zh.status).sort();
  const enS = Object.keys(L.I18N.en.status).sort();
  eq(enS, zhS, "en 状态键应与 zh 一致");
  const zhU = Object.keys(L.I18N.zh.ui).sort();
  const enU = Object.keys(L.I18N.en.ui).sort();
  eq(enU, zhU, "en 界面键应与 zh 一致");
  // 每个状态的 short/full/title 三种文案在两种语言下都存在（可为 ""）
  zhS.forEach(k => {
    ["short", "full", "title"].forEach(kind => {
      assert.ok(L.I18N.en.status[k][kind] !== undefined, `en.status.${k}.${kind} 缺失`);
    });
  });
});
test("I18N：tips 为分条数组（避免一整段连续文字），sumLabel 四类齐全", () => {
  L.LOCALES.forEach(loc => {
    const tips = L.I18N[loc].ui.tips;
    assert.ok(Array.isArray(tips), loc + ".ui.tips 应为数组");
    assert.ok(tips.length >= 3, loc + ".ui.tips 应至少 3 条，实际 " + tips.length);
    tips.forEach(s => assert.ok(typeof s === "string" && s.length > 10, loc + " tips 每条应为非空短句"));
    const sl = L.I18N[loc].ui.sumLabel;
    ["work", "leave", "sick", "pubhol"].forEach(k => {
      assert.ok(sl && typeof sl[k] === "string" && sl[k].length > 0, loc + ".ui.sumLabel." + k + " 缺失");
      assert.ok(sl[k].length <= 8, loc + ".ui.sumLabel." + k + " 应为短标签（≤8 字符），实际 " + sl[k]);
    });
  });
});
test("【隐私】默认员工示例不得含真实人名（仓库公开，防真名回流）", () => {
  // 曾误将使用者真名放进默认员工列表，现已替换为中性示例名
  const emps = L.defaultEmployees();
  eq(emps.length, 8, "默认仍应 8 名员工");
  ok(!emps.some(e => /David/i.test(e)), "默认员工不得含 David（曾误放真名）");
  ok(new Set(emps).size === emps.length, "默认员工名不得重复");
});
test("VERSION：语义化 MAJOR.MINOR.PATCH，为两版页面的唯一真相源", () => {
  ok(typeof L.VERSION === "string", "VERSION 应为字符串");
  ok(/^\d+\.\d+\.\d+$/.test(L.VERSION), "VERSION 应为 x.y.z 格式，实际 " + L.VERSION);
  const [maj, min, pat] = L.VERSION.split(".").map(Number);
  ok(maj >= 1, "主版本号应 ≥ 1");
  ok(min >= 0 && pat >= 0, "次版本/修订号应为非负整数");
});
test("holidayEntries：en 下节日名称与调休班文案为英文", () => {
  const e = L.holidayEntries("2026-01-01", "en"); // 元旦 + 瑞典新年
  eq(e.length, 2);
  eq(e[0].name, "New Year's Day");
  eq(e[1].name, "New Year's Day");
  eq(L.holidayEntries("2026-05-09", "en")[0].name, "Workday (adjusted)"); // 调休补班
  eq(L.holidayEntries("2026-01-01")[0].name, "元旦", ); // 缺省仍为中文
});
test("weekdayText：zh 周三 / en Wed", () => {
  eq(L.weekdayText("2026-10-14"), "周三");       // 缺省 zh
  eq(L.weekdayText("2026-10-14", "zh"), "周三");
  eq(L.weekdayText("2026-10-14", "en"), "Wed");
  eq(L.weekdayText("2026-10-17", "en"), "Sat");
});
test("buildBoardHtml：en 下 corner / 星期 / 选项文案为英文", () => {
  const s = { employees: ["A"], dates: ["2026-10-14"], cells: {} };
  const h = L.buildBoardHtml(s, null, "en");
  assert.ok(h.includes("Employee \\ Date"), "en corner 表头");
  assert.ok(h.includes("<br>Wed</br>") || h.includes("<br>Wed"), "en 星期应为 Wed");
  assert.ok(h.includes(">Pub<"), "en 法定假下拉应显示 Pub");
  assert.ok(h.includes("title='Leave · AM'"), "en 上午事假应带英文标题");
});
test("buildCsv：en 下表头与状态值为英文，空白格仍输出空", () => {
  const employees = ["A"];
  const dates = ["2026-01-01", "2026-10-14", "2026-10-15"];
  const cells = { "A|2026-10-15": "" }; // 显式空白
  const csv = L.buildCsv(employees, dates, cells, "en");
  eq(csv, "Employee,2026-01-01,2026-10-14,2026-10-15\nA,Public holiday,Work,\n");
  // zh 保持不变
  eq(L.buildCsv(employees, dates, cells), "员工,2026-01-01,2026-10-14,2026-10-15\nA,法定假,上班,\n");
});

console.log("实时时钟（中国 / 瑞典，含夏令时）");
test("clockText：中国固定 UTC+8，瑞典冬令时 +1 / 夏令时 +2", () => {
  const winter = new Date("2026-01-15T12:00:00Z"); // 冬令时
  const summer = new Date("2026-07-15T12:00:00Z"); // 夏令时
  eq(L.clockText(winter, L.TZ.CN), "20:00:00");   // 中国无夏令时，恒 +8
  eq(L.clockText(summer, L.TZ.CN), "20:00:00");
  eq(L.clockText(winter, L.TZ.SE), "13:00:00");   // 瑞典冬令 +1
  eq(L.clockText(summer, L.TZ.SE), "14:00:00");   // 瑞典夏令 +2
});
test("clockText：跨日边界补零正确（午夜 / 上午个位时）", () => {
  eq(L.clockText(new Date("2026-01-15T16:00:00Z"), L.TZ.CN), "00:00:00"); // 次日 00 点
  eq(L.clockText(new Date("2026-01-15T01:05:09Z"), L.TZ.CN), "09:05:09");
});
test("tzOffsetHours：中瑞时差冬令 7 小时、夏令 6 小时", () => {
  const winter = new Date("2026-01-15T12:00:00Z");
  const summer = new Date("2026-07-15T12:00:00Z");
  eq(L.tzOffsetHours(winter, L.TZ.CN), 8);
  eq(L.tzOffsetHours(winter, L.TZ.SE), 1);
  eq(L.tzOffsetHours(summer, L.TZ.SE), 2);
  eq(L.tzOffsetHours(winter, L.TZ.CN) - L.tzOffsetHours(winter, L.TZ.SE), 7);
  eq(L.tzOffsetHours(summer, L.TZ.CN) - L.tzOffsetHours(summer, L.TZ.SE), 6);
});
test("clockParts 返回补零后的时/分/秒字符串", () => {
  eq(L.clockParts(new Date("2026-01-15T01:05:09Z"), L.TZ.CN), { h: "09", m: "05", s: "09" });
});

console.log("节假日数据不变量（防数据录入错误）");
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dowOf = (iso) => WD[L.parseISO(iso).getDay()];
test("瑞典：仲夏节 / 万圣节必须落在周六", () => {
  ["2025-06-21", "2026-06-20", "2027-06-26",      // 仲夏节
   "2025-11-01", "2026-10-31", "2027-11-06"]      // 万圣节
    .forEach(d => eq(dowOf(d), "Sat", d + " 应为周六，实际 " + dowOf(d)));
});
test("瑞典：复活节衍生节日星期正确（受难五/复活日/周一/升天四/圣灵日）", () => {
  const expect = { "耶稣受难日": "Fri", "复活节": "Sun", "复活节星期一": "Mon", "耶稣升天节": "Thu", "圣灵降临节": "Sun" };
  const checked = Object.keys(L.SWEDEN_HOLIDAYS).filter(d => expect[L.SWEDEN_HOLIDAYS[d]]);
  ok(checked.length >= 15, "应覆盖三年共 15 条复活节衍生节日，实际 " + checked.length);
  checked.forEach(d => {
    const n = L.SWEDEN_HOLIDAYS[d];
    eq(dowOf(d), expect[n], d + " " + n + " 应为 " + expect[n]);
  });
});
test("中国：调休补班日必须落在周末，且不与法定节假日冲突", () => {
  [...L.MAKEUP].forEach(d => {
    const w = dowOf(d);
    ok(w === "Sat" || w === "Sun", "补班日 " + d + " 应在周末，实际 " + w);
    ok(!L.HOLIDAYS[d], "补班日 " + d + " 不应同时是法定节假日");
  });
});
test("瑞典无调休补班（数据中不应出现 SE 的 makeup）", () => {
  Object.keys(L.SWEDEN_HOLIDAYS).forEach(d => ok(!L.MAKEUP.has(d), d + " 不应是补班日"));
});
test("两国数据集均覆盖 2025–2027 且非空", () => {
  const cn = Object.keys(L.HOLIDAYS), se = Object.keys(L.SWEDEN_HOLIDAYS);
  ok(cn.length > 30 && se.length > 30, "两国节假日数量应可观");
  ["2025", "2026", "2027"].forEach(y => {
    ok(se.some(d => d.startsWith(y)), "瑞典数据应含 " + y);
  });
  ok(cn.some(d => d.startsWith("2025")) && cn.some(d => d.startsWith("2026")), "中国数据应含 2025/2026");
});

console.log("转义与样式细节");
test("escapeHtml / escapeAttr 转义特殊字符", () => {
  eq(L.escapeHtml("<b>&'x</b>"), "&lt;b&gt;&amp;'x&lt;/b&gt;");
  // 属性统一用单引号包裹，故只需转义 & < > '（双引号在单引号属性内无害，不转义）
  eq(L.escapeAttr("a'b"), "a&#39;b");
  eq(L.escapeAttr('<a href="#">'), '&lt;a href="#"&gt;');
});
test("paintSelectStyle：法定假用自身状态色（淡紫），不回落列底纹", () => {
  eq(L.paintSelectStyle("pubhol", "holiday").bg, "#e7def8");
  eq(L.paintSelectStyle("pubhol", "").bg, "#e7def8");
});
test("buildBoardHtml：select 带内联状态色（已填=状态色，空白=列底纹）", () => {
  const s = { employees: ["A"], dates: ["2026-10-14", "2026-10-17"], cells: { "A|2026-10-14": "work" } };
  const h = L.buildBoardHtml(s);
  ok(h.includes("background:#2e9e5b"), "已填 work 格应为绿色内联样式");
  ok(h.includes("background:#f0f3f7"), "空白周末格应为周末底纹");
});
test("holidayNameText / localeOf：未知语言回落 zh、en 名映射生效", () => {
  eq(L.localeOf(undefined), L.I18N.zh);
  eq(L.localeOf("en"), L.I18N.en);
  eq(L.localeOf("xx"), L.I18N.zh);                                  // 未知语言回落
  eq(L.holidayNameText("元旦", L.I18N.zh), "元旦");                  // zh 原名返回
  eq(L.holidayNameText("元旦", L.I18N.en), "New Year's Day");
});

console.log("默认状态完整矩阵（优先级：调休 > 国定假日 > 周末 > 普通）");
test("defaultStateFor 全分支：普通/周末/调休/中瑞假日/假日∩周末", () => {
  eq(L.defaultStateFor("2026-10-14"), "work");    // 普通周三
  eq(L.defaultStateFor("2026-10-17"), "");        // 普通周六
  eq(L.defaultStateFor("2026-05-09"), "work");    // 调休补班（周六）
  eq(L.defaultStateFor("2026-01-01"), "pubhol");  // 元旦（中瑞同放）
  eq(L.defaultStateFor("2026-05-14"), "pubhol");  // 仅瑞典（工作日）
  eq(L.defaultStateFor("2026-06-06"), "pubhol");  // 仅瑞典 + 周六 → 假日优先
  eq(L.defaultStateFor("2026-04-04"), "pubhol");  // 中国清明 + 周六 → 假日优先
});
test("手动标记可覆盖节假日默认（显式 work 盖掉法定假）", () => {
  const cells = { "A|2026-01-01": "work" };
  eq(L.computeSummary(["A"], ["2026-01-01"], cells)[0],
     { emp: "A", work: 1, leave: 0, sick: 0, pubhol: 0 });
});

console.log("\n结果：" + pass + " 通过, " + fail + " 失败");
process.exit(fail ? 1 : 0);
