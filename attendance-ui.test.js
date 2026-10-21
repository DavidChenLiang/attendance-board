/*
 * attendance-ui.test.js
 * UI 契约 / 集成测试：覆盖纯逻辑测试测不到的部分——
 *   1) React 版真实渲染冒烟（esbuild 打包 + react-dom/server 渲染），
 *      可捕获「周周三」这类只在视图层出现的回归；
 *   2) vanilla 版与 React 版的 DOM id 契约、逻辑层全局引用契约；
 *   3) 语言包键引用、CSS 类引用、构建产物存在性。
 * 运行：node attendance-ui.test.js
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log("  ✓ " + name); }
  catch (e) { fail++; console.log("  ✗ " + name + "\n      " + e.message); }
}
function ok(cond, msg) { assert.ok(cond, msg); }
function eq(actual, expected, msg) { assert.deepStrictEqual(actual, expected, msg); }

const ROOT = __dirname;
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const appSrc = read("src/App.jsx");
const vanillaHtml = read("attendance-board.html");
const reactCss = read("src/styles.css");
const L = require("./attendance-logic.js");

// ---------------------------------------------------------------- 通用小工具
// 收集源码里出现的标识符集合
function collectIds(src) {
  const out = new Set();
  const re = /id\s*=\s*["']([\w-]+)["']/g;          // HTML/JSX 里定义的 id
  let m; while ((m = re.exec(src))) out.add(m[1]);
  return out;
}
function collectGetElementById(src) {
  const out = new Set();
  const re = /getElementById\(\s*["']([\w-]+)["']\s*\)/g;
  let m; while ((m = re.exec(src))) out.add(m[1]);
  return out;
}

console.log("React 版：真实渲染冒烟（esbuild 打包 + react-dom/server）");

// 把 App.jsx 打包成 CJS 供 Node 渲染（仅测试用，产物写入临时文件后清理）
const esbuild = require("esbuild");
const TMP_APP = path.join(ROOT, ".tmp-ssr-app.cjs");
let renderApp = null;   // (locale) => html
let ssrError = null;
try {
  esbuild.buildSync({
    entryPoints: [path.join(ROOT, "src/App.jsx")],
    bundle: true, format: "cjs", outfile: TMP_APP,
    jsx: "automatic", external: ["react", "react-dom"], logLevel: "error",
  });
  const React = require("react");
  const { renderToString } = require("react-dom/server");
  const App = require(TMP_APP).default;
  // 渲染前装好浏览器侧依赖（localStorage），否则 loadState/持久化会崩
  const store = {};
  global.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  // 渲染一次：locale 指定语言；stats=true 时预置「人员统计已展开」偏好
  renderApp = (locale, stats) => {
    if (locale) store["attendance-board-locale"] = locale;
    else delete store["attendance-board-locale"];
    if (stats) store["attendance-board-stats"] = "1";
    else delete store["attendance-board-stats"];
    delete store["attendance-board-v1"];   // 用默认状态渲染，避免依赖历史数据
    return renderToString(React.createElement(App));
  };
} catch (e) { ssrError = e; }

function cleanupTmp() { try { fs.unlinkSync(TMP_APP); } catch (e) { /* ignore */ } }

test("打包 + 服务端渲染不抛错（渲染管线可跑通）", () => {
  ok(!ssrError, "打包/加载 App 失败：" + (ssrError && ssrError.message));
  const html = renderApp("zh");
  ok(html && html.length > 1000, "渲染结果应非空，实际长度 " + (html || "").length);
});

test("中文渲染：标题 / 表头 / 图例 / 汇总 均在位", () => {
  const html = renderApp("zh");
  ok(html.includes("员工假期考勤看板"), "应含中文标题");
  ok(html.includes("员工 \\ 日期"), "应含 corner 表头");
  ok(html.includes("法定假"), "图例应含「法定假」");
  ok(html.includes("上班"), "图例应含「上班」");
  ok(/上班 \d+/.test(html), "应含统计合计「上班 N」");
});

console.log("图例位置：移到页面底部（顶栏只留操作区）");

test("图例渲染在矩阵之后（不再占据顶栏）", () => {
  const html = renderApp("zh");
  const iBoard = html.indexOf('id="board"');
  const iPalette = html.indexOf('id="palette"');
  const iStats = html.indexOf('id="statsBar"');
  ok(iBoard >= 0 && iPalette >= 0, "应同时渲染 board 与 palette");
  ok(iPalette > iBoard, "图例应排在考勤矩阵之后（底部）");
  ok(iPalette < iStats, "图例应排在人员统计之上");
  // 顶栏（header）内不应再出现图例
  const headerEnd = html.indexOf("</header>");
  ok(headerEnd >= 0 && iPalette > headerEnd, "图例不应出现在 header 内");
});

