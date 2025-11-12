import express from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';

export function mountTestBootstrap(app) {
  const verifyMode = String(process.env.VERIFY_MODE || '');
  const isVerifyEnabled = verifyMode === '1';
  if (!isVerifyEnabled) return;
  if (process.env.NODE_ENV === 'production') return;

  const router = express.Router();

  router.post('/__test__/bootstrap', async (_req, res) => {
    const Users = mongoose.connection.collection('users');
    const Chats = mongoose.connection.collection('chats');

    const userA = new mongoose.Types.ObjectId();
    const userB = new mongoose.Types.ObjectId();
    const chatId = new mongoose.Types.ObjectId();

    const now = new Date();
    await Users.insertMany([
      {
        _id: userA,
        username: 'userA',
        email: 'userA@example.test',
        password: 'bootstrap-password',
        createdAt: now,
        updatedAt: now,
      },
      {
        _id: userB,
        username: 'userB',
        email: 'userB@example.test',
        password: 'bootstrap-password',
        createdAt: now,
        updatedAt: now,
      },
    ]);

    await Chats.insertOne({
      _id: chatId,
      participants: [userA, userB],
      createdAt: now,
      updatedAt: now,
    });

    const sign = (sub) =>
      jwt.sign(
        { sub, aud: process.env.JWT_AUDIENCE || 'aud', iss: process.env.JWT_ISSUER || 'iss' },
        process.env.JWT_SECRET || 'secret',
        { algorithm: 'HS256' }
      );

    return res.json({
      chatId: chatId.toString(),
      tokenA: sign(userA.toString()),
      tokenB: sign(userB.toString()),
    });
  });

  app.use(router);
}

export default mountTestBootstrap;
