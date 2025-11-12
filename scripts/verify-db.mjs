process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.VERIFY_MODE = process.env.VERIFY_MODE || '1';

const jwt = (await import('jsonwebtoken')).default;
const mongoose = (await import('mongoose')).default;
const { MongoMemoryServer } = await import('mongodb-memory-server');
const supertest = (await import('supertest')).default;

const { createApp } = await import('../server/src/app.js');
const { default: Chat } = await import('../server/src/models/Chat.js');
const { default: Message } = await import('../server/src/models/Message.js');
const { closeRedis, setRedisClient } = await import('../server/src/services/replayGuard.js');
const { InMemoryRedis } = await import('../server/test/helpers/inMemoryRedis.js');

const BASE64_RE = /^[A-Za-z0-9+/=]+$/;

function toObjectId(value) {
  return typeof value === 'string' ? new mongoose.Types.ObjectId(value) : value;
}

async function main() {
  let mongod;
  const redis = new InMemoryRedis();
  let exitCode = 0;

  try {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri('verify-db'));
    setRedisClient(redis);

    const app = createApp();
    const request = supertest(app);
    const bootstrap = await request.post('/__test__/bootstrap');
    if (bootstrap.statusCode !== 200) {
      throw new Error(`Bootstrap failed with status ${bootstrap.statusCode}`);
    }

    const { chatId, tokenA, tokenB } = bootstrap.body || {};
    if (!chatId || !tokenA || !tokenB) {
      throw new Error('Bootstrap did not return chatId/tokenA/tokenB');
    }

    const secret = process.env.JWT_SECRET || 'secret';
    const payloadA = jwt.verify(tokenA, secret);
    const payloadB = jwt.verify(tokenB, secret);
    const participantIds = [payloadA.sub || payloadA.userId, payloadB.sub || payloadB.userId]
      .filter(Boolean)
      .map(toObjectId);
    if (participantIds.length) {
      await Chat.updateOne(
        { _id: toObjectId(chatId) },
        { $set: { participants: participantIds } },
        { upsert: true }
      );
    }

    const ciphertext = Buffer.from('db-verification').toString('base64');
    const messageRes = await request
      .post('/api/messages')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ chatId, encryptedPayload: ciphertext });
    if (messageRes.statusCode >= 400) {
      throw new Error(`Ciphertext write failed with status ${messageRes.statusCode}`);
    }

    const docs = await Message.find({ chatId }).limit(5).lean();
    if (!docs.length) {
      throw new Error('No messages persisted for verification');
    }

    for (const doc of docs) {
      if (typeof doc.encryptedPayload !== 'string' || !BASE64_RE.test(doc.encryptedPayload)) {
        throw new Error(`Invalid encryptedPayload in document ${doc._id}`);
      }
      if (Object.prototype.hasOwnProperty.call(doc, 'text') && doc.text != null) {
        throw new Error(`Plaintext field detected in document ${doc._id}`);
      }
    }

    const sample = docs[0];
    console.log(
      'DB OK: ciphertext-only. Sample chatId=%s sender=%s ciphertext(prefix)=%s',
      sample.chatId,
      sample.senderId,
      sample.encryptedPayload.slice(0, 12)
    );
  } catch (err) {
    console.error('DB verification failed:', err);
    exitCode = 1;
  } finally {
    await mongoose.disconnect().catch(() => {});
    if (mongod) {
      await mongod.stop();
    }
    redis.clear();
    await closeRedis();
  }

  process.exit(exitCode);
}

main();
