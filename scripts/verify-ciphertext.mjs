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
    await mongoose.connect(mongod.getUri('verify-ciphertext'));
    setRedisClient(redis);

    const observedBodies = [];
    const app = createApp({
      messageObserver: (body) => {
        observedBodies.push(JSON.parse(JSON.stringify(body ?? {})));
      },
    });
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
    const memberIds = [payloadA.sub || payloadA.userId, payloadB.sub || payloadB.userId]
      .filter(Boolean)
      .map(toObjectId);
    if (memberIds.length) {
      await Chat.updateOne(
        { _id: toObjectId(chatId) },
        { $set: { participants: memberIds } },
        { upsert: true }
      );
    }

    const plaintextRes = await request
      .post('/api/messages')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ text: 'diagnostic-plaintext' });
    if (plaintextRes.statusCode < 400) {
      console.error('Plaintext payload was accepted:', plaintextRes.statusCode);
      exitCode = 1;
    } else {
      console.log('Plaintext payload rejected with status', plaintextRes.statusCode);
    }

    const ciphertextPayload = Buffer.from('ciphertext-diagnostic').toString('base64');
    const cipherRes = await request
      .post('/api/messages')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ chatId, encryptedPayload: ciphertextPayload });

    if (cipherRes.statusCode >= 400) {
      console.error('Ciphertext payload was rejected:', cipherRes.statusCode, cipherRes.text);
      exitCode = 1;
    }

    const observedCipher = observedBodies.find(
      (body) => body?.encryptedPayload === ciphertextPayload
    );
    if (!observedCipher) {
      console.error('Ciphertext request was not observed via middleware');
      exitCode = 1;
    } else {
      if (Object.prototype.hasOwnProperty.call(observedCipher, 'text')) {
        console.error('Ciphertext observer saw plaintext field:', observedCipher);
        exitCode = 1;
      }
      if (!BASE64_RE.test(observedCipher.encryptedPayload || '')) {
        console.error('Observed encrypted payload is not canonical base64');
        exitCode = 1;
      }
    }

    const docs = await Message.find({ chatId }).lean();
    if (docs.length !== 1) {
      console.error('Expected exactly one stored message, found', docs.length);
      exitCode = 1;
    } else {
      const [doc] = docs;
      if (doc.encryptedPayload !== ciphertextPayload) {
        console.error('Stored ciphertext mismatch:', doc);
        exitCode = 1;
      }
      if (Object.prototype.hasOwnProperty.call(doc, 'text')) {
        console.error('Stored document contains plaintext field:', doc);
        exitCode = 1;
      }
    }

    const historyRes = await request
      .get(`/api/messages/${chatId}`)
      .set('Authorization', `Bearer ${tokenA}`);
    if (historyRes.statusCode !== 200) {
      console.error('History endpoint failed with status', historyRes.statusCode);
      exitCode = 1;
    } else {
      const records = Array.isArray(historyRes.body?.messages)
        ? historyRes.body.messages
        : Array.isArray(historyRes.body)
          ? historyRes.body
          : [];
      records.forEach((record) => {
        if (!BASE64_RE.test(record?.encryptedPayload ?? '')) {
          console.error('History returned non-base64 payload:', record);
          exitCode = 1;
        }
        if (Object.prototype.hasOwnProperty.call(record, 'text')) {
          console.error('History response leaked plaintext:', record);
          exitCode = 1;
        }
      });
    }

    if (exitCode === 0) {
      console.log(
        'Ciphertext verification completed successfully (%d observed request bodies).',
        observedBodies.length
      );
    }
  } catch (err) {
    console.error('Ciphertext verification failed with exception:', err);
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
