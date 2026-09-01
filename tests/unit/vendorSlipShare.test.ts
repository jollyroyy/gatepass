// THE PASS ITSELF GOES TO THE VENDOR, NOT A DESCRIPTION OF IT (client,
// 2026-09-01: the WhatsApp message must carry the make and model, the
// department and the QR code — "the same exact print pass page should be sent
// out to the vendor using the WhatsApp as well").
//
// A QR code cannot be typed into a chat, so the printed slip is photographed
// and attached. What is testable here is the decision around that picture:
// which way the device sends it, what happens when the capture fails, and what
// the text says either way.
import { describe, it, expect, vi } from 'vitest';
import { dataUrlToFile, slipFileName } from '../../src/lib/slipImage';
import { sendToVendor, type ShareEnv } from '../../src/lib/vendorShare';

const PNG = 'data:image/png;base64,aGVsbG8=';

function file(): File {
  return dataUrlToFile(PNG, 'RGP-IT-0001.png');
}

function env(over: Partial<ShareEnv> = {}): ShareEnv {
  return {
    download: vi.fn(),
    openUrl: vi.fn(),
    ...over,
  };
}

describe('the slip file', () => {
  it('is named after the pass, so the vendor sees the pass number in the chat', () => {
    expect(slipFileName({ pass_number: 'RGP-IT-0001' })).toBe('RGP-IT-0001.png');
  });

  it('decodes a data URL into real PNG bytes, without a network round trip', () => {
    const f = file();
    expect(f.name).toBe('RGP-IT-0001.png');
    expect(f.type).toBe('image/png');
    expect(f.size).toBe(5); // "hello"
  });
});

describe('sending it', () => {
  it('hands the sheet AND the text to the share sheet when the device has one', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const e = env({ share, canShare: () => true });
    const outcome = await sendToVendor(file(), 'the message', 'https://wa.me/91?text=x', e);
    expect(outcome).toBe('shared');
    const arg = share.mock.calls[0][0];
    expect(arg.files[0].name).toBe('RGP-IT-0001.png');
    expect(arg.text).toBe('the message');
    expect(e.download).not.toHaveBeenCalled();
    expect(e.openUrl).not.toHaveBeenCalled();
  });

  it('saves the sheet and opens wa.me when the browser cannot share files', async () => {
    // Chrome on Windows HAS navigator.share and refuses files — canShare is
    // the only honest test, and this is the desktop HOD's path.
    const e = env({ share: vi.fn(), canShare: () => false });
    const outcome = await sendToVendor(file(), 'the message', 'https://wa.me/91?text=x', e);
    expect(outcome).toBe('downloaded');
    expect(e.share).not.toHaveBeenCalled();
    expect((e.download as ReturnType<typeof vi.fn>).mock.calls[0][0].name).toBe('RGP-IT-0001.png');
    expect(e.openUrl).toHaveBeenCalledWith('https://wa.me/91?text=x');
  });

  it('does NOT drop a file on somebody who backed out of the share sheet', async () => {
    const abort = Object.assign(new Error('cancelled'), { name: 'AbortError' });
    const e = env({ share: vi.fn().mockRejectedValue(abort), canShare: () => true });
    expect(await sendToVendor(file(), 'm', 'https://wa.me/91', e)).toBe('cancelled');
    expect(e.download).not.toHaveBeenCalled();
    expect(e.openUrl).not.toHaveBeenCalled();
  });

  it('falls back rather than failing when the share sheet itself errors', async () => {
    const e = env({ share: vi.fn().mockRejectedValue(new Error('nope')), canShare: () => true });
    expect(await sendToVendor(file(), 'm', 'https://wa.me/91', e)).toBe('downloaded');
    expect(e.download).toHaveBeenCalled();
    expect(e.openUrl).toHaveBeenCalled();
  });

  it('still sends the message when the sheet could not be photographed', async () => {
    const e = env({ share: vi.fn(), canShare: () => true });
    expect(await sendToVendor(null, 'm', 'https://wa.me/91', e)).toBe('downloaded');
    expect(e.share).not.toHaveBeenCalled();
    expect(e.download).not.toHaveBeenCalled();
    expect(e.openUrl).toHaveBeenCalledWith('https://wa.me/91');
  });
});
