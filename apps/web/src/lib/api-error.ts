import { apiErrorSchema, type ApiError } from '@dokanflow/shared';

/** Thrown by API helpers for non-success responses. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError | undefined,
  ) {
    super(body?.error.message ?? `Request failed with status ${String(status)}`);
    this.name = 'ApiRequestError';
  }

  static async fromResponse(response: Response): Promise<ApiRequestError> {
    const json: unknown = await response.json().catch(() => undefined);
    const parsed = apiErrorSchema.safeParse(json);
    return new ApiRequestError(response.status, parsed.success ? parsed.data : undefined);
  }
}
