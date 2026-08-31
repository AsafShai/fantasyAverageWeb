import { useEffect } from 'react'

type EspnHelperInstallDialogProps = {
  onClose: () => void
  onRetry: () => void
}

export default function EspnHelperInstallDialog({ onClose, onRetry }: EspnHelperInstallDialogProps) {
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40 px-0 sm:px-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="espn-helper-install-title"
        className="w-full sm:max-w-lg rounded-t-2xl sm:rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="espn-helper-install-title" className="text-lg font-bold text-gray-900 dark:text-gray-100">
          Chrome helper not installed
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
          Apply on ESPN needs a small Chrome extension. You should have a zip of the built helper. Chrome on a computer
          only — this will not work in Safari, Firefox, or on a phone.
        </p>
        <ol className="mt-3 space-y-2 text-sm text-gray-700 dark:text-gray-200 list-decimal pl-5">
          <li>Unzip the file you were sent. Open the folder until you see <code className="text-xs">manifest.json</code>.</li>
          <li>
            In Chrome, type <code className="text-xs">chrome://extensions</code> in the address bar and press Enter.
          </li>
          <li>Turn on <span className="font-semibold">Developer mode</span> (top right).</li>
          <li>
            Click <span className="font-semibold">Load unpacked</span> and choose that unzipped folder (the one with{' '}
            <code className="text-xs">manifest.json</code>).
          </li>
          <li>Reload this page, then click Apply on ESPN again.</li>
        </ol>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
          After it connects: open ESPN Edit Draft Strategy, click Apply order in the helper, then click Save Rankings on
          ESPN yourself.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 sm:flex-none px-3 py-2.5 sm:py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200"
          >
            Close
          </button>
          <button type="button" onClick={onRetry} className="btn-primary flex-1 sm:flex-none text-sm py-2.5 sm:py-1.5 px-4">
            I loaded it — try again
          </button>
        </div>
      </div>
    </div>
  )
}
