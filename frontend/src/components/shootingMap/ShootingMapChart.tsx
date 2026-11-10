import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react'
import { createShootingMapChart, type ChartHandle, type ChartInput, type DragMode } from './chartEngine'

export interface ShootingMapChartRef {
  focus(key: string): void
}

interface Props {
  input: ChartInput
  /** Changes when the axes change (stats, unit, period, team, floors): the view zooms back out. */
  viewKey: string
  onToggle(key: string): void
  onDragMode(mode: DragMode): void
  /** Controls shown in the bar above the chart (the page's threshold inputs). */
  toolbar?: ReactNode
}

const DRAG_MODES: [DragMode, string][] = [['pan', 'Move'], ['box', 'Select area']]
const ZOOM_BTN = 'w-8 h-8 grid place-items-center rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600'

/** React shell around the imperative chart: owns the svg, the tooltip and the zoom bar. */
const ShootingMapChart = forwardRef<ShootingMapChartRef, Props>(function ShootingMapChart({ input, viewKey, onToggle, onDragMode, toolbar }, ref) {
  const boxRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const chart = useRef<ChartHandle | null>(null)
  const toggleRef = useRef(onToggle)
  toggleRef.current = onToggle
  const [zoom, setZoom] = useState(1)
  const lastViewKey = useRef<string | null>(null)

  useEffect(() => {
    const svg = svgRef.current, tip = tipRef.current, box = boxRef.current
    if (!svg || !tip || !box) return
    const root = (box.closest('.sm-root') as HTMLElement | null) ?? box
    chart.current = createShootingMapChart(svg, tip, root, {
      onToggle: key => toggleRef.current(key),
      onZoom: k => setZoom(k),
    })
    return () => {
      chart.current?.destroy()
      chart.current = null
      lastViewKey.current = null
    }
  }, [])

  useEffect(() => {
    const reset = lastViewKey.current !== viewKey
    lastViewKey.current = viewKey
    chart.current?.update(input, reset)
  }, [input, viewKey])

  useImperativeHandle(ref, () => ({ focus: key => chart.current?.focus(key) }), [])

  return (
    <div className="sm-chartbox relative bg-white dark:bg-gray-800 rounded-xl shadow overflow-hidden" ref={boxRef}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 py-2 border-b border-gray-200 dark:border-gray-700">
        {toolbar}
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2 ml-auto max-w-full">
          <span className="basis-[200px] grow text-right text-xs text-gray-600 dark:text-gray-300">Scroll or pinch to zoom · click a dot to pin · drag to</span>
          <div className="flex shrink-0 rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden text-[13px]" role="group" aria-label="Drag action">
            {DRAG_MODES.map(([mode, label]) => (
              <button key={mode} type="button" aria-pressed={input.dragMode === mode} onClick={() => onDragMode(mode)}
                className={`px-2.5 py-1.5 whitespace-nowrap ${input.dragMode === mode ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600'}`}>{label}</button>
            ))}
          </div>
          <div className="flex shrink-0 items-center gap-1 text-sm">
            <button type="button" aria-label="Zoom out" className={`${ZOOM_BTN} text-base`} onClick={() => chart.current?.zoomBy(1 / 1.6)}>−</button>
            <div className="min-w-[2.5rem] text-center text-xs text-gray-600 dark:text-gray-300 tabular-nums" aria-live="polite">{zoom < 10 ? zoom.toFixed(1) : Math.round(zoom)}×</div>
            <button type="button" aria-label="Zoom in" className={`${ZOOM_BTN} text-base`} onClick={() => chart.current?.zoomBy(1.6)}>+</button>
            <button type="button" aria-label="Reset view" className={`${ZOOM_BTN} ml-1`} onClick={() => chart.current?.reset()}>
              <svg aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2.5 8a5.5 5.5 0 1 0 1.8-4.1" /><path d="M2.5 2.5v3h3" />
              </svg>
            </button>
          </div>
        </div>
      </div>
      <svg ref={svgRef} className="sm-chart" role="img" aria-label="Scatter plot of the selected chart" />
      <div className="sm-tip" ref={tipRef} hidden />
    </div>
  )
})

export default ShootingMapChart
