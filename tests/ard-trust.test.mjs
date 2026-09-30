// U6: findable by other agents (ARD), and the named-human credentials readable (/trust).
// Run: node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import handler, { TRUST } from '../api/mcp.mjs';
import { ARD, DID_DOCUMENT, trustHtml, trustMarkdown } from '../lib/trust.mjs';

const root = new URL('../', import.meta.url);
const path = file => fileURLToPath(new URL(file, root));
const read = file => readFileSync(new URL(file, root), 'utf-8');
const json = file => JSON.parse(read(file));
const P = json('provenance.json');
const SITE = 'https://universalagents.ai';
const DID = 'did:web:universalagents.ai';
// The public key the orchestrator generated on 2026-09-29, as pinned in the slice. Its private key is not in this repo.
const PINNED_JWK_FILE = join(homedir(), 'Deliverables/2026-09/mcp-trust/did-web-public-jwk.json');
const PINNED_JWK = { kty: 'OKP', crv: 'Ed25519', x: 'LdOi-0D-MxMrGfb7Lzlp-rd5wD4Ndiaplwuklh4I13k' };
const VENDOR = 'scripts/vendor/ard-conformance/';
const TESTER = path(`${VENDOR}conformance/bin/conformance-test`);

// Run a command and return its exit code and output; a non-zero exit is a result, not a throw.
async function run(file, args, options = {}) {
  try {
    const { stdout, stderr } = await promisify(execFile)(file, args, { cwd: path('.'), ...options });
    return { code: 0, stdout, stderr };
  } catch (e) {
    if (typeof e.code !== 'number') throw e;
    return { code: e.code, stdout: e.stdout, stderr: e.stderr };
  }
}

async function liveToolNames() {
  const res = { setHeader() {}, status() { return this; }, json(body) { this.body = body; return this; }, end() { return this; } };
  await handler({ method: 'POST', headers: {}, body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } }, res);
  return res.body.result.tools.map(tool => tool.name);
}

const people = ids => ids.map(id => ({ name: P.people[id].name, title: P.people[id].title }));

test('the ARD tester is vendored unchanged from ard-spec b76f235 (spec v0.91), with its Apache-2.0 LICENSE and the pinned commit', () => {
  const note = read(`${VENDOR}PINNED.md`);
  assert.match(note, /ards-project\/ard-spec/);
  assert.match(note, /\bb76f235a8f461876ad4f1e77abd0eb0eb302b48d\b/, 'the pinned commit');
  assert.match(note, /v0\.91/);
  assert.match(read(`${VENDOR}LICENSE`), /Apache License\s+Version 2\.0/);
  const pinned = [...note.matchAll(/^sha256 ([0-9a-f]{64}) (\S+)$/gm)];
  assert.deepEqual(pinned.map(([, , file]) => file).sort(), ['LICENSE', 'conformance/bin/conformance-test', 'spec/schemas/ard-entry.schema.json']);
  for (const [, hash, file] of pinned) {
    assert.equal(createHash('sha256').update(readFileSync(path(VENDOR + file))).digest('hex'), hash, `${file} differs from the pinned commit`);
  }
});

test('the vendored ARD tester validates .well-known/ard.json in manifest mode: exit 0, 0 critical errors, 0 warnings', async () => {
  assert.ok(existsSync(path('.well-known/ard.json')), '.well-known/ard.json is missing');
  const { code, stdout } = await run('python3', [TESTER, 'manifest', '.well-known/ard.json']);
  assert.equal(code, 0, `tester exit code ${code}:\n${stdout}`);
  // The tester exits 0 with warnings too, so the summary line is what proves there are none.
  assert.match(stdout, /Validated with 0 critical specification errors and 0 warnings\b/, stdout);
});

test('the manifest\'s entry for the MCP server: URN, type, card url, 2-5 queries, and the live tool names', async () => {
  const { entries } = json('.well-known/ard.json');
  const mcp = entries.filter(e => e.type === 'application/mcp-server-card+json');
  assert.equal(mcp.length, 1, 'one entry for the MCP server');
  const [entry] = mcp;
  assert.match(entry.identifier, /^urn:air:universalagents\.ai:/);
  assert.equal(entry.url, `${SITE}/.well-known/mcp/server-card.json`);
  assert.ok(Array.isArray(entry.representativeQueries) && entry.representativeQueries.length >= 2 && entry.representativeQueries.length <= 5,
    `2-5 representativeQueries, got ${entry.representativeQueries?.length}`);
  assert.deepEqual(entry.capabilities, await liveToolNames(), 'capabilities are the live tools/list names');
});

