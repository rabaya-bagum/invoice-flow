import { File, Paths } from 'expo-file-system';

const safe = (n: string) => n.replace(/[^A-Za-z0-9._-]+/g, '_');

/** Writes PDF bytes to the app cache and returns a file:// URI for the share sheet / print preview. */
export function savePdfToCache(invoiceNumber: string, bytes: Uint8Array): string {
  const file = new File(Paths.cache, `${safe(invoiceNumber)}.pdf`);
  file.create({ overwrite: true });
  file.write(bytes);
  return file.uri;
}

/** Name used when the PDF is saved or shared. */
export const pdfFileName = (number: string) => `${safe(number)}.pdf`;
