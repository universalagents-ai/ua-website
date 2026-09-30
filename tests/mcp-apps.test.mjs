// U7: the pricing and intro answers render as MCP Apps views, called in-process against api/mcp.mjs.
// The pinned standard: MCP Apps, specification/2026-01-26/apps.mdx, ext-apps v2.0.3 (82221c0).
// Run: node --test tests/*.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import vm from 'node:vm';
import handler from '../api/mcp.mjs';

const root = new URL('../', import.meta.url);
const read = file => readFileSync(new URL(file, root), 'utf-8');
const P = JSON.parse(read('provenance.json'));

const EXTENSION = 'io.modelcontextprotocol/ui';
const MIME = 'text/html;profile=mcp-app';
const PROTOCOL = '2026-01-26';
const VERSION = '1.4.0';
// The tools that carry a view, with the arguments an agent would pass. The markup in a name must stay text.
const APPS = {
  get_pricing: {},
  request_intro: { name: 'Sam <b>Example</b>', agency: 'Example & Co', size: '40', goal: 'Faster pitches' },
};
const TEXT_ONLY = { about_universal_agents: {}, answer_faq: {} };
// What a view may send to the host: the handshake, its size, and the open-link hand-off. Never a tool call or a message.
const VIEW_SENDS = new Set(['ui/initialize', 'ui/notifications/initialized', 'ui/notifications/size-changed', 'ui/open-link']);

async function rpc(method, params, headers = {}) {
  const res = { headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status() { return this; }, json(body) { this.body = body; return this; }, end() { return this; } };
  const log = console.log;
  console.log = () => {};
  try {
    await handler({ method: 'POST', headers, body: { jsonrpc: '2.0', id: 1, method, params } }, res);
  } finally {
    console.log = log;
  }
  return { reply: res.body, headers: res.headers };
}

// Everything the checks read: what a host that supports MCP Apps would fetch, and every tool's reply.
async function served() {
  const hello = (capabilities, name) => rpc('initialize', { protocolVersion: '2025-11-25', capabilities, clientInfo: { name, version: '0' } });
  const withUi = await hello({ extensions: { [EXTENSION]: { mimeTypes: [MIME] } } }, 'ui-host');
  const plain = await hello({}, 'text-only-client');
  const resources = (await rpc('resources/list')).reply.result.resources;
  const reads = {};
  for (const { uri } of resources) reads[uri] = (await rpc('resources/read', { uri })).reply.result;
  const calls = {};
  for (const [client, init] of [['ui', withUi], ['plain', plain]]) {
    const session = { 'mcp-session-id': init.headers['mcp-session-id'] };
    calls[client] = {};
    for (const [name, args] of Object.entries({ ...APPS, ...TEXT_ONLY })) calls[client][name] = (await rpc('tools/call', { name, arguments: args }, session)).reply.result;
  }
  return {
    init: withUi.reply.result,
    tools: (await rpc('tools/list')).reply.result.tools,
    resources, reads, calls,
    missing: (await rpc('resources/read', { uri: 'ui://universal-agents/missing' })).reply,
    serverJson: JSON.parse(read('server.json')),
  };
}

const viewOf = (s, name) => s.reads[s.tools.find(t => t.name === name)._meta.ui.resourceUri].contents[0].text;

