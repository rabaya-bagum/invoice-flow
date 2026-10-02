import { useAuth } from '../store/auth';
import { previewPdfFile, shareText, sharePdfFile } from '../utils/pdf-actions';
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
        await previewPdfFile(await fetchPdf());
      }),
    /** The customer-facing page where they can read the estimate and accept or decline it. */
    shareLink: () =>
      state.run(async () => {
        const { url } = await api.createEstimateShareLink(estimate.id);
        await shareText(
          `Estimate ${estimate.number}${businessName ? ` from ${businessName}` : ''}: ${url}`,
        );
      }),
    sharePdf: () =>
      state.run(async () => {
        await sharePdfFile(await fetchPdf(), estimate.number, `Estimate ${estimate.number}`);
      }),
  };
}
