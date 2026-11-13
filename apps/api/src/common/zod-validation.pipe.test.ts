import { registerRequestSchema } from '@dokanflow/shared';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { RequestValidationException } from './request-validation.exception.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(
    z.object({ name: z.string().trim().min(1), page: z.coerce.number().int().min(1).default(1) }),
  );

  it('returns the parsed value with transforms and defaults applied', () => {
    expect(pipe.transform({ name: '  Rice  ' })).toEqual({ name: 'Rice', page: 1 });
  });

  it('strips unknown keys', () => {
    expect(pipe.transform({ name: 'Dal', tenantId: 'attacker-supplied' })).toEqual({
      name: 'Dal',
      page: 1,
    });
  });

  it('throws RequestValidationException listing each issue', () => {
    try {
      pipe.transform({ name: '', page: '0' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RequestValidationException);
      const paths = (error as RequestValidationException).issues.map((i) => i.path);
      expect(paths).toEqual(['name', 'page']);
    }
  });

  it('turns shared validation keys into English messages', () => {
    const shared = new ZodValidationPipe(registerRequestSchema);
    try {
      shared.transform({
        businessName: 'Shop',
        name: 'Owner',
        email: 'o@x.test',
        password: 'short',
      });
      expect.unreachable();
    } catch (error) {
      expect((error as RequestValidationException).issues).toEqual([
        { path: 'password', message: 'Use at least 10 characters' },
      ]);
    }
  });
});
