import { shotLabels, passesFilter, signedImpact, isScoped, type ShotScope, type ShotData, type ShotFilter, type ShotMode, type ShotRow, type ShotUnit } from '../../utils/shootingMap'

/*
 * The Shooting Map's pan/zoom scatter, drawn straight into an <svg> outside
 * React: wheel / pinch / drag / double-click redraw every animation frame, and
 * a plain redraw of ~200 points is far cheaper than reconciling them.
 * The page hands it the derived data, filters and selection with update().
 */

export interface ChartInput {
  data: ShotData
  mode: ShotMode
  unit: ShotUnit
  filter: ShotFilter
  scope: ShotScope
  selected: ReadonlySet<string>
}

export interface ChartHandle {
  update(input: ChartInput, resetView: boolean): void
  focus(key: string): void
  zoomBy(factor: number): void
  reset(): void
  destroy(): void
}

const NS = 'http://www.w3.org/2000/svg'
const MAX_ZOOM = 12
let chartCount = 0
const DISPLAY_FONT = '"Barlow Condensed", "Inter", system-ui, sans-serif'

interface Placed { X: number; Y: number; on: boolean; inView: boolean; pri: number }
type Row = ShotRow & Placed
interface Box { x: number; y: number; w: number; h: number }
interface Dims { w: number; h: number; m: { l: number; r: number; t: number; b: number }; W: number; H: number; narrow: boolean }

const measureCtx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null
function textW(t: string, size: number, weight = 600): number {
  if (!measureCtx) return t.length * size * 0.5
  measureCtx.font = `${weight} ${size}px ${DISPLAY_FONT}`
  return measureCtx.measureText(t).width
}

function niceTicks(a: number, b: number, n: number, minStep = 0) {
  const span = b - a, step0 = span / n, mag = Math.pow(10, Math.floor(Math.log10(step0))), err = step0 / mag
  const step = Math.max(minStep, (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag)
  const ticks: number[] = []
  for (let v = Math.ceil(a / step) * step; v <= b + 1e-9; v += step) ticks.push(+v.toFixed(10))
  return { ticks, step }
}

function hex(c: string): number[] {
  const h = c.replace('#', '')
  return [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16))
}
function mix(a: string, b: string, t: number): string {
  const A = hex(a), B = hex(b)
  return 'rgb(' + A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',') + ')'
}
function shortName(n: string): string {
  const p = n.split(' ')
  return p.length > 1 ? p[0][0] + '. ' + p.slice(1).join(' ') : n
}
function esc(s: string): string {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
}