test("图例：9 个状态色块齐全（含法定假与空白）", () => {
  const html = renderApp("zh");
  const legend = html.slice(html.indexOf('id="palette"'), html.indexOf('id="statsBar"'));
  const sw = (legend.match(/class="swatch"/g) || []).length;
  eq(sw, Object.keys(L.COLORS).length, "图例色块数应等于状态数（COLORS 键数）");
  ["法定假", "上班", "空白"].forEach(s => ok(legend.includes(s), "图例应含「" + s + "」"));
});

console.log("人员统计：默认折叠为一行合计条，点击展开每人卡片");

test("默认折叠：只渲染合计条，不渲染每人卡片（空间留给矩阵）", () => {
  const html = renderApp("zh");
  ok(html.includes('class="statsbar"'), "应渲染统计合计条");
  ok(html.includes('aria-expanded="false"'), "默认应为折叠态");
  ok(!html.includes("sum-card"), "折叠态不应渲染任何 sum-card");
  ok(!html.includes("statsbar open"), "折叠态合计条不应带 open 类");
});

test("合计条：常显全员合计（上班 / 事假 / 病假 / 法定假 四类）", () => {
  const html = renderApp("zh");
  const st = L.defaultState();
  const tot = L.computeTotals(st.employees, st.dates, st.cells);
  const expected = L.I18N.zh.ui.summary(tot.work, tot.leave, tot.sick, tot.pubhol);
  ok(html.includes(expected), "合计条应显示「" + expected + "」");
});

test("展开态：每人一张卡片，数量 = 员工数，且四类计数齐全", () => {
  const html = renderApp("zh", true);   // 预置 stats=1
  ok(html.includes("statsbar open"), "展开态合计条应带 open 类");
  ok(html.includes('aria-expanded="true"'), "展开态 aria-expanded 应为 true");
  const n = L.defaultState().employees.length;
  const cards = (html.match(/class="sum-card"/g) || []).length;
  eq(cards, n, "展开后卡片数应等于员工数");
  ["is-work", "is-leave", "is-sick", "is-pubhol"].forEach(k => {
    eq((html.match(new RegExp("sum-item " + k, "g")) || []).length, n, "每人应有 " + k + " 计数");
  });
});

test("操作说明：分条渲染（3 条 li，不再是一整段连续文字）", () => {
  const html = renderApp("zh");
  ok(html.includes('class="tiplist"'), "应渲染 tiplist 容器");
  const li = (html.match(/<li /g) || []).length + (html.match(/<li>/g) || []).length;
  eq(li, L.I18N.zh.ui.tips.length, "li 条数应等于 tips 条数");
  ok(html.includes("<b>状态</b>"), "应含分条小标题");
});

test("【回归】日期表头星期不得重复「周」前缀（曾出现「周周三」）", () => {
  const html = renderApp("zh");
  ok(!html.includes("周周"), "不应出现「周周」重复前缀");
  // 中文星期应为「周X」且 X 为单个汉字，如 周一/周二/…/周日
  ok(/周[一二三四五六日]/.test(html), "应出现形如「周一」的星期");
});

test("英文渲染：界面为英文且不带中文星期前缀", () => {
  const html = renderApp("en");
  ok(html.includes("Attendance Board"), "应含英文标题");
  ok(html.includes("Employee \\ Date"), "应含英文 corner");
  ok(html.includes("Public holiday"), "图例应含 Public holiday");
  ok(!html.includes("周周"), "英文下不应出现「周周」");
  ok(!/周[一二三四五六日]/.test(html), "英文下不应出现中文星期");
});