// A DOM just big enough for the view: elements, attributes, text, click listeners. Strings stay text, as textContent does.
class Node {
  constructor(tag) { this.tag = tag; this.attrs = {}; this.children = []; this.listeners = {}; this.style = { setProperty(k, v) { this[k] = v; } }; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  append(...nodes) { this.children.push(...nodes.map(n => (n instanceof Node ? n : String(n)))); }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  getBoundingClientRect() { return { width: 400, height: 180 }; }
  get textContent() { return this.children.map(c => (typeof c === 'string' ? c : c.textContent)).join(''); }
  all(pick, out = []) {
    for (const c of this.children) if (c instanceof Node) { if (pick(c)) out.push(c); c.all(pick, out); }
    return out;
  }
  byClass(name) { return this.all(n => (n.attrs.class || '').split(' ').includes(name)); }
  click() {
    const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    (this.listeners.click || []).forEach(fn => fn(event));
    return event;
  }
}

const settle = () => new Promise(resolve => setImmediate(resolve));
const HOST_CONTEXT = { theme: 'dark', styles: { variables: { '--color-text-primary': 'light-dark(#171717, #fafafa)' } }, displayMode: 'inline' };

// Load a view's HTML into a sandbox whose parent is a test host: every postMessage the view makes is kept.
function mount(html) {
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1, 'one inline script');
  assert.equal(scripts[0][1], '', 'the script is inline, with no attributes');
  assert.ok(html.includes('<main class="card" id="card"'), 'the card element the script renders into');
  const documentElement = new Node('html');
  for (const [, k, v] of html.match(/<html([^>]*)>/)[1].matchAll(/([\w-]+)="([^"]*)"/g)) documentElement.setAttribute(k, v);
  const body = new Node('body');
  const card = new Node('main');
  body.append(card);
  const sent = [];
  const parent = { postMessage(message, target) { sent.push({ ...JSON.parse(JSON.stringify(message)), target }); } };
  const listeners = [];
  const window = { parent, innerWidth: 400, addEventListener(type, fn) { if (type === 'message') listeners.push(fn); } };
  const document = { documentElement, body, getElementById: id => (id === 'card' ? card : null), createElement: tag => new Node(tag) };
  vm.runInNewContext(scripts[0][2], { window, document });
  const deliver = (data, source = parent) => listeners.forEach(fn => fn({ source, data: JSON.parse(JSON.stringify(data)) }));
  return { sent, deliver, card, root: documentElement };
}

// Mount, answer ui/initialize as a host would, then send the tool's input and result.
async function open(html, result, { openLinks = true } = {}) {
  const v = mount(html);
  v.deliver({ jsonrpc: '2.0', id: v.sent[0]?.id, result: {
    protocolVersion: PROTOCOL, hostCapabilities: openLinks ? { openLinks: {} } : {}, hostInfo: { name: 'test-host', version: '0' }, hostContext: HOST_CONTEXT,
  } });
  await settle();
  v.deliver({ jsonrpc: '2.0', method: 'ui/notifications/tool-input', params: { arguments: {} } });
  v.deliver({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: result });
  await settle();
  return v;
}

const one = (v, name) => {
  const found = v.card.byClass(name);
  assert.equal(found.length, 1, `one .${name}`);
  return found[0];
};
const person = x => `${x.name} (${x.title})`;

