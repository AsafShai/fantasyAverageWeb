import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { FF_SHARE_CARDS } from '../../config/featureFlags'
import { usePersistedState } from '../../hooks/usePersistedState'
import { canCopyImage, canShareFile, downloadBlob, shareFileName, useShareImage, type ShareImageResult } from '../../hooks/useShareImage'
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
  /** A ready-made message to go with the image: sent as the share-sheet text
   * and offered as "Copy message" for apps that take the image alone. */
  shareText?: string
}

const BUTTON_STYLES = {
  neutral: 'bg-white dark:bg-gray-800 text-blue-600 dark:text-blue-400 border-gray-200 dark:border-gray-600 hover:bg-blue-50 dark:hover:bg-gray-700',
  onBlue: 'bg-white/15 text-white border-white/60 hover:bg-white/25',
}

const RESULT_MESSAGES: Partial<Record<ShareImageResult, string>> = {
  copied: 'Copied. Paste it into WhatsApp.',
}

const PRIMARY_ACTION = 'bg-blue-600 text-white hover:bg-blue-700'
const WHATSAPP_ACTION = 'bg-[#25D366] text-white hover:bg-[#1ebe5d]'
const SECONDARY_ACTION = 'bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600'

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

export const ShareCardMenu = ({ title, renderCard, highlightOption = false, variant = 'neutral', shareText }: ShareCardButtonProps) => {
  const [open, setOpen] = useState(false)
  const [dark, setDark] = useState(false)
  const [highlightMyTeam, setHighlightMyTeam] = usePersistedState('share.highlightMyTeam', false)
  const [message, setMessage] = useState<string | null>(null)
  const [zoomed, setZoomed] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const fileName = shareFileName(title, todayIso())
  const { cardRef, blob, file, status, error, render, share, copy, download } = useShareImage(fileName, title, shareText)
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
      if (e.key !== 'Escape') return
      if (zoomed) setZoomed(false)
      else setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, zoomed])

  const toggle = () => {
    if (!open) {
      setDark(isDarkTheme())
      setMessage(null)
      setZoomed(false)
      setWhatsAppStep(null)
    }
    setOpen(!open)
  }

  const runAction = async (action: () => ShareImageResult | Promise<ShareImageResult>, failure: string) => {
    setMessage(null)
    try {
      const result = await action()
      if (result === 'shared') {
        // The caption rides along on Android; on iOS it is on the clipboard now.
        if (shareText) setMessage('Shared. If the message is missing, paste it: it is copied.')
        else setOpen(false)
      }
      else if (result === 'downloaded') setMessage(`Saved ${fileName}`)
      else setMessage(RESULT_MESSAGES[result] ?? null)
    } catch (err) {
      setMessage(`${failure}${err instanceof Error && err.message ? ` (${err.message})` : ''}`)
    }
  }

  /** Direct to WhatsApp: a wa.me link carries the message but no file (no web
   * page can hand WhatsApp Desktop/Web a file), so the image goes on the
   * clipboard first and one paste in the chat attaches it with the message as
   * its caption. If the clipboard is blocked, the PNG is downloaded instead. */
  const [whatsAppStep, setWhatsAppStep] = useState<'pasted' | 'downloaded' | null>(null)
  const openWhatsApp = async () => {
    if (!shareText || !blob) return
    setMessage(null)
    let imageCopied = false
    if (canCopyImage()) {
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        imageCopied = true
      } catch { /* clipboard blocked: fall through to the download */ }
    }
    if (!imageCopied) downloadBlob(blob, fileName)
    window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, '_blank', 'noopener')
    setWhatsAppStep(imageCopied ? 'pasted' : 'downloaded')
  }

  const copyText = async () => {
    if (!shareText) return
    setMessage(null)
    try {
      await navigator.clipboard.writeText(shareText)
      setMessage('Message copied. Paste it with the image.')
    } catch {
      setMessage("Couldn't copy the message")
    }
  }

  const ready = status === 'ready'
  const showCopyText = !!shareText && typeof navigator.clipboard?.writeText === 'function'
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
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">Share as image</span>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="-mr-2 flex h-11 w-11 sm:h-8 sm:w-8 items-center justify-center rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">✕</button>
          </div>

          {/* Compact preview: a thumbnail to confirm the card, full size on tap. */}
          <div className="mb-3 flex items-center gap-3">
            {previewUrl ? (
              <button
                type="button"
                onClick={() => setZoomed(true)}
                aria-label="View full size"
                className="shrink-0 overflow-hidden rounded-md border border-gray-200 dark:border-gray-700"
              >
                <img src={previewUrl} alt={`${title} preview`} className={`h-20 w-auto max-w-[96px] object-contain transition-opacity ${ready ? '' : 'opacity-50'}`} />
              </button>
            ) : (
              <div className={`h-20 w-16 shrink-0 rounded-md bg-gray-100 dark:bg-gray-700 ${status === 'error' ? '' : 'animate-pulse'}`} />
            )}
            <div className="min-w-0 flex-1">
              {status === 'error' ? (
                <p className="text-xs text-red-600 dark:text-red-400">Couldn't create the image: {error}</p>
              ) : (
                <p className="text-xs text-gray-500 dark:text-gray-400">{ready ? <><span className="sm:hidden">Tap</span><span className="hidden sm:inline">Click</span> the image to see it full size</> : 'Preparing image…'}</p>
              )}
              {highlightOption && (
                <label className="mt-1 flex min-h-11 sm:min-h-8 items-center gap-2 text-sm cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={highlightMyTeam}
                    onChange={(e) => setHighlightMyTeam(e.target.checked)}
                    className="w-4 h-4 accent-blue-600"
                  />
                  Highlight my team
                </label>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            {showShare && (
              <button type="button" disabled={!ready} onClick={() => runAction(share, "Couldn't open the share sheet")} className={`${actionClass} ${PRIMARY_ACTION}`}>
                Share…
              </button>
            )}
            {shareText && (
              <button type="button" disabled={!ready} onClick={openWhatsApp} className={`${actionClass} ${WHATSAPP_ACTION}`}>
                Send on WhatsApp
              </button>
            )}
            <div className="flex gap-2">
              {showCopy && (
                <button type="button" disabled={!ready} onClick={() => runAction(copy, "Copy isn't available here. Use Download instead")} className={`${actionClass} ${showShare ? SECONDARY_ACTION : PRIMARY_ACTION}`}>
                  Copy image
                </button>
              )}
              <button type="button" disabled={!ready} onClick={() => runAction(download, "Couldn't save the image")} className={`${actionClass} ${showShare || showCopy ? SECONDARY_ACTION : PRIMARY_ACTION}`}>
                Download PNG
              </button>
            </div>
          </div>

          {showCopyText && (
            <button type="button" onClick={copyText} className={`${actionClass} mt-2 ${SECONDARY_ACTION}`}>
              Copy message
            </button>
          )}

          {whatsAppStep && (
            <div role="status" className="mt-2 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/30 px-3 py-2 text-xs text-emerald-900 dark:text-emerald-100">
              <div className="font-semibold">WhatsApp opened with the message.</div>
              {whatsAppStep === 'pasted' ? (
                <div className="mt-1">Pick the chat, then press <kbd className="rounded border border-emerald-300 dark:border-emerald-700 px-1 font-mono">{navigator.platform.startsWith('Mac') ? '⌘V' : 'Ctrl+V'}</kbd> in it: the image is on your clipboard and attaches with the message as its caption.</div>
              ) : (
                <div className="mt-1">The clipboard is blocked here, so the image was saved as <span className="font-mono">{fileName}</span>: drag it into the chat.</div>
              )}
            </div>
          )}

          {message && <p role="status" className="mt-2 text-xs text-gray-600 dark:text-gray-300">{message}</p>}
        </div>
      )}

      {open && zoomed && previewUrl && (
        <button
          type="button"
          onClick={() => setZoomed(false)}
          aria-label="Close full-size image"
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"
        >
          <img src={previewUrl} alt={`${title} full size`} className="max-h-full max-w-full object-contain" />
        </button>
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
