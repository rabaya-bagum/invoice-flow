import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Share } from 'react-native';
import { useAuth } from '../store/auth';
import { savePdfToCache } from '../utils/pdf-files';
import { useSubmit } from './useSubmit';

/** PDF preview/share and the customer link for one estimate. */
export function useEstimateActions(estimate: { id: string; number: string }, businessName = '') {
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
    /** The customer-facing page where they can read the estimate and accept or decline it. */
    shareLink: () =>
      state.run(async () => {
        const { url } = await api.createEstimateShareLink(estimate.id);
        await Share.share({
          message: `Estimate ${estimate.number}${businessName ? ` from ${businessName}` : ''}: ${url}`,
        });
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
