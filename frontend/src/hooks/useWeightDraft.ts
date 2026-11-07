import { useEffect, useRef, useState } from 'react'
import type { RankingCategory } from '../utils/playerRankings'

type Weights = Record<RankingCategory, number>

/**
 * Local drag state for the Player Rankings category weight sliders. Ticking a
 * slider only re-renders the sliders; the settled value is pushed up through
 * `onCommit` (debounced 150 ms for drags, at once for punt toggles), so the
 * big rankings table re-renders once per change, not per tick.
 * Shared by the desktop sliders and the phone redesign.
 */
export function useWeightDraft(initialWeights: Weights, onCommit: (weights: Weights) => void) {
  const [weights, setWeights] = useState(initialWeights)
  const prevWeightsRef = useRef(initialWeights)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
  }, [])

  const isPunted = (cat: RankingCategory) => weights[cat] === 0

  const slide = (cat: RankingCategory, value: number) => {
    setWeights(w => {
      const next = { ...w, [cat]: value }
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => onCommit(next), 150)
      return next
    })
  }

  const togglePunt = (cat: RankingCategory) => {
    setWeights(w => {
      const next = w[cat] === 0
        ? { ...w, [cat]: prevWeightsRef.current[cat] }
        : { ...w, [cat]: 0 }
      if (w[cat] !== 0) prevWeightsRef.current = { ...prevWeightsRef.current, [cat]: w[cat] }
      if (debounceRef.current) clearTimeout(debounceRef.current)
      onCommit(next)
      return next
    })
  }

  return { weights, isPunted, slide, togglePunt }
}
