#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dist = 'client/dist/assets';
const files = readdirSync(dist).filter((f) => f.endsWith('.js'));
const libsignalFiles = files.filter((f) => /libsignal/i.test(f));

if (libsignalFiles.length !== 1) {
  console.error(
    `[ERROR] Expected exactly 1 libsignal chunk, found: ${libsignalFiles.length} -> ${libsignalFiles.join(', ')}`
  );
  process.exit(1);
}

const libsignalName = libsignalFiles[0];
const libsignalPath = join(dist, libsignalName);
const libsignalSize = statSync(libsignalPath).size;

const offenders = [];
for (const f of files) {
  if (f === libsignalName) continue;
  const p = join(dist, f);
  const txt = readFileSync(p, 'utf8');
  if (txt.match(/Curve25519|DoubleRatchet|X3DH/i)) {
    offenders.push(f);
  }
}

if (offenders.length) {
  console.error(`[ERROR] libsignal symbols found in non-libsignal chunks: ${offenders.join(', ')}`);
  process.exit(1);
}

console.log(
  `[OK] Single libsignal chunk: ${libsignalName} (${libsignalSize} bytes), no leaks into main/vendor.`
);
