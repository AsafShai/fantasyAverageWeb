import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { FF_SHARE_CARDS } from '../../config/featureFlags'
import { usePersistedState } from '../../hooks/usePersistedState'
import { canCopyImage, canShareFile, shareFileName, useShareImage, type ShareImageResult } from '../../hooks/useShareImage'
import { todayIso } from '../../utils/dateRange'
import './ShareCard.css'

export interface ShareCardOptions {
  /** Site theme at the moment the menu opened; the card follows it. */
  dark: boolean
  highlightMyTeam: boolean
}

interface ShareCardButtonProps {
  /** Card title — names the PNG and the share-sheet entry. */
  title: string
  renderCard: (options: ShareCardOptions) => ReactNode
  /** Offer a "Highlight my team" toggle (cards that can mark the user's team). */
  highlightOption?: boolean
  /** `onBlue` for the blue gradient page headers, `neutral` elsewhere. */
  variant?: 'neutral' | 'onBlue'
}

const BUTTON_STYLES = {
  neutral: 'bg-white dark:bg-gray-800 text-blue-600 dark:text-blue-400 border-gray-200 dark:border-gray-600 hover:bg-blue-50 dark:hover:bg-gray-700',
  onBlue: 'bg-white/15 text-white border-white/60 hover:bg-white/25',
}

const RESULT_MESSAGES: Partial<Record<ShareImageResult, string>> = {
  copied: 'Copied. Paste it into WhatsApp.',
}

const isDarkTheme = () => document.documentElement.classList.contains('dark')

const ShareIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3v12" />
    <path d="M7 8l5-5 5 5" />
    <path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
  </svg>
)

/**
 * "Share" button that renders a dedicated card layout off-screen, turns it
 * into a PNG, and offers the native share sheet (phones), copy to clipboard
 * and download. Renders nothing while FF_SHARE_CARDS is off.
 */
export const ShareCardButton = (props: ShareCardButtonProps) =>
  FF_SHARE_CARDS ? <ShareCardMenu {...props} /> : null

export const ShareCardMenu = ({ title, renderCard, highlightOption = false, variant = 'neutral' }: ShareCardButtonProps) => {
  const [open, setOpen] = useState(false)
  const [dark, setDark] = useState(false)
  const [highlightMyTeam, setHighlightMyTeam] = usePersistedState('share.highlightMyTeam', false)
  const [message, setMessage] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const fileName = shareFileName(title, todayIso())
  const { cardRef, blob, file, status, error, render, share, copy, download } = useShareImage(fileName, title)
  const highlight = highlightOption && highlightMyTeam

  // Re-render the PNG whenever the menu opens or an option changes, so the
  // image is ready by the time an action is tapped.
  useEffect(() => {
    if (open) void render()
  }, [open, dark, highlight, render])

  const previewUrl = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob])
  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
  }, [previewUrl])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const toggle = () => {
    if (!open) {
      setDark(isDarkTheme())
      setMessage(null)
    }
    setOpen(!open)
  }

  const runAction = async (action: () => ShareImageResult | Promise<ShareImageResult>, failure: string) => {
    setMessage(null)
    try {
      const result = await action()
      if (result === 'shared') setOpen(false)
      else if (result === 'downloaded') setMessage(`Saved ${fileName}`)
      else setMessage(RESULT_MESSAGES[result] ?? null)
    } catch (err) {
      setMessage(`${failure}${err instanceof Error && err.message ? ` (${err.message})` : ''}`)
    }
  }

  const ready = status === 'ready'
  const showShare = typeof navigator.canShare === 'function' && (file ? canShareFile(file) : true)
  const showCopy = canCopyImage()
  const actionClass = 'w-full min-h-11 sm:min-h-0 px-3 py-2 rounded-md text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed'

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`inline-flex items-center gap-1.5 min-h-11 sm:min-h-0 px-3 py-1.5 rounded-lg border text-sm font-semibold transition-colors ${BUTTON_STYLES[variant]}`}
      >
        <ShareIcon />
        Share
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Share as image"
          className="fixed inset-x-3 bottom-3 z-50 sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-full sm:mt-2 sm:w-72 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 shadow-xl text-left text-gray-900 dark:text-gray-100"
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-semibold">Share as image</span>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="-mr-2 flex h-11 w-11 sm:h-8 sm:w-8 items-center justify-center rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">✕</button>
          </div>

          <div className="mb-3 flex items-center justify-center min-h-[96px] rounded-lg bg-gray-100 dark:bg-gray-900 overflow-hidden">
            {status === 'error' ? (
              <p className="p-3 text-xs text-red-600 dark:text-red-400">Couldn't create the image: {error}</p>
            ) : previewUrl ? (
              <img src={previewUrl} alt={`${title} preview`} className={`max-h-48 w-auto transition-opacity ${ready ? '' : 'opacity-50'}`} />
            ) : (
              <span className="text-xs text-gray-500 dark:text-gray-400 animate-pulse">Preparing image…</span>
            )}
          </div>

          {highlightOption && (
            <label className="mb-3 flex min-h-11 sm:min-h-0 items-center gap-2 text-sm cursor-pointer select-none">
              <input
                type="checkbox"
                checked={highlightMyTeam}
                onChange={(e) => setHighlightMyTeam(e.target.checked)}
                className="w-4 h-4 accent-blue-600"
              />
              Highlight my team
            </label>
          )}

          <div className="flex flex-col gap-2">
            {showShare && (
              <button type="button" disabled={!ready} onClick={() => runAction(share, "Couldn't open the share sheet")} className={`${actionClass} bg-blue-600 text-white hover:bg-blue-700`}>
                Share…
              </button>
            )}
            {showCopy && (
              <button type="button" disabled={!ready} onClick={() => runAction(copy, "Copy isn't available here. Use Download instead")} className={`${actionClass} ${showShare ? 'bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600' : 'bg-blue-600 text-white hover:bg-blue-700'}`}>
                Copy image
              </button>
            )}
            <button type="button" disabled={!ready} onClick={() => runAction(download, "Couldn't save the image")} className={`${actionClass} bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600`}>
              Download PNG
            </button>
          </div>

          {message && <p role="status" className="mt-2 text-xs text-gray-600 dark:text-gray-300">{message}</p>}
        </div>
      )}

      {open && createPortal(
        <div aria-hidden="true" style={{ position: 'fixed', left: -10000, top: 0, pointerEvents: 'none' }}>
          <div ref={cardRef} className={`share-card-canvas${dark ? ' share-card-canvas--dark' : ''}`}>
            {renderCard({ dark, highlightMyTeam: highlight })}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
