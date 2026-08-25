import { mergeEspnOrder, packedPlacement, rowKey, topPlayers } from './match'
import { parseEspnId } from './normalize'
import { identitiesMatchOrder, nextMisplacedIndex, swapDidNotMove } from './rankMoves'
import type { EspnBoardRow, RankedPlayer } from './types'

const NAME_SELECTORS = [
  '.player-column__athlete a',
  '.player-column__athlete',
  '.playerinfo__playername',
  'a.AnchorLink.link',
  'a[href*="/player/"]',
  'a[href*="playerId="]',
]

type Fiber = {
  memoizedProps?: unknown
  pendingProps?: unknown
  stateNode?: { tagName?: string }
  return?: Fiber | null
}

export type ReorderResult =
  | {
      ok: true
      matched: number
      totalEspn: number
      unmatchedCsv: RankedPlayer[]
      unmatchedEspn: EspnBoardRow[]
      method: string
      stopped?: boolean
    }
  | { ok: false; error: string }

export function applyFinishResult(input: {
  stopped: boolean
  placed: number
  missing: number
  wrong: number
  unmatchedCsv: RankedPlayer[]
  totalEspn: number
  method: string
  saveOn?: boolean | null
}): ReorderResult {
  const saveNote = input.saveOn === true ? '; Save Rankings is enabled' : ''
  const method = `${input.method}; top ${input.totalEspn} (${input.missing} not on ESPN)${saveNote}`
  if (input.stopped) {
    return {
      ok: true,
      stopped: true,
      matched: input.placed,
      totalEspn: input.totalEspn,
      unmatchedCsv: input.unmatchedCsv,
      unmatchedEspn: [],
      method: `stopped; ${method}`,
    }
  }
  if (input.wrong > 0) {
    return {
      ok: false,
      error:
        'Could not finish placing the top 300. The ESPN list still does not match your packed order. Reload the Edit Draft Strategy tab and Apply again. Do not save until the order is correct.',
    }
  }
  return {
    ok: true,
    matched: input.placed,
    totalEspn: input.totalEspn,
    unmatchedCsv: input.unmatchedCsv,
    unmatchedEspn: [],
    method,
  }
}

function aborted(signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function isUnsafeToWalk(value: unknown): boolean {
  if (value == null || typeof value !== 'object') return false
  try {
    if (typeof Window !== 'undefined' && value instanceof Window) return true
    if (typeof HTMLIFrameElement !== 'undefined' && value instanceof HTMLIFrameElement) return true
  } catch {
    return true
  }
  return false
}

function safeKeys(node: object): string[] {
  try {
    return Object.keys(node)
  } catch {
    return []
  }
}

export function friendlyApplyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (/cross-origin frame/i.test(msg) || (typeof DOMException !== 'undefined' && err instanceof DOMException && err.name === 'SecurityError')) {
    return 'ESPN blocked a lookup into an ad iframe. Reload this tab and click Apply order again.'
  }
  return msg || 'Reorder failed.'
}

function fiberKey(node: object): string | undefined {
  return safeKeys(node).find(
    (k) =>
      k.startsWith('__reactFiber$') ||
      k.startsWith('__reactInternalInstance$') ||
      k.startsWith('__reactContainer$'),
  )
}

function fiberFromNode(node: Element): Fiber | null {
  const key = fiberKey(node)
  if (!key) return null
  return (node as unknown as Record<string, Fiber>)[key] ?? null
}

function isPlayerRankRow(row: HTMLElement): boolean {
  if (row.querySelector('th, select.dropdown__select, .position-value, [data-position-id]')) return false
  if (row.matches('[data-player-row][draggable="true"]')) return true
  return Boolean(row.querySelector('.player-column, .ranking-column, .player-column__athlete, .player-headshot'))
}

