import { useEffect } from 'react'
import NProgress from 'nprogress'
import 'nprogress/nprogress.css'
import { useSelector } from 'react-redux'

NProgress.configure({ showSpinner: false, minimum: 0.2, speed: 300 })

export default function GlobalLoadingBar() {
  const isFetching = useSelector((state: any) =>
    Object.values(state.fantasyApi?.queries ?? {}).some((q: any) => q?.status === 'pending')
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
