import process from 'node:process';

import mongoose from 'mongoose';

import { MongoMemoryServer } from 'mongodb-memory-server';

import { attachHttp, connectMongo, createApp } from '../server/src/app.js';
import { setRedisClient, closeRedis } from '../server/src/services/replayGuard.js';
import { InMemoryRedis } from '../server/test/helpers/inMemoryRedis.js';

const port = Number.parseInt(process.env.API_CHECKS_PORT || '3100', 10);

async function main() {
  process.env.NODE_ENV ||= 'test';
  process.env.JWT_SECRET ||= 'test-secret';
  process.env.VERIFY_MODE ||= '1';

  const mongod = await MongoMemoryServer.create();
  const mongoUri = mongod.getUri();
  await connectMongo(mongoUri);
  setRedisClient(new InMemoryRedis());

  const app = createApp();
  const { server } = await attachHttp(app);

  await new Promise((resolve) => {
    server.listen(port, () => {
      console.log(`ready:${port}`);
      resolve();
    });
  });

  let shuttingDown = false;
  async function shutdown() {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    await new Promise((resolve) => {
      server.close(resolve);
    });
    await closeRedis();
    await mongoose.disconnect();
    await mongod.stop();
  }

  const handleExit = (signal) => async () => {
    console.warn(`Received ${signal}, shutting down test server`);
    await shutdown();
    process.exit(0);
  };

  process.on('SIGINT', handleExit('SIGINT'));
  process.on('SIGTERM', handleExit('SIGTERM'));

  process.on('beforeExit', async () => {
    await shutdown();
  });
}

main().catch((err) => {
  console.error('[api-checks:start]', err);
  process.exit(1);
});
