'use client';

import { formatPoisha, saleListResponseSchema } from '@dokanflow/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { formatDateTime } from '@/components/catalog/format';
import { catalogKey } from '@/components/catalog/use-catalog';
import { Pagination } from '@/components/common/pagination';
import { FormMessage } from '@/components/form/field';
import { useT } from '@/i18n/i18n';
import { useAuth } from '@/lib/auth/auth-provider';
import { errorMessage } from '@/lib/error-message';

export function SalesListView() {
  const t = useT();
  const { client, session } = useAuth();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => {
      clearTimeout(timer);
    };
  }, [searchInput]);

  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (search) params.set('search', search);
  if (status) params.set('status', status);
  params.set('page', String(page));
  const query = params.toString();

  const sales = useQuery({
    queryKey: catalogKey(session?.tenant.id, 'sales', query),
    queryFn: ({ signal }) =>
      client.request('GET', `/sales?${query}`, { schema: saleListResponseSchema, signal }),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="stack">
      <h1>{t('sales.title')}</h1>
      <div className="filters">
        <div className="field">
          <label htmlFor="sales-from">{t('sales.from')}</label>
          <input
            id="sales-from"
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="field">
          <label htmlFor="sales-to">{t('sales.to')}</label>
          <input
            id="sales-to"
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="field">
          <label htmlFor="sales-search">{t('sales.searchLabel')}</label>
          <input
            id="sales-search"
            type="search"
            placeholder={t('sales.searchPlaceholder')}
            value={searchInput}
            onChange={(e) => {
              setSearchInput(e.target.value);
            }}
          />
        </div>
        <div className="field">
          <label htmlFor="sales-status">{t('sales.status')}</label>
          <select
            id="sales-status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{t('sales.allStatuses')}</option>
            <option value="completed">{t('sales.status.completed')}</option>
            <option value="voided">{t('sales.status.voided')}</option>
          </select>
        </div>
      </div>

      {sales.isPending ? (
        <p className="muted">{t('common.loading')}</p>
      ) : sales.isError ? (
        <FormMessage kind="error">{errorMessage(sales.error, t)}</FormMessage>
      ) : sales.data.items.length === 0 ? (
        <p className="muted">{t('sales.empty')}</p>
      ) : (
        <>
          <p className="muted">{t('sales.total', { total: sales.data.total })}</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">{t('sales.col.invoice')}</th>
                  <th scope="col">{t('sales.col.date')}</th>
                  <th scope="col">{t('sales.col.cashier')}</th>
                  <th scope="col" className="numeric">
                    {t('sales.col.items')}
                  </th>
                  <th scope="col" className="numeric">
                    {t('sales.col.total')}
                  </th>
                  <th scope="col">{t('sales.col.status')}</th>
                </tr>
              </thead>
              <tbody>
                {sales.data.items.map((sale) => (
                  <tr key={sale.id}>
                    <td>
                      <Link href={`/app/sales/${sale.id}`}>{sale.invoiceNumber}</Link>
                    </td>
                    <td>{formatDateTime(sale.createdAt)}</td>
                    <td>{sale.cashier.name}</td>
                    <td className="numeric">{sale.itemCount}</td>
                    <td className="numeric">{formatPoisha(sale.totalPoisha)}</td>
                    <td>
                      {sale.status === 'voided' ? (
                        <span className="badge badge-warning">{t('sales.status.voided')}</span>
                      ) : (
                        t('sales.status.completed')
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={sales.data.page}
            pageSize={sales.data.pageSize}
            total={sales.data.total}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
}
