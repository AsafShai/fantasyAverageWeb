import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toBlob } from 'html-to-image';
import { canCopyImage, canShareFile, shareFileName, useShareImage } from '../useShareImage';

vi.mock('html-to-image', () => ({ toBlob: vi.fn() }));
const toBlobMock = vi.mocked(toBlob);

const png = (label = 'png') => new Blob([label], { type: 'image/png' });

function setNavigator(props: Record<string, unknown>) {
  for (const [key, value] of Object.entries(props)) {
    Object.defineProperty(navigator, key, { value, configurable: true, writable: true });
  }
}

async function renderReady() {
  const hook = renderHook(() => useShareImage('roto-rankings-2026-10-19.png', 'Roto Rankings'));
  hook.result.current.cardRef.current = document.createElement('div');
  await act(() => hook.result.current.render());
  return hook;
}

beforeEach(() => {
  toBlobMock.mockResolvedValue(png());
  URL.createObjectURL = vi.fn(() => 'blob:card');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  setNavigator({ share: undefined, canShare: undefined, clipboard: undefined });
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('shareFileName', () => {
  it('slugs the title and appends the date', () => {
    expect(shareFileName('Brick City ⇄ Dunk Tank', '2026-10-19')).toBe('brick-city-dunk-tank-2026-10-19.png');
    expect(shareFileName('⇄', '2026-10-19')).toBe('fantasy-league-2026-10-19.png');
  });
});

describe('capability checks', () => {
  it('needs both share and canShare(files) to share a file', () => {
    const file = new File([png()], 'a.png', { type: 'image/png' });
    expect(canShareFile(file)).toBe(false);
    setNavigator({ share: vi.fn(), canShare: vi.fn(() => true) });
    expect(canShareFile(file)).toBe(true);
    setNavigator({ canShare: vi.fn(() => false) });
    expect(canShareFile(file)).toBe(false);
  });

  it('needs ClipboardItem and clipboard.write to copy an image', () => {
    expect(canCopyImage()).toBe(false);
    vi.stubGlobal('ClipboardItem', class {});
    setNavigator({ clipboard: { write: vi.fn() } });
    expect(canCopyImage()).toBe(true);
  });
});

describe('useShareImage', () => {
  it('renders the card node to a 2x PNG', async () => {
    const { result } = await renderReady();
    expect(toBlobMock).toHaveBeenCalledWith(expect.any(HTMLDivElement), expect.objectContaining({ pixelRatio: 2, skipFonts: true }));
    expect(result.current.status).toBe('ready');
    expect(result.current.file?.name).toBe('roto-rankings-2026-10-19.png');
    expect(result.current.file?.type).toBe('image/png');
  });

  it('reports a render failure', async () => {
    toBlobMock.mockRejectedValueOnce(new Error('canvas tainted'));
    const { result } = await renderReady();
    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('canvas tainted');
    expect(result.current.blob).toBeNull();
  });

  it('keeps only the newest render when two overlap', async () => {
    let resolveFirst: (b: Blob) => void = () => {};
    toBlobMock
      .mockReturnValueOnce(new Promise<Blob>(resolve => { resolveFirst = resolve; }))
      .mockResolvedValueOnce(png('second'));
    const { result } = renderHook(() => useShareImage('a.png', 'A'));
    result.current.cardRef.current = document.createElement('div');
    let first: Promise<void> = Promise.resolve();
    await act(async () => {
      first = result.current.render();
      await result.current.render();
    });
    await act(async () => {
      resolveFirst(png('first'));
      await first;
    });
    expect(await result.current.blob?.text()).toBe('second');
  });

  it('opens the share sheet with the PNG file', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    setNavigator({ share, canShare: vi.fn(() => true) });
    const { result } = await renderReady();
    await expect(result.current.share()).resolves.toBe('shared');
    const [data] = share.mock.calls[0];
    expect(data.title).toBe('Roto Rankings');
    expect(data.files[0].name).toBe('roto-rankings-2026-10-19.png');
  });

  it('treats a dismissed share sheet as cancelled, not an error', async () => {
    setNavigator({
      share: vi.fn().mockRejectedValue(new DOMException('dismissed', 'AbortError')),
      canShare: vi.fn(() => true),
    });
    const { result } = await renderReady();
    await expect(result.current.share()).resolves.toBe('cancelled');
  });

  it('downloads instead when the browser cannot share files', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { result } = await renderReady();
    await expect(result.current.share()).resolves.toBe('downloaded');
    expect(click).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).toHaveBeenCalled();
    click.mockRestore();
  });

  it('copies the PNG to the clipboard', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('ClipboardItem', class { constructor(public items: Record<string, Blob>) {} });
    setNavigator({ clipboard: { write } });
    const { result } = await renderReady();
    await expect(result.current.copy()).resolves.toBe('copied');
    expect(write.mock.calls[0][0][0].items['image/png']).toBe(result.current.blob);
  });

  it('refuses actions before the image exists', async () => {
    const { result } = renderHook(() => useShareImage('a.png', 'A'));
    await expect(result.current.share()).rejects.toThrow('not ready');
    expect(() => result.current.download()).toThrow('not ready');
  });
});