function queryRows(): HTMLElement[] {
  const ranked = [...document.querySelectorAll<HTMLElement>('tr[data-player-row][draggable="true"]')].filter(
    (row) => !row.querySelector('th'),
  )
  if (ranked.length >= 10) return ranked
  return [...document.querySelectorAll<HTMLElement>('tr.Table__TR')].filter(isPlayerRankRow)
}

function playerNameFromRow(row: HTMLElement): string {
  for (const selector of NAME_SELECTORS) {
    const el = row.querySelector(selector)
    const text = el?.textContent?.trim()
    if (text) return text.replace(/\s+/g, ' ')
  }
  const img = row.querySelector('img[alt]')
  if (img instanceof HTMLImageElement && img.alt.trim()) return img.alt.trim()
  return (row.textContent || '').trim().split('\n')[0]?.trim() ?? ''
}

function playerTeamFromRow(row: HTMLElement): string {
  const el =
    row.querySelector('.playerinfo__playerteam') ||
    row.querySelector('.player-column__position .playerinfo__playerteam')
  return (el?.textContent || '').trim()
}

function espnIdFromUrl(url: string): number | null {
  const patterns = [
    /\/(?:players|full)\/(\d+)\.(?:png|jpg|gif|webp)/i,
    /\/player\/_\/id\/(\d+)/i,
    /[?&]playerId=(\d+)/i,
    /\/id\/(\d+)\//,
    /headshots\/nba\/players\/full\/(\d+)/i,
  ]
  for (const re of patterns) {
    const m = url.match(re)
    if (m) return Number(m[1])
  }
  return null
}

/** Player id from the exclude checkbox or headshot. Never from the row's data-idx (that is the visual rank index). */
export function espnIdFromRowHints(hints: {
  checkboxDataIdx?: string | null
  rowDataIdx?: string | null
  imgSrc?: string | null
}): number | null {
  const fromBox = parseEspnId(hints.checkboxDataIdx)
  if (fromBox) return fromBox
  if (hints.imgSrc) {
    const fromImg = espnIdFromUrl(hints.imgSrc)
    if (fromImg) return fromImg
  }
  return null
}

function espnIdFromRow(row: HTMLElement): number | null {
  const box = row.querySelector<HTMLInputElement>(
    '.exclude-wrapper input[data-idx], input.form__control--checkbox[data-idx]',
  )
  const img = row.querySelector<HTMLImageElement>(
    '.player-headshot img:not(.fallback), img[src*="headshots/nba/players"]',
  )
  const fromHints = espnIdFromRowHints({
    checkboxDataIdx: box?.getAttribute('data-idx'),
    imgSrc: img?.currentSrc || img?.src || img?.getAttribute('src'),
  })
  if (fromHints) return fromHints
  for (const el of row.querySelectorAll('img[src], img[data-src], a[href]')) {
    if (el.classList.contains('fallback')) continue
    const url =
      (el instanceof HTMLImageElement && (el.currentSrc || el.src || el.getAttribute('data-src'))) ||
      (el instanceof HTMLAnchorElement && el.href) ||
      el.getAttribute('src') ||
      el.getAttribute('href') ||
      ''
    const id = espnIdFromUrl(url)
    if (id) return id
  }
  return null
}

function rowsToBoard(rows: HTMLElement[]): EspnBoardRow[] {
  return rows.map((row, index) => ({
    espnId: espnIdFromRow(row),
    name: playerNameFromRow(row),
    team: playerTeamFromRow(row),
    index,
  }))
}

function isOurUi(el: Element | null): boolean {
  return Boolean(el?.closest('#ff-espn-helper'))
}

function controlText(el: Element): string {
  return (el.textContent || '').replace(/\s+/g, ' ').trim()
}

function isSaveControl(el: HTMLElement): boolean {
  return /save\s*rankings/i.test(controlText(el))
}

function saveRankingsButton(): HTMLButtonElement | null {
  const named = document.querySelector<HTMLButtonElement>('button.save-rankings-btn')
  if (named && !isOurUi(named)) return named
  for (const el of document.querySelectorAll('button')) {
    if (isOurUi(el)) continue
    if (isSaveControl(el)) return el
  }
  return null
}

