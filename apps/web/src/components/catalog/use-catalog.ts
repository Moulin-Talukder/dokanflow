'use client';

import {
  categoryListResponseSchema,
  productListResponseSchema,
  type ProductListQueryInput,
} from '@dokanflow/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth/auth-provider';
import { toQueryString } from './query-string';

/** Query keys are scoped by shop, so switching shops never shows cached data. */
export function catalogKey(tenantId: string | undefined, ...rest: unknown[]): unknown[] {
  return ['catalog', tenantId, ...rest];
}

export function useCategories() {
  const { client, session } = useAuth();
  return useQuery({
    queryKey: catalogKey(session?.tenant.id, 'categories'),
    queryFn: ({ signal }) =>
      client.request('GET', '/categories', { schema: categoryListResponseSchema, signal }),
  });
}

export function useProducts(params: ProductListQueryInput) {
  const { client, session } = useAuth();
  return useQuery({
    queryKey: catalogKey(session?.tenant.id, 'products', params),
    queryFn: ({ signal }) =>
      client.request('GET', `/products?${toQueryString(params)}`, {
        schema: productListResponseSchema,
        signal,
      }),
    placeholderData: keepPreviousData,
  });
}
