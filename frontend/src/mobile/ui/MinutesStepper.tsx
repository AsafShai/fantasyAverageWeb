interface MinutesStepperProps {
  value: number
  /** The model's minutes; ↺ goes back to it. */
  defaultValue: number
  onChange: (minutes: number) => void
  min?: number
  max?: number
  step?: number
  /** Player name, for screen-reader labels. */
  playerName?: string
  disabled?: boolean
}

/**
 * "− 31 min +" with a ↺ reset. A stepper (not a slider) so it works inside
 * sheets and cards without fighting page scroll. Pages pass the change on to
 * the projection call (POST /projections/predict), same as today's slider.
 */
export function MinutesStepper({
  value,
  defaultValue,
  onChange,
  min = 0,
  max = 48,
  step = 1,
  playerName,
  disabled = false,
}: MinutesStepperProps) {
  const clamp = (n: number) => Math.min(max, Math.max(min, n))
  const who = playerName ? ` for ${playerName}` : ''
  const shown = Number.isInteger(value) ? value : Math.round(value)
  return (
    <span className="mr-stepper-row">
      <span className="mr-step" role="group" aria-label={`Minutes${who}`}>
        <button type="button" aria-label={`Fewer minutes${who}`} disabled={disabled || value <= min} onClick={() => onChange(clamp(value - step))}>
          −
        </button>
        <output aria-live="polite">
          {shown}
          <i> min</i>
        </output>
        <button type="button" aria-label={`More minutes${who}`} disabled={disabled || value >= max} onClick={() => onChange(clamp(value + step))}>
          +
        </button>
      </span>
      <button
        type="button"
        className="mr-reset"
        aria-label={`Reset to default minutes${who}`}
        title="Reset to default minutes"
        disabled={disabled || value === defaultValue}
        onClick={() => onChange(defaultValue)}
      >
        ↺
      </button>
    </span>
  )
}