function saveButtonEnabled(): boolean | null {
  const button = saveRankingsButton()
  if (!button) return null
  return (
    !button.disabled &&
    button.getAttribute('aria-disabled') !== 'true' &&
    !button.classList.contains('disabled') &&
    !button.classList.contains('Button--disabled')
  )
}

function isEnabledButton(el: HTMLButtonElement | null): el is HTMLButtonElement {
  return Boolean(
    el &&
      !isOurUi(el) &&
      !el.disabled &&
      el.getAttribute('aria-disabled') !== 'true' &&
      !el.classList.contains('Button--disabled'),
  )
}

function showMoreButton(): HTMLElement | null {
  const named = document.querySelector<HTMLButtonElement>('button.show-more')
  if (isEnabledButton(named)) return named
  for (const el of document.querySelectorAll('button')) {
    if (!isEnabledButton(el) || isSaveControl(el)) continue
    if (/^show more$/i.test(controlText(el))) return el
  }
  return null
}

async function expandVisibleList(onProgress?: (msg: string) => void, signal?: AbortSignal): Promise<void> {
  for (let i = 0; i < 40; i++) {
    if (aborted(signal)) return
    const before = queryRows().length
    const more = showMoreButton()
    if (!more) break
    onProgress?.(`Loading more ESPN players (${before} so far)…`)
    try {
      more.click()
    } catch {
      break
    }
    await sleep(450)
    const after = queryRows().length
    if (after <= before) break
  }
}

function fireMouse(el: HTMLElement, type: string, x: number, y: number, extra: Record<string, unknown> = {}): void {
  el.dispatchEvent(
    new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
      button: 0,
      buttons: type === 'mouseup' ? 0 : 1,
      ...extra,
    }),
  )
}

function firePointer(el: HTMLElement, type: string, x: number, y: number, extra: Record<string, unknown> = {}): void {
  el.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      buttons: type === 'pointerup' ? 0 : 1,
      ...extra,
    }),
  )
}

function dragHandle(row: HTMLElement): HTMLElement {
  return (
    row.querySelector<HTMLElement>('.grabber, td.grabber, [class*="grabber"]') ||
    row.querySelector<HTMLElement>('[draggable="true"]') ||
    row
  )
}

function makeDataTransfer(): DataTransfer {
  try {
    return new DataTransfer()
  } catch {
    return {
      dropEffect: 'move',
      effectAllowed: 'move',
      files: [] as unknown as FileList,
      items: [] as unknown as DataTransferItemList,
      types: [],
      setData() {},
      getData() {
        return ''
      },
      clearData() {},
      setDragImage() {},
    } as DataTransfer
  }
}

function fireDrag(el: HTMLElement, type: string, dt: DataTransfer, x: number, y: number): void {
  const event = new DragEvent(type, {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: x,
    clientY: y,
    dataTransfer: dt,
  })
  if (event.dataTransfer !== dt) {
    Object.defineProperty(event, 'dataTransfer', { value: dt })
  }
  el.dispatchEvent(event)
}

function propsFromNode(el: HTMLElement): Record<string, unknown> | null {
  const fiber = fiberFromNode(el)
  const props = fiber?.memoizedProps ?? fiber?.pendingProps
  return isObject(props) ? props : null
}

function fakeDragProps(target: HTMLElement, dt: DataTransfer, x: number, y: number): Record<string, unknown> {
  return {
    bubbles: true,
    cancelable: true,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true
    },
    stopPropagation() {},
    stopImmediatePropagation() {},
    persist() {},
    currentTarget: target,
    target,
    dataTransfer: dt,
    clientX: x,
    clientY: y,
    button: 0,
    buttons: 1,
  }
}

