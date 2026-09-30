// U9: no cookies, and a privacy policy that is true. Holds /privacy to the pages and the code it describes.
// Run: node --test tests/*.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import handler from '../api/mcp.mjs';
import middleware from '../middleware.js';

const root = new URL('../', import.meta.url);
const read = file => readFileSync(new URL(file, root), 'utf-8');
const P = JSON.parse(read('provenance.json'));
const SITE = P.server.operator.website;
const ANALYTICS = '<script defer src="/_vercel/insights/script.js"></script>';

// Every file a check reads, by path, so a deliberate break can edit a copy in memory.
const BUILT = readdirSync(new URL('./', root)).filter(f => f.endsWith('.html'));
const SRC = readdirSync(new URL('src/', root), { recursive: true }).filter(f => f.endsWith('.html')).map(f => `src/${f}`);
const OTHER = ['privacy.md', 'trust.md', 'sitemap.xml', 'vercel.json', 'middleware.js', 'lib/agent-traffic.mjs', '.well-known/mcp.json'];
const FILES = Object.fromEntries([...BUILT, ...SRC, ...OTHER].filter(f => existsSync(new URL(f, root))).map(f => [f, read(f)]));

// What the MCP server actually does, from a live call: the keys of its audit line and what request_intro returns.
async function liveMcp() {
  const call = async (body, headers = {}) => {
    const res = { headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status() { return this; }, json(b) { this.body = b; return this; }, end() { return this; } };
    await handler({ method: 'POST', headers, body }, res);
    return res;
  };
  const init = await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'privacy-test', version: '9.9' } } });
  const args = { name: 'Ada Placeholder', agency: 'Zzq Agency', size: '12', goal: 'zzq-goal-text' };
  const lines = [];
  const log = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  let reply;
  try {
    reply = await call({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'request_intro', arguments: args } }, { 'mcp-session-id': init.headers['mcp-session-id'] });
  } finally {
    console.log = log;
  }
  return { lines, args, audit: lines.map(line => JSON.parse(line)), intro: reply.body.result.structuredContent };
}
const MCP = await liveMcp();