export function createShootingMapChart(
  svg: SVGSVGElement,
  tip: HTMLDivElement,
  themeRoot: HTMLElement,
  callbacks: { onToggle(key: string): void; onZoom(k: number): void },
): ChartHandle {
  let input: ChartInput | null = null
  // Unique per chart, so two maps on one page never share a clip path.
  const clipId = `sm-plot-${++chartCount}`
  let rows: Row[] = []
  const view = { k: 1, tx: 0, ty: 0 }
  let hover: string | null = null
  // Colors are read once per redraw, not per point.
  let palette: Record<string, string> = {}

  const css = (n: string) => getComputedStyle(themeRoot).getPropertyValue(n).trim()
  const readPalette = () => {
    palette = Object.fromEntries(['--ink', '--muted', '--grid', '--rule', '--label-halo', '--hot', '--cold', '--neutral', '--sel']
      .map(n => [n, css(n)]))
  }
  const el = (tag: string, attrs: Record<string, string | number>, parent?: Element) => {
    const e = document.createElementNS(NS, tag)
    for (const k in attrs) e.setAttribute(k, String(attrs[k]))
    if (parent) parent.appendChild(e)
    return e
  }

  const dims = (): Dims => {
    const r = svg.getBoundingClientRect()
    const narrow = r.width < 560
    const m = { l: narrow ? 44 : 58, r: narrow ? 12 : 22, t: 16, b: narrow ? 40 : 46 }
    return { w: r.width, h: r.height, m, W: r.width - m.l - m.r, H: r.height - m.t - m.b, narrow }
  }
  const clampView = (dm: Dims) => {
    const minTx = dm.W - dm.W * view.k, minTy = dm.H - dm.H * view.k
    view.tx = Math.min(0, Math.max(minTx, view.tx))
    view.ty = Math.min(0, Math.max(minTy, view.ty))
  }
  const D = () => (input as ChartInput).data
  const sx = (v: number, dm: Dims) => dm.m.l + ((v - D().x0) / (D().x1 - D().x0) * dm.W) * view.k + view.tx
  const sy = (v: number, dm: Dims) => dm.m.t + (dm.H - (v - D().y0) / (D().y1 - D().y0) * dm.H) * view.k + view.ty
  const invX = (px: number, dm: Dims) => D().x0 + ((px - dm.m.l - view.tx) / view.k) / dm.W * (D().x1 - D().x0)
  const invY = (py: number, dm: Dims) => D().y0 + (dm.H - (py - dm.m.t - view.ty) / view.k) / dm.H * (D().y1 - D().y0)

  const fmtPct = (v: number) => (v * 100).toFixed(1) + '%'
  const fmtN = (v: number) => (input?.unit === 'tot' ? Math.round(v).toString() : v.toFixed(1))
  const color = (d: Row) => {
    const t = Math.max(-1, Math.min(1, d.z / 2))
    return mix(palette['--neutral'], t > 0 ? palette['--hot'] : palette['--cold'], Math.pow(Math.abs(t), 0.8))
  }
  const annText = (d: Row) => {
    const L = shotLabels((input as ChartInput).mode)
    const parts: string[] = []
    // Ranks are among the top 200; a team's other players get none.
    if (!d.inPool) return fmtPct(d.pct) + ' on ' + fmtN(d.a) + ' ' + L.att
    if (d.rPct && d.rPct <= 10) parts.push('#' + d.rPct + ' ' + L.pct)
    else if (d.rPct && d.rPct > D().nq - 10) parts.push('#' + d.rPct + '/' + D().nq + ' ' + L.pct)
    if (d.rVol <= 10) parts.push('#' + d.rVol + ' ' + L.att)
    if (!parts.length) parts.push(fmtPct(d.pct) + ' on ' + fmtN(d.a) + ' ' + L.att)
    return parts.join(' · ')
  }

  function render() {
    if (!input) return
    const dm = dims()
    while (svg.firstChild) svg.removeChild(svg.firstChild)
    if (dm.W <= 0 || dm.H <= 0) return
    clampView(dm)
    readPalette()
    svg.setAttribute('viewBox', `0 0 ${dm.w} ${dm.h}`)
    const { mode, unit, filter, scope, selected } = input
    const data = D()
    const L = shotLabels(mode)
    const ink = palette['--ink'], muted = palette['--muted'], grid = palette['--grid'], rule = palette['--rule'], halo = palette['--label-halo']
    const defs = el('defs', {}, svg)
    const cp = el('clipPath', { id: clipId }, defs)
    el('rect', { x: dm.m.l, y: dm.m.t, width: dm.W, height: dm.H }, cp)

    // visible domain
    const vx0 = invX(dm.m.l, dm), vx1 = invX(dm.m.l + dm.W, dm), vy0 = invY(dm.m.t + dm.H, dm), vy1 = invY(dm.m.t, dm)
    const gx = niceTicks(vx0, vx1, dm.narrow ? 4 : 8), gy = niceTicks(vy0, vy1, dm.narrow ? 5 : 7, unit === 'tot' ? 1 : 0)
    const gG = el('g', {}, svg)
    gx.ticks.forEach(v => {
      const x = sx(v, dm)
      el('line', { x1: x, x2: x, y1: dm.m.t, y2: dm.m.t + dm.H, stroke: grid, 'stroke-width': 1 }, gG)
      const t = el('text', { x, y: dm.m.t + dm.H + 18, 'text-anchor': 'middle', 'font-size': 12, fill: muted }, gG)
      t.textContent = (v * 100).toFixed(gx.step < 0.01 ? 1 : 0) + '%'
    })
    gy.ticks.forEach(v => {
      const y = sy(v, dm)
      el('line', { x1: dm.m.l, x2: dm.m.l + dm.W, y1: y, y2: y, stroke: grid, 'stroke-width': 1 }, gG)
      const t = el('text', { x: dm.m.l - 8, y: y + 4, 'text-anchor': 'end', 'font-size': 12, fill: muted }, gG)
      t.textContent = gy.step < 1 ? v.toFixed(1) : String(Math.round(v))
    })
    el('rect', { x: dm.m.l, y: dm.m.t, width: dm.W, height: dm.H, fill: 'none', stroke: rule }, gG)
    // axis titles
    let t = el('text', { x: dm.m.l + dm.W, y: dm.h - 6, 'text-anchor': 'end', 'font-size': 13, 'font-weight': 700, fill: ink, 'letter-spacing': '.06em' }, svg)
    t.textContent = L.pct + '  →'
    t = el('text', { transform: `translate(13 ${dm.m.t}) rotate(-90)`, 'text-anchor': 'end', 'font-size': 13, 'font-weight': 700, fill: ink, 'letter-spacing': '.06em' }, svg)
    t.textContent = (unit === 'tot' ? 'TOTAL ' : '') + L.att + (unit === 'pg' ? ' / GAME' : '') + '  →'

    const plot = el('g', { 'clip-path': `url(#${clipId})` }, svg)
    const reserved: Box[] = []
    const ov = (b: Box) => reserved.some(p => b.x < p.x + p.w && b.x + b.w > p.x && b.y < p.y + p.h && b.y + b.h > p.y)

    // quadrant names in the corners, faded out as you zoom in
    const ax = sx(data.avgPct, dm), ay = sy(data.avgAtt, dm)
    const quads: [string, number, number][] = [
      ['High volume, high %', 1, 1], ['High volume, low %', 0, 1],
      ['Low volume, high %', 1, 0], ['Low volume, low %', 0, 0],
    ]
    quads.forEach(([label, right, top]) => {
      const qs = dm.narrow ? 12 : 14
      const x = right ? dm.m.l + dm.W - 12 : dm.m.l + 12, y = top ? dm.m.t + 20 : dm.m.t + dm.H - 12
      const qo = 0.7 * Math.max(0, Math.min(1, 2.2 - view.k))
      if (qo <= 0) return
      const t = el('text', { x, y, 'text-anchor': right ? 'end' : 'start', 'font-size': qs, 'font-weight': 700, fill: muted, opacity: qo, 'pointer-events': 'none', 'letter-spacing': '.02em' }, plot)
      t.textContent = label
      const w = textW(label, qs, 700)
      reserved.push({ x: right ? x - w : x, y: y - qs, w, h: qs + 4 })
    })

    // equal-impact curves: pct = avg + c / attempts
    ;[1, 2].map(m => m * data.sd).forEach((c, li) => [c, -c].forEach(cc => {
      const pts: [number, number][] = []
      const aMin = Math.max(0.2, vy0), aMax = vy1
      for (let i = 0; i <= 120; i++) {
        const a = aMin + (aMax - aMin) * Math.pow(i / 120, 1.6)
        const p = data.avgPct + cc / a
        if (p < vx0 - 0.2 || p > vx1 + 0.2) continue
        pts.push([sx(p, dm), sy(a, dm)])
      }
      if (pts.length < 2) return
      const stroke = cc > 0 ? palette['--hot'] : palette['--cold']
      el('path', { d: 'M' + pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('L'), fill: 'none', stroke, 'stroke-width': 1.2, 'stroke-dasharray': '3 5', opacity: li ? 0.35 : 0.5 }, plot)
      const aL = vy0 + (vy1 - vy0) * 0.9, pL = data.avgPct + cc / aL, xL = sx(pL, dm), yL = sy(aL, dm)
      const lw = textW(fmtN(Math.abs(cc)) + '+', 11.5, 700)
      const ib = { x: cc > 0 ? xL + 5 : xL - 5 - lw, y: yL - 11, w: lw + 2, h: 13 }
      if (aL > 0.2 && xL > dm.m.l + 20 && xL < dm.m.l + dm.W - 20 && !ov(ib)) {
        reserved.push(ib)
        const tt = el('text', { x: xL + (cc > 0 ? 5 : -5), y: yL, 'text-anchor': cc > 0 ? 'start' : 'end', 'font-size': 11.5, 'font-weight': 700, fill: stroke, stroke: halo, 'stroke-width': 3, 'paint-order': 'stroke' }, plot)
        tt.textContent = (cc > 0 ? '+' : '−') + fmtN(Math.abs(cc))
      }
    }))

    // average lines
    el('line', { x1: ax, x2: ax, y1: dm.m.t, y2: dm.m.t + dm.H, stroke: ink, 'stroke-width': 1.3, opacity: 0.75 }, plot)
    el('line', { x1: dm.m.l, x2: dm.m.l + dm.W, y1: ay, y2: ay, stroke: ink, 'stroke-width': 1.3, opacity: 0.75 }, plot)
    t = el('text', { x: ax + 6, y: dm.m.t + dm.H - 8, 'font-size': 12, 'font-weight': 700, fill: ink }, plot)
    t.textContent = 'AVG ' + fmtPct(data.avgPct)
    reserved.push({ x: ax + 4, y: dm.m.t + dm.H - 22, w: textW(t.textContent, 12, 700) + 4, h: 16 })
    t = el('text', { x: dm.m.l + dm.W - 8, y: ay - 6, 'text-anchor': 'end', 'font-size': 12, 'font-weight': 700, fill: ink }, plot)
    t.textContent = 'AVG ' + fmtN(data.avgAtt) + ' ' + L.att
    {
      const w = textW(t.textContent, 12, 700) + 4
      reserved.push({ x: dm.m.l + dm.W - 8 - w, y: ay - 20, w, h: 16 })
    }

    // points
    const r = Math.min(9, 4.6 + Math.log2(view.k) * 1.1) * (dm.narrow ? 0.9 : 1)
    const vis: Row[] = []
    for (const d of rows) {
      d.X = sx(d.pct, dm)
      d.Y = sy(d.a, dm)
      d.on = passesFilter(d, data, filter, scope)
      d.inView = d.X >= dm.m.l - 2 && d.X <= dm.m.l + dm.W + 2 && d.Y >= dm.m.t - 2 && d.Y <= dm.m.t + dm.H + 2
      if (d.inView) vis.push(d)
    }
    const pg = el('g', {}, plot)
    const order = [...vis].sort((a, b) => (Number(a.on) - Number(b.on)) || (Math.abs(a.z) - Math.abs(b.z)))
    for (const d of order) {
      const isSel = selected.has(d.key), isHov = hover === d.key
      el('circle', {
        cx: d.X.toFixed(1), cy: d.Y.toFixed(1), r: (isSel || isHov) ? r + 2.2 : r, fill: color(d),
        stroke: isSel ? palette['--sel'] : halo, 'stroke-width': isSel ? 2.4 : 1, opacity: d.on ? 1 : 0.13,
        'data-key': d.key, style: 'cursor:pointer',
      }, pg)
    }

    // labels: priority = outlier-ness + isolation; the budget grows with zoom
    const cand = vis.filter(d => d.on)
    for (const d of cand) {
      let n1 = 1e9, n2 = 1e9
      for (const o of cand) {
        if (o === d) continue
        const dd = Math.hypot(o.X - d.X, o.Y - d.Y)
        if (dd < n1) { n2 = n1; n1 = dd } else if (dd < n2) n2 = dd
      }
      const iso = Math.min(1.5, (n1 + n2) / 2 / 60)
      const ext = Math.hypot((d.pct - data.avgPct) / (data.x1 - data.x0) * 3, (d.a - data.avgAtt) / (data.y1 - data.y0) * 3)
      d.pri = Math.abs(d.z) + iso * 1.1 + ext * 0.6 + (selected.has(d.key) ? 100 : 0) + (hover === d.key ? 200 : 0) + (d.frank != null && d.frank <= 20 ? 0.35 : 0)
    }
    cand.sort((a, b) => b.pri - a.pri)
    // A single team leaves few dots; label them all.
    const budget = isScoped(scope) && cand.length <= 30 ? cand.length : Math.round((dm.W * dm.H / 26000) * Math.pow(view.k, 1.35))
    const placed = reserved.slice()
    const fs = dm.narrow ? 12 : 13.5
    const lg = el('g', {}, svg)
    const pointBoxes = cand.map(d => ({ x: d.X - r, y: d.Y - r, w: 2 * r, h: 2 * r, key: d.key }))
    const hit = (b: Box) => placed.some(p => b.x < p.x + p.w && b.x + b.w > p.x && b.y < p.y + p.h && b.y + b.h > p.y)
    const hitPts = (b: Box, key: string) => pointBoxes.reduce((n, p) => n + (p.key !== key && b.x < p.x + p.w && b.x + b.w > p.x && b.y < p.y + p.h && b.y + b.h > p.y ? 1 : 0), 0)
    let count = 0, annot = 0
    for (const d of cand) {
      const forced = selected.has(d.key) || hover === d.key
      if (!forced && count >= budget) continue
      const name = view.k < 1.6 && !forced && d.name.length > 15 ? shortName(d.name) : d.name
      const showAnn = forced || (annot < (dm.narrow ? 3 : 6) && Math.abs(d.z) > 1.2)
      const ann = showAnn ? annText(d) : null
      const w = Math.max(textW(name, fs, 700), ann ? textW(ann, 11, 600) : 0) + 6, h = ann ? fs + 15 : fs + 4
      const pos = [[r + 4, -h / 2], [-r - 4 - w, -h / 2], [-w / 2, -r - 3 - h], [-w / 2, r + 3], [r + 2, -r - h], [-r - 2 - w, -r - h], [r + 2, r], [-r - 2 - w, r]]
      let best: Box | null = null, bestScore = 1e9
      for (const [ox, oy] of pos) {
        const b = { x: d.X + ox, y: d.Y + oy, w, h }
        if (b.x < dm.m.l + 2 || b.x + b.w > dm.m.l + dm.W - 2 || b.y < dm.m.t + 2 || b.y + b.h > dm.m.t + dm.H - 2) continue
        if (hit(b)) continue
        const s = hitPts(b, d.key)
        if (s < bestScore) { bestScore = s; best = b }
        if (s === 0) break
      }
      if (!best || (!forced && bestScore > (view.k > 2 ? 1 : 2))) continue
      if (!forced && bestScore > 0 && count > budget * 0.7) continue
      placed.push(best)
      count++
      if (showAnn && !forced) annot++
      const tx = best.x + 3, ty = best.y + fs - 1
      const g = el('g', { 'pointer-events': 'none' }, lg)
      const tn = el('text', { x: tx, y: ty, 'font-size': fs, 'font-weight': 700, fill: ink, stroke: halo, 'stroke-width': 4, 'stroke-linejoin': 'round', 'paint-order': 'stroke' }, g)
      tn.textContent = name
      if (ann) {
        const ta = el('text', { x: tx, y: ty + 14, 'font-size': 11, 'font-weight': 600, fill: d.imp >= 0 ? palette['--hot'] : palette['--cold'], stroke: halo, 'stroke-width': 3.5, 'stroke-linejoin': 'round', 'paint-order': 'stroke' }, g)
        ta.textContent = ann
      }
    }
    callbacks.onZoom(view.k)
  }

  let raf = 0
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; render() })
  }

  function tipHtml(d: Row): string {
    const L = shotLabels((input as ChartInput).mode)
    const rank = d.frank != null ? `Fantasy #${d.frank}` : 'Outside the top 200'
    return `<div class="sm-tip-n">${esc(d.name)}</div><div class="sm-tip-sub">${esc(d.team)} · ${d.g} games · ${rank}</div>
  <div class="sm-tip-r"><span>${L.made}/${L.att}</span><span>${fmtN(d.m)} / ${fmtN(d.a)}</span></div>
  <div class="sm-tip-r"><span>${L.pct}</span><span>${fmtPct(d.pct)}${d.inPool && d.rPct ? ` (#${d.rPct})` : ''}</span></div>
  ${d.inPool ? `<div class="sm-tip-r"><span>${L.att} rank</span><span>#${d.rVol}</span></div>` : ''}
  <div class="sm-tip-r"><span>Impact</span><span class="${d.imp >= 0 ? 'sm-tip-pos' : 'sm-tip-neg'}">${signedImpact(d.imp, (input as ChartInput).unit)}${d.inPool ? ` (#${d.rImp})` : ''}</span></div>`
  }
  function showTipFor(key: string) {
    const d = rows.find(x => x.key === key)
    if (!d || !d.inView) { hideTip(); return }
    tip.innerHTML = tipHtml(d)
    tip.hidden = false
    const box = (svg.parentElement as HTMLElement).getBoundingClientRect()
    // The tip sits in the chart box, below the zoom bar.
    const top0 = svg.getBoundingClientRect().top - box.top
    let x = d.X + 14, y = top0 + d.Y - 10
    const tw = tip.offsetWidth, th = tip.offsetHeight
    if (x + tw > box.width - 8) x = d.X - 14 - tw
    if (y + th > box.height - 8) y = box.height - 8 - th
    if (y < 8) y = 8
    if (x < 8) x = 8
    tip.style.left = x + 'px'
    tip.style.top = y + 'px'
  }
  function hideTip() { tip.hidden = true }

  function zoomAt(px: number, py: number, factor: number) {
    const dm = dims()
    const k2 = Math.max(1, Math.min(MAX_ZOOM, view.k * factor))
    const mx = px - dm.m.l, my = py - dm.m.t
    view.tx = mx - (mx - view.tx) * (k2 / view.k)
    view.ty = my - (my - view.ty) * (k2 / view.k)
    view.k = k2
    schedule()
  }
  const local = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = svg.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }
  const keyOf = (target: EventTarget | null): string | null =>
    target instanceof Element ? target.getAttribute('data-key') : null

  const onWheel = (e: WheelEvent) => {
    // Zooming out at 1× has nothing to do: let the page scroll instead.
    if (view.k <= 1 && e.deltaY > 0 && !e.ctrlKey) return
    e.preventDefault()
    const [x, y] = local(e)
    zoomAt(x, y, Math.exp(-Math.max(-120, Math.min(120, e.deltaY)) * (e.ctrlKey ? 0.008 : 0.0016)))
  }
  const ptrs = new Map<number, [number, number]>()
  let drag: { x: number; y: number; tx: number; ty: number; target: EventTarget | null } | null = null
  let pinch: { d: number; k: number } | null = null
  let moved = false
  const onDown = (e: PointerEvent) => {
    try {
      svg.setPointerCapture(e.pointerId)
    } catch {
      // the pointer is already gone (synthetic or cancelled); capture is optional
    }
    ptrs.set(e.pointerId, local(e))
    moved = false
    if (ptrs.size === 1) drag = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty, target: e.target }
    else if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()]
      pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), k: view.k }
      drag = null
    }
  }
  const onMove = (e: PointerEvent) => {
    if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, local(e))
    if (pinch && ptrs.size === 2) {
      const [a, b] = [...ptrs.values()]
      const d = Math.hypot(a[0] - b[0], a[1] - b[1])
      zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (pinch.k * d / pinch.d) / view.k)
      moved = true
      hideTip()
      return
    }
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y
      if (Math.abs(dx) + Math.abs(dy) > 4) { moved = true; svg.classList.add('sm-dragging') }
      if (moved) { view.tx = drag.tx + dx; view.ty = drag.ty + dy; hideTip(); schedule() }
      return
    }
    if (e.pointerType === 'mouse') {
      const k = keyOf(e.target)
      if (k !== hover) { hover = k; schedule() }
      if (k != null) showTipFor(k)
      else hideTip()
    }
  }
  const onUp = (e: PointerEvent) => {
    const wasDrag = drag
    ptrs.delete(e.pointerId)
    if (ptrs.size < 2) pinch = null
    if (wasDrag && !moved && ptrs.size === 0) {
      const k = keyOf(wasDrag.target)
      if (k != null) {
        callbacks.onToggle(k)
        if (e.pointerType !== 'mouse') requestAnimationFrame(() => showTipFor(k))
      } else hideTip()
    }
    if (ptrs.size === 0) { drag = null; svg.classList.remove('sm-dragging') }
  }
  const onLeave = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && !drag) { hover = null; hideTip(); schedule() }
  }
  const onDbl = (e: MouseEvent) => {
    const [x, y] = local(e)
    zoomAt(x, y, 2)
  }
  svg.addEventListener('wheel', onWheel, { passive: false })
  svg.addEventListener('pointerdown', onDown)
  svg.addEventListener('pointermove', onMove)
  svg.addEventListener('pointerup', onUp)
  svg.addEventListener('pointercancel', onUp)
  svg.addEventListener('pointerleave', onLeave)
  svg.addEventListener('dblclick', onDbl)

  const resizeObs = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => schedule()) : null
  resizeObs?.observe(svg)
  // The site's dark mode is a class on <html>.
  const themeObs = new MutationObserver(schedule)
  themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  document.fonts?.ready.then(() => schedule()).catch(() => {})

  return {
    update(next, resetView) {
      input = next
      rows = next.data.rows.map(d => ({ ...d, X: 0, Y: 0, on: true, inView: false, pri: 0 }))
      if (resetView) { view.k = 1; view.tx = 0; view.ty = 0; hideTip() }
      render()
      if (hover && !tip.hidden) showTipFor(hover)
    },
    focus(key) {
      const d = rows.find(x => x.key === key)
      if (!d || !input) return
      const dm = dims()
      const k2 = Math.max(view.k, 3)
      const bx = (d.pct - D().x0) / (D().x1 - D().x0) * dm.W, by = dm.H - (d.a - D().y0) / (D().y1 - D().y0) * dm.H
      view.k = k2
      view.tx = dm.W / 2 - bx * k2
      view.ty = dm.H / 2 - by * k2
      render()
      showTipFor(key)
    },
    zoomBy(factor) {
      const dm = dims()
      zoomAt(dm.m.l + dm.W / 2, dm.m.t + dm.H / 2, factor)
    },
    reset() {
      view.k = 1; view.tx = 0; view.ty = 0
      hideTip()
      render()
    },
    destroy() {
      cancelAnimationFrame(raf)
      resizeObs?.disconnect()
      themeObs.disconnect()
      svg.removeEventListener('wheel', onWheel)
      svg.removeEventListener('pointerdown', onDown)
      svg.removeEventListener('pointermove', onMove)
      svg.removeEventListener('pointerup', onUp)
      svg.removeEventListener('pointercancel', onUp)
      svg.removeEventListener('pointerleave', onLeave)
      svg.removeEventListener('dblclick', onDbl)
    },
  }
}
