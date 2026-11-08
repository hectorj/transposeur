#!/usr/bin/env node
/**
 * Draws the toolbar icon and rasterises it.
 *
 * The mark is a sine wave whose frequency sweeps upward from left to right —
 * literally what the extension does to a sound. Generated rather than
 * hand-drawn so the sweep is exact and the shape can be retuned for
 * legibility at 16px, where everything decorative turns to mush.
 *
 *   npm run icons     (needs resvg, provided by the nix dev shell)
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SIZES = [16, 32, 48, 128];

const S = 128; // viewBox
const CYCLES_START = 0.5; // cycles at the left edge
const CYCLES_END = 2.6; // ... and at the right edge; more than this turns to mush at 16px
const AMPLITUDE = 30;
const STROKE = 13;
const MARGIN = 15;

/** Sine with a linear frequency sweep, sampled densely enough to look smooth. */
function wavePath() {
  const x0 = MARGIN;
  const x1 = S - MARGIN;
  const steps = 160;
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = x0 + (x1 - x0) * t;
    // integral of a linearly rising frequency gives a quadratic phase
    const phase = 2 * Math.PI * (CYCLES_START * t + ((CYCLES_END - CYCLES_START) * t * t) / 2);
    const y = S / 2 - AMPLITUDE * Math.sin(phase);
    points.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return `M${points.join(' L')}`;
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2b3344"/>
      <stop offset="1" stop-color="#171b24"/>
    </linearGradient>
  </defs>
  <rect width="${S}" height="${S}" rx="28" fill="url(#bg)"/>
  <path d="${wavePath()}" fill="none" stroke="#5de0c4" stroke-width="${STROKE}"
        stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`;

const svgPath = path.join(root, 'assets/icon.svg');
await fs.mkdir(path.dirname(svgPath), { recursive: true });
await fs.writeFile(svgPath, svg);

const outDir = path.join(root, 'extension/icons');
await fs.mkdir(outDir, { recursive: true });
for (const size of SIZES) {
  const out = path.join(outDir, `icon-${size}.png`);
  await run('resvg', ['--width', String(size), '--height', String(size), svgPath, out]);
  console.log(`wrote extension/icons/icon-${size}.png`);
}
