import 'dotenv/config';
import { createApp, connectMongo, attachHttp } from './src/app.js';
import config from './src/config.js';
import authMiddleware from './src/middleware/auth.js';

const port = Number(process.env.PORT) || config.port;

await connectMongo();

let io;
const app = createApp({
  authMiddleware,
  onMessage: (message) => {
    if (io) io.to(message.chatId).emit('message', message);
  },
});

const { server: httpServer, io: attachedIo } = await attachHttp(app);
io = attachedIo;

httpServer.listen(port, () => console.warn(`API listening on http://localhost:${port}`));
