'use client';

import { saleSchema } from '@dokanflow/shared';
import { useQuery } from '@tanstack/react-query';
import { catalogKey } from '@/components/catalog/use-catalog';
import { ApiRequestError } from '@/lib/api-error';
import { useAuth } from '@/lib/auth/auth-provider';

export function useSale(saleId: string) {
  const { client, session } = useAuth();
  return useQuery({
    queryKey: catalogKey(session?.tenant.id, 'sale', saleId),
    queryFn: ({ signal }) =>
      client.request('GET', `/sales/${saleId}`, { schema: saleSchema, signal }),
    retry: (count, error) =>
      !(error instanceof ApiRequestError && [400, 404].includes(error.status)) && count < 1,
  });
}

export function isNotFound(error: unknown): boolean {
  return error instanceof ApiRequestError && [400, 404].includes(error.status);
}
