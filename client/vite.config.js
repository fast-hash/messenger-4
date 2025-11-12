// client/vite.config.js
import path from 'path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      'libsignal-protocol': path.resolve(__dirname, 'src/crypto/libsignal-protocol/index.js'),
      '@': path.resolve(__dirname, 'src'),
      'node:worker_threads': '/@empty-worker-threads',
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
      },
    },
  },
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.match(/libsignal/i)) {
            return 'libsignal';
          }
          if (id.includes('node_modules')) {
            return 'vendor';
          }
          return undefined;
        },
        chunkFileNames(chunkInfo) {
          if (chunkInfo.name === 'libsignal') {
            return 'assets/libsignal-[hash].js';
          }
          return 'assets/[name]-[hash].js';
        },
        entryFileNames(chunkInfo) {
          if (chunkInfo.name === 'libsignal' || chunkInfo.facadeModuleId?.match(/libsignal/i)) {
            return 'assets/libsignal-[hash].js';
          }
          return 'assets/[name]-[hash].js';
        },
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
      plugins: [
        {
          name: 'empty-worker-threads',
          resolveId(id) {
            if (id === '/@empty-worker-threads') {
              return id;
            }
            return null;
          },
          load(id) {
            if (id === '/@empty-worker-threads') {
              return 'export default {};';
            }
            return null;
          },
        },
        {
          name: 'libsignal-chunk-renamer',
          generateBundle(_options, bundle) {
            let oldName;
            let newName;
            let target;

            for (const [fileName, output] of Object.entries(bundle)) {
              if (fileName.includes('worker')) {
                continue;
              }
              const isJs = fileName.endsWith('.js');
              if (!isJs) continue;

              if (output.type === 'asset') {
                let source = '';
                if (typeof output.source === 'string') {
                  source = output.source;
                } else if (output.source instanceof Uint8Array) {
                  source = new TextDecoder().decode(output.source);
                }
                if (/SignalProtocol|Curve25519|DoubleRatchet|X3DH/.test(source)) {
                  oldName = fileName;
                  target = output;
                  break;
                }
              } else if (output.type === 'chunk') {
                const hasLibsignalModule = Object.keys(output.modules ?? {}).some((id) =>
                  /libsignal/i.test(id)
                );
                if (hasLibsignalModule) {
                  oldName = fileName;
                  target = output;
                  break;
                }
              }
            }

            if (!oldName || !target) {
              return;
            }

            const hash = oldName.match(/(-[A-Za-z0-9]+)\.js$/)?.[1] ?? '';
            newName = `assets/libsignal${hash}.js`;

            if (newName !== oldName) {
              delete bundle[oldName];
              target.fileName = newName;
              bundle[newName] = target;

              const oldMap = `${oldName}.map`;
              const mapAsset = bundle[oldMap];
              if (mapAsset) {
                const newMap = `${newName}.map`;
                delete bundle[oldMap];
                mapAsset.fileName = newMap;
                bundle[newMap] = mapAsset;
              }
            }

            const oldBasename = oldName.split('/').pop();
            const newBasename = newName.split('/').pop();

            const replaceAll = (text) =>
              text
                .replaceAll(oldName, newName)
                .replaceAll(`/assets/${oldBasename}`, `/assets/${newBasename}`)
                .replaceAll(oldBasename, newBasename);

            for (const output of Object.values(bundle)) {
              if (output.type === 'chunk') {
                output.code = replaceAll(output.code);
              } else if (output.type === 'asset' && typeof output.source === 'string') {
                output.source = replaceAll(output.source);
              }
            }
          },
        },
      ],
    },
  },
  worker: {
    format: 'es',
  },
  define: { global: 'window' },
});