test('the entry\'s trustManifest: did:web on the URN\'s domain, the accountable person and the code authors from provenance.json, and nothing held', () => {
  const [{ identifier, trustManifest: trust }] = json('.well-known/ard.json').entries;
  assert.equal(trust.identity, DID, 'identity is the did:web DID');
  assert.equal(trust.identityType, 'did');
  // ARD §4.5.1: the identity's trust domain is the URN's publisher domain.
  assert.equal(trust.identity.replace(/^did:web:/, ''), identifier.split(':')[2], 'the DID\'s host is the URN\'s publisher domain');
  assert.ok(trust.statement.includes(`Identity: ${DID}. ${P.server.identity.statement}`), 'the statement says what did:web does and does not prove');
  assert.deepEqual(trust.accountable, { ...people([P.server.accountable])[0], contact: P.server.contact });
  assert.deepEqual(trust.codeAuthors, people(P.answers.code.authors));
  assert.deepEqual(trust.attestations, [], 'no attestation is held');
  assert.match(trust.statement, /^No attestation or signature is held\./);
  assert.equal(trust.documentationUrl, `${SITE}/trust`);
  // Nothing that implies a signature, a verification or a certification.
  for (const key of ['signature', 'trustSchema', 'verificationMethods', 'proof', 'jws']) {
    assert.ok(!JSON.stringify(trust).includes(`"${key}"`), `trustManifest carries "${key}"`);
  }
  assert.doesNotMatch(JSON.stringify(trust), /\b(verified|aligned|compliant|certified|accredited)\b/i);
});

test('node build.mjs writes ard.json, the card\'s trust block and /trust; each is stale-checked against its generator', () => {
  assert.deepEqual(json('.well-known/ard.json'), ARD, '.well-known/ard.json is stale: run node build.mjs');
  assert.deepEqual(json('.well-known/did.json'), DID_DOCUMENT, '.well-known/did.json is stale: run node build.mjs');
  assert.deepEqual(json('.well-known/mcp.json').trust, TRUST, 'the card\'s trust block is stale: run node build.mjs');
  assert.equal(read('trust.md'), trustMarkdown(), 'trust.md is stale: run node build.mjs');
  assert.ok(read('trust.html').includes(trustHtml()), 'trust.html is stale: run node build.mjs');
  const build = read('build.mjs');
  for (const out of ['.well-known/ard.json', '.well-known/did.json', 'trust.md', '.well-known/mcp.json']) assert.ok(build.includes(`'${out}'`), `build.mjs does not write ${out}`);
});

test('/.well-known/mcp/server-card.json serves the same JSON as /.well-known/mcp.json', () => {
  const vercel = json('vercel.json');
  assert.ok(vercel.rewrites.some(r => r.source === '/.well-known/mcp/server-card.json' && r.destination === '/.well-known/mcp.json'), 'no rewrite to the card');
  // A file at the second path would be served before the rewrite, and could drift.
  assert.ok(!existsSync(path('.well-known/mcp/server-card.json')), 'a separate file shadows the rewrite');
  const headers = source => vercel.headers.find(h => h.source === source)?.headers;
  assert.deepEqual(headers('/.well-known/mcp/server-card.json'), headers('/.well-known/mcp.json'), 'same headers as the card');
  assert.ok(headers('/.well-known/ard.json')?.some(h => h.key === 'Content-Type' && /^application\/json/.test(h.value)), 'ard.json is served as JSON');
});

test('every built HTML page carries <link rel="ard" href="/.well-known/ard.json">', () => {
  const pages = readdirSync(path('src/pages')).filter(f => f.endsWith('.html'));
  assert.ok(pages.includes('trust.html'), '/trust is built from src/pages like the other pages');
  const built = readdirSync(path('.')).filter(f => f.endsWith('.html'));
  assert.deepEqual(built.sort(), pages.sort(), 'every built page has a source, and every source is built');
  for (const page of built) {
    const head = read(page).split('</head>')[0];
    assert.ok(head.includes('<link rel="ard" href="/.well-known/ard.json">'), `${page} has no rel="ard" link in its head`);
  }
});

