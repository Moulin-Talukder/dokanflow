import {
  type AuthResponse,
  authResponseSchema,
  type ChangePasswordRequest,
  CSRF_HEADER,
  CSRF_HEADER_VALUE,
  type LoginRequest,
  type RegisterRequest,
  type Session,
} from '@dokanflow/shared';
import type { z } from 'zod';
import { ApiRequestError } from '../api-error';

type LockFn = <T>(name: string, fn: () => Promise<T>) => Promise<T>;

/**
 * Serializes refreshes across tabs. The server treats a second use of a rotated
 * refresh token as theft, so two tabs must never refresh with the same cookie at
 * once. Tabs share the cookie jar, so the tab that waits sends the new cookie.
 */
const webLock: LockFn = (name, fn) =>
  typeof navigator !== 'undefined' && 'locks' in navigator
    ? navigator.locks.request(name, fn)
    : fn();

export interface AuthClientOptions {
  baseUrl: string;
  onSessionChange: (session: Session | null) => void;
  fetchImpl?: typeof fetch;
  lock?: LockFn;
}

interface RequestOptions<T> {
  body?: unknown;
  schema?: z.ZodType<T>;
  signal?: AbortSignal;
}

/**
 * Talks to the API on behalf of the signed-in user. The access token lives only
 * in this object's memory; the refresh token is an httpOnly cookie the browser
 * sends to /api/auth/* and that scripts cannot read.
 */
export class AuthClient {
  private accessToken: string | null = null;
  private refreshInFlight: Promise<boolean> | null = null;
  private readonly fetchImpl: typeof fetch;
  private readonly lock: LockFn;

  constructor(private readonly options: AuthClientOptions) {
    this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
    this.lock = options.lock ?? webLock;
  }

  get isAuthenticated(): boolean {
    return this.accessToken !== null;
  }

  /**
   * Exchanges the refresh cookie for a new access token. Concurrent callers share
   * one request. Returns false when there is no valid session.
   */
  refresh(): Promise<boolean> {
    this.refreshInFlight ??= this.lock('dokanflow-refresh', () =>
      this.authCall('/auth/refresh', undefined, { csrf: true }),
    )
      .then((response) => {
        this.accept(response);
        return true;
      })
      .catch((error: unknown) => {
        if (error instanceof ApiRequestError && (error.status === 401 || error.status === 403)) {
          this.clear();
          return false;
        }
        throw error;
      })
      .finally(() => {
        this.refreshInFlight = null;
      });
    return this.refreshInFlight;
  }

  async login(input: LoginRequest): Promise<Session> {
    return this.accept(await this.authCall('/auth/login', input, { csrf: true }));
  }

  async register(input: RegisterRequest): Promise<Session> {
    return this.accept(await this.authCall('/auth/register', input, { csrf: true }));
  }

  async changePassword(input: ChangePasswordRequest): Promise<Session> {
    return this.accept(await this.authCall('/auth/change-password', input, { bearer: true }));
  }

  async switchTenant(tenantId: string): Promise<Session> {
    return this.accept(
      await this.authCall('/auth/switch-tenant', { tenantId }, { csrf: true, bearer: true }),
    );
  }

  async logout(): Promise<void> {
    try {
      await this.fetchImpl(`${this.options.baseUrl}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
        headers: { [CSRF_HEADER]: CSRF_HEADER_VALUE },
      });
    } finally {
      this.clear();
    }
  }

  /**
   * An authenticated API call. On 401 it refreshes once and retries, so an
   * expired access token is invisible to callers.
   */
  async request<T>(method: string, path: string, options: RequestOptions<T> = {}): Promise<T> {
    let response = await this.send(method, path, options);
    if (response.status === 401 && (await this.refresh())) {
      response = await this.send(method, path, options);
    }
    if (response.status === 401) {
      this.clear();
    }
    if (!response.ok) {
      throw await ApiRequestError.fromResponse(response);
    }
    if (response.status === 204 || !options.schema) {
      return undefined as T;
    }
    return options.schema.parse(await response.json());
  }

  private send(method: string, path: string, options: RequestOptions<unknown>): Promise<Response> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    if (this.accessToken) headers.authorization = `Bearer ${this.accessToken}`;
    return this.fetchImpl(`${this.options.baseUrl}${path}`, {
      method,
      headers,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  }

  /** Calls an endpoint that sets the refresh cookie, so credentials must be included. */
  private async authCall(
    path: string,
    body: unknown,
    flags: { csrf?: boolean; bearer?: boolean } = {},
  ): Promise<AuthResponse> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (flags.csrf) headers[CSRF_HEADER] = CSRF_HEADER_VALUE;
    if (flags.bearer && this.accessToken) headers.authorization = `Bearer ${this.accessToken}`;
    const response = await this.fetchImpl(`${this.options.baseUrl}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      throw await ApiRequestError.fromResponse(response);
    }
    return authResponseSchema.parse(await response.json());
  }

  private accept(response: AuthResponse): Session {
    this.accessToken = response.accessToken;
    this.options.onSessionChange(response.session);
    return response.session;
  }

  private clear(): void {
    this.accessToken = null;
    this.options.onSessionChange(null);
  }
}