function callHandler(props: Record<string, unknown> | null, name: string, event: unknown): void {
  const fn = props?.[name]
  if (typeof fn === 'function') {
    try {
      fn(event)
    } catch {
      /* ESPN handler rejected a synthetic event */
    }
  }
}

function closestReorderCallback(row: HTMLElement): ((payload: unknown) => void) | null {
  let fiber: Fiber | null = fiberFromNode(row)
  let depth = 0
  while (fiber && depth++ < 48) {
    try {
      if (isUnsafeToWalk(fiber.stateNode)) {
        fiber = fiber.return ?? null
        continue
      }
      const props = fiber.memoizedProps
      if (isObject(props)) {
        for (const key of ['onDragEnd', 'onSortEnd', 'onReorder', 'handleDragEnd', 'handleSortEnd']) {
          const fn = props[key]
          if (typeof fn !== 'function') continue
          if (key === 'onDragEnd' && !row.closest('[data-rbd-droppable-id]')) continue
          const host = fiber.stateNode
          if (
            host &&
            typeof host === 'object' &&
            'querySelector' in host &&
            typeof (host as HTMLElement).querySelector === 'function' &&
            (host as HTMLElement).querySelector('select.dropdown__select[data-round-id], .position-value')
          ) {
            continue
          }
          return fn as (payload: unknown) => void
        }
      }
      fiber = fiber.return ?? null
    } catch {
      fiber = fiber.return ?? null
    }
  }
  return null
}

function tryReactReorder(
  fromRow: HTMLElement,
  toRow: HTMLElement,
  from: number,
  to: number,
  moved: () => boolean,
): boolean {
  const dt = makeDataTransfer()
  const playerId = espnIdFromRow(fromRow)
  try {
    dt.setData('text/plain', String(playerId ?? from))
  } catch {
    /* DataTransfer may be sealed */
  }
  const fromBox = fromRow.getBoundingClientRect()
  const toBox = toRow.getBoundingClientRect()
  const startX = fromBox.left + 8
  const startY = fromBox.top + fromBox.height / 2
  const endX = toBox.left + 8
  const endY = toBox.top + 8

  callHandler(propsFromNode(fromRow), 'onDragStart', fakeDragProps(fromRow, dt, startX, startY))
  callHandler(propsFromNode(toRow), 'onDragEnter', fakeDragProps(toRow, dt, endX, endY))
  callHandler(propsFromNode(toRow), 'onDragOver', fakeDragProps(toRow, dt, endX, endY))
  callHandler(propsFromNode(toRow), 'onDrop', fakeDragProps(toRow, dt, endX, endY))
  callHandler(propsFromNode(fromRow), 'onDragEnd', fakeDragProps(fromRow, dt, endX, endY))
  if (moved()) return true

  const reorder = closestReorderCallback(fromRow)
  if (!reorder) return false
  const droppableId =
    fromRow.closest('[data-rbd-droppable-id]')?.getAttribute('data-rbd-droppable-id') ||
    toRow.parentElement?.getAttribute('data-rbd-droppable-id') ||
    'droppable'
  const payloads: unknown[] = [
    {
      draggableId: String(playerId ?? fromRow.getAttribute('data-player-row') ?? from),
      type: 'DEFAULT',
      source: { index: from, droppableId },
      destination: { index: to, droppableId },
      reason: 'DROP',
      mode: 'FLUID',
      combine: null,
    },
    { oldIndex: from, newIndex: to },
    { from, to, sourceIndex: from, destIndex: to },
  ]
  for (const payload of payloads) {
    try {
      reorder(payload)
    } catch {
      continue
    }
    if (moved()) return true
  }
  try {
    ;(reorder as (a: unknown, b?: unknown) => void)(from, to)
  } catch {
    return false
  }
  return moved()
}

