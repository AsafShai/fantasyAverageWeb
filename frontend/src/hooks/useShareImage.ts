import { useCallback, useRef, useState } from 'react';

export type ShareImageStatus = 'idle' | 'rendering' | 'ready' | 'error';
export type ShareImageResult = 'shared' | 'cancelled' | 'copied' | 'downloaded';

// 2x keeps text crisp once WhatsApp scales the image to the phone's width.
const PIXEL_RATIO = 2;

/** Renders a DOM node to a PNG blob. The card uses the system font stack, so
 * web-font embedding is skipped: it's slow and can trip over cross-origin
 * stylesheets. No cache-busting: it would append a random query to every
 * image (the Boom or Bust card carries ~20 headshots) and re-download them on
 * each render, bypassing the browser and CDN caches.
 *
 * includeQueryParams: html-to-image caches embedded images by URL and by
 * default cuts the query off the key. Every headshot is ESPN's resizer
 * (`/combiner/i?img=…/<id>.png`), so without the query they all share one key
 * and the first photo fetched was painted on every row. */
// Loaded on first use so the renderer stays out of the page bundles; one
// shared promise so overlapping renders don't each start an import.
let htmlToImage: Promise<typeof import('html-to-image')> | null = null;

/** WebKit (Safari, and every browser on iOS) can paint the SVG snapshot
 * before the photos embedded in it have decoded, leaving them blank on the
 * first render; the second render paints them. */
function isWebKit(): boolean {
  const ua = navigator.userAgent;
  return /AppleWebKit/.test(ua) && !/Chrome|Chromium|Edg|Android/.test(ua);
}

export async function renderNodeToPng(node: HTMLElement): Promise<Blob> {
  htmlToImage ??= import('html-to-image');
  const { toBlob } = await htmlToImage;
  const options = { pixelRatio: PIXEL_RATIO, cacheBust: false, skipFonts: true, includeQueryParams: true };
  if (isWebKit() && node.querySelector('img')) await toBlob(node, options);
  const blob = await toBlob(node, options);
  if (!blob) throw new Error('Could not create the image');
  return blob;
}

/** True when the browser can hand this file to the native share sheet
 * (mobile Safari/Chrome; most desktop browsers can't share files). */
export function canShareFile(file: File): boolean {
  try {
    return typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] }) === true;
  } catch {
    return false;
  }
}

export function canCopyImage(): boolean {
  return typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard?.write === 'function';
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoke on the next tick: some browsers start the download asynchronously.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** "Roto Rankings" + "2026-10-19" → "roto-rankings-2026-10-19.png" */
export function shareFileName(title: string, isoDate: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${slug || 'fantasy-league'}-${isoDate}.png`;
}

const isAbort = (err: unknown) => err instanceof DOMException && err.name === 'AbortError';

/**
 * Turns a rendered card into a PNG and shares, copies or downloads it.
 *
 * The PNG is rendered ahead of time (`render`) rather than on the action
 * click: the share sheet and clipboard both need a recent user gesture, and
 * mobile Safari drops it if we spend a few hundred ms rendering first.
 */
export function useShareImage(fileName: string, title: string, text?: string) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [status, setStatus] = useState<ShareImageStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  // Only the newest render may land: toggling an option mid-render must not
  // let the stale image overwrite the fresh one.
  const renderId = useRef(0);

  const render = useCallback(async () => {
    const node = cardRef.current;
    if (!node) return;
    const id = ++renderId.current;
    setStatus('rendering');
    setError(null);
    try {
      const png = await renderNodeToPng(node);
      if (id !== renderId.current) return;
      setBlob(png);
      setStatus('ready');
    } catch (err) {
      if (id !== renderId.current) return;
      setBlob(null);
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Could not create the image');
    }
  }, []);

  const file = blob ? new File([blob], fileName, { type: 'image/png' }) : null;

  const share = useCallback(async (): Promise<ShareImageResult> => {
    if (!blob) throw new Error('The image is not ready yet');
    const shareFile = new File([blob], fileName, { type: 'image/png' });
    if (!canShareFile(shareFile)) {
      downloadBlob(blob, fileName);
      return 'downloaded';
    }
    try {
      // WhatsApp on Android keeps `text` as the image caption; iOS drops it,
      // so the caption is also put on the clipboard: one paste in the chat.
      if (text) {
        try { await navigator.clipboard?.writeText(text); } catch { /* clipboard blocked: "Copy message" remains */ }
      }
      await navigator.share({ files: [shareFile], title, ...(text ? { text } : {}) });
      return 'shared';
    } catch (err) {
      if (isAbort(err)) return 'cancelled';
      throw err;
    }
  }, [blob, fileName, title, text]);

  const copy = useCallback(async (): Promise<ShareImageResult> => {
    if (!blob) throw new Error('The image is not ready yet');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return 'copied';
  }, [blob]);

  const download = useCallback((): ShareImageResult => {
    if (!blob) throw new Error('The image is not ready yet');
    downloadBlob(blob, fileName);
    return 'downloaded';
  }, [blob, fileName]);

  return { cardRef, blob, file, status, error, render, share, copy, download };
}