test('/trust explains, from provenance.json, who stands behind the server and each answer type, the fields and levels, and what is held', () => {
  for (const [label, text] of [['trust.html', read('trust.html')], ['trust.md', read('trust.md')]]) {
    const has = (s, what) => assert.ok(text.includes(s), `${label}: missing ${what}: ${s}`);
    has(P.server.operator.name, 'the operator');
    has(P.server.contact, 'the contact');
    for (const who of Object.values(P.people)) { has(who.name, 'a person'); has(who.title, 'a title'); has(who.role, 'a role'); }
    for (const [type, a] of Object.entries(P.answers)) {
      has(a.what, `what ${type} covers`);
      has(`Authors: ${people(a.authors).map(p => `${p.name} (${p.title})`).join(', ')}`, `${type} authors`);
      has(`Accountable: ${people([a.accountable]).map(p => `${p.name} (${p.title})`)}`, `${type} accountable`);
      if (a.source) has(a.source, `${type} source`);
      has(`level ${a.agent_may.level}, ${a.agent_may.label}`, `${type} level`);
    }
    has('provenance_schema', 'the field set version');
    has(TRUST.fields.provenance, 'what provenance means');
    has(TRUST.fields.agent_may, 'what agent_may means');
    for (const [n, level] of Object.entries(P.delegation_map.levels)) has(`${n} ${level.label}: ${level.means}`, 'a Delegation-Map level');
    has(P.server.auth, 'auth');
    has(P.server.attestations.statement, 'attestations');
    has(P.server.signed, 'signatures');
    has(P.server.data_reach.stores, 'what is stored');
    has(`${SITE}/.well-known/ard.json`, 'the ARD manifest');
    has(DID, 'the DID');
    has(`${SITE}/.well-known/did.json`, 'where the DID document is');
    has(P.server.identity.statement, 'what did:web does and does not prove');
  }
  // Every level an answer uses is explained, and the scale runs Tell to Hands Off.
  for (const a of Object.values(P.answers)) assert.equal(P.delegation_map.levels[a.agent_may.level]?.label, a.agent_may.label);
  assert.equal(P.delegation_map.levels[1].label, 'Tell');
  assert.equal(P.delegation_map.levels[7].label, 'Hands Off');
  // Served at /trust, with the markdown mirror on Accept: text/markdown, and linked from the card.
  assert.ok(json('vercel.json').rewrites.some(r => r.source === '/trust' && r.destination === '/trust.html'));
  assert.match(read('middleware.js'), /'\/trust': '\/trust\.md'/);
  assert.equal(json('.well-known/mcp.json').trust.page, `${SITE}/trust`);
});

test('the server card documents provenance and agent_may as a versioned field set (provenance_schema: 1)', () => {
  const { trust } = json('.well-known/mcp.json');
  assert.equal(trust.provenance_schema, 1);
  assert.match(trust.fields?.provenance ?? '', /answer_type.*authors.*accountable.*source/s);
  assert.match(trust.fields?.agent_may ?? '', /level, label and note/);
  assert.deepEqual(trust.fields.levels, P.delegation_map.levels);
});

test('no name is typed anywhere but provenance.json: every other file that carries one is generated from it', () => {
  // The generated files are stale-checked above, so a name in them came from provenance.json.
  const GENERATED = ['.well-known/mcp.json', '.well-known/ard.json', 'trust.html', 'trust.md'];
  const SKIP = new Set(['node_modules', '.git', '.vercel', 'assets', 'tests', 'provenance.json', 'LAP-HANDOVER.md', '.lap-prompt.md', ...GENERATED]);
  const files = [];
  const walk = dir => readdirSync(path(dir || '.')).forEach(name => {
    const file = dir + name;
    if (SKIP.has(file)) return;
    if (statSync(path(file)).isDirectory()) walk(`${file}/`);
    else files.push(file);
  });
  walk('');
  assert.ok(files.includes('lib/trust.mjs') && files.includes('src/pages/trust.html') && files.includes('build.mjs'));
  for (const file of files) {
    const text = read(file);
    for (const who of Object.values(P.people)) assert.ok(!text.includes(who.name), `${file} names ${who.name}`);
  }
  for (const file of GENERATED) assert.ok(Object.values(P.people).some(who => read(file).includes(who.name)), `${file} names no one`);
});

