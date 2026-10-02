import {
  formatLongDate,
  formatPercent,
  formatQuantity,
  optionOn,
  TEMPLATES,
  type DisplayOptionKey,
} from '@invoiceflow/shared';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useBusinessAsset } from '../hooks/queries';
import type { BusinessProfile, Invoice } from '../models';
import { spacing } from '../theme';
import { useTheme } from '../theme/useTheme';
import { money } from '../utils/format';
import { rowsFromInvoice } from '../utils/totals-rows';
import { StatusBadge } from './StatusBadge';
import { TotalsCard } from './TotalsCard';

const safeAccent = (c: string) => (/^#[0-9a-f]{6}$/i.test(c) ? c : '#2563EB');

/** The on-screen invoice: mirrors the PDF layout (logo, parties, items table, totals, notes, terms). */
export function InvoiceDocument({
  invoice: inv,
  business: biz,
  kind = 'invoice',
}: {
  invoice: Invoice;
  business: BusinessProfile;
  /** Estimates print their expiry, say "prepared for" and have no payment lines. */
  kind?: 'invoice' | 'estimate';
}) {
  const estimate = kind === 'estimate';
  const on = (k: DisplayOptionKey) => optionOn(biz.displayOptions, k);
  const template = (TEMPLATES as readonly string[]).includes(biz.template)
    ? biz.template
    : 'classic';
  const modern = template === 'modern';
  const minimal = template === 'minimal';
  const headFg = modern ? '#FFFFFF' : undefined;
  const c = useTheme();
  const accent = safeAccent(biz.accentColor);
  const logo = useBusinessAsset('logo', on('showLogo') ? biz.logoPath : null);
  const signature = useBusinessAsset('signature', on('showSignature') ? biz.signaturePath : null);
  const address = [
    biz.addressLine1,
    biz.addressLine2,
    [biz.city, biz.province, biz.postalCode].filter(Boolean).join(', '),
    biz.country,
  ].filter(Boolean);
  const contact = [
    biz.phone,
    biz.email,
    biz.website,
    biz.taxNumber ? `Tax no: ${biz.taxNumber}` : null,
  ].filter(Boolean);

  return (
    <View
      style={[styles.sheet, { backgroundColor: c.surface, borderColor: c.border }]}
      accessibilityLabel={`${estimate ? 'Estimate' : 'Invoice'} ${inv.number}`}
    >
      <View
        style={[
          styles.row,
          modern && { backgroundColor: accent, padding: spacing.sm, borderRadius: 10 },
        ]}
      >
        <View style={{ flex: 1, gap: 2 }}>
          {logo.data ? (
            <Image
              source={{ uri: logo.data }}
              style={styles.logo}
              resizeMode="contain"
              accessibilityLabel="Company logo"
            />
          ) : null}
          <Text style={{ color: headFg ?? c.text, fontSize: 16, fontWeight: '700' }}>
            {biz.name}
          </Text>
          {[...address, ...contact].map((l) => (
            <Text key={l as string} style={{ color: headFg ?? c.muted, fontSize: 12 }}>
              {l}
            </Text>
          ))}
        </View>
        <View style={{ alignItems: 'flex-end', gap: 2 }}>
          <Text
            style={{
              color: headFg ?? (minimal ? c.text : accent),
              fontSize: 22,
              fontWeight: '800',
            }}
          >
            {estimate ? 'ESTIMATE' : 'INVOICE'}
          </Text>
          <Text style={{ color: headFg ?? c.text, fontWeight: '700' }}>{inv.number}</Text>
          <Text style={{ color: headFg ?? c.muted, fontSize: 12 }}>
            Issued {formatLongDate(inv.issueDate)}
          </Text>
          <Text style={{ color: headFg ?? c.muted, fontSize: 12 }}>
            {estimate ? 'Valid until' : 'Due'} {formatLongDate(inv.dueDate)}
          </Text>
          <StatusBadge status={inv.displayStatus} />
        </View>
      </View>

      <View style={{ gap: 2 }}>
        <Text style={{ color: c.muted, fontSize: 11, fontWeight: '700' }}>
          {estimate ? 'PREPARED FOR' : 'BILL TO'}
        </Text>
        <Text style={{ color: c.text, fontSize: 15, fontWeight: '700' }}>{inv.customerName}</Text>
        {inv.customerEmail ? (
          <Text style={{ color: c.muted, fontSize: 12 }}>{inv.customerEmail}</Text>
        ) : null}
      </View>

      <View>
        <View
          style={[
            styles.row,
            minimal
              ? {
                  borderBottomWidth: 2,
                  borderBottomColor: c.text,
                  paddingVertical: 6,
                  paddingHorizontal: 8,
                }
              : { backgroundColor: `${accent}1F`, paddingVertical: 6, paddingHorizontal: 8 },
          ]}
        >
          <Text style={[styles.th, { color: minimal ? c.text : accent, flex: 1 }]}>
            DESCRIPTION
          </Text>
          <Text
            style={[styles.th, { color: minimal ? c.text : accent, width: 40, textAlign: 'right' }]}
          >
            QTY
          </Text>
          <Text
            style={[styles.th, { color: minimal ? c.text : accent, width: 84, textAlign: 'right' }]}
          >
            AMOUNT
          </Text>
        </View>
        {inv.items.map((it) => (
          <View
            key={it.id}
            style={[
              styles.row,
              {
                paddingVertical: 8,
                paddingHorizontal: 8,
                borderBottomWidth: StyleSheet.hairlineWidth,
                borderBottomColor: c.border,
              },
            ]}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.text }}>{it.description}</Text>
              <Text style={{ color: c.muted, fontSize: 11 }}>
                {money(it.unitPriceMinor, inv.currency)} each
                {it.taxes.length && on('showTaxColumn')
                  ? ` · ${it.taxes.map((t) => `${t.name} ${formatPercent(t.rateBps)}%`).join(', ')}`
                  : ''}
              </Text>
            </View>
            <Text style={{ color: c.text, width: 40, textAlign: 'right' }}>
              {formatQuantity(it.quantityMilli)}
            </Text>
            <Text style={{ color: c.text, width: 84, textAlign: 'right', fontWeight: '700' }}>
              {money(it.lineTotalMinor, inv.currency)}
            </Text>
          </View>
        ))}
      </View>

      <TotalsCard
        rows={
          estimate
            ? rowsFromInvoice(inv).filter(
                (r) => r.label !== 'Amount paid' && r.label !== 'Balance due',
              )
            : rowsFromInvoice(inv)
        }
      />

      {biz.paymentInstructions && !estimate && on('showPaymentInfo') ? (
        <View style={{ gap: 2 }}>
          <Text style={{ color: accent, fontSize: 11, fontWeight: '700' }}>
            PAYMENT INFORMATION
          </Text>
          <Text style={{ color: c.text }}>{biz.paymentInstructions}</Text>
        </View>
      ) : null}
      {inv.notes && on('showNotes') ? (
        <View style={{ gap: 2 }}>
          <Text style={{ color: accent, fontSize: 11, fontWeight: '700' }}>NOTES</Text>
          <Text style={{ color: c.text }}>{inv.notes}</Text>
        </View>
      ) : null}
      {inv.terms && on('showTerms') ? (
        <View style={{ gap: 2 }}>
          <Text style={{ color: accent, fontSize: 11, fontWeight: '700' }}>
            TERMS AND CONDITIONS
          </Text>
          <Text style={{ color: c.muted }}>{inv.terms}</Text>
        </View>
      ) : null}
      {signature.data ? (
        <View style={{ gap: 4 }}>
          <Image
            source={{ uri: signature.data }}
            style={styles.signature}
            resizeMode="contain"
            accessibilityLabel="Signature"
          />
          <Text style={{ color: c.muted, fontSize: 11 }}>
            {biz.ownerName ? `${biz.ownerName} · ` : ''}Authorized signature
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { borderWidth: 1, borderRadius: 16, padding: spacing.md, gap: spacing.md },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  th: { fontSize: 10, fontWeight: '800' },
  logo: { width: 140, height: 48, marginBottom: 4, alignSelf: 'flex-start' },
  signature: { width: 150, height: 50, alignSelf: 'flex-start' },
});
