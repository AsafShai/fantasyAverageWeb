import { useEffect } from 'react'
import NProgress from 'nprogress'
import 'nprogress/nprogress.css'
import { useIsFetching } from '../store/api/fantasyApi'

NProgress.configure({ showSpinner: false, minimum: 0.2, speed: 300 })

export default function GlobalLoadingBar() {
  const isFetching = useIsFetching()

  useEffect(() => {
    if (isFetching > 0) {
      NProgress.start()
    } else {
      NProgress.done()
    }
  }, [isFetching])

  return null
}