test('/.well-known/did.json is the W3C DID document for did:web:universalagents.ai, carrying the pinned public key', () => {
  const doc = json('.well-known/did.json');
  assert.ok(doc['@context'].includes('https://www.w3.org/ns/did/v1'), 'the DID v1 context');
  assert.equal(doc.id, DID);
  assert.equal(new URL(SITE).hostname, DID.replace(/^did:web:/, ''), 'did:web resolves to this site\'s /.well-known/did.json');
  assert.deepEqual(doc.verificationMethod.map(m => [m.id, m.type, m.controller]), [[`${DID}#key-1`, 'JsonWebKey2020', DID]], 'one verification method');
  assert.deepEqual(doc.verificationMethod[0].publicKeyJwk, PINNED_JWK, 'publicKeyJwk is the pinned key, nothing more');
  if (existsSync(PINNED_JWK_FILE)) assert.deepEqual(JSON.parse(readFileSync(PINNED_JWK_FILE, 'utf-8')), PINNED_JWK, `${PINNED_JWK_FILE} differs from the key pinned here`);
  assert.deepEqual(doc.authentication, [`${DID}#key-1`]);
  assert.deepEqual(doc.assertionMethod, [`${DID}#key-1`]);
  assert.deepEqual(json('.well-known/mcp.json').trust.identity, { did: DID, document: `${SITE}/.well-known/did.json`, statement: P.server.identity.statement }, 'the card names the DID');
  const headers = json('vercel.json').headers.find(h => h.source === '/.well-known/did.json')?.headers;
  assert.ok(headers?.some(h => h.key === 'Content-Type' && /^application\/json/.test(h.value)), 'did.json is served as JSON');
});

test('no private key material: no JSON in the repo has a "d" member', () => {
  const found = [];
  const members = (value, at) => {
    if (Array.isArray(value)) value.forEach((v, i) => members(v, `${at}[${i}]`));
    else if (value && typeof value === 'object') for (const [key, v] of Object.entries(value)) {
      if (key === 'd') found.push(at);
      members(v, `${at}.${key}`);
    }
  };
  const files = [];
  const walk = dir => readdirSync(path(dir || '.')).forEach(name => {
    const file = dir + name;
    if (['node_modules', '.git', '.vercel'].includes(file)) return;
    if (statSync(path(file)).isDirectory()) walk(`${file}/`);
    else if (file.endsWith('.json')) files.push(file);
  });
  walk('');
  assert.ok(files.includes('.well-known/did.json') && files.includes('provenance.json'));
  for (const file of files) members(json(file), file);
  assert.deepEqual(found, [], 'a "d" member is a private key');
});

test('the identity wording says what did:web proves and what it does not, and never claims a signature', () => {
  const { statement } = P.server.identity;
  assert.match(statement, /ties this identity to control of the domain/);
  assert.match(statement, /nothing is signed with its key yet/);
  assert.match(P.server.signed, /^Nothing is signed: not the server card, the ARD manifest or the replies\./);
  for (const text of [statement, P.server.signed, ARD.entries[0].trustManifest.statement]) {
    assert.doesNotMatch(text, /\b(verified|certified)\b/i);
    assert.doesNotMatch(text.replace(/\b[Nn]othing is signed\b/g, ''), /\bsigned\b/i, 'signed appears only as "nothing is signed"');
  }
});

test('sitemap.xml lists /trust', () => {
  assert.ok(read('sitemap.xml').includes(`<loc>${SITE}/trust</loc>`));
});

