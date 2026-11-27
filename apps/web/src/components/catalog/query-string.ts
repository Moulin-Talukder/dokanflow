import type { ProductListQueryInput } from '@dokanflow/shared';

/** Builds the products query string, dropping empty values. */
export function toQueryString(params: ProductListQueryInput): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries<unknown>(params)) {
    if (typeof value === 'string' && value !== '') search.set(key, value);
    else if (typeof value === 'number') search.set(key, String(value));
  }
  return search.toString();
}
