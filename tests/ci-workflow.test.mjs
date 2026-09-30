// U5: the tests run on every change. Reads .github/workflows/test.yml and holds it to that.
// Run: node --test tests/*.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf-8');
const WORKFLOW = read('.github/workflows/test.yml');
const PKG = JSON.parse(read('package.json'));

// A reader for the YAML subset the workflow keeps to: block maps, block lists of maps, `[a, b]` lists, plain or
// quoted one-line scalars, `#` comments. Anything else throws, so the workflow cannot outgrow this test quietly.
function parse(text) {
  const lines = text.split('\n')
    .map(line => line.replace(/(^|\s)#.*$/, '').trimEnd())
    .filter(Boolean)
    .map(line => ({ indent: line.search(/\S/), text: line.trim() }));
  const outside = line => new Error(`reader: outside the YAML subset this test reads: ${line}`);
  const scalar = s => {
    if (/^\[[^\]]*\]$/.test(s)) return s.slice(1, -1).split(',').map(v => scalar(v.trim()));
    if (/^'[^']*'$|^"[^"]*"$/.test(s)) return s.slice(1, -1);
    if (/^[[\]{}|>&*!%@`'"]/.test(s)) throw outside(s);
    return s;
  };
  let i = 0;
  const block = indent => {
    const list = lines[i].text.startsWith('- ');
    const out = list ? [] : {};
    while (i < lines.length && lines[i].indent === indent && lines[i].text.startsWith('- ') === list) {
      if (list) {
        // `- key: value` opens a map two columns in, where the item's other keys sit.
        lines[i] = { indent: indent + 2, text: lines[i].text.slice(2) };
        out.push(block(indent + 2));
        continue;
      }
      const [, key, value] = lines[i].text.match(/^([\w-]+):(?: (.+))?$/) ?? [];
      if (!key || key in out) throw outside(lines[i].text);
      i++;
      if (value !== undefined) out[key] = scalar(value);
      else if (i < lines.length && lines[i].indent > indent) out[key] = block(lines[i].indent);
      else throw outside(`${key}: with no value`);
    }
    return out;
  };
  const doc = block(0);
  if (i < lines.length) throw outside(lines[i].text);
  return doc;
}

// Every property the slice asks of the workflow; each failure message starts with the property's name.
function check(text, pkg) {
  const wf = parse(text);
  assert.deepEqual(wf.on, { pull_request: { branches: ['main'] }, push: { branches: ['main'] } },
    'triggers: every pull request to main and every push to main, and nothing else');
  assert.deepEqual(wf.permissions, { contents: 'read' }, 'permissions: the token may read the repo and nothing more');
  const jobs = Object.values(wf.jobs ?? {});
  assert.ok(jobs.every(job => !('permissions' in job)), 'permissions: no job widens the token');
  const steps = jobs.flatMap(job => job.steps ?? []);
  const uses = steps.filter(step => step.uses).map(step => step.uses);
  const runs = steps.filter(step => step.run).map(step => step.run);
  assert.deepEqual(uses.map(u => u.split('@')[0]), ['actions/checkout', 'actions/setup-node', 'actions/setup-python'],
    'steps: check out the repo, set up Node and Python, and use no other action');
  assert.equal(uses.length + runs.length, steps.length, 'steps: every step is one action or one command');
  for (const u of uses) assert.match(u, /@(v\d+\.\d+\.\d+|[0-9a-f]{40})$/, `pinned: ${u} is not pinned to a release or a commit`);
  const withOf = name => steps.find(step => step.uses?.startsWith(`${name}@`)).with ?? {};
  assert.equal(withOf('actions/checkout')['persist-credentials'], 'false', 'credentials: the checkout keeps no token to write with');
  assert.equal(withOf('actions/setup-node')['node-version'], '22', 'node: Node 22, pinned as a major');
  assert.match(withOf('actions/setup-python')['python-version'] ?? '', /^3(\.\d+)?$/, 'python: Python 3');
  assert.match(runs[0] ?? '', /^python -m pip install jsonschema(==[\d.]+)?$/,
    'jsonschema: installed first, so the vendored ARD tester runs its strict schema pass');
  assert.equal(runs[1], 'npm ci',
    'deps: the site\'s packages are installed from the lockfile before the tests, as production has them');
  assert.ok(jobs.length === 1 && runs.length === 3 && ['node --test tests/*.test.mjs', 'npm test'].includes(runs[2]),
    `gate: node --test tests/*.test.mjs is the only gate, got ${JSON.stringify(runs.slice(2))} in ${jobs.length} job(s)`);
  assert.doesNotMatch(text, /\bsecrets\s*[.[]/, 'secrets: the workflow references no secret');
  assert.equal(pkg.scripts?.test, 'node --test tests/*.test.mjs', 'package: npm test runs node --test tests/*.test.mjs');
}

test('.github/workflows/test.yml runs node --test tests/*.test.mjs on every PR and push to main: Node 22, Python 3 with jsonschema, pinned actions, read-only, no secrets', () => {
  check(WORKFLOW, PKG);
});

test('each property check catches a deliberate break of it', () => {
  const BREAKS = [
    ['triggers', 'branches: [main]\n  push:', 'branches: [main, dev]\n  push:'],
    ['triggers', '  push:\n    branches: [main]\n', ''],
    ['permissions', 'contents: read', 'contents: write'],
    ['permissions', '    runs-on: ubuntu-latest\n', '    runs-on: ubuntu-latest\n    permissions: write-all\n'],
    ['steps', '      - uses: actions/checkout@v5.0.0\n        with:\n          persist-credentials: false\n', ''],
    ['steps', '      - run: node --test tests/*.test.mjs\n', '      - uses: amondnet/vercel-action@v25.2.0\n      - run: node --test tests/*.test.mjs\n'],
    ['pinned', 'actions/checkout@v5.0.0', 'actions/checkout@main'],
    ['pinned', 'actions/setup-node@v5.0.0', 'actions/setup-node@v5'],
    ['credentials', 'persist-credentials: false', 'persist-credentials: true'],
    ['node', 'node-version: 22', 'node-version: 20'],
    ['node', 'node-version: 22', 'node-version: 22.4.1'],
    ['python', "python-version: '3.12'", "python-version: '2.7'"],
    ['jsonschema', '      - run: python -m pip install jsonschema==4.23.0\n', ''],
    ['deps', '      - run: npm ci\n', ''],
    ['deps', '      - run: npm ci\n', '      - run: npm install\n'],
    ['gate', 'run: node --test tests/*.test.mjs', 'run: node --test tests/*.test.mjs || true'],
    ['gate', '      - run: node --test tests/*.test.mjs\n', '      - run: node --test tests/*.test.mjs\n      - run: npx vercel deploy --prod\n'],
    ['secrets', '      - run: node --test tests/*.test.mjs\n', '      - run: node --test tests/*.test.mjs\n        env:\n          TOKEN: ${{ secrets.VERCEL_TOKEN }}\n'],
    ['reader', '- run: node --test tests/*.test.mjs', '- run: |\n          node --test tests/*.test.mjs'],
  ];
  for (const [name, from, to] of BREAKS) {
    assert.ok(WORKFLOW.includes(from), `the ${name} break no longer applies: ${JSON.stringify(from)}`);
    assert.throws(() => check(WORKFLOW.replace(from, to), PKG), { message: new RegExp(`^${name}:`) },
      `breaking ${name} with ${JSON.stringify(to)} went unnoticed`);
  }
  assert.throws(() => check(WORKFLOW, { scripts: { test: 'node --test' } }), { message: /^package:/ });
});