// Check 12, run against a local server so neither the network nor the live site decides the result.
// `did` is the body served at /.well-known/did.json: null is a 404, 'drop' closes the connection unanswered.
async function check12(body, tester, did = read('.well-known/did.json')) {
  const server = createServer((req, res) => {
    if (req.url === '/.well-known/ard.json' && body) res.writeHead(200, { 'Content-Type': 'application/json' }).end(body);
    else if (req.url === '/.well-known/did.json' && did === 'drop') req.socket.destroy();
    else if (req.url === '/.well-known/did.json' && did) res.writeHead(200, { 'Content-Type': 'application/json' }).end(did);
    else res.writeHead(404).end();
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const script = [
    'import importlib.util, json, sys',
    `spec = importlib.util.spec_from_file_location("agent_check", ${JSON.stringify(path('scripts/agent-check.py'))})`,
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    'args = [sys.argv[1]] + ([sys.argv[2]] if len(sys.argv) > 2 else [])',
    'print(json.dumps(m.ard_check(*args)))',
  ].join('\n');
  try {
    const { code, stdout, stderr } = await run('python3', ['-c', script, base, ...(tester ? [tester] : [])], { env: { ...process.env, NO_PROXY: '*', no_proxy: '*' } });
    assert.equal(code, 0, stderr);
    return JSON.parse(stdout);
  } finally {
    server.close();
  }
}

test('agent-check check 12 also fetches /.well-known/did.json: its id must be the manifest\'s identity, and no answer is couldnt-check', async () => {
  const [ok, okDetail] = await check12(read('.well-known/ard.json'));
  assert.equal(ok, 'pass', okDetail);
  assert.match(okDetail, /did\.json: id did:web:universalagents\.ai is the manifest's identity/);
  const other = JSON.stringify({ ...DID_DOCUMENT, id: 'did:web:example.com' });
  assert.equal((await check12(read('.well-known/ard.json'), undefined, other))[0], 'fail', 'a DID document for another id fails');
  const plain = JSON.stringify({ entries: [{ ...ARD.entries[0], trustManifest: { ...ARD.entries[0].trustManifest, identity: 'universalagents.ai' } }] });
  assert.equal((await check12(plain))[0], 'fail', 'a manifest identity that is not the DID fails');
  assert.equal((await check12(read('.well-known/ard.json'), undefined, null))[0], 'fail', 'no DID document fails');
  assert.equal((await check12(read('.well-known/ard.json'), undefined, 'not json'))[0], 'fail', 'a DID document that is not JSON fails');
  const [dropped, droppedDetail] = await check12(read('.well-known/ard.json'), undefined, 'drop');
  assert.equal(dropped, 'couldnt-check', droppedDetail);
});

test('agent-check check 12 fetches /.well-known/ard.json and runs the vendored tester: pass, fail, and couldnt-check (never pass) without the tester or the network', async () => {
  assert.match(read('scripts/agent-check.py'), /record\("12 ARD manifest", verdict, detail\)/, 'check 12 is part of the run');
  assert.ok(read('scripts/agent-check.py').includes('"vendor", "ard-conformance", "conformance", "bin", "conformance-test"'), 'check 12 runs the vendored tester');

  const [ok, okDetail] = await check12(read('.well-known/ard.json'));
  assert.equal(ok, 'pass', okDetail);
  const broken = JSON.stringify({ entries: [{ ...ARD.entries[0], identifier: 'not-a-urn' }] });
  assert.equal((await check12(broken))[0], 'fail', 'a manifest with errors fails');
  const quiet = JSON.stringify({ entries: [{ ...ARD.entries[0], representativeQueries: undefined }] });
  assert.equal((await check12(quiet))[0], 'fail', 'a manifest with warnings fails');
  assert.equal((await check12(null))[0], 'fail', 'no manifest fails');

  const [noTester, noTesterDetail] = await check12(read('.well-known/ard.json'), path('scripts/vendor/missing-tester'));
  assert.equal(noTester, 'couldnt-check', noTesterDetail);
  const { code, stdout } = await run('python3', ['-c', [
    'import importlib.util, json',
    `spec = importlib.util.spec_from_file_location("agent_check", ${JSON.stringify(path('scripts/agent-check.py'))})`,
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    'print(json.dumps(m.ard_check("http://127.0.0.1:9/")))',
  ].join('\n')], { env: { ...process.env, NO_PROXY: '*', no_proxy: '*' } });
  assert.equal(code, 0);
  assert.equal(JSON.parse(stdout)[0], 'couldnt-check', 'no network is couldnt-check');
});
