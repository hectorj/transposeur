#!/usr/bin/env node
/**
 * Packs extension/ into dist/chrome and dist/firefox.
 *
 * The two browsers differ in exactly one place — Firefox MV3 needs an explicit
 * add-on id — so the shared manifest lives in extension/ and the Firefox build
 * is a patched copy rather than a second hand-maintained file.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'extension');
const dist = path.join(root, 'dist');

// Permanent once published — AMO will not let it change. See PUBLISHING.md.
const GECKO_ID = 'pitch-shifter@hectorj.net';

await fs.rm(dist, { recursive: true, force: true });

const manifest = JSON.parse(await fs.readFile(path.join(src, 'manifest.json'), 'utf8'));

const targets = {
  chrome: manifest,
  firefox: {
    ...manifest,
    browser_specific_settings: {
      gecko: {
        id: GECKO_ID,
        strict_min_version: '142.0',
        // nothing leaves the machine; audio is processed in the page
        data_collection_permissions: { required: ['none'] },
      },
    },
  },
};

for (const [name, mf] of Object.entries(targets)) {
  const out = path.join(dist, name);
  await fs.cp(src, out, { recursive: true });
  await fs.writeFile(path.join(out, 'manifest.json'), `${JSON.stringify(mf, null, 2)}\n`);
  console.log(`built dist/${name}`);
}