// The network: no URL and nothing that fetches, loads or navigates. The only way out is the result's mailto.
const NETWORK = [
  /\b(https?|wss?|ftp):/i, /\/\/[\w.-]+\.[a-z]{2,}/i,
  /<\w[^>]*\s(src|srcset|href|action|formaction|poster|background)\s*=/i, /setAttribute\(\s*'(src|srcset|action|formaction|poster|background)'/,
  /<(link|img|iframe|frame|object|embed|form|video|audio|source|base|meta\s+http-equiv)\b/i,
  /@import\b/i, /\burl\s*\(/i, /\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /EventSource/, /sendBeacon/,
  /\bimport\s*\(/, /\bnew\s+(Image|Worker|SharedWorker)\b/, /\bwindow\.open\b/, /\blocation\b/, /navigator\./,
];
// Answer text is data: the view only ever sets text, never markup.
const MARKUP = /innerHTML|outerHTML|insertAdjacentHTML|document\.write|createContextualFragment|\beval\s*\(|new\s+Function\b/;

const CHECKS = {
  async extension(s) {
    assert.deepEqual(s.init.capabilities.extensions, { [EXTENSION]: { mimeTypes: [MIME] } }, 'initialize declares the MCP Apps extension');
    assert.ok(s.init.capabilities.resources, 'initialize declares resources');
  },

  async linked(s) {
    for (const tool of s.tools) {
      if (!(tool.name in APPS)) {
        assert.equal(tool._meta?.ui, undefined, `${tool.name} stays text-only`);
        continue;
      }
      const uri = tool._meta?.ui?.resourceUri;
      assert.match(uri ?? '', /^ui:\/\/[^/]+\/\w/, `${tool.name}: _meta.ui.resourceUri is a ui:// resource`);
      assert.equal(tool._meta['ui/resourceUri'], uri, `${tool.name}: the deprecated flat key, as registerAppTool sets it`);
      assert.ok(!tool._meta.ui.visibility || tool._meta.ui.visibility.includes('model'), `${tool.name} stays visible to the model`);
    }
    const uris = Object.keys(APPS).map(name => s.tools.find(t => t.name === name)._meta.ui.resourceUri);
    assert.equal(new Set(uris).size, uris.length, 'each tool has its own view');
  },

  async listed(s) {
    const linked = s.tools.map(t => t._meta?.ui?.resourceUri).filter(Boolean).sort();
    assert.deepEqual(s.resources.map(r => r.uri).sort(), linked, 'resources/list lists exactly the views the tools name');
    for (const r of s.resources) {
      assert.equal(r.mimeType, MIME, `${r.uri}: mimeType`);
      assert.ok(r.name && !('text' in r), `${r.uri}: a name, and no content in the listing`);
    }
  },

  async read(s) {
    for (const r of s.resources) {
      const { contents } = s.reads[r.uri];
      assert.equal(contents.length, 1, `${r.uri}: one content item`);
      assert.equal(contents[0].uri, r.uri, `${r.uri}: the content's uri`);
      assert.equal(contents[0].mimeType, MIME, `${r.uri}: read as ${MIME}`);
      assert.match(contents[0].text, /^<!doctype html>\n<html lang="en" data-view="\w+" data-version="[\d.]+">[\s\S]*<\/html>\n$/, `${r.uri}: an HTML5 document`);
    }
    assert.equal(s.missing.error?.code, -32002, 'an unknown ui:// resource is an error, not an empty read');
  },

  async offline(s) {
    for (const r of s.resources) {
      const [content] = s.reads[r.uri].contents;
      for (const [where, meta] of [['listing', r._meta], ['read', content._meta]]) {
        assert.equal(meta?.ui?.csp, undefined, `${r.uri} ${where}: no CSP domain is declared, so the host's default allows no connection`);
        assert.equal(meta?.ui?.domain, undefined, `${r.uri} ${where}: no dedicated origin`);
      }
      for (const pattern of NETWORK) assert.doesNotMatch(content.text, pattern, `${r.uri}: a network request or navigation`);
      assert.doesNotMatch(content.text, MARKUP, `${r.uri}: markup built from data`);
    }
  },

  async renders(s) {
    const names = Object.values(P.people).map(p => p.name);
    for (const [name] of Object.entries(APPS)) {
      const html = viewOf(s, name);
      for (const typed of [...names, P.server.contact, ...P.ua_brain.paths]) assert.ok(!html.includes(typed), `${name}: the view types ${typed}`);
      assert.doesNotMatch(html, /\$\d/, `${name}: the view types a price`);

      const data = s.calls.ui[name].structuredContent;
      const v = await open(html, s.calls.ui[name]);
      const [init, initialized, size] = v.sent;
      assert.deepEqual({ ...init, id: typeof init.id }, {
        jsonrpc: '2.0', id: 'number', method: 'ui/initialize', target: '*',
        params: { appCapabilities: { availableDisplayModes: ['inline'] }, appInfo: { name: `universal-agents-${v.root.attrs['data-view']}`, version: s.init.serverInfo.version }, protocolVersion: PROTOCOL },
      }, `${name}: ui/initialize, in the spec's shape`);
      assert.deepEqual(initialized, { jsonrpc: '2.0', method: 'ui/notifications/initialized', target: '*' }, `${name}: then ui/notifications/initialized`);
      assert.equal(size?.method, 'ui/notifications/size-changed', `${name}: then its size`);
      assert.ok(Number.isInteger(size.params.width) && Number.isInteger(size.params.height), `${name}: size in pixels`);
      assert.equal(v.root.attrs['data-theme'], 'dark', `${name}: follows the host's theme`);
      assert.equal(v.root.style['--color-text-primary'], HOST_CONTEXT.styles.variables['--color-text-primary'], `${name}: takes the host's style variables`);

      const footer = one(v, 'card__who').textContent;
      const p = data.provenance;
      for (const part of ['Who stands behind this answer', ...p.authors.map(person), person(p.accountable), p.accountable.contact,
        p.source ? `${p.source.repo}, ${p.source.path}, effective ${p.effective}` : 'the server\'s own code',
        `level ${data.agent_may.level}, ${data.agent_may.label}. ${data.agent_may.note}`]) {
        assert.ok(footer.includes(part), `${name}: the who-stands-behind line lacks ${JSON.stringify(part)}`);
      }

      // Requests from the host are answered with their id; a message from any other window is ignored.
      const before = v.sent.length;
      v.deliver({ jsonrpc: '2.0', id: 'p', method: 'ping' });
      v.deliver({ jsonrpc: '2.0', id: 't', method: 'ui/resource-teardown', params: { reason: 'test' } });
      v.deliver({ jsonrpc: '2.0', id: 'u', method: 'ui/unknown' });
      v.deliver({ jsonrpc: '2.0', id: 'x', method: 'ping' }, { postMessage() {} });
      assert.deepEqual(v.sent.slice(before).map(m => [m.id, m.result ?? m.error.code]), [['p', {}], ['t', {}], ['u', -32601]], `${name}: answers the host, and only the host`);
      for (const m of v.sent) assert.ok(!m.method || VIEW_SENDS.has(m.method), `${name}: the view sent ${m.method}`);
    }
  },

  async pricing(s) {
    const result = s.calls.ui.get_pricing;
    const v = await open(viewOf(s, 'get_pricing'), result);
    assert.equal(one(v, 'card__answer').textContent, result.structuredContent.pricing, 'the price text exactly as get_pricing returns it');
  },

  async intro(s) {
    const result = s.calls.ui.request_intro;
    const data = result.structuredContent;
    assert.ok(data.mailto.startsWith(`mailto:${P.server.contact}?`), 'the draft is addressed to the contact');
    const v = await open(viewOf(s, 'request_intro'), result);
    assert.equal(one(v, 'card__answer').textContent, data.body, 'the draft body');
    const text = v.card.textContent;
    for (const part of [data.to, data.subject]) assert.ok(text.includes(part), `the card shows ${part}`);
    assert.match(text, /nothing has been sent/, 'the card says nothing has been sent');
    const action = one(v, 'card__action');
    assert.deepEqual(v.card.all(n => 'href' in n.attrs).map(n => n.attrs.href), [data.mailto], 'the one link is the draft\'s mailto');

    // With openLinks, the click asks the host to open the mailto link; the view sends nothing else.
    const before = v.sent.length;
    assert.ok(action.click().defaultPrevented, 'the host opens it, not the iframe');
    assert.deepEqual(v.sent.slice(before).map(({ method, params }) => ({ method, params })), [{ method: 'ui/open-link', params: { url: data.mailto } }], 'ui/open-link with the mailto');
    for (const m of v.sent) assert.ok(!m.method || VIEW_SENDS.has(m.method), `the view sent ${m.method}`);

    // Without it, the link itself is the hand-off.
    const bare = await open(viewOf(s, 'request_intro'), result, { openLinks: false });
    const count = bare.sent.length;
    assert.ok(!one(bare, 'card__action').click().defaultPrevented, 'without openLinks, the mailto link is followed');
    assert.equal(bare.sent.length, count, 'and the view sends nothing');
  },

  async unchanged(s) {
    for (const [name, result] of Object.entries(s.calls.ui)) {
      assert.deepEqual(Object.keys(result).sort(), ['content', 'isError', 'structuredContent'], `${name}: no _meta or view on the reply`);
      assert.deepEqual(result.content, [{ type: 'text', text: JSON.stringify(result.structuredContent) }], `${name}: the text fallback is the same JSON`);
      assert.deepEqual(s.calls.plain[name], result, `${name}: a text-only client gets the same reply`);
    }
  },

  async version(s) {
    assert.equal(s.init.serverInfo.version, VERSION, 'api/mcp.mjs serverInfo.version');
    assert.equal(s.serverJson.version, VERSION, 'server.json version');
  },
};

test('get_pricing and request_intro render as MCP Apps views, per the pinned spec, and text-only clients see no difference', async () => {
  const s = await served();
  for (const [name, check] of Object.entries(CHECKS)) {
    await check(s).catch(e => { e.message = `${name}: ${e.message}`; throw e; });
  }
});

// Each check is shown to fail on a deliberate break of what it guards.
const edit = (s, change) => { for (const r of Object.values(s.reads)) r.contents[0].text = change(r.contents[0].text); };
const replace = (from, to) => s => edit(s, html => {
  assert.ok(html.includes(from), `the break no longer applies: ${from}`);
  return html.replace(from, to);
});
const BREAKS = [
  ['extension', s => { delete s.init.capabilities.extensions; }],
  ['extension', s => { s.init.capabilities.extensions[EXTENSION].mimeTypes = ['text/html']; }],
  ['linked', s => { delete s.tools.find(t => t.name === 'get_pricing')._meta; }],
  ['linked', s => { s.tools.find(t => t.name === 'request_intro')._meta.ui.resourceUri = 'https://universalagents.ai/card'; }],
  ['linked', s => { s.tools.find(t => t.name === 'answer_faq')._meta = { ui: { resourceUri: 'ui://universal-agents/faq' } }; }],
  ['listed', s => { s.resources.push({ uri: 'ui://universal-agents/extra', name: 'extra', mimeType: MIME }); }],
  ['listed', s => { s.resources[0].mimeType = 'text/html'; }],
  ['read', s => { Object.values(s.reads)[0].contents[0].mimeType = 'text/html'; }],
  ['read', s => { s.missing = { result: { contents: [] } }; }],
  ['offline', s => { Object.values(s.reads)[0].contents[0]._meta = { ui: { csp: { connectDomains: ['https://api.example.com'] } } }; }],
  ['offline', replace('<main class="card"', '<img alt="" src="https://example.com/pixel.gif"><main class="card"')],
  ['offline', replace('function render(data) {', 'function render(data) { fetch(\'/log\');')],
  ['offline', replace('--ua-mint: #3FFF8C;', '--ua-mint: #3FFF8C; background-image: url(/x.png);')],
  ['offline', replace('el(\'p\', \'card__answer\', data.pricing)', 'Object.assign(el(\'p\', \'card__answer\'), { innerHTML: data.pricing })')],
  ['renders', replace('<title>Universal Agents</title>', `<title>${Object.values(P.people)[0].name}</title>`)],
  ['renders', replace(', who(data));', ');')],
  ['renders', replace('`An agent may: level ${may.level}, ${may.label}. ${may.note}`', '`An agent may: level ${may.level}.`')],
  ['renders', replace('protocolVersion: \'2026-01-26\'', 'protocolVersion: \'2025-06-18\'')],
  ['renders', replace('send({ method: \'ui/notifications/initialized\' });', '')],
  ['renders', replace('root.setAttribute(\'data-theme\', context.theme);', '')],
  ['renders', replace('if (event.source !== host ||', 'if (')],
  ['pricing', replace('el(\'p\', \'card__answer\', data.pricing)', 'el(\'p\', \'card__answer\', data.pricing.split(\'\\n\\n\')[0])')],
  ['intro', replace('action.setAttribute(\'href\', data.mailto);', 'action.setAttribute(\'href\', \'mailto:someone@example.com\');')],
  ['intro', replace('request(\'ui/open-link\', { url: data.mailto })', 'request(\'ui/message\', { role: \'user\', content: { type: \'text\', text: data.body } })')],
  ['intro', replace('if (!hostCapabilities.openLinks) return;', '')],
  ['unchanged', s => { s.calls.ui.get_pricing._meta = { ui: { resourceUri: 'ui://universal-agents/pricing' } }; }],
  ['unchanged', s => { s.calls.ui.request_intro.content[0].text = 'Drafted.'; }],
  ['version', s => { s.init.serverInfo.version = '1.3.0'; }],
  ['version', s => { s.serverJson.version = '1.3.0'; }],
];

test('each check catches a deliberate break of what it guards', async () => {
  const s = await served();
  assert.deepEqual(new Set(BREAKS.map(([name]) => name)), new Set(Object.keys(CHECKS)), 'every check has a break');
  for (const [name, breakIt] of BREAKS) {
    const broken = structuredClone(s);
    breakIt(broken);
    await assert.rejects(CHECKS[name](broken), assert.AssertionError, `a break of ${name} went unnoticed: ${breakIt}`);
  }
});

// agent-check check 11, run against the server in-process behind a local port, reads and scans the views too.
async function liveScan(tamper = body => body) {
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', async () => {
      const out = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, end() { return this; } };
      const log = console.log;
      console.log = () => {};
      try { await handler({ method: 'POST', headers: { 'mcp-session-id': req.headers['mcp-session-id'] }, body: raw }, out); } finally { console.log = log; }
      res.writeHead(out.code || 200, { 'Content-Type': 'application/json', ...out.headers });
      res.end(out.body === undefined ? '' : JSON.stringify(tamper(out.body)));
    });
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const script = [
    'import importlib.util, json, sys',
    `spec = importlib.util.spec_from_file_location("agent_check", ${JSON.stringify(fileURLToPath(new URL('scripts/agent-check.py', root)))})`,
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    'print(json.dumps(m.mcp_scan(sys.argv[1])))',
  ].join('\n');
  try {
    const { stdout } = await promisify(execFile)('python3', ['-c', script, `http://127.0.0.1:${server.address().port}/mcp`], { env: { ...process.env, NO_PROXY: '*', no_proxy: '*' } });
    return JSON.parse(stdout);
  } finally {
    server.close();
  }
}

test('agent-check check 11 (the U1 scan) also reads and scans every view a tool names', async () => {
  const [ok, detail] = await liveScan();
  assert.equal(ok, 'pass', detail);
  assert.match(detail, /\b2 views scanned\b/);
  const hidden = body => {
    const text = body?.result?.contents?.[0]?.text;
    return text ? { ...body, result: { contents: [{ ...body.result.contents[0], text: text.replace('Pricing', 'Pricing​') }] } } : body;
  };
  const [bad, badDetail] = await liveScan(hidden);
  assert.equal(bad, 'fail', 'a zero-width space in a view fails the scan');
  assert.match(badDetail, /ui:\/\/universal-agents\/\w+\.contents\[0\]\.text: invisible U\+200B/);
  const [gone] = await liveScan(body => (body?.result?.contents ? { jsonrpc: '2.0', id: body.id, error: { code: -32002, message: 'gone' } } : body));
  assert.equal(gone, 'fail', 'a view a tool names but the server cannot read fails the scan');
});

test('/trust says the pricing and intro answers also render as MCP Apps views', async () => {
  const s = await served();
  for (const file of ['trust.md', 'trust.html']) {
    const page = read(file).replace(/<\/?code>|`/g, '');
    assert.ok(page.includes('the get_pricing and request_intro answers also render as MCP Apps views'), `${file}: the line`);
    for (const { uri } of s.resources) assert.ok(page.includes(uri), `${file}: names ${uri}`);
  }
});