test("渲染：下拉每格 9 个选项、格子数 = 员工数 × 天数", () => {
  const html = renderApp("zh");
  const state = L.defaultState();
  const cells = (html.match(/class="cellwrap/g) || []).length;
  eq(cells, state.employees.length * state.dates.length, "格子数应为 员工×日期");
  const opts = (html.match(/<option/g) || []).length;
  eq(opts, cells * 9, "每格应 9 个 option");
});

test("渲染：两个时钟与「24小时制」标注均在位", () => {
  const html = renderApp("zh");
  const clocks = (html.match(/class="clock"/g) || []).length;
  eq(clocks, 2, "应渲染中国、瑞典两个时钟");
  ok(html.includes("24小时制"), "应含「24小时制」标注");
  ok(/UTC[+-]\d/.test(html), "时钟 title 应带 UTC 偏移");
});

test("渲染：页面注明节假日数据来源（中/英均含来源标识）", () => {
  const zh = renderApp("zh");
  ok(zh.includes("国务院"), "中文应注明中国来源（国务院放假安排）");
  ok(zh.includes("publicholidays.se"), "应注明瑞典来源 publicholidays.se");
  const en = renderApp("en");
  ok(/State Council|MFA/.test(en), "英文应注明来源（State Council / MFA）");
  ok(en.includes("publicholidays.se"), "英文也应含 publicholidays.se");
});

test("渲染：框选模式默认关闭（表不带 selecting 类）", () => {
  const html = renderApp("zh");
  ok(!html.includes('class="selecting"'), "默认不应处于框选模式");
});

cleanupTmp();

console.log("两版一致性：vanilla 的硬编码副本不得与逻辑层漂移");

test("vanilla 版默认员工列表与 defaultEmployees() 完全一致", () => {
  const expected = JSON.stringify(L.defaultEmployees());
  // vanilla load() 里维护了一份硬编码副本，历史上它曾与逻辑层同时含有同一个真名
  const m = vanillaHtml.match(/state\.employees\s*=\s*(\[[^\]]*\])/);
  ok(m, "vanilla 应存在默认员工列表");
  const actual = JSON.stringify(
    m[1].match(/"([^"]+)"/g).map(s => s.slice(1, -1))
  );
  eq(actual, expected, "vanilla 的默认员工应与逻辑层一致（当前：" + actual + "）");
});

console.log("版本号：两版从逻辑层 VERSION 单一真相源读取");

test("版本号为语义化 MAJOR.MINOR.PATCH", () => {
  ok(/^\d+\.\d+\.\d+$/.test(L.VERSION), "VERSION 应为 x.y.z，实际 " + L.VERSION);
});

