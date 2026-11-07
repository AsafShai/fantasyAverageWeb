import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react'
import { createShootingMapChart, type ChartHandle, type ChartInput } from './chartEngine'

export interface ShootingMapChartRef {
  focus(key: string): void
}

interface Props {
  input: ChartInput
  /** Changes when the axes change (mode, unit, period, team): the view zooms back out. */
  viewKey: string
  onToggle(key: string): void
  /** Controls shown in the bar above the chart (the page's threshold inputs). */
  toolbar?: ReactNode
}

/** React shell around the imperative chart: owns the svg, the tooltip and the zoom bar. */
const ShootingMapChart = forwardRef<ShootingMapChartRef, Props>(function ShootingMapChart({ input, viewKey, onToggle, toolbar }, ref) {
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
        <div className="flex items-center gap-3 ml-auto">
          <span className="hidden xl:inline text-xs text-gray-400 dark:text-gray-500">Scroll or pinch to zoom · drag to pan · click a dot to pin</span>
          <span className="sm:hidden text-xs text-gray-400 dark:text-gray-500">Pinch to zoom · tap to pin</span>
          <div className="flex items-center gap-1 text-sm">
            <button type="button" aria-label="Zoom out" className="w-8 h-8 grid place-items-center rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600" onClick={() => chart.current?.zoomBy(1 / 1.6)}>−</button>
            <div className="min-w-[2.5rem] text-center text-xs text-gray-500 dark:text-gray-400 tabular-nums" aria-live="polite">{zoom < 10 ? zoom.toFixed(1) : Math.round(zoom)}×</div>
            <button type="button" aria-label="Zoom in" className="w-8 h-8 grid place-items-center rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600" onClick={() => chart.current?.zoomBy(1.6)}>+</button>
            <button type="button" aria-label="Reset view" className="w-8 h-8 grid place-items-center rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600 ml-1" onClick={() => chart.current?.reset()}>⟲</button>
          </div>
        </div>
      </div>
      <svg ref={svgRef} className="sm-chart" role="img" aria-label="Scatter plot of shooting percentage against shot volume" />
      <div className="sm-tip" ref={tipRef} hidden />
    </div>
  )
})

export default ShootingMapChart
