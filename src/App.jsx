import React, { useState, useEffect, useRef, useLayoutEffect, useCallback } from 'react'
// 逻辑层复用根目录的 UMD 模块：Vite 以 CJS 互操作将其导出为 default（内含 toISO / genDates / buildCsv / computeSummary ...）
import L from '../attendance-logic.js'

const STORE_KEY = 'attendance-board-v1'   // 与 vanilla 版共用同一份 localStorage，数据可延续
const LOCALE_KEY = 'attendance-board-locale' // 语言偏好（zh / en），两版共用
const STATS_KEY = 'attendance-board-stats'   // 人员统计展开状态（"1" = 展开，默认折叠）
const EXTEND = 14                        // 拖动到边缘时每次延展的天数
const OPTION_KEYS = ['', 'work', 'leave', 'leave_am', 'leave_pm', 'sick', 'sick_am', 'sick_pm', 'pubhol']

function loadLocale() {
  try { return localStorage.getItem(LOCALE_KEY) === 'en' ? 'en' : 'zh' } catch (e) { return 'zh' }
}

// 人员统计默认折叠：把视觉空间留给矩阵
function loadStatsOpen() {
  try { return localStorage.getItem(STATS_KEY) === '1' } catch (e) { return false }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (raw) {
      const s = JSON.parse(raw)
      if (typeof s.workdaysOnly !== 'boolean') s.workdaysOnly = true
      if (!s.employees || !s.employees.length) return null
      return s
    }
  } catch (e) { /* ignore */ }
  return null
}

// 实时时钟：独立组件，每秒自更新 —— 避免每秒重渲染整张考勤表
function Clocks({ locale }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  const LI = L.I18N[locale]
  const zones = [
    { flag: '🇨🇳', name: LI.country.CN, tz: L.TZ.CN },
    { flag: '🇸🇪', name: LI.country.SE, tz: L.TZ.SE },
  ]
  return (
    <div className="clocks">
      {zones.map(z => {
        const off = L.tzOffsetHours(now, z.tz)
        return (
          <div className="clock" key={z.tz} title={`${LI.ui.clock24} · UTC${off >= 0 ? '+' : ''}${off}`}>
            <span className="flag">{z.flag}</span>
            <span className="cname">{z.name}</span>
            <span className="ctime">{L.clockText(now, z.tz)}</span>
          </div>
        )
      })}
      <span className="c24" title={LI.ui.clock24}>{LI.ui.clock24}</span>
    </div>
  )
}

