import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toBlob } from 'html-to-image';
import { ShareCardButton, ShareCardMenu, type ShareCardOptions } from '../ShareCardButton';

vi.mock('html-to-image', () => ({ toBlob: vi.fn() }));
// The flag comes from .env, which may be on for local QA; the gate test needs it off.
vi.mock('../../../config/featureFlags', () => ({ FF_SHARE_CARDS: false }));

const renderCard = vi.fn((options: ShareCardOptions) => (
  <div data-testid="card">{options.dark ? 'dark' : 'light'}|{options.highlightMyTeam ? 'mine' : 'plain'}</div>
));

beforeEach(() => {
  vi.mocked(toBlob).mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  document.documentElement.classList.remove('dark');
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const openMenu = async (props: Partial<Parameters<typeof ShareCardMenu>[0]> = {}) => {
  render(<ShareCardMenu title="Roto Rankings" renderCard={renderCard} {...props} />);
  await userEvent.click(screen.getByRole('button', { name: 'Share' }));
  await screen.findByAltText('Roto Rankings preview');
};

describe('ShareCardButton', () => {
  it('renders nothing while the feature flag is off', () => {
    const { container } = render(<ShareCardButton title="Roto Rankings" renderCard={renderCard} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('ShareCardMenu', () => {
  it('renders the card off-screen only while open and shows a preview', async () => {
    render(<ShareCardMenu title="Roto Rankings" renderCard={renderCard} />);
    expect(screen.queryByTestId('card')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(screen.getByTestId('card')).toHaveTextContent('light|plain');
    expect(await screen.findByAltText('Roto Rankings preview')).toHaveAttribute('src', 'blob:preview');
    expect(screen.getByRole('button', { name: 'Download PNG' })).toBeEnabled();
  });

  it('follows the site theme at the moment it opens', async () => {
    document.documentElement.classList.add('dark');
    await openMenu();
    expect(screen.getByTestId('card')).toHaveTextContent('dark|plain');
  });

  it('offers a highlight toggle that re-renders the card and is remembered', async () => {
    await openMenu({ highlightOption: true });
    const toggle = screen.getByRole('checkbox', { name: 'Highlight my team' });
    expect(toggle).not.toBeChecked();

    await userEvent.click(toggle);
    expect(screen.getByTestId('card')).toHaveTextContent('light|mine');
    await waitFor(() => expect(toBlob).toHaveBeenCalledTimes(2));
    expect(localStorage.getItem('fw:share.highlightMyTeam')).toBe('true');
  });

  it('hides the highlight toggle on cards without a my-team row', async () => {
    await openMenu();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('copies the image and says where to paste it', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('ClipboardItem', class { constructor(public items: Record<string, Blob>) {} });
    Object.defineProperty(navigator, 'clipboard', { value: { write }, configurable: true });
    await openMenu();

    await userEvent.click(screen.getByRole('button', { name: 'Copy image' }));
    expect(write).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('Copied. Paste it into WhatsApp.');
  });

  it('explains a failed copy instead of failing silently', async () => {
    vi.stubGlobal('ClipboardItem', class {});
    Object.defineProperty(navigator, 'clipboard', {
      value: { write: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    });
    await openMenu();

    await userEvent.click(screen.getByRole('button', { name: 'Copy image' }));
    expect(screen.getByRole('status')).toHaveTextContent("Copy isn't available here. Use Download instead (denied)");
  });

  it('hides Share and Copy where the browser supports neither', async () => {
    await openMenu();
    expect(screen.queryByRole('button', { name: 'Share…' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy image' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Download PNG' })).toBeInTheDocument();
  });

  it('shows a render error in place of the preview', async () => {
    vi.mocked(toBlob).mockRejectedValueOnce(new Error('canvas tainted'));
    render(<ShareCardMenu title="Roto Rankings" renderCard={renderCard} />);
    await userEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(await screen.findByText(/Couldn't create the image: canvas tainted/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download PNG' })).toBeDisabled();
  });

  it('opens the thumbnail full size; Escape closes that before the menu', async () => {
    await openMenu();
    await userEvent.click(screen.getByRole('button', { name: 'View full size' }));
    expect(screen.getByAltText('Roto Rankings full size')).toHaveAttribute('src', 'blob:preview');

    act(() => { fireEvent.keyDown(document, { key: 'Escape' }); });
    expect(screen.queryByAltText('Roto Rankings full size')).toBeNull();
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'View full size' }));
    await userEvent.click(screen.getByRole('button', { name: 'Close full-size image' }));
    expect(screen.queryByAltText('Roto Rankings full size')).toBeNull();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('closes on Escape and on a click outside', async () => {
    render(
      <div>
        <p>outside</p>
        <ShareCardMenu title="Roto Rankings" renderCard={renderCard} />
      </div>,
    );
    const button = screen.getByRole('button', { name: 'Share' });
    await userEvent.click(button);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    act(() => { fireEvent.keyDown(document, { key: 'Escape' }); });
    expect(screen.queryByRole('dialog')).toBeNull();

    await userEvent.click(button);
    fireEvent.mouseDown(screen.getByText('outside'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByTestId('card')).toBeNull();
  });
});

describe('ShareCardMenu with a message', () => {
  it('sends the message to WhatsApp and puts the image on the clipboard first', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { write, writeText: vi.fn() }, configurable: true });
    vi.stubGlobal('ClipboardItem', class { constructor(public items: Record<string, Blob>) {} });
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    await openMenu({ shareText: '💥 *Boom or Bust*\nhello' });

    await userEvent.click(screen.getByRole('button', { name: 'Send on WhatsApp' }));

    expect(write).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(`https://wa.me/?text=${encodeURIComponent('💥 *Boom or Bust*\nhello')}`, '_blank', 'noopener');
    expect(await screen.findByRole('status')).toHaveTextContent('the image is on your clipboard');
    expect(screen.getByRole('button', { name: 'Copy message' })).toBeInTheDocument();
    open.mockRestore();
  });

  it('offers neither WhatsApp nor Copy message without a message', async () => {
    await openMenu();
    expect(screen.queryByRole('button', { name: 'Send on WhatsApp' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy message' })).not.toBeInTheDocument();
  });
});
