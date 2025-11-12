export class InMemoryRedis {
  constructor() {
    this.store = new Map();
  }

  async set(key, value, options = {}) {
    if (options?.NX && this.store.has(key)) {
      return null;
    }
    this.store.set(key, value);
    if (options?.EX) {
      const timeout = setTimeout(() => {
        this.store.delete(key);
      }, options.EX * 1000);
      if (typeof timeout.unref === 'function') {
        timeout.unref();
      }
    }
    return 'OK';
  }

  async quit() {
    this.store.clear();
  }

  async disconnect() {
    this.store.clear();
  }

  clear() {
    this.store.clear();
  }
}