export default function App() {
  const [state, setState] = useState(loadState() || L.defaultState())
  const [selMode, setSelMode] = useState(false)   // 框选模式（开启后拖拽框选，Esc 退出）
  const [selection, setSelection] = useState(null) // 选区 { r0, c0, r1, c1 }：员工行/日期列索引
  const [locale, setLocale] = useState(loadLocale) // 中 / 英一键切换
  const [statsOpen, setStatsOpen] = useState(loadStatsOpen) // 人员统计：默认折叠
  const t = L.I18N[locale].ui                     // 当前语言的界面文案

  const todayISO = L.toISO(new Date())

  const boardWrapRef = useRef(null)
  const boardRef = useRef(null)
  const tipRef = useRef(null)
  const stateRef = useRef(state)
  stateRef.current = state
  const pendingScrollAdjRef = useRef(0)   // 向左延展后补偿滚动位移
  const pendingScrollToRef = useRef(null)  // 回到今天：滚动到指定日期居中
  const panRef = useRef({ panning: false, startX: 0, startScroll: 0 })
  const dateDaysRef = useRef(null)
  const dragRef = useRef(null)   // 框选进行中：{ r0, c0 }，鼠标抬起置空
  const anchorRef = useRef(null) // Shift 批量选区的锚点：{ r, c }（首次 Shift 点击的位置）

  // 持久化
  useEffect(() => {
    localStorage.setItem(STORE_KEY, JSON.stringify(state))
  }, [state])

  // 语言偏好持久化
  useEffect(() => {
    try { localStorage.setItem(LOCALE_KEY, locale) } catch (e) { /* ignore */ }
  }, [locale])

  // 人员统计展开状态持久化
  useEffect(() => {
    try { localStorage.setItem(STATS_KEY, statsOpen ? '1' : '0') } catch (e) { /* ignore */ }
  }, [statsOpen])

  // ---------- 单元格值解析（缺省回退到 defaultStateFor）----------
  function cellValue(emp, iso) {
    let v = state.cells[L.cellKey(emp, iso)]
    if (v === undefined) v = L.defaultStateFor(iso)
    if (v === 'none') v = ''
    return v
  }

  // ---------- 下拉选项（窄格用短标签，按当前语言）----------
  function renderOptions() {
    return OPTION_KEYS.map(val => {
      const c = L.COLORS[val]
      return (
        <option key={val} value={val} title={L.statusText(val, locale, 'title')} style={{ background: c.bg, color: c.fg }}>
          {L.statusText(val, locale, 'short')}
        </option>
      )
    })
  }

  function cellStyle(value, colType) {
    const c = L.paintSelectStyle(value, colType)
    return { background: c.bg, color: c.fg }
  }

  // ---------- 写单元格 ----------
  function setCell(emp, iso, val) {
    setState(s => ({ ...s, cells: { ...s.cells, [L.cellKey(emp, iso)]: val } }))
  }

  // ---------- 批量框选标记 ----------
  // 把任意两点归一化成左上角/右下角
  function normRect(s) {
    const [ra, rb] = s.r0 <= s.r1 ? [s.r0, s.r1] : [s.r1, s.r0]
    const [ca, cb] = s.c0 <= s.c1 ? [s.c0, s.c1] : [s.c1, s.c0]
    return { ra, rb, ca, cb }
  }
  function inSelection(r, c) {
    if (!selection) return false
    const { ra, rb, ca, cb } = normRect(selection)
    return r >= ra && r <= rb && c >= ca && c <= cb
  }
  function onCellMouseDown(e, r, c) {
    if (e.ctrlKey) return   // Ctrl 保留给平移视图
    const shiftBatch = e.shiftKey && !selMode   // 按住 Shift：无需进入框选模式即可批量
    if (!selMode && !shiftBatch) return         // 普通点击交给下拉
    e.preventDefault()                          // 阻止下拉展开与 Shift 拖选文本
    if (shiftBatch) {
      if (!anchorRef.current) anchorRef.current = { r, c }   // 首次 Shift 点击 = 锚点
      const a = anchorRef.current
      dragRef.current = { r0: a.r, c0: a.c }    // 锚点为起点，支持继续 Shift+拖动扩展
      setSelection({ r0: a.r, c0: a.c, r1: r, c1: c })
      return
    }
    dragRef.current = { r0: r, c0: c }
    setSelection({ r0: r, c0: c, r1: r, c1: c })
    anchorRef.current = { r, c }
  }
  function onCellMouseEnter(r, c) {
    if (!dragRef.current) return        // 仅在拖拽过程中跟随扩展选区
    const { r0, c0 } = dragRef.current
    setSelection({ r0, c0, r1: r, c1: c })
  }
  function applyToSelection(val) {
    if (!selection) return
    const { ra, rb, ca, cb } = normRect(selection)
    setState(prev => {
      const cells = { ...prev.cells }
      for (let r = ra; r <= rb; r++) {
        for (let c = ca; c <= cb; c++) {
          const emp = prev.employees[r], iso = prev.dates[c]
          if (emp === undefined || iso === undefined) continue
          cells[L.cellKey(emp, iso)] = val
        }
      }
      return { ...prev, cells }
    })
    setSelection(null)
    anchorRef.current = null
  }
  function selectionInfo() {
    if (!selection) return null
    const { ra, rb, ca, cb } = normRect(selection)
    return {
      count: (rb - ra + 1) * (cb - ca + 1),
      nEmp: rb - ra + 1,
      nDay: cb - ca + 1,
      d0: state.dates[ca],
      d1: state.dates[cb],
    }
  }

  // 鼠标抬起结束框选
  useEffect(() => {
    const onUp = () => { dragRef.current = null }
    window.addEventListener('mouseup', onUp)
    return () => window.removeEventListener('mouseup', onUp)
  }, [])
  // Esc：清空选区并退出框选模式
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { setSelection(null); setSelMode(false); dragRef.current = null; anchorRef.current = null }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  // 日期列/员工变化（生成列、切换工作日、边缘延展、增删员工）时清空选区，避免索引错位
  useEffect(() => {
    setSelection(null)
    dragRef.current = null
    anchorRef.current = null
  }, [state.dates, state.employees])

  // ---------- 员工增删改 ----------
  function addEmp(name) {
    const v = (name || '').trim()
    if (!v) return
    if (state.employees.includes(v)) { alert(t.empExists); return }
    setState(s => ({ ...s, employees: [...s.employees, v] }))
  }
  function delEmp(emp) {
    if (!confirm(t.confirmDel(emp))) return
    setState(s => {
      const cells = {}
      Object.keys(s.cells).forEach(k => { if (!k.startsWith(emp + '|')) cells[k] = s.cells[k] })
      return { ...s, employees: s.employees.filter(e => e !== emp), cells }
    })
  }
  function renameEmp(old) {
    const nv = prompt(t.promptRename, old)
    if (!nv || !nv.trim() || nv === old) return
    const newn = nv.trim()
    setState(s => {
      const employees = s.employees.map(e => (e === old ? newn : e))
      const cells = {}
      Object.keys(s.cells).forEach(k => {
        if (k.startsWith(old + '|')) cells[newn + '|' + k.slice(old.length + 1)] = s.cells[k]
        else cells[k] = s.cells[k]
      })
      return { ...s, employees, cells }
    })
  }

  // ---------- 日期列生成 / 仅工作日切换 / 重置 ----------
  function pruneCellsForDates(dates) {
    const valid = new Set(dates)
    const cells = {}
    Object.keys(stateRef.current.cells).forEach(k => {
      if (valid.has(k.split('|')[1])) cells[k] = stateRef.current.cells[k]
    })
    return cells
  }
  function genDatesHandler(start, days) {
    const dates = L.genDates(start, days, stateRef.current.workdaysOnly)
    setState(s => ({ ...s, dates, cells: pruneCellsForDates(dates) }))
  }
  function toggleWd(checked) {
    setState(s => { const st = { ...s, workdaysOnly: checked }; L.rebuildDates(st); return st })
  }
  function clearAll() {
    if (confirm(t.confirmClear))
      setState(s => ({ ...s, cells: {} }))
  }
  function resetAll() {
    if (confirm(t.confirmReset)) {
      localStorage.removeItem(STORE_KEY)
      setState(L.defaultState())
    }
  }
  function goToday() {
    const wrap = boardWrapRef.current, board = boardRef.current
    const empTh = board && board.querySelector('tbody th.emp')
    const empW = empTh ? empTh.offsetWidth : 140
    const cell = board && board.querySelector('td.cellwrap')
    const cw = cell ? cell.getBoundingClientRect().width : 50
    const total = parseInt((dateDaysRef.current && dateDaysRef.current.value)) || 14
    const baseHalf = Math.max(1, Math.floor(total / 2))
    const colsNeeded = Math.ceil((wrap.clientWidth - empW) / cw) || 1
    const half = Math.max(baseHalf, Math.ceil((colsNeeded - 1) / 2) + 1)
    const dates = L.genDatesAround(todayISO, half, stateRef.current.workdaysOnly)
    setState(s => ({ ...s, dates, cells: pruneCellsForDates(dates) }))
    pendingScrollToRef.current = todayISO
  }

  // ---------- CSV 导出 ----------
  function exportCsv() {
    const csv = L.buildCsv(state.employees, state.dates, state.cells, locale)
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = t.csvName + todayISO + '.csv'
    a.click()
  }

  // ---------- 悬停浮动提示 ----------
  function showTip(iso, x, y) {
    const el = tipRef.current
    if (!el) return
    const LI = L.I18N[locale]
    const wd = L.weekdayText(iso, locale)
    const ents = L.holidayEntries(iso, locale)
    let html = `<b>${iso.slice(5)} ${wd}</b>`
    if (ents.length) {
      html += '<br>' + ents.map(en => {
        const pre = en.type === 'makeup' ? LI.makeupPrefix : (LI.country[en.country] || en.country)
        return `${pre}: ${en.name}`
      }).join('<br>')
    } else {
      html += `<br><span style='opacity:.7'>${LI.noMark}</span>`
    }
    el.innerHTML = html
    el.style.display = 'block'
    el.style.left = (x + 14) + 'px'
    el.style.top = (y + 14) + 'px'
  }
  function hideTip() { const el = tipRef.current; if (el) el.style.display = 'none' }
  function onOver(e) {
    const el = e.target.closest('[data-iso]')
    if (el) showTip(el.getAttribute('data-iso'), e.clientX, e.clientY)
    else hideTip()
  }
  function onMoveTip(e) {
    const el = tipRef.current
    if (el && el.style.display === 'block') {
      el.style.left = (e.clientX + 14) + 'px'
      el.style.top = (e.clientY + 14) + 'px'
    }
  }
  function onOut(e) {
    const to = e.relatedTarget
    if (!to || !to.closest || !to.closest('[data-iso]')) hideTip()
  }

  // ---------- Ctrl 拖动平移 + 边缘自动延展 ----------
  const maybeExtend = useCallback(() => {
    const wrap = boardWrapRef.current
    if (!wrap) return
    const cell = wrap.querySelector('td.cellwrap')
    const cw = cell ? cell.getBoundingClientRect().width : 50
    const maxScroll = wrap.scrollWidth - wrap.clientWidth
    if (wrap.scrollLeft <= cw * 1.5 && stateRef.current.dates.length) {
      pendingScrollAdjRef.current = EXTEND * cw
      setState(s => {
        const dates = L.extendLeft(s.dates, s.workdaysOnly, EXTEND)
        const valid = new Set(dates)
        const cells = {}
        Object.keys(s.cells).forEach(k => { if (valid.has(k.split('|')[1])) cells[k] = s.cells[k] })
        return { ...s, dates, cells }
      })
    } else if (maxScroll > 0 && wrap.scrollLeft >= maxScroll - cw * 1.5) {
      setState(s => {
        const dates = L.extendRight(s.dates, s.workdaysOnly, EXTEND)
        const valid = new Set(dates)
        const cells = {}
        Object.keys(s.cells).forEach(k => { if (valid.has(k.split('|')[1])) cells[k] = s.cells[k] })
        return { ...s, dates, cells }
      })
    }
  }, [])

  useEffect(() => {
    const wrap = boardWrapRef.current
    if (!wrap) return
    const onDown = (e) => {
      if (!e.ctrlKey) return
      if (e.target.closest('th.emp')) return
      panRef.current = { panning: true, startX: e.clientX, startScroll: wrap.scrollLeft }
      wrap.style.cursor = 'grabbing'
      e.preventDefault()
    }
    const onMove = (e) => {
      if (!panRef.current.panning) return
      wrap.scrollLeft = panRef.current.startScroll - (e.clientX - panRef.current.startX)
      maybeExtend()
    }
    const onUp = () => {
      if (panRef.current.panning) { panRef.current.panning = false; wrap.style.cursor = '' }
    }
    wrap.addEventListener('mousedown', onDown)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    wrap.addEventListener('scroll', maybeExtend, { passive: true })
    return () => {
      wrap.removeEventListener('mousedown', onDown)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      wrap.removeEventListener('scroll', maybeExtend)
    }
  }, [maybeExtend])

  // 延展/回到今天后的滚动补偿（在 DOM 更新后执行）
  useLayoutEffect(() => {
    const wrap = boardWrapRef.current, board = boardRef.current
    if (!wrap || !board) return
    if (pendingScrollAdjRef.current) {
      wrap.scrollLeft += pendingScrollAdjRef.current
      pendingScrollAdjRef.current = 0
    }
    if (pendingScrollToRef.current) {
      const iso = pendingScrollToRef.current
      pendingScrollToRef.current = null
      const idx = state.dates.indexOf(iso)
      if (idx >= 0) {
        const empTh = board.querySelector('tbody th.emp')
        const empW = empTh ? empTh.offsetWidth : 140
        const cell = board.querySelector('td.cellwrap')
        const cw = cell ? cell.getBoundingClientRect().width : 50
        const centerX = empW + idx * cw + cw / 2
        const target = Math.max(0, Math.min(centerX - wrap.clientWidth / 2, wrap.scrollWidth - wrap.clientWidth))
        wrap.scrollLeft = target
      }
    }
  })

  // ---------- 表头单格 ----------
  function dateHeader(iso) {
    const wd = L.weekdayText(iso, locale)
    const ents = L.holidayEntries(iso, locale)
    const hasCN = ents.some(e => e.country === 'CN' && e.type === 'holiday')
    const hasMakeup = ents.some(e => e.type === 'makeup')
    const hasSE = ents.some(e => e.country === 'SE' && e.type === 'holiday')
    let cls = 'hd'
    if (hasMakeup) cls = 'hd makeup'
    else if (hasCN) cls = 'hd holiday'
    else if (hasSE) cls = 'hd seflag'
    else if (L.isWeekend(iso)) cls = 'hd weekend'
    const isToday = iso === todayISO
    return { cls: cls + (isToday ? ' today' : ''), iso, label: iso.slice(5), wd }
  }

  // 人员统计：常显全员合计；折叠时不渲染每人卡片，把空间留给矩阵
  const totals = L.computeTotals(state.employees, state.dates, state.cells)
  const statCards = statsOpen
    ? L.computeSummary(state.employees, state.dates, state.cells).map(s => (
        <div className="sum-card" key={s.emp}>
          <div className="sum-name">{s.emp}</div>
          <dl className="sum-nums">
            <div className="sum-item is-work"><dt>{t.sumLabel.work}</dt><dd>{s.work}</dd></div>
            <div className="sum-item is-leave"><dt>{t.sumLabel.leave}</dt><dd>{s.leave}</dd></div>
            <div className="sum-item is-sick"><dt>{t.sumLabel.sick}</dt><dd>{s.sick}</dd></div>
            <div className="sum-item is-pubhol"><dt>{t.sumLabel.pubhol}</dt><dd>{s.pubhol}</dd></div>
          </dl>
        </div>
      ))
    : null

  return (
    <div className="app">
      <header>
        <div className="titlerow">
          {/* 版本号必须是单个表达式：拆成两段文本会让 SSR 插入注释标记，破坏 "v1.4.0" 整体 */}
          <h1>{t.title}<span className="ver">{`v${L.VERSION}`}</span></h1>
          <Clocks locale={locale} />
          <button className="btn" onClick={() => setLocale(l => (l === 'zh' ? 'en' : 'zh'))}>{t.langBtn}</button>
        </div>
        <div className="toolbar">
          <div className="field"><input type="text" id="newEmp" placeholder={t.empName} style={{ width: 110 }} /></div>
          <button className="btn" onClick={() => { const i = document.getElementById('newEmp'); addEmp(i.value); i.value = '' }}>{t.addEmp}</button>
          <div className="field">{t.start} <input type="date" id="dateStart" defaultValue={todayISO} /></div>
          <div className="field">{t.days} <input type="number" id="dateDays" ref={dateDaysRef} defaultValue={14} min={1} max={365} style={{ width: 60 }} /></div>
          <button className="btn" onClick={() => { const s = document.getElementById('dateStart').value; const n = parseInt(document.getElementById('dateDays').value) || 14; if (!s) { alert(t.alertStart); return } genDatesHandler(s, n) }}>{t.generate}</button>
          <button className="btn primary" onClick={goToday}>{t.goToday}</button>
          <label className="field"><input type="checkbox" id="wdOnly" checked={state.workdaysOnly} onChange={e => toggleWd(e.target.checked)} /> {t.workdaysOnly}</label>
        </div>
        <div className="toolbar">
          <button
            className={'btn' + (selMode ? ' primary' : '')}
            onClick={() => { setSelMode(m => !m); setSelection(null); dragRef.current = null; anchorRef.current = null }}
          >
            {selMode ? t.selectModeOn : t.selectMode}
          </button>
          <button className="btn" onClick={clearAll}>{t.resetWork}</button>
          <button className="btn" onClick={resetAll}>{t.resetBoard}</button>
          <button className="btn" onClick={exportCsv}>{t.exportCsv}</button>
        </div>
        {/* 操作说明：分条列出，避免一整段文字连在一起 */}
        <ul className="tiplist">
          {t.tips.map((line, i) => (
            <li key={i} dangerouslySetInnerHTML={{ __html: line }} />
          ))}
        </ul>
      </header>

      <div className="board-wrap" ref={boardWrapRef} onMouseOver={onOver} onMouseMove={onMoveTip} onMouseOut={onOut}>
        <table id="board" ref={boardRef} className={selMode ? 'selecting' : ''}>
          <thead>
            <tr>
              <th className="corner">{t.corner}</th>
              {state.dates.map(iso => {
                const h = dateHeader(iso)
                // h.wd 已含语言前缀（中文「周三」/ 英文「Wed」），此处不可再拼「周」
                return (
                  <th key={iso} className={h.cls} data-iso={iso}>{h.label}<br />{h.wd}</th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {state.employees.map((emp, rowIdx) => (
              <tr key={emp}>
                <th className="emp">
                  <div className="emp-inner">
                    <span className="emp-name" title={t.renameTitle} onClick={() => renameEmp(emp)}>{emp}</span>
                    <span className="emp-del" title={t.delTitle} onClick={() => delEmp(emp)}>✕</span>
                  </div>
                </th>
                {state.dates.map((iso, colIdx) => {
                  const v = cellValue(emp, iso)
                  const ct = L.colTypeOf(iso)
                  const isToday = iso === todayISO
                  const isSel = inSelection(rowIdx, colIdx)
                  return (
                    <td
                      key={iso}
                      className={'cellwrap' + (isToday ? ' today' : '')}
                      onMouseDown={(e) => onCellMouseDown(e, rowIdx, colIdx)}
                      onMouseEnter={() => onCellMouseEnter(rowIdx, colIdx)}
                    >
                      <select
                        className={'cellsel' + (isToday ? ' today' : '') + (isSel ? ' sel' : '')}
                        data-emp={emp} data-iso={iso} data-coltype={ct}
                        value={v}
                        style={cellStyle(v, ct)}
                        onChange={e => setCell(emp, iso, e.target.value)}
                      >
                        {renderOptions()}
                      </select>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 图例移到页面底部：顶栏只留操作区，视觉重心全给矩阵 */}
      <div className="legend">
        <div className="palette" id="palette">
          {OPTION_KEYS.map(v => (
            <div className="swatch" key={v}>
              <span className={'dot ' + (v === '' ? 'none' : v)} />
              {L.statusText(v, locale, 'full')}
            </div>
          ))}
        </div>
      </div>

      <div className="stats">
        <button
          className={'statsbar' + (statsOpen ? ' open' : '')}
          id="statsBar"
          aria-expanded={statsOpen}
          title={statsOpen ? t.statsCollapse : t.statsExpand}
          onClick={() => setStatsOpen(o => !o)}
        >
          <span className="stats-title">{t.stats}</span>
          <span className="stats-total">{t.summary(totals.work, totals.leave, totals.sick, totals.pubhol)}</span>
          <span className="stats-arrow" aria-hidden="true">▾</span>
        </button>
        <div className="summary" id="summary">{statCards}</div>
      </div>
      <div className="datasource">
        {t.dataSource}
        <span className="ver ver-foot">{`v${L.VERSION}`}</span>
      </div>

      {/* 批量框选：拖动出选区后浮动显示，避免顶栏增减行导致布局跳动 */}
      {selection && (() => {
        const info = selectionInfo()
        return (
          <div className="selbar">
            <span>{t.selected(info.count, info.nEmp, info.nDay, info.d0, info.d1)}</span>
            {OPTION_KEYS.map(v => {
              const c = L.COLORS[v]
              return (
                <button
                  key={v}
                  className="btn"
                  style={{ background: c.bg, color: v === '' ? '#1f2933' : c.fg, borderColor: '#cbd5e1' }}
                  onClick={() => applyToSelection(v)}
                  title={L.statusText(v, locale, 'title')}
                >
                  {L.statusText(v, locale, 'full')}
                </button>
              )
            })}
            <button className="btn" onClick={() => setSelection(null)}>{t.cancel}</button>
          </div>
        )
      })()}

      <div id="tipFloat" ref={tipRef} />
    </div>
  )
}
