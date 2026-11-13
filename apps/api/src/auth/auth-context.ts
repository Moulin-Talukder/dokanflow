import type { MembershipRole } from '@dokanflow/shared';
import type { AccessTokenClaims } from './access-token.service.js';

/** The authenticated user acting in one tenant, resolved per request from the database. */
export interface AuthContext {
  userId: string;
  tenantId: string;
  role: MembershipRole;
  /** Refresh-token family of the current session. */
  sessionId: string;
  mustChangePassword: boolean;
}

// Express's typings merge this global interface into every Request.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by JwtAuthGuard. */
      accessClaims?: AccessTokenClaims;
      /** Set by TenantContextGuard. */
      auth?: AuthContext;
    }
  }
}
