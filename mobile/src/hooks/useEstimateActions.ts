import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useAuth } from '../store/auth';
import { savePdfToCache } from '../utils/pdf-files';
import { useSubmit } from './useSubmit';

/** PDF preview and share for one estimate (estimates have no public link or pay page). */
export function useEstimateActions(estimate: { id: string; number: string }) {
  const { api } = useAuth();
  const state = useSubmit();
  const fetchPdf = async () =>
    savePdfToCache(estimate.number, await api.downloadEstimatePdf(estimate.id));

  return {
    loading: state.loading,
    error: state.error,
    previewPdf: () =>
      state.run(async () => {
        await Print.printAsync({ uri: await fetchPdf() });
      }),
    sharePdf: () =>
      state.run(async () => {
        const uri = await fetchPdf();
        if (!(await Sharing.isAvailableAsync()))
          throw Object.assign(new Error('unavailable'), { code: 'PDF_FAILED' });
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          UTI: 'com.adobe.pdf',
          dialogTitle: `Estimate ${estimate.number}`,
        });
      }),
  };
}
