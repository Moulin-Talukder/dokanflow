import { ConflictException, Injectable } from '@nestjs/common';
import { withDbContext } from '@dokanflow/db';
import type { Category, CreateCategoryRequest } from '@dokanflow/shared';
import type { AuthContext } from '../auth/auth-context.js';
import { isUniqueViolation } from '../common/prisma-errors.js';
import { PrismaService } from '../infra/prisma.service.js';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  list(auth: AuthContext): Promise<Category[]> {
    return withDbContext(this.prisma.client, auth, (tx) =>
      tx.category.findMany({
        where: { tenantId: auth.tenantId },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    );
  }

  async create(auth: AuthContext, input: CreateCategoryRequest): Promise<Category> {
    try {
      return await withDbContext(this.prisma.client, auth, (tx) =>
        tx.category.create({
          data: { tenantId: auth.tenantId, name: input.name },
          select: { id: true, name: true },
        }),
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('A category with this name already exists');
      }
      throw error;
    }
  }
}
