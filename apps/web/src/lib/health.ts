import { readinessResponseSchema, type ReadinessResponse } from '@dokanflow/shared';
import { ApiRequestError } from './api-error';

/**
 * Fetches API readiness. A 503 still carries a readiness body (with the failing
 * dependency), so both 200 and 503 are parsed rather than treated as errors.
 */
export async function fetchReadiness(
  apiUrl: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<ReadinessResponse> {
  const response = await fetchImpl(`${apiUrl}/health`, {
    headers: { accept: 'application/json' },
    cache: 'no-store',
    ...(signal ? { signal } : {}),
  });
  if (response.status !== 200 && response.status !== 503) {
    throw await ApiRequestError.fromResponse(response);
  }
  return readinessResponseSchema.parse(await response.json());
}
