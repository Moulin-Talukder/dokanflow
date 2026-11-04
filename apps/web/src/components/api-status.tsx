'use client';

import type { DependencyCheck } from '@dokanflow/shared';
import { useQuery } from '@tanstack/react-query';
import { publicEnv } from '@/lib/env';
import { fetchReadiness } from '@/lib/health';

function DependencyRow({ name, check }: { name: string; check: DependencyCheck }) {
  return (
    <li>
      <span className={`dot dot-${check.status}`} aria-hidden="true" />
      {name}: <strong>{check.status}</strong>{' '}
      <span className="muted">
        ({check.latencyMs} ms{check.error ? `, ${check.error}` : ''})
      </span>
    </li>
  );
}

export function ApiStatus() {
  const { data, error, isPending } = useQuery({
    queryKey: ['health', 'readiness'],
    queryFn: ({ signal }) => fetchReadiness(publicEnv.NEXT_PUBLIC_API_URL, fetch, signal),
    refetchInterval: 15_000,
  });

  return (
    <section className="card" aria-live="polite">
      <h2>System status</h2>
      {isPending ? (
        <p className="muted">Checking API…</p>
      ) : error ? (
        <p>
          <span className="dot dot-down" aria-hidden="true" />
          API unreachable at <code>{publicEnv.NEXT_PUBLIC_API_URL}</code>
        </p>
      ) : (
        <>
          <p>
            API: <strong>{data.status === 'ok' ? 'ready' : 'degraded'}</strong>
          </p>
          <ul className="checks">
            <DependencyRow name="PostgreSQL" check={data.checks.database} />
            <DependencyRow name="Redis" check={data.checks.redis} />
          </ul>
        </>
      )}
    </section>
  );
}
