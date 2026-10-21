# Employee Leave & Attendance Board

A lightweight, offline-first attendance board for **China–Sweden** teams. Chinese and Swedish public holidays are detected automatically — including China's adjusted make-up workdays — so you only need to mark the exceptions.

Two builds ship side by side from a **single shared logic layer**, so behaviour never drifts between them.

---

## Highlights

- **Automatic public holidays** — China (State Council, incl. make-up workdays) and Sweden (national holidays incl. Easter-derived moving feasts), with automatic daylight-saving handling for the Sweden clock.
- **Nine marking states** — Work, Leave (full / AM / PM), Sick (full / AM / PM), Public holiday, Blank. AM/PM count as 0.5 day. Public holiday is tracked **separately** from Leave.
- **Batch editing** — drag a box, or just hold **Shift** and click / drag.
- **Bilingual UI** — one-click 中文 / English toggle over a shared translation pack.
- **Works with no backend** — everything lives in `localStorage`; CSV export included.

---

## Quick start

### Option A — single file, no build

Keep these two files in the **same folder** and open `attendance-board.html` in a browser:

```
attendance-board.html
attendance-logic.js      ← required (vanilla build loads it via <script src>)
```

No server, no `npm install`. Note that the vanilla build is a single *page* but not a fully self-contained file.

### Option B — React build

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # output to dist/
npm test           # 111 assertions (79 logic + 32 UI contract)
```

Both builds read and write the **same `localStorage` keys**, so you can switch between them without losing data.

---

## Usage

| Action | How |
|---|---|
| Mark a cell | Pick a state from the dropdown |
| Batch mark | Drag a box, or hold **Shift** + click / drag |
| Enter / leave box-select mode | **框选模式** button — **Esc** clears the selection |
| Pan the timeline | **Ctrl** + drag (auto-extends at both edges) |
| Rename / delete employee | Click the name / click **✕** |
| Centre on today | **回到今天** |

Header colours: red = Chinese holiday · amber = make-up workday · grey = weekend · blue with a yellow cross = Sweden-only holiday. Hover any date cell for the holiday name.

Employee stats are **collapsed by default** into a single totals bar — click to expand per-person cards, leaving the matrix the visual centre of the page.

---

## Project layout

```
attendance-board.html      vanilla build (loads attendance-logic.js from the same folder)
attendance-logic.js        UMD logic layer — the single source of truth for both builds
attendance-logic.test.js   pure logic tests        (79 assertions)
attendance-ui.test.js      UI contract tests       (32 assertions)
src/App.jsx                React build
src/main.jsx
src/styles.css
vite.config.js
CHANGELOG.md
```

The logic layer is deliberately UMD: it attaches to `globalThis` for the browser build and uses `module.exports` for Node, which lets the test suite exercise exactly the code that runs in the page.

---

## Holiday data

| Country | Source | Coverage |
|---|---|---|
| China | State Council public holiday arrangements (incl. adjusted make-up workdays) | 2025–2026 |
| Sweden | Swedish MFA circular note 2/2025 + [publicholidays.se](https://publicholidays.se) | 2025–2027 |

Holiday tables are hand-maintained constants in `attendance-logic.js`. **New years must be added after the official publication** — the UI states this too. Two tests guard the data: Swedish Midsummer / All Saints' Day must fall on a Saturday, and every Chinese make-up day must fall on a weekend and never collide with a public holiday.

### Known limitation

Employees are treated under a single holiday rule set: every public holiday from **both** countries is marked as Public holiday for **everyone**. There is no per-employee country attribute yet — relevant if your team members are individually bound to CN-only or SE-only calendars.

---

## Version

Current: **v1.4.0** — see [CHANGELOG.md](CHANGELOG.md). The version lives in `attendance-logic.js` (`VERSION`) and is the single source shown on both builds.