async function simulateRowDrag(
  fromRow: HTMLElement,
  toRow: HTMLElement,
  edge: 'before' | 'after' = 'before',
): Promise<void> {
  const handle = dragHandle(fromRow)
  const source = fromRow.matches('[draggable="true"]') ? fromRow : handle
  const from = handle.getBoundingClientRect()
  const to = toRow.getBoundingClientRect()
  const startX = from.left + Math.min(12, Math.max(4, from.width / 4))
  const startY = from.top + from.height / 2
  const endX = to.left + Math.min(12, Math.max(4, to.width / 4))
  const endY = edge === 'after' ? to.top + Math.max(8, to.height - 6) : to.top + 6
  const dt = makeDataTransfer()
  dt.effectAllowed = 'move'
  try {
    dt.setData('text/plain', String(espnIdFromRow(fromRow) ?? fromRow.getAttribute('data-player-row') ?? ''))
    dt.setData('application/espn-player', String(espnIdFromRow(fromRow) ?? ''))
  } catch {
    /* ignore */
  }

  const allowDrop = (event: Event) => {
    event.preventDefault()
    const drag = event as DragEvent
    if (drag.dataTransfer) drag.dataTransfer.dropEffect = 'move'
  }
  document.addEventListener('dragover', allowDrop, true)

  if (from.top < 60 || from.bottom > window.innerHeight - 60) {
    handle.scrollIntoView({ block: 'center' })
    await sleep(30)
  }

  try {
    firePointer(handle, 'pointerdown', startX, startY)
    fireMouse(handle, 'mousedown', startX, startY)
    fireDrag(handle, 'dragstart', dt, startX, startY)
    fireDrag(source, 'dragstart', dt, startX, startY)
    firePointer(handle, 'pointermove', startX, startY + 14)
    const tbody = toRow.parentElement instanceof HTMLElement ? toRow.parentElement : toRow
    fireDrag(toRow, 'dragenter', dt, endX, endY)
    fireDrag(tbody, 'dragenter', dt, endX, endY)
    fireDrag(toRow, 'dragover', dt, endX, endY)
    fireDrag(tbody, 'dragover', dt, endX, endY)
    fireDrag(toRow, 'drop', dt, endX, endY)
    fireDrag(tbody, 'drop', dt, endX, endY)
    fireDrag(source, 'dragend', dt, endX, endY)
    firePointer(toRow, 'pointerup', endX, endY)
    fireMouse(toRow, 'mouseup', endX, endY)
  } finally {
    document.removeEventListener('dragover', allowDrop, true)
  }
}

async function placeIndexAtSlot(
  from: number,
  to: number,
  edge: 'before' | 'after',
): Promise<number | null> {
  const rows = queryRows()
  const fromRow = rows[from]
  const toRow = rows[to]
  if (!fromRow || !toRow || from === to) return from
  const key = rowKey(rowsToBoard(rows)[from] ?? { espnId: null, name: '', team: '', index: from })
  try {
    await simulateRowDrag(fromRow, toRow, edge)
  } catch {
    return key ? rowsToBoard(queryRows()).findIndex((row) => rowKey(row) === key) : null
  }
  await sleep(50)
  const locate = () => {
    if (!key) return null
    const at = rowsToBoard(queryRows()).findIndex((row) => rowKey(row) === key)
    return at >= 0 ? at : null
  }
  let at = locate()
  if (at !== to && fromRow.isConnected && toRow.isConnected) {
    tryReactReorder(fromRow, toRow, from, to, () => locate() === to)
    at = locate()
  }
  return at
}

