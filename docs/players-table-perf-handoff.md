# Handoff — Players table scroll performance

**Status:** proposed, not implemented. Diagnosis was done by reading the code; **no UI change here has been verified in a browser**, because the analysis ran in a remote session with no way to run the app. Everything below needs a local run to confirm.

**Context:** the Players page (~1200 rows × 15 columns) lags on scroll. A JS virtualization attempt was rejected — it produced white/blank rows during fast scroll that only filled in once scrolling stopped.

---

## 1. Why virtualization produced white rows

A virtualizer renders only the in-view window. Scrolling drives: scroll event → React state update → re-render → paint. That chain runs on the **main thread**. Scrolling itself is driven by the **compositor**, which runs independently and never waits for React.

On a fast fling the compositor reaches rows React hasn't rendered yet → placeholder → white until the main thread catches up.

This is architectural, not a tuning problem. Raising `overscan` only pushes the blank further out and gives back the performance the virtualizer was added for.

**Therefore: the goal is not to render fewer rows. It's to make rendering all 1200 cheap enough that windowing isn't needed.** Browsers handle 1200-row tables fine when layout is linear. Two CSS properties currently stop it being linear.

---

## 2. Root causes (both in `frontend/src/pages/Players.css`)

### Cause A — no `table-layout`, so it defaults to `auto`

`Players.css:214`

```css
.player-table {
  width: 100%;
  border-collapse: collapse;
  /* no table-layout -> defaults to `auto` */
}
```

Under `table-layout: auto`, the browser cannot assign column widths until it has measured **every cell in every row**. That's a pass over ~18,000 cells, on the main thread, and it re-runs on every sort, every filter change, and every Per-Game/Totals toggle.

This is the primary suspect for the underlying slowness. Virtualization masked it by shrinking the cell count rather than fixing the quadratic-ish measurement.

### Cause B — `position: sticky` on the first cell of every row

`Players.css:246-254`

```css
.player-table th:first-child,
.player-table td:first-child {
  position: sticky;
  left: 0;
  ...
}
```

1200 sticky constraints for the compositor to re-evaluate on every scroll frame, on top of the sticky header. **This cost is independent of how many rows React renders** — which is exactly why virtualizing did not fix the scroll feel.

---

## 3. Changes to make, in order

Apply and measure **one at a time**. Stop as soon as scroll feels right — later steps may be unnecessary.

### Step 1 — `table-layout: fixed` + explicit column widths

`frontend/src/pages/Players.css:214`

```css
.player-table {
  width: 100%;
  table-layout: fixed;        /* ADD */
  border-collapse: collapse;
  background: #fff;
  font-size: 14px;
}
```

With `fixed`, widths come from the header row alone and rows lay out in one linear pass. **Widths must be declared or columns will distribute evenly and look wrong.**

The table has 15 columns in this order (`Players.tsx:497-511`): Name, NBA Team, Pos, Team, MIN, FG%, FT%, 3PM, REB, AST, STL, BLK, PTS, GP, Matchup (Matchup only when `FF_MATCHUP_QUALITY` is on).

