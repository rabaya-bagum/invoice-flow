const safe = (n: string) => n.replace(/[^A-Za-z0-9._-]+/g, '_');

/**
 * Web version of pdf-files.ts (Metro picks it for web builds): there is no file system, so the PDF
 * becomes an in-memory blob URL. The browser frees it when the page closes.
 */
export function savePdfToCache(_invoiceNumber: string, bytes: Uint8Array): string {
  return URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
}

/** Name used when the browser saves the PDF. */
export const pdfFileName = (number: string) => `${safe(number)}.pdf`;
