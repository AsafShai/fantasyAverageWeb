import { useEffect, useState } from 'react'

/** True below the Tailwind `lg` breakpoint (1024px). */
export function useIsBelowLg() {
  const [below, setBelow] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 1023px)').matches : false,
  )
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)')
    const sync = () => setBelow(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])
  return below
}
