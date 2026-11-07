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
    <div className="sm-chartbox" ref={boxRef}>
      <div className="sm-chartbar">
        {toolbar}
        <div className="sm-hint">
          <span className="sm-hint-wide">Scroll or pinch to zoom · drag to pan · click a dot to pin a player</span>
          <span className="sm-hint-narrow">Pinch to zoom · tap a dot to pin</span>
        </div>
        <div className="sm-zoombar">
          <button type="button" aria-label="Zoom out" onClick={() => chart.current?.zoomBy(1 / 1.6)}>−</button>
          <div className="sm-zoomlvl" aria-live="polite">{zoom < 10 ? zoom.toFixed(1) : Math.round(zoom)}×</div>
          <button type="button" aria-label="Zoom in" onClick={() => chart.current?.zoomBy(1.6)}>+</button>
          <button type="button" aria-label="Reset view" style={{ fontSize: 15 }} onClick={() => chart.current?.reset()}>⟲</button>
        </div>
      </div>
      <svg ref={svgRef} className="sm-chart" role="img" aria-label="Scatter plot of shooting percentage against shot volume" />
      <div className="sm-tip" ref={tipRef} hidden />
    </div>
  )
})

export default ShootingMapChart
