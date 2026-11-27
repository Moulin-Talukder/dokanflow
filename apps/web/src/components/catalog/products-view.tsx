'use client';

import { formatPoisha } from '@dokanflow/shared';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Pagination } from '@/components/common/pagination';
import { FormMessage } from '@/components/form/field';
import { useT } from '@/i18n/i18n';
import { useAuth } from '@/lib/auth/auth-provider';
import { errorMessage } from '@/lib/error-message';
import { formatQuantity } from './format';
import { useCategories, useProducts } from './use-catalog';

const PAGE_SIZE = 20;

export function ProductsView() {
  const t = useT();
  const { can } = useAuth();
  const searchParams = useSearchParams();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [lowStock, setLowStock] = useState(searchParams.get('lowStock') === 'true');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [page, setPage] = useState(1);

  // Search as the user types, without a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => {
      clearTimeout(timer);
    };
  }, [searchInput]);

  const categories = useCategories();
  const products = useProducts({
    search,
    categoryId,
    lowStock: lowStock ? 'true' : 'false',
    includeArchived: includeArchived ? 'true' : 'false',
    page,
    pageSize: PAGE_SIZE,
  });
  const lowStockCount = useProducts({ lowStock: 'true', pageSize: 1 });
  const lowCount = lowStockCount.data?.total ?? 0;
  const filtered = search !== '' || categoryId !== '' || lowStock || includeArchived;

  return (
    <div className="stack">
      <div className="row space-between">
        <h1>{t('products.title')}</h1>
        <div className="row">
          {can('catalog:write') ? (
            <Link className="button" href="/app/products/new">
              {t('products.new')}
            </Link>
          ) : null}
          <Link href="/app/categories">{t('products.manageCategories')}</Link>
        </div>
      </div>

      {lowCount > 0 && !lowStock ? (
        <p className="alert" role="status">
          {lowCount === 1
            ? t('products.lowStockAlertOne')
            : t('products.lowStockAlert', { count: lowCount })}{' '}
          <button
            type="button"
            className="button-link"
            onClick={() => {
              setLowStock(true);
              setPage(1);
            }}
          >
            {t('products.viewLowStock')}
          </button>
        </p>
      ) : null}

      <div className="filters">
        <div className="field">
          <label htmlFor="product-search">{t('products.searchLabel')}</label>
          <input
            id="product-search"
            type="search"
            placeholder={t('products.searchPlaceholder')}
            value={searchInput}
            onChange={(e) => {
              setSearchInput(e.target.value);
            }}
          />
        </div>
        <div className="field">
          <label htmlFor="product-category">{t('products.categoryFilter')}</label>
          <select
            id="product-category"
            value={categoryId}
            onChange={(e) => {
              setCategoryId(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{t('products.allCategories')}</option>
            {categories.data?.items.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={lowStock}
            onChange={(e) => {
              setLowStock(e.target.checked);
              setPage(1);
            }}
          />
          {t('products.lowStockOnly')}
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => {
              setIncludeArchived(e.target.checked);
              setPage(1);
            }}
          />
          {t('products.showArchived')}
        </label>
      </div>

      {products.isPending ? (
        <p className="muted">{t('common.loading')}</p>
      ) : products.isError ? (
        <FormMessage kind="error">{errorMessage(products.error, t)}</FormMessage>
      ) : products.data.items.length === 0 ? (
        <p className="muted">{filtered ? t('products.noMatches') : t('products.empty')}</p>
      ) : (
        <>
          <p className="muted">{t('products.total', { total: products.data.total })}</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">{t('products.col.name')}</th>
                  <th scope="col">{t('products.col.sku')}</th>
                  <th scope="col">{t('products.col.category')}</th>
                  <th scope="col" className="numeric">
                    {t('products.col.price')}
                  </th>
                  <th scope="col" className="numeric">
                    {t('products.col.stock')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {products.data.items.map((product) => (
                  <tr key={product.id}>
                    <td>
                      <Link href={`/app/products/${product.id}`}>{product.name}</Link>
                      {product.archived ? (
                        <span className="badge">{t('products.archivedBadge')}</span>
                      ) : null}
                    </td>
                    <td>
                      <code>{product.sku}</code>
                    </td>
                    <td>{product.category?.name ?? t('common.none')}</td>
                    <td className="numeric">
                      {formatPoisha(product.pricePoisha)}{' '}
                      <span className="muted">{t(`unit.${product.unit}.per`)}</span>
                    </td>
                    <td className="numeric">
                      {formatQuantity(t, product.stockQuantity, product.unit)}
                      {product.isLowStock ? (
                        <span className="badge badge-warning">{t('products.lowStockBadge')}</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={products.data.page}
            pageSize={products.data.pageSize}
            total={products.data.total}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
}
