import { useEffect } from 'react'
import NProgress from 'nprogress'
import 'nprogress/nprogress.css'
import { useAppSelector } from '../store/hooks'

NProgress.configure({ showSpinner: false, minimum: 0.2, speed: 300 })

export default function GlobalLoadingBar() {
  const isFetching = useAppSelector((state) =>
    Object.values(state.fantasyApi?.queries ?? {}).some((q) => q?.status === 'pending')
  )

  useEffect(() => {
    if (isFetching) {
      NProgress.start()
    } else {
      NProgress.done()
    }
  }, [isFetching])

  return null
}
