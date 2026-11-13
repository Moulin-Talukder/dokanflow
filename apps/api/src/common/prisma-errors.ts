import { Prisma } from '@dokanflow/db';

/** True for a unique-constraint violation (Prisma error P2002). */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
