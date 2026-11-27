'use client';

import { useT } from '@/i18n/i18n';

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const t = useT();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <nav className="row pagination" aria-label={t('common.pageOf', { page, pages })}>
      <button
        type="button"
        className="button-link"
        disabled={page <= 1}
        onClick={() => {
          onPageChange(page - 1);
        }}
      >
        {t('common.previous')}
      </button>
      <span className="muted">{t('common.pageOf', { page, pages })}</span>
      <button
        type="button"
        className="button-link"
        disabled={page >= pages}
        onClick={() => {
          onPageChange(page + 1);
        }}
      >
        {t('common.next')}
      </button>
    </nav>
  );
}
