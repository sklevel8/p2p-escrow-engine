import { createClient } from 'redis';
import { env } from './env';

/**
 * Redis backs the webhook idempotency gate. `SET key value NX EX` is the only
 * operation used for claiming a gateway reference, so the claim is atomic
 * across concurrent instances.
 */
export const redisClient = createClient({ url: env.redisUrl });

redisClient.on('error', (error: Error) => {
  // Never log the payload of a failed command: it can contain PII.
  console.error(`[redis] client error: ${error.message}`);
});

export async function closeRedis(): Promise<void> {
  if (redisClient.isOpen) {
    await redisClient.quit();
  }
}