```css
/* Starting point — tune against the real rendered widths before committing. */
.player-table th:nth-child(1)  { width: 190px; }  /* Name (sticky)   */
.player-table th:nth-child(2)  { width:  80px; }  /* NBA Team        */
.player-table th:nth-child(3)  { width:  90px; }  /* Pos             */
.player-table th:nth-child(4)  { width: 130px; }  /* Fantasy Team    */
.player-table th:nth-child(n+5):nth-child(-n+14) { width: 62px; }  /* MIN..GP */
.player-table th:nth-child(15) { width: 150px; }  /* Matchup         */

.player-table td {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

**Watch for:** long player names clipping in the 190px Name column, and the `colSpan={10}` "No data for this range" cell (`Players.tsx:513-520`) still spanning correctly. Under `fixed`, content no longer widens a column.

### Step 2 — contain the sticky cells

`frontend/src/pages/Players.css:246`

```css
.player-table th:first-child,
.player-table td:first-child {
  position: sticky;
  left: 0;
  z-index: 11;
  background: #fff;
  border-right: 1px solid #ddd;
  contain: layout paint;      /* ADD — own containment root per sticky cell */
}
```

If scroll is still heavy on mobile, consider dropping sticky entirely on small screens — that's where the compositor is weakest and where the horizontal scroll the sticky column exists for is most common. **This is a UX tradeoff, not a free win — needs a human decision after feeling both.**

```css
@media (max-width: 640px) {
  .player-table th:first-child,
  .player-table td:first-child { position: static; }
}
```

### Step 3 — only if Steps 1–2 are insufficient

```css
.player-table tbody tr {
  content-visibility: auto;
  contain-intrinsic-size: auto 41px;   /* MEASURE the real row height first */
}
```

Skips layout/paint for off-screen rows **while leaving them in the DOM** — decided inside the browser's paint pipeline, not in JS, so there's no React round-trip to fall behind the compositor. Ctrl-F and text selection keep working.

**Caveat:** on an extreme fling some browsers may briefly show an unpainted region. It recovers within a frame rather than waiting for scroll to stop, and never shows an empty row where content should be — but this is the step closest to what was rejected before, so evaluate it carefully.

`contain-intrinsic-size` must match the real row height (measure a `<tr>` in DevTools) or the scrollbar will jump.

### Step 4 — React-side (secondary; layout is the main cost)

1. **`PlayerNameLink.tsx:10`** — calls `useLocation()` internally, so 1200 router-context subscriptions on this page. It also blocks `React.memo` on any row: the memo comparison passes, then the context change forces the render anyway. Hoist `useLocation()` to `PlayerTable`, pass `from` down as a prop (keep the internal call as a fallback default so other call sites keep working).
2. **`Players.tsx:411`** — wrap `formatStat` in `useCallback`. `getTeamDisplay` directly above it already is; this one was missed. Required before a memo'd row does anything.
3. **`Players.tsx:497-546`** — extract `const PlayerRow = React.memo(...)`. Only effective after (1) and (2). Currently expanding one matchup row re-renders all 1200.
4. **`Players.tsx:499`** — `key={`${player.player_name}-${idx}`}` includes the array index, so every key changes on sort and React remounts all rows instead of reordering. Use `key={player.player_id ?? player.player_name}`.
5. **`Players.tsx:117`** — memo deps include the whole `filters` object, which gets a new identity on every keystroke, so the 250 ms debounce never prevents the filter pass. Depend on the individual fields instead.

---

## 4. Test protocol (must be run locally — not verified here)

```bash
cd frontend && npm install && npm run dev
```

Ensure the dataset is the full one: Players page requests `limit: 1200` (`Players.tsx:26`).

### Measure before changing anything — record the baseline

1. DevTools → **Performance** → record ~5 s while flinging the table hard, top to bottom.
2. Record from the summary: **scripting / rendering / painting ms**, and **dropped frames**.
3. DevTools → Performance → check **Layout** and **Recalculate Style** total durations. Under `table-layout: auto` these should be the dominant blocks — **if they are not, Step 1 is the wrong fix and this diagnosis is wrong.** Say so rather than continuing.
4. Repeat with CPU throttling **4× slowdown** to approximate a mid-range phone.

### After each step

Re-record the same trace and compare. Expected direction:

| Step | Expect to drop |
|---|---|
| 1 — `table-layout: fixed` | **Layout** time, sharply. Also faster sort/filter/toggle. |
| 2 — `contain` on sticky cells | **Paint / compositing** during scroll |
| 3 — `content-visibility` | Layout + paint further; watch the scrollbar for jump |
| 4 — React memo work | **Scripting** time on expand/sort, not on scroll |

### Correctness checks (needs human eyes — this is why it can't be signed off remotely)

- [ ] Column widths look right at desktop, tablet, and 375px-wide mobile
- [ ] Long names (e.g. "Shai Gilgeous-Alexander", "Giannis Antetokounmpo") don't clip badly in the Name column
- [ ] Sticky Name column still pins during horizontal scroll (or is deliberately off on mobile)
- [ ] Sticky header still pins during vertical scroll
- [ ] **No white/blank rows on a hard fling** — the original complaint
- [ ] Sorting each column still works, and rows don't visibly flash/remount
- [ ] Expanding a matchup row still renders `MatchupExpandRow` at full width
- [ ] The custom-range "No data for this range" `colSpan` row still spans correctly
- [ ] Dark mode unaffected (`Players.css:342+`)
- [ ] Same checks on `TeamDetail.tsx` and `PlayerRankings.tsx` if the CSS is shared

### Regression

```bash
cd frontend && npm test        # component tests, incl. Players.test.tsx
cd frontend && npm run build   # type-check + production build
```

---

## 5. What NOT to do

- **Don't reintroduce JS virtualization** (`react-window`, `@tanstack/react-virtual`). It was already rejected for cause; the white rows are inherent to rendering asynchronously with respect to scroll.
- **Don't raise `overscan` as a fix** — it trades the blank for the performance you were trying to gain.
- **Don't skip the baseline trace.** If Layout isn't dominant in the "before" profile, Cause A is wrong and Steps 1–3 won't help; report that back instead of applying them anyway.
