'use client';

import { discountToInput, formatPoisha, type Sale } from '@dokanflow/shared';
import { formatQuantity } from '@/components/catalog/format';
import { useT } from '@/i18n/i18n';

/** Lines and totals of a sale; shared by the detail page and the invoice. */
export function SaleLines({ sale, compact = false }: { sale: Sale; compact?: boolean }) {
  const t = useT();
  return (
    <>
      <table className="sale-lines">
        <thead>
          <tr>
            <th scope="col">{t('pos.col.item')}</th>
            <th scope="col" className="numeric">
              {t('invoice.qty')}
            </th>
            {compact ? null : (
              <th scope="col" className="numeric">
                {t('invoice.rate')}
              </th>
            )}
            <th scope="col" className="numeric">
              {t('invoice.amount')}
            </th>
          </tr>
        </thead>
        <tbody>
          {sale.lines.map((line) => (
            <tr key={line.lineNo}>
              <td>
                {line.productName}
                {line.lineDiscountPoisha > 0 ? (
                  <div className="muted small">
                    {t('pos.col.discount')} {line.discount ? discountToInput(line.discount) : ''} (
                    {formatPoisha(-line.lineDiscountPoisha)})
                  </div>
                ) : null}
                {compact ? (
                  <div className="muted small">
                    {formatPoisha(line.unitPricePoisha)} {t(`unit.${line.unit}.per`)}
                  </div>
                ) : null}
              </td>
              <td className="numeric">{formatQuantity(t, line.quantity, line.unit)}</td>
              {compact ? null : (
                <td className="numeric">
                  {formatPoisha(line.unitPricePoisha)}
                  <div className="muted small">{t(`unit.${line.unit}.per`)}</div>
                </td>
              )}
              <td className="numeric">
                {formatPoisha(line.grossPoisha - line.lineDiscountPoisha)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="totals">
        <dt>{t('pos.subtotal')}</dt>
        <dd>{formatPoisha(sale.subtotalPoisha - sale.lineDiscountPoisha)}</dd>
        {sale.saleDiscountPoisha > 0 ? (
          <>
            <dt>
              {t('sale.saleDiscount')}
              {sale.saleDiscount?.type === 'percent'
                ? ` (${discountToInput(sale.saleDiscount)})`
                : ''}
            </dt>
            <dd>{formatPoisha(-sale.saleDiscountPoisha)}</dd>
          </>
        ) : null}
        <dt className="grand">{t('pos.total')}</dt>
        <dd className="grand">{formatPoisha(sale.totalPoisha)}</dd>
        <dt>{t('pos.vatIncluded')}</dt>
        <dd>{formatPoisha(sale.taxPoisha)}</dd>
        {sale.payments.map((p, i) => (
          <PaymentRow
            key={i}
            method={p.method}
            amount={p.amountPoisha}
            tendered={p.tenderedPoisha}
            change={p.changePoisha}
          />
        ))}
      </dl>
    </>
  );
}

function PaymentRow({
  method,
  amount,
  tendered,
  change,
}: {
  method: Sale['payments'][number]['method'];
  amount: number;
  tendered: number | null;
  change: number | null;
}) {
  const t = useT();
  return (
    <>
      <dt>{t(`sale.method.${method}`)}</dt>
      <dd>
        {formatPoisha(amount)}
        {tendered !== null && change !== null ? (
          <div className="muted small">
            {t('sale.tendered', { amount: formatPoisha(tendered), change: formatPoisha(change) })}
          </div>
        ) : null}
      </dd>
    </>
  );
}