async function applyByDrags(
  desired: RankedPlayer[],
  onProgress?: (msg: string) => void,
  signal?: AbortSignal,
): Promise<'complete' | 'stopped'> {
  const top = topPlayers(desired)
  const maxMoves = Math.max(400, top.length * 3)
  let prev: { from: number; to: number; key: string | null } | null = null
  for (let moves = 0; moves < maxMoves; moves++) {
    if (aborted(signal)) return 'stopped'
    const rows = queryRows()
    const board = rowsToBoard(rows)
    const match = mergeEspnOrder(top, board)
    const currentIds = board.map(rowKey)
    const targetIds = match.next.map(rowKey)
    if (identitiesMatchOrder(currentIds, targetIds)) return 'complete'
    const step = nextMisplacedIndex(currentIds, targetIds)
    if (!step) return 'complete'
    const key = currentIds[step.from] ?? null
    if (swapDidNotMove(prev, step, key)) return 'complete'
    prev = { from: step.from, to: step.to, key }
    const name = board[step.from]?.name || `row ${step.from + 1}`
    onProgress?.(`Placing ${Math.min(step.to + 1, match.matched)}/${match.matched}: ${name}`)
    const edge: 'before' | 'after' = step.from < step.to ? 'after' : 'before'
    await placeIndexAtSlot(step.from, step.to, edge)
  }
  return aborted(signal) ? 'stopped' : 'complete'
}

export function snapshotReorderResult(desired: RankedPlayer[], stopped: boolean): ReorderResult {
  return finishFromBoard(desired, stopped ? 'stopped' : 'espn-drags', stopped)
}

function finishFromBoard(desired: RankedPlayer[], method: string, stopped: boolean): ReorderResult {
  const top = topPlayers(desired)
  const afterBoard = rowsToBoard(queryRows())
  const verify = mergeEspnOrder(top, afterBoard)
  const placed = packedPlacement(top, afterBoard)
  return applyFinishResult({
    stopped,
    placed: placed.placed,
    missing: placed.missing,
    wrong: placed.wrong,
    unmatchedCsv: verify.unmatchedCsv,
    totalEspn: top.length,
    method,
    saveOn: saveButtonEnabled(),
  })
}

export async function applyRankingsToEspnPage(
  desired: RankedPlayer[],
  onProgress?: (msg: string) => void,
  signal?: AbortSignal,
): Promise<ReorderResult> {
  try {
    return await applyRankingsToEspnPageInner(desired, onProgress, signal)
  } catch (err) {
    return { ok: false, error: friendlyApplyError(err) }
  }
}

async function applyRankingsToEspnPageInner(
  desired: RankedPlayer[],
  onProgress?: (msg: string) => void,
  signal?: AbortSignal,
): Promise<ReorderResult> {
  if (!desired.length) return { ok: false, error: 'No rankings to apply.' }
  if (aborted(signal)) return finishFromBoard(desired, 'stopped', true)

  onProgress?.('Loading the full ESPN list…')
  await expandVisibleList(onProgress, signal)
  if (aborted(signal)) return finishFromBoard(desired, 'stopped', true)
  await sleep(200)

  let rows = queryRows()
  if (rows.length < 10) {
    for (let i = 0; i < 12 && rows.length < 10; i++) {
      if (aborted(signal)) return finishFromBoard(desired, 'stopped', true)
      await sleep(250)
      rows = queryRows()
    }
  }
  if (rows.length < 10) {
    return {
      ok: false,
      error: 'Could not find ESPN’s player list. Open Edit Draft Strategy, wait for the table, then try again.',
    }
  }

  const top = topPlayers(desired)
  const espnRows = rowsToBoard(rows)
  const knownIds = new Set<number>()
  for (const row of espnRows) if (row.espnId) knownIds.add(row.espnId)
  for (const player of top) if (player.espnId) knownIds.add(player.espnId)
  if (knownIds.size < 5) {
    return { ok: false, error: 'Could not read ESPN player ids from this table.' }
  }

  const matchPreview = mergeEspnOrder(top, espnRows)
  if (matchPreview.matched === 0) {
    return { ok: false, error: 'None of the exported top-300 players matched this ESPN list.' }
  }

  onProgress?.(`Placing top ${top.length} from your CSV…`)
  const dragStatus = await applyByDrags(top, onProgress, signal)
  const method = dragStatus === 'stopped' ? 'stopped' : 'espn-drags'
  return finishFromBoard(desired, method, dragStatus === 'stopped' || aborted(signal))
}
