import express, { NextFunction, Request, Response } from 'express';
import { WebhookController } from './controllers/WebhookController';
import { closeDatabase } from './config/database';
import { closeRedis, redisClient } from './config/redis';
import { env } from './config/env';

export function createApp(): express.Express {
  const app = express();

  // Raw body is retained because PayFast signatures are computed over the exact
  // ordered, encoded field string that was posted.
  const captureRawBody = (req: Request, _res: Response, buffer: Buffer): void => {
    (req as Request & { rawBody?: string }).rawBody = buffer.toString('utf8');
  };

  app.use(express.urlencoded({ extended: false, limit: '64kb', verify: captureRawBody }));
  app.use(express.json({ limit: '64kb', verify: captureRawBody }));

  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', version: '1.0.0' });
  });

  app.post('/webhooks/payfast', WebhookController.handleGatewayCallback);

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not Found' });
  });

  // Body-parser and routing errors must not leak stack traces to the caller.
  app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error(`[http] unhandled error: ${error.message}`);
    res.status(400).json({ error: 'Bad Request' });
  });

  return app;
}

async function main(): Promise<void> {
  if (!env.payfastPassphrase) {
    console.warn('[boot] PAYFAST_PASSPHRASE is unset: gateway callbacks will be refused with 503.');
  }

  await redisClient.connect();

  const server = createApp().listen(env.port, () => {
    console.log(`[boot] escrow webhook service listening on :${env.port} (${env.nodeEnv})`);
  });

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[shutdown] received ${signal}`);
    server.close();
    await closeRedis();
    await closeDatabase();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error('[boot] fatal:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
