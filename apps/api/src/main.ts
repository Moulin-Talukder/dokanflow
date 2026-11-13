import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { assertArgon2Available } from './auth/password-hasher.js';
import { ApiExpressAdapter } from './common/api-express.adapter.js';
import { EnvValidationError, parseApiEnv } from './config/env.js';
import { loadRootEnvFile } from './config/load-env-file.js';

async function bootstrap(): Promise<void> {
  assertArgon2Available();
  loadRootEnvFile();

  let env;
  try {
    env = parseApiEnv(process.env);
  } catch (error) {
    if (error instanceof EnvValidationError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  const app = await NestFactory.create(AppModule.forRoot(env), new ApiExpressAdapter(), {
    bufferLogs: true,
  });
  configureApp(app, env);
  await app.listen(env.API_PORT);
}

await bootstrap();