test("两版页面都显示版本号（标题徽章 + 页脚，共 2 处）", () => {
  const html = renderApp("zh");
  ok(html.includes("v" + L.VERSION), "React 版应显示 v" + L.VERSION);
  eq((html.match(/class="ver/g) || []).length, 2, "应显示标题徽章与页脚版本各 1 处");
  // 英文下同样显示（版本号不参与翻译）
  ok(renderApp("en").includes("v" + L.VERSION), "英文版也应显示 v" + L.VERSION);
  // 回归防线：版本号文本内不得出现 SSR 的文本分隔注释（会让 "v1.4.0" 断成两截）
  ok(!/v<!-- -->\d/.test(html), "版本号不应被 SSR 注释分隔（请用单个模板字符串）");
  ok(!/class="ver[^"]*">[^<]*<!--/.test(html), "版本号元素内不应含注释节点");
});

test("CHANGELOG.md 记录了当前版本", () => {
  const log = read("CHANGELOG.md");
  ok(log.includes("## " + L.VERSION), "CHANGELOG 应有 " + L.VERSION + " 的条目");
  ok(log.includes(L.VERSION), "CHANGELOG 应提及当前版本号");
  // 版本号必须可在 CHANGELOG 的表格中被检索到
  ok(new RegExp("\\|\\s*\\*\\*" + L.VERSION.replace(/\./g, "\\.") + "\\*\\*").test(log),
    "CHANGELOG 版本索引表应含 " + L.VERSION);
});

test("vanilla 版：版本号同样渲染在标题与页脚，且取自逻辑层", () => {
  ok(vanillaHtml.includes('id="ver"'), "vanilla 版应有标题版本号容器");
  ok(vanillaHtml.includes('id="verFoot"'), "vanilla 版应有页脚版本号容器");
  ok(/"v" \+ VERSION/.test(vanillaHtml), "vanilla 版应从逻辑层 VERSION 读取（不硬编码）");
  ok(vanillaHtml.includes('class="ver"'), "vanilla 版应有 .ver 样式类");
});

console.log("DOM 契约：代码里 getElementById 的目标必须存在");

test("React 版：所有 getElementById 的 id 都在 JSX 中定义", () => {
  const defined = collectIds(appSrc);
  const used = collectGetElementById(appSrc);
  const missing = [...used].filter(id => !defined.has(id));
  eq(missing, [], "React 版缺失 id：" + missing.join(", "));
});

test("vanilla 版：所有 getElementById 的 id 都在 HTML 中定义", () => {
  const defined = collectIds(vanillaHtml);
  const used = collectGetElementById(vanillaHtml);
  const missing = [...used].filter(id => !defined.has(id));
  eq(missing, [], "vanilla 版缺失 id：" + missing.join(", "));
  ok(used.size > 0, "应至少用到若干 id（否则检查本身失效）");
});

console.log("逻辑层契约：vanilla 当作全局使用的 API 必须已导出");

test("vanilla 版引用的逻辑层全局函数全部存在", () => {
  // 抓出 vanilla 脚本里用到的、且属于逻辑层的标识符
  const used = new Set();
  const decls = new Set();
  const script = vanillaHtml.match(/<script>([\s\S]*?)<\/script>/)[1];
  // 本文件内定义的 function / let / const 名称
  const dre = /(?:function|let|const|var)\s+([A-Za-z_$][\w$]*)/g;
  let m; while ((m = dre.exec(script))) decls.add(m[1]);
  // 逻辑层导出名
  Object.keys(L).forEach(k => {
    // 排除本文件自定义的同名变量后，检查调用点是否存在
    if (!decls.has(k) && new RegExp("\\b" + k + "\\s*\\(").test(script)) used.add(k);
  });
  const missing = [...used].filter(k => L[k] === undefined);
  eq(missing, [], "逻辑层缺失导出：" + missing.join(", "));
  ok(used.size >= 10, "应检测到足够多的逻辑层调用（当前 " + used.size + "）");
});

test("两版共用同一份 localStorage key（数据可延续）", () => {
  ok(appSrc.includes("attendance-board-v1"), "React 版应使用 attendance-board-v1");
  ok(vanillaHtml.includes("attendance-board-v1"), "vanilla 版应使用 attendance-board-v1");
  ok(appSrc.includes("attendance-board-locale"), "React 版应持久化语言偏好");
  ok(vanillaHtml.includes("attendance-board-locale"), "vanilla 版应持久化语言偏好");
});

console.log("语言包契约：代码里引用的文案键必须存在（防漏翻/拼错）");

test("两版引用的 I18N 界面键均已在 zh / en 中定义", () => {
  const zhKeys = Object.keys(L.I18N.zh.ui);
  const enKeys = Object.keys(L.I18N.en.ui);
  const used = new Set();
  // React：t.xxx  /  LI.ui.xxx / L.I18N[locale].ui.xxx
  const reT = /\bt\.([A-Za-z_$][\w$]*)/g;
  let m;
  while ((m = reT.exec(appSrc))) used.add(m[1]);
  // vanilla：t().xxx / T.xxx
  const reV = /(?:\bt\(\)\.|\bT\.)([A-Za-z_$][\w$]*)/g;
  while ((m = reV.exec(vanillaHtml))) used.add(m[1]);
  const missingZh = [...used].filter(k => !zhKeys.includes(k));
  const missingEn = [...used].filter(k => !enKeys.includes(k));
  eq(missingZh, [], "zh 缺失键：" + missingZh.join(", "));
  eq(missingEn, [], "en 缺失键：" + missingEn.join(", "));
  ok(used.size >= 15, "应检测到足够多的文案键引用（当前 " + used.size + "）");
});

test("语言包：国家名 / 调休前缀 / 无标记 在两语言中都有值", () => {
  ["zh", "en"].forEach(loc => {
    const LI = L.I18N[loc];
    ok(LI.country && LI.country.CN && LI.country.SE, loc + " 缺 country");
    ok(LI.makeupPrefix && LI.noMark, loc + " 缺 makeupPrefix/noMark");
    ok(LI.weekdays.length === 7, loc + " weekdays 应为 7 个");
  });
});

console.log("样式契约：用到的 CSS 类必须在样式表中定义");

test("关键样式类在 React 样式表中存在", () => {
  ["dot.pubhol", "dot.none", "selbar", "clocks", "clock", "c24", "cellwrap", "cellsel",
   "tiplist", "sum-card", "sum-name", "sum-nums", "sum-item", "titlerow",
   "stats", "statsbar", "stats-title", "stats-total", "stats-arrow", "legend", "ver", "ver-foot"]
    .forEach(sel => {
      const cls = sel.split(".").pop();
      ok(reactCss.includes("." + cls), "styles.css 缺 ." + cls);
    });
  ok(reactCss.includes("#board.selecting"), "styles.css 缺 #board.selecting");
  ok(reactCss.includes("select.cellsel.sel"), "styles.css 缺 select.cellsel.sel");
});

test("关键样式类在 vanilla 样式表中存在（与 React 版对等）", () => {
  const css = vanillaHtml;
  ["dot.pubhol", "selbar", "clocks", "clock", "c24",
   "tiplist", "sum-card", "sum-name", "sum-nums", "sum-item", "titlerow",
   "stats", "statsbar", "stats-title", "stats-total", "stats-arrow", "legend", "ver", "ver-foot"]
    .forEach(sel => ok(css.includes("." + sel.split(".").pop()), "vanilla 缺 ." + sel));
  ok(css.includes("#board.selecting"), "vanilla 缺 #board.selecting");
  ok(css.includes("select.cellsel.sel"), "vanilla 缺 select.cellsel.sel");
});

test("两版布局均为「顶栏固定 + 表格区独占滚动」的应用外壳", () => {
  ok(reactCss.includes("#root { display: flex; flex-direction: column; height: 100vh; }"),
    "React 版应用外壳应为 flex 列布局");
  ok(/\.board-wrap \{[^}]*flex: 1 1 auto/.test(reactCss), "React 版表格区应 flex 占满剩余高度");
  ok(/\.board-wrap \{[^}]*flex: 1 1 auto/.test(vanillaHtml), "vanilla 版表格区应 flex 占满剩余高度");
  ok(/\.summary \{[^}]*flex: 0 0 auto/.test(reactCss), "React 版汇总区不应被压缩");
  ok(/\.summary \{[^}]*flex: 0 0 auto/.test(vanillaHtml), "vanilla 版汇总区不应被压缩");
  // 折叠态容器必须彻底让位（否则空 padding 仍会吃掉矩阵空间）
  [reactCss, vanillaHtml].forEach(css =>
    ok(/\.summary:empty \{[^}]*display: none/.test(css), "折叠态应有 .summary:empty 隐藏规则"));
});

test("vanilla 版：汇总卡片与分条提示的渲染代码与 React 版对等", () => {
  ok(vanillaHtml.includes("sum-card"), "vanilla 版应渲染汇总卡片");
  ok(/T\.tips\.map/.test(vanillaHtml), "vanilla 版应分条渲染 tips");
  ok(vanillaHtml.includes('id="tipText"'), "vanilla 版应保留 tipText 容器");
  // 折叠开关：两版共用同一 key，且 vanilla 有点击处理
  ok(/statsOpen\s*=\s*!statsOpen/.test(vanillaHtml), "vanilla 版应有展开/收起切换");
  ok(/localStorage\.setItem\(STATS_KEY/.test(vanillaHtml), "vanilla 版应持久化统计展开状态");
});

test("vanilla 版：图例同样位于底部（在 board-wrap 之后）", () => {
  const iBoard = vanillaHtml.indexOf('class="board-wrap"');
  const iPalette = vanillaHtml.indexOf('id="palette"');
  ok(iBoard >= 0 && iPalette > iBoard, "vanilla 版图例应排在矩阵之后（底部）");
  ok(vanillaHtml.indexOf('class="legend"') < iPalette, "vanilla 版图例应在 .legend 容器内");
});

test("两版共用同一个人员统计展开状态 key（偏好可延续）", () => {
  ok(appSrc.includes("attendance-board-stats"), "React 版应使用 attendance-board-stats");
  ok(vanillaHtml.includes("attendance-board-stats"), "vanilla 版应使用 attendance-board-stats");
});

console.log("构建产物（先 npm run build）");

test("dist 构建产物存在且引用了 JS/CSS", () => {
  const idx = path.join(ROOT, "dist", "index.html");
  if (!fs.existsSync(idx)) { console.log("      (跳过：未执行 npm run build)"); return; }
  const html = read("dist/index.html");
  ok(/<script[^>]+src="\/assets\/[^"]+\.js"/.test(html), "index.html 应引用构建后的 JS");
  ok(/\.css/.test(html), "index.html 应引用构建后的 CSS");
  const assetsDir = path.join(ROOT, "dist", "assets");
  const files = fs.readdirSync(assetsDir);
  ok(files.some(f => f.endsWith(".js")), "dist/assets 应有 JS 产物");
  ok(files.some(f => f.endsWith(".css")), "dist/assets 应有 CSS 产物");
});

test("vanilla 版内联脚本语法可通过（node --check）", () => {
  const script = vanillaHtml.match(/<script>([\s\S]*?)<\/script>/)[1];
  const tmp = path.join(ROOT, ".tmp-vanilla-syntax.js");
  fs.writeFileSync(tmp, script);
  try {
    require("child_process").execFileSync(process.execPath, ["--check", tmp], { stdio: "pipe" });
  } catch (e) {
    assert.fail("vanilla 脚本语法错误：" + (e.stderr ? e.stderr.toString() : e.message));
  } finally {
    try { fs.unlinkSync(tmp); } catch (e) { /* ignore */ }
  }
});

console.log("\n结果：" + pass + " 通过, " + fail + " 失败");
process.exit(fail ? 1 : 0);
