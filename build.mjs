#!/usr/bin/env node
/**
 * Assembles HTML pages from src/pages/ templates + src/partials/ fragments.
 *
 * Markers in templates:
 *   <!-- @partial:name -->   → replaced with src/partials/name.html
 *
 *   <!-- @trust -->          → the /trust page body, made from provenance.json (lib/trust.mjs)
 *
 * Nav current-page tokens (replaced per page):
 *   @@NAV_CURRENT_HOME@@        → "is--current" on index, "" elsewhere
 *   @@NAV_CURRENT_INTERPLAY@@   → "is--current" on interplay, "" elsewhere
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { TRUST } from './api/mcp.mjs';
import { ARD, trustHtml, trustMarkdown } from './lib/trust.mjs';

const SRC = 'src/pages';
const PARTIALS = 'src/partials';
const OUT = '.'; // output to repo root (Vercel serves from here)

// Map page filename → which nav link gets is--current
const NAV_CURRENT = {
  'index.html': { HOME: 'is--current', INTERPLAY: '' },
  'interplay.html': { HOME: '', INTERPLAY: 'is--current' },
};

const partialCache = new Map();

function loadPartial(name) {
  if (!partialCache.has(name)) {
    partialCache.set(name, readFileSync(join(PARTIALS, `${name}.html`), 'utf-8'));
  }
  return partialCache.get(name);
}

const pages = readdirSync(SRC).filter(f => f.endsWith('.html'));

for (const page of pages) {
  let html = readFileSync(join(SRC, page), 'utf-8');

  // Replace partial markers
  html = html.replace(/<!-- @partial:(\w+) -->/g, (_, name) => {
    try { return loadPartial(name); }
    catch { console.error(`  ⚠ partial "${name}" not found`); return `<!-- missing partial: ${name} -->`; }
  });

  html = html.replace('<!-- @trust -->', trustHtml);

  // Replace nav current-page tokens
  const tokens = NAV_CURRENT[page] || {};
  html = html.replace(/@@NAV_CURRENT_(\w+)@@/g, (_, key) => tokens[key] || '');

  writeFileSync(join(OUT, page), html);
  console.log(`  ✓ ${page}`);
}

console.log(`\nBuilt ${pages.length} pages.`);

// The server card's trust block is made from provenance.json. Its tools digest stays pinned by hand.
// vercel.json serves the same file at /.well-known/mcp/server-card.json.
const CARD = '.well-known/mcp.json';
writeFileSync(CARD, JSON.stringify({ ...JSON.parse(readFileSync(CARD, 'utf-8')), trust: TRUST }, null, 2) + '\n');
console.log(`  ✓ ${CARD} trust block`);

// For agents that look for us: the ARD manifest, and the markdown mirror of /trust.
writeFileSync('.well-known/ard.json', JSON.stringify(ARD, null, 2) + '\n');
console.log('  ✓ .well-known/ard.json');
writeFileSync('trust.md', trustMarkdown());
console.log('  ✓ trust.md');