// Page text with the markup removed, and the markdown with its syntax removed, so the two can be compared word for word.
const htmlText = html => (html.match(/<main[^>]*>([\s\S]*?)<\/main>/)?.[1] ?? '')
  .replace(/<[^>]+>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();
const mdText = md => md.replace(/^(#+|>|-) /gm, '').replace(/`/g, '').replace(/\s+/g, ' ').trim();

// The keys of the object literal a line of source serialises, e.g. JSON.stringify({ day, first: x }) → day, first.
const keysOf = (source, pattern) => {
  const body = source.match(pattern)?.[1];
  return body ? body.split(',').map(part => part.trim().match(/^(\w+)/)?.[1]).filter(Boolean) : null;
};

// Every property the slice asks of the site; each failure message starts with the property's name.
function check(files, mcp) {
  const pages = Object.keys(files).filter(f => f.endsWith('.html'));
  const built = pages.filter(f => !f.startsWith('src/'));

  for (const f of pages) {
    assert.ok(!/googletagmanager\.com/i.test(files[f]), `google: ${f} loads Google Tag Manager`);
    assert.ok(!/\bgtag\b/.test(files[f]), `google: ${f} calls gtag`);
    assert.ok(!/\bG-[A-Z0-9]{6,}\b/.test(files[f]), `google: ${f} carries a GA4 measurement id`);
    assert.ok(!/script\.debug\.js/.test(files[f]), `analytics: ${f} loads the Vercel Analytics debug script`);
    assert.ok(!/document\s*\.\s*cookie\s*=(?!=)|cookieStore\s*\.\s*set\b/.test(files[f]), `cookies: ${f} sets a cookie`);
  }
  for (const f of built) assert.ok(files[f].includes(ANALYTICS), `analytics: ${f} does not load ${ANALYTICS}`);

  const vercel = JSON.parse(files['vercel.json']);
  assert.ok(files['src/pages/privacy.html'], 'page: src/pages/privacy.html is missing');
  assert.equal(files['privacy.html'], files['src/pages/privacy.html'], 'page: privacy.html is stale: run node build.mjs');
  assert.ok(vercel.rewrites.some(r => r.source === '/privacy' && r.destination === '/privacy.html'), 'page: no rewrite from /privacy to /privacy.html');
  assert.ok(files['privacy.html'].includes(`<link rel="canonical" href="${SITE}/privacy">`), 'page: no canonical link to /privacy');

  assert.ok(files['privacy.md'], 'markdown: privacy.md is missing');
  assert.ok(/'\/privacy': '\/privacy\.md'/.test(files['middleware.js']),'markdown: middleware.js does not serve /privacy.md to Accept: text/markdown');
  assert.ok(files['privacy.html'].includes('<link rel="alternate" type="text/markdown" href="/privacy.md">'), 'markdown: no rel="alternate" link to /privacy.md');
  assert.equal(htmlText(files['privacy.html']), mdText(files['privacy.md']), 'markdown: privacy.md and privacy.html say different things');

  for (const f of built) {
    const footer = files[f].slice(files[f].lastIndexOf('<footer'));
    assert.ok(/<a [^>]*href="\/privacy"/.test(footer.slice(0, footer.indexOf('</footer>'))), `footer: ${f} has no /privacy link in its footer`);
  }
  assert.ok(files['sitemap.xml'].includes(`<loc>${SITE}/privacy</loc>`), 'sitemap: sitemap.xml does not list /privacy');

  // The code the policy describes: the crawler log's stored record, its log line and its retention.
  const lib = files['lib/agent-traffic.mjs'];
  const sighting = keysOf(lib, /put\(pathname, JSON\.stringify\(\{([^}]*)\}\)/);
  const hitLine = keysOf(files['middleware.js'], /JSON\.stringify\(\{ evt: 'ai-agent-hit',([^}]*)\}\)/);
  const keepDays = lib.match(/const KEEP_DAYS = (\d+);/)?.[1];
  const deletes = /if \(day < expire\) \{ stale\.push\(pathname\)/.test(lib) && /await del\(stale\)/.test(lib)
    && vercel.crons?.some(c => c.path === '/api/cron-agent-traffic' && /^\d+ \d+ \* \* \*$/.test(c.schedule));
  assert.deepEqual(sighting, ['day', 'platform', 'agent', 'group', 'first'], 'crawler: the stored sighting is no longer the one the policy describes');
  assert.deepEqual(hitLine, ['agent', 'platform', 'group', 'path', 'at'], 'crawler: the ai-agent-hit log line is no longer the one the policy describes');
  assert.ok(/`seen\/\$\{day\}\/\$\{slug\(platform\)\}\/\$\{group\}\.json`/.test(lib),'crawler: sightings are no longer one per UTC day, platform and content group');

  // The MCP server, from the live call.
  assert.equal(mcp.audit.length, 1, 'audit: one line per tools/call');
  assert.deepEqual(Object.keys(mcp.audit[0]), ['evt', 'ts', 'tool', 'client', 'outcome'], 'audit: the audit line is no longer the one the policy describes');
  assert.deepEqual(Object.keys(mcp.audit[0].client ?? {}), ['name', 'version'], 'audit: the client is no longer name and version');
  for (const value of Object.values(mcp.args)) assert.ok(!mcp.lines.join('\n').includes(value), `audit: the log carries an argument: ${value}`);
  assert.equal(mcp.intro.sent, false, 'intro: request_intro sent something');

  // Consistent with /trust and the server card: the same data_reach, the same contact, the same audit fields.
  const card = JSON.parse(files['.well-known/mcp.json']).trust;
  assert.ok(files['trust.md'].includes(card.data_reach.stores), 'consistent: /trust does not state the card\'s data_reach.stores');
  assert.ok(/arguments are never logged.*sends nothing/.test(card.data_reach.request_intro), 'consistent: the card no longer says request_intro logs no arguments and sends nothing');
  assert.equal(JSON.parse(files['.well-known/mcp.json']).contact, P.server.contact, 'consistent: the card\'s contact is not the policy\'s');
  for (const field of ['the tool name', 'the client name and version', 'the outcome', 'the time']) {
    assert.ok(card.data_reach.stores.includes(field), `consistent: the card's data_reach.stores does not name ${field}`);
  }

  // What /privacy states, in the page and in its markdown mirror alike.
  for (const [label, text] of [['privacy.html', htmlText(files['privacy.html'])], ['privacy.md', mdText(files['privacy.md'])]]) {
    const says = (name, phrase) => assert.ok(text.includes(phrase), `${name}: ${label} does not say "${phrase}"`);
    says('no-cookies', 'The site sets no cookies.');
    for (const phrase of ['aggregate page-view data only', 'the event timestamp, the URL, the dynamic path, the referrer, filtered query parameters, the geolocation (country, region, city), the device OS and version, the browser and version, the device type and the script version',
      'a hash created from the incoming request, not by a cookie', 'Vercel discards that hash after 24 hours']) says('vercel-analytics', phrase);
    for (const phrase of ['the user-agent token', 'the platform', 'the content group', 'once per UTC day', 'No IP address is stored', 'in Vercel Blob',
      'the user-agent token, the platform, the content group, the path and the time']) says('crawler', phrase);
    if (deletes) says('crawler', `deletes sightings older than ${keepDays} days`);
    else says('crawler', 'Nothing deletes them.');
    says('audit', card.data_reach.stores);
    for (const phrase of ['The arguments of a call are never logged.', 'Vercel keeps runtime logs for 1 hour on our plan.']) says('audit', phrase);
    says('intro', 'It sends nothing and stores nothing.');
    for (const phrase of [`Email to ${P.server.contact} is handled by Google Workspace.`]) says('email', phrase);
    const processors = text.slice(text.indexOf('Who processes it'));
    for (const phrase of ['Vercel: hosting, analytics, runtime logs and Blob storage.', 'Google: email, through Google Workspace.', 'jsDelivr: the scripts our pages load']) {
      assert.ok(text.includes('Who processes it') && processors.includes(phrase), `processors: ${label} does not name "${phrase}" under Who processes it`);
    }
    says('contact', `${P.server.operator.name}, ${SITE}. Contact: ${P.server.contact}.`);
    assert.ok(/Last updated: \d{4}-\d{2}-\d{2}\./.test(text), `updated: ${label} carries no "Last updated" date`);
    assert.ok(!/\b(GDPR|CCPA|compliant|compliance|certified|Ltd|LLC|Inc\.|GmbH)\b/.test(text), `claims: ${label} makes a compliance claim or names a legal entity`);
  }
}

test('no page loads Google Analytics or sets a cookie; every page loads Vercel Analytics\' production script; /privacy states what the site and the MCP server collect', () => {
  check(FILES, MCP);
});

test('each check catches a deliberate break of it', () => {
  const GA = '<script async src="https://www.googletagmanager.com/gtag/js?id=G-11YS3SH6PC"></script>';
  const PAGE = ['privacy.html', 'src/pages/privacy.html'];
  const BREAKS = [
    ['google', 'src/pages/index.html', '<head>', `<head>\n  ${GA}`],
    ['google', 'interplay.html', '</body>', '<script>gtag(\'js\', new Date());</script></body>'],
    ['google', 'src/partials/footer.html', '</footer>', '<!-- G-11YS3SH6PC --></footer>'],
    ['analytics', 'trust.html', ANALYTICS, ''],
    ['analytics', 'index.html', ANALYTICS, '<script defer src="https://va.vercel-scripts.com/v1/script.debug.js" data-endpoint="/_vercel/insights"></script>'],
    ['cookies', 'src/pages/interplay.html', '</body>', '<script>document.cookie = "seen=1";</script></body>'],
    ['page', 'privacy.html', '</main>', '<p>Stale.</p></main>'],
    ['page', 'vercel.json', '"source": "/privacy"', '"source": "/privacy-policy"'],
    ['page', PAGE, `<link rel="canonical" href="${SITE}/privacy">`, `<link rel="canonical" href="${SITE}/trust">`],
    ['markdown', 'middleware.js', "'/privacy': '/privacy.md'", "'/privacy': '/privacy.html'"],
    ['markdown', PAGE, '<link rel="alternate" type="text/markdown" href="/privacy.md">', ''],
    ['markdown', 'privacy.md', 'The site sets no cookies.', 'The site sets no cookies. It may set one later.'],
    ['footer', 'index.html', 'href="/privacy"', 'href="/trust"'],
    ['footer', 'trust.html', '<a href="/privacy">', '<a href="/">'],
    ['sitemap', 'sitemap.xml', `<loc>${SITE}/privacy</loc>`, `<loc>${SITE}/trust</loc>`],
    ['crawler', 'lib/agent-traffic.mjs', '{ day, platform, agent, group,', '{ day, platform, agent, group, ip,'],
    ['crawler', 'middleware.js', 'path: url.pathname,', "path: url.pathname, ip: request.headers.get('x-real-ip'),"],
    ['crawler', 'lib/agent-traffic.mjs', 'const KEEP_DAYS = 35;', 'const KEEP_DAYS = 90;'],
    ['crawler', 'lib/agent-traffic.mjs', '  if (stale.length) await del(stale);\n', ''],
    ['crawler', 'vercel.json', '"path": "/api/cron-agent-traffic"', '"path": "/api/cron-other"'],
    ['crawler', 'lib/agent-traffic.mjs', 'seen/${day}/', 'seen/${at.toISOString()}/'],
    ['no-cookies', 'privacy.md', 'The site sets no cookies.', 'The site sets few cookies.'],
    ['vercel-analytics', 'privacy.md', 'after 24 hours', 'after 30 days'],
    ['audit', 'privacy.md', 'for 1 hour on our plan', 'for 30 days on our plan'],
    ['intro', 'privacy.md', 'It sends nothing and stores nothing.', 'It sends nothing.'],
    ['email', 'privacy.md', 'handled by Google Workspace', 'handled by our mail host'],
    ['processors', 'privacy.md', '- jsDelivr: the scripts our pages load', '- A CDN: the scripts our pages load'],
    ['contact', 'privacy.md', `Contact: ${P.server.contact}.`, 'Contact: privacy@example.com.'],
    ['updated', 'privacy.md', 'Last updated:', 'Updated:'],
    ['claims', 'privacy.md', 'The site sets no cookies.', 'The site sets no cookies. We are GDPR compliant.'],
    ['consistent', 'trust.md', P.server.data_reach.stores, 'Nothing is stored.'],
    ['consistent', '.well-known/mcp.json', `"contact": "${P.server.contact}"`, '"contact": "someone@example.com"'],
    ['consistent', '.well-known/mcp.json', 'The server drafts the email and sends nothing.', 'The server drafts the email and sends it.'],
  ];
  for (const [name, target, from, to] of BREAKS) {
    const broken = { ...FILES };
    for (const file of [].concat(target)) {
      assert.ok(FILES[file]?.includes(from), `the ${name} break no longer applies to ${file}: ${JSON.stringify(from)}`);
      broken[file] = FILES[file].replace(from, to);
    }
    // A markdown-only break also shows up as a mirror mismatch first; the named statement must still fail on its own.
    if (target === 'privacy.md' && name !== 'markdown') broken['privacy.html'] = broken['src/pages/privacy.html'] = mirrorOf(broken['privacy.md'], FILES['privacy.html']);
    assert.throws(() => check(broken, MCP), { message: new RegExp(`^${name}:`) }, `breaking ${name} in ${target} went unnoticed`);
  }
  const without = key => Object.fromEntries(Object.entries(FILES).filter(([f]) => f !== key));
  assert.throws(() => check(without('src/pages/privacy.html'), MCP), { message: /^page:/ });
  assert.throws(() => check(without('privacy.md'), MCP), { message: /^markdown:/ });
  const [line] = MCP.audit;
  assert.throws(() => check(FILES, { ...MCP, audit: [{ ...line, arguments: MCP.args }] }), { message: /^audit:/ }, 'an audit line with the arguments went unnoticed');
  assert.throws(() => check(FILES, { ...MCP, audit: [line, line] }), { message: /^audit:/ }, 'two audit lines for one call went unnoticed');
  assert.throws(() => check(FILES, { ...MCP, audit: [{ ...line, client: { ...line.client, ip: '203.0.113.9' } }] }), { message: /^audit:/ }, 'a client with more than name and version went unnoticed');
  assert.throws(() => check(FILES, { ...MCP, lines: [...MCP.lines, JSON.stringify(MCP.args)] }), { message: /^audit:/ }, 'a logged argument went unnoticed');
  assert.throws(() => check(FILES, { ...MCP, intro: { ...MCP.intro, sent: true } }), { message: /^intro:/ }, 'request_intro sending went unnoticed');
});

// A privacy.html whose <main> says what the given markdown says, so a break in the markdown reaches the statement checks.
function mirrorOf(md, html) {
  const body = md.split('\n').map(line => line.replace(/^(#+|>|-) /, '')).join('\n').replace(/`/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return html.replace(/<main([^>]*)>[\s\S]*?<\/main>/, `<main$1>${body}</main>`);
}

test('Accept: text/markdown on /privacy is served privacy.md', () => {
  const res = middleware(new Request(`${SITE}/privacy`, { headers: { accept: 'text/markdown' } }));
  assert.equal(res?.headers.get('x-middleware-rewrite'), `${SITE}/privacy.md`);
  assert.equal(middleware(new Request(`${SITE}/privacy`, { headers: { accept: 'text/html' } })), undefined, 'a browser gets the page');
});
