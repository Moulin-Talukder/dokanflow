import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { CSRF_HEADER } from '@dokanflow/shared';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import type { ApiEnv } from './config/env.js';

export const API_PREFIX = 'api';

/**
 * Applies global HTTP configuration. Shared by main.ts and the integration tests,
 * so tests exercise the same setup as production.
 */
export function configureApp(app: INestApplication, env: ApiEnv): void {
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix(API_PREFIX);
  app.use(helmet());
  app.enableCors({
    origin: env.API_CORS_ORIGINS,
    credentials: true,
    allowedHeaders: ['content-type', 'authorization', CSRF_HEADER, 'x-request-id'],
    exposedHeaders: ['x-request-id'],
  });
  app.enableShutdownHooks();

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('DokanFlow API')
      .setDescription('Multi-tenant POS and inventory API')
      .setVersion('0.2.0')
      .addBearerAuth()
      .addCookieAuth('dokanflow_rt')
      .build(),
  );
  SwaggerModule.setup(`${API_PREFIX}/docs`, app, document, {
    jsonDocumentUrl: `${API_PREFIX}/docs-json`,
  });
}
