'use client';

import type { DependencyCheck } from '@dokanflow/shared';
import { useQuery } from '@tanstack/react-query';
import { useT } from '@/i18n/i18n';
import { publicEnv } from '@/lib/env';
import { fetchReadiness } from '@/lib/health';

function DependencyRow({ name, check }: { name: string; check: DependencyCheck }) {
  const t = useT();
  return (
    <li>
      <span className={`dot dot-${check.status}`} aria-hidden="true" />
      {name}: <strong>{check.status === 'up' ? t('status.up') : t('status.down')}</strong>{' '}
      <span className="muted">
        ({check.latencyMs} ms{check.error ? `, ${check.error}` : ''})
      </span>
    </li>
  );
}

export function ApiStatus() {
  const t = useT();
  const { data, error, isPending } = useQuery({
    queryKey: ['health', 'readiness'],
    queryFn: ({ signal }) => fetchReadiness(publicEnv.NEXT_PUBLIC_API_URL, fetch, signal),
    refetchInterval: 15_000,
  });

  return (
    <section className="card" aria-live="polite">
      <h2>{t('status.title')}</h2>
      {isPending ? (
        <p className="muted">{t('status.checking')}</p>
      ) : error ? (
        <p>
          <span className="dot dot-down" aria-hidden="true" />
          {t('status.unreachable', { url: publicEnv.NEXT_PUBLIC_API_URL })}
        </p>
      ) : (
        <>
          <p>
            {t('status.api')}:{' '}
            <strong>{data.status === 'ok' ? t('status.ready') : t('status.degraded')}</strong>
          </p>
          <ul className="checks">
            <DependencyRow name={t('status.database')} check={data.checks.database} />
            <DependencyRow name={t('status.redis')} check={data.checks.redis} />
          </ul>
        </>
      )}
    </section>
  );
}
