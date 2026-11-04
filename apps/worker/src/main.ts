import { pino } from 'pino';
import { loadRootEnvFile, parseWorkerEnv } from './env.js';
import { startWorkers } from './worker.js';

loadRootEnvFile();

let env;
try {
  env = parseWorkerEnv(process.env);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'worker' },
  ...(env.NODE_ENV === 'development'
    ? { transport: { target: 'pino-pretty', options: { singleLine: true } } }
    : {}),
});

const workers = await startWorkers(env, logger);

let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down');
  const forceExit = setTimeout(() => {
    logger.error('Graceful shutdown timed out, exiting');
    process.exit(1);
  }, 30_000);
  forceExit.unref();
  try {
    await workers.close();
    logger.info('Shutdown complete');
    process.exit(0);
  } catch (error) {
    logger.error({ err: error }, 'Error during shutdown');
    process.exit(1);
  }
}

process.on('SIGTERM', (signal) => void shutdown(signal));
process.on('SIGINT', (signal) => void shutdown(signal));
