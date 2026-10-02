import { Platform, Share } from 'react-native';
import { previewPdfFile, shareText, sharePdfFile } from '../src/utils/pdf-actions';
import { pdfFileName, savePdfToCache } from '../src/utils/pdf-files.web';

jest.mock('expo-print', () => ({ printAsync: jest.fn() }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({ File: class {}, Paths: {} }));

type G = Record<string, unknown>;
const g = globalThis as unknown as G;
const saved: G = {};
const set = (k: string, v: unknown) => {
  if (!(k in saved)) saved[k] = g[k];
  g[k] = v;
};

afterEach(() => {
  for (const k of Object.keys(saved)) g[k] = saved[k];
  jest.restoreAllMocks();
});

describe('PDF handling on web', () => {
  beforeEach(() => jest.replaceProperty(Platform, 'OS', 'web'));

  it('turns the bytes into a PDF blob URL', () => {
    const create = jest.fn(() => 'blob:abc');
    set('URL', { createObjectURL: create });
    expect(savePdfToCache('INV 001', new Uint8Array([1, 2]))).toBe('blob:abc');
    const blob = (create.mock.calls[0] as unknown as [Blob])[0];
    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBe(2);
  });

  it('names the download safely', () => {
    expect(pdfFileName('INV/001 x')).toBe('INV_001_x.pdf');
  });

  it('previews in a new tab and reports a blocked pop-up', async () => {
    const open = jest.fn(() => ({}));
    set('window', { open });
    await previewPdfFile('blob:abc');
    expect(open).toHaveBeenCalledWith('blob:abc', '_blank');
    open.mockReturnValue(null as never);
    await expect(previewPdfFile('blob:abc')).rejects.toMatchObject({ code: 'PDF_FAILED' });
  });

  it('downloads the PDF through a temporary link', async () => {
    const a = { href: '', download: '', click: jest.fn(), remove: jest.fn() };
    set('document', { createElement: () => a, body: { appendChild: jest.fn() } });
    await sharePdfFile('blob:abc', 'INV-001', 'Invoice INV-001');
    expect(a).toMatchObject({ href: 'blob:abc', download: 'INV-001.pdf' });
    expect(a.click).toHaveBeenCalled();
    expect(a.remove).toHaveBeenCalled();
  });

  it('copies a link when the browser has no Web Share API', async () => {
    const writeText = jest.fn(async () => undefined);
    set('navigator', { clipboard: { writeText } });
    const share = jest.spyOn(Share, 'share');
    await shareText('Invoice: http://x');
    expect(writeText).toHaveBeenCalledWith('Invoice: http://x');
    expect(share).not.toHaveBeenCalled();
  });

  it('uses the Web Share API when there is one', async () => {
    set('navigator', { share: jest.fn(), clipboard: { writeText: jest.fn() } });
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
    await shareText('hi');
    expect(share).toHaveBeenCalledWith({ message: 'hi' });
  });
});
