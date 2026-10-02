import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Platform, Share } from 'react-native';
import { pdfFileName } from './pdf-files';

const pdfFailed = () => Object.assign(new Error('unavailable'), { code: 'PDF_FAILED' });

/** Shows the PDF: the native print preview, or a new browser tab on web. */
export async function previewPdfFile(uri: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (!window.open(uri, '_blank')) throw pdfFailed(); // pop-up blocked
    return;
  }
  await Print.printAsync({ uri });
}

/** Hands the PDF to the user: the share sheet on a phone, a file download in a browser. */
export async function sharePdfFile(uri: string, number: string, title: string): Promise<void> {
  if (Platform.OS === 'web') {
    const a = document.createElement('a');
    a.href = uri;
    a.download = pdfFileName(number);
    document.body.appendChild(a);
    a.click();
    a.remove();
    return;
  }
  if (!(await Sharing.isAvailableAsync())) throw pdfFailed();
  await Sharing.shareAsync(uri, {
    mimeType: 'application/pdf',
    UTI: 'com.adobe.pdf',
    dialogTitle: title,
  });
}

/** Shares text (a customer link). Browsers without the Web Share API copy it instead. */
export async function shareText(message: string): Promise<void> {
  if (Platform.OS === 'web' && typeof navigator !== 'undefined' && !navigator.share) {
    if (!navigator.clipboard) throw pdfFailed();
    await navigator.clipboard.writeText(message);
    return;
  }
  await Share.share({ message });
}
