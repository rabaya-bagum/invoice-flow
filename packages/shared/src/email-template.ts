import { isSupportedCurrency } from './currency';
import { formatLongDate } from './dates';
import { formatMoney } from './money';

export interface EmailTemplateInput {
  businessName: string;
  customerName: string;
  invoiceNumber: string;
  totalMinor: number;
  currency: string;
  dueDate: string;
}

/** Default invoice email shown (and editable) before sending. */
export function defaultInvoiceEmail(i: EmailTemplateInput): { subject: string; message: string } {
  const total = isSupportedCurrency(i.currency)
    ? formatMoney(i.totalMinor, i.currency)
    : `${i.totalMinor} ${i.currency}`;
  return {
    subject: `Invoice ${i.invoiceNumber} from ${i.businessName}`,
    message: [
      `Hi ${i.customerName},`,
      '',
      `Please find attached invoice ${i.invoiceNumber} for ${total}.`,
      '',
      `Payment is due on ${formatLongDate(i.dueDate)}.`,
      '',
      'Thank you.',
    ].join('\n'),
  };
}
