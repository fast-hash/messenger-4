const cfg = {
  port: Number(process.env.PORT) || 3000,
  mongoUrl: process.env.MONGO_URL || 'mongodb://localhost:27017/messenger3',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  jwtSecret: process.env.JWT_SECRET || 'change_me_to_a_long_random_string',
};

export default cfg;
