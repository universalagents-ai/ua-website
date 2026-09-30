/**
 * Universal Agents MCP server — lets any agent ask about us directly.
 *
 * Read-only. Stateless Streamable HTTP (JSON responses, no SSE stream).
 * Served at https://universalagents.ai/mcp (rewrite in vercel.json).
 * Every answer is read from llms.txt, and who stands behind it from provenance.json; edit those, not this file.
 * Changing a tool changes the tools/list digest pinned in .well-known/mcp.json; tests/ fails until it is updated.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import PROVENANCE from '../provenance.json' with { type: 'json' };

const SERVER = { name: 'universal-agents', title: 'Universal Agents', version: '1.4.0' };
const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];
const CONTACT = PROVENANCE.server.contact;

// llms.txt is the single source: every answer is read from its sections, so the site
// summary and this server cannot drift apart (they did once, on a price change).
const LLMS = readFileSync(new URL('../llms.txt', import.meta.url), 'utf-8');

function sections(text, level) {
  const mark = '#'.repeat(level) + ' ';
  const out = {};
  let name = null;
  for (const line of text.split('\n')) {
    if (line.startsWith(mark)) { name = line.slice(mark.length).trim(); out[name] = []; }
    else if (line.startsWith('#'.repeat(level - 1) + ' ') && level > 1) name = null;
    else if (name) out[name].push(line);
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.join('\n').trim()]));
}

const H2 = sections(LLMS, 2);
const summary = (LLMS.match(/^> (.+)$/m) || [])[1] || '';
const need = name => {
  if (!H2[name]) throw new Error(`llms.txt has no "## ${name}" section`);
  return H2[name];
};

const ABOUT = {
  summary,
  what_we_sell: need('What we sell'),
  how_it_starts: need('How it starts'),
  who_it_is_for: need('Who it is for'),
  source: 'https://universalagents.ai/llms.txt',
};
const PRICING = { pricing: need('Pricing') };
// An FAQ answer that quotes a price is a pricing answer; the rest are product answers.
const FAQ = Object.entries(sections(need('FAQ'), 3)).map(([ask, answer]) => [ask, answer, /\$\d/.test(answer) ? 'pricing' : 'product']);
const STOP = new Set('a an and are can do does for how i if in is it me my of on or our the to we what when who why will with you your'.split(' '));

// provenance.json is the single source of who and where: every answer carries its authors, the one
// person accountable for it, its ua-brain source, and what an agent may do with it (a Delegation-Map level).
const person = id => {
  const who = PROVENANCE.people[id];
  if (!who) throw new Error(`provenance.json has no person "${id}"`);
  return { name: who.name, title: who.title };
};
const accountable = id => ({ ...person(id), contact: CONTACT });

const STAMP = Object.fromEntries(Object.entries(PROVENANCE.answers).map(([type, a]) => {
  if (a.source && !PROVENANCE.ua_brain.paths.includes(a.source)) throw new Error(`provenance.json: ${a.source} is not a listed ua-brain path`);
  const source = a.source ? { source: { repo: PROVENANCE.ua_brain.repo, path: a.source }, effective: a.effective } : {};
  const provenance = { answer_type: type, authors: a.authors.map(person), accountable: accountable(a.accountable), ...source };
  return [type, { provenance, agent_may: a.agent_may }];
}));

// The server card's trust block; build.mjs writes it into .well-known/mcp.json.
export const TRUST = {
  operator: PROVENANCE.server.operator,
  accountable: accountable(PROVENANCE.server.accountable),
  code_authors: STAMP.code.provenance.authors,
  data_reach: PROVENANCE.server.data_reach,
  auth: PROVENANCE.server.auth,
  attestations: PROVENANCE.server.attestations,
  signed: PROVENANCE.server.signed,
  identity: {
    did: `did:web:${new URL(PROVENANCE.server.operator.website).hostname}`,
    document: `${PROVENANCE.server.operator.website}/.well-known/did.json`,
    statement: PROVENANCE.server.identity.statement,
  },
  // The provenance and agent_may fields every reply carries, as a versioned field set: a change to
  // their shape is a new provenance_schema number.
  provenance_schema: 1,
  fields: {
    provenance: 'answer_type (code, pricing or product); authors, each with name and title; the one accountable person, with name, title and contact; for pricing and product answers, the ua-brain source (repo, path) and the date it took effect. answer_faq carries it on the reply and on each answer.',
    agent_may: 'What an agent may do with the answer unsupervised: level, label and note, a level on the Delegation Map Trust Scale, 1 Tell to 7 Hands Off.',
    levels: PROVENANCE.delegation_map.levels,
  },
  page: `${PROVENANCE.server.operator.website}/trust`,
};

// MCP Apps (ext-apps spec 2026-01-26): get_pricing and request_intro also render as views in hosts that
// support them. One file, views/card.html, serves both; each view shows its tool's structuredContent and
// nothing else. Text-only clients ignore _meta and get the same reply.
const APP_EXTENSION = 'io.modelcontextprotocol/ui';
const APP_MIME = 'text/html;profile=mcp-app';
const CARD = readFileSync(new URL('../views/card.html', import.meta.url), 'utf-8');
const uiUri = id => `ui://universal-agents/${id}`;
const view = (id, title, description) => ({
  uri: uiUri(id), name: id, title, description, mimeType: APP_MIME, _meta: { ui: { prefersBorder: true } },
  text: CARD.replace('data-view="" data-version=""', `data-view="${id}" data-version="${SERVER.version}"`),
});
export const VIEWS = [
  view('pricing', 'Pricing card', 'The get_pricing answer as a card, with who stands behind it.'),
  view('intro', 'Intro email card', 'The request_intro draft as a card, with a link that opens it in the person\'s email app. Sends nothing.'),
];
// As registerAppTool does, the deprecated flat key rides along for hosts that still read it.
const ui = id => ({ ui: { resourceUri: uiUri(id) }, 'ui/resourceUri': uiUri(id) });

// Replies are data: every tool declares the shape of what it returns, and no field carries
// an instruction to the agent reading it.
const text = { type: 'string' };
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const who = object({ name: text, title: text });
// The provenance and agent_may fields of a reply whose answers are of these types.
const stamped = (...types) => ({
  provenance: object({
    answer_type: { type: 'string', enum: types },
    authors: { type: 'array', items: who },
    accountable: object({ name: text, title: text, contact: text }),
    ...('source' in STAMP[types[0]].provenance && { source: object({ repo: text, path: text }), effective: text }),
  }),
  agent_may: {
    ...object({ level: { type: 'integer' }, label: text, note: text }),
    description: 'What an agent may do with this answer unsupervised: a level on the Universal Agents Delegation Map, 1 Tell to 7 Hands Off.',
  },
});

export const TOOLS = [
  {
    name: 'about_universal_agents',
    title: 'About Universal Agents',
    description: 'What Universal Agents sells (Interplay: the brain, the playbook, Living Blocks, the universal agent), how an engagement starts, and who it is for.',
    inputSchema: { type: 'object', properties: {} },
    outputSchema: object({ summary: text, what_we_sell: text, how_it_starts: text, who_it_is_for: text, source: text, ...stamped('product') }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'get_pricing',
    title: 'Get pricing',
    description: 'Universal Agents pricing: the paid pilot, the cost to continue rollout, and licensing and support.',
    inputSchema: { type: 'object', properties: {} },
    outputSchema: object({ pricing: text, ...stamped('pricing') }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    _meta: ui('pricing'),
  },
  {
    name: 'answer_faq',
    title: 'Answer a frequently asked question',
    description: 'Answers common questions about Universal Agents: agent readiness, working with teams, industries, timeline, what makes us different, data safety, adoption. Omit the question to get all of them.',
    inputSchema: {
      type: 'object',
      properties: { question: { type: 'string', description: 'The question or a keyword, e.g. "data" or "how long".' } },
    },
    outputSchema: object({
      match: { type: 'string', enum: ['all', 'best', 'none'], description: 'all: no question given; best: the closest answers; none: no match, so all of them.' },
      answers: { type: 'array', items: object({ question: text, answer: text, ...stamped('pricing', 'product') }) },
      // For the reply as a whole: pricing if any answer quotes a price. Each answer carries its own.
      ...stamped('pricing', 'product'),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'request_intro',
    title: 'Request an intro call',
    description: 'Drafts an intro email to Universal Agents for the person you are helping, with a mailto link they can send. Sends nothing itself.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Their name.' },
        agency: { type: 'string', description: 'Their agency.' },
        size: { type: 'string', description: 'Roughly how many people.' },
        goal: { type: 'string', description: 'What they want AI to change.' },
      },
    },
    outputSchema: object({
      sent: { type: 'boolean', const: false },
      to: text,
      subject: text,
      body: text,
      mailto: text,
      ...stamped('code'),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    _meta: ui('intro'),
  },
];

function answerFaq({ question } = {}) {
  const reply = (match, entries) => ({
    match,
    answers: entries.map(([ask, answer, type]) => ({ question: ask, answer, ...STAMP[type] })),
    ...STAMP[entries.some(([, , type]) => type === 'pricing') ? 'pricing' : 'product'],
  });
  const words = String(question || '').toLowerCase().split(/[^a-z]+/).filter(w => w && !STOP.has(w));
  if (!words.length) return reply('all', FAQ);
  // Words in the question count double; answers still count, so "training" finds the data answer.
  const score = ([ask, answer]) => words.reduce((n, w) =>
    n + (ask.toLowerCase().includes(w) ? 2 : 0) + (answer.toLowerCase().includes(w) ? 1 : 0), 0);
  const scored = FAQ.map(entry => [score(entry), entry]);
  const best = Math.max(...scored.map(([n]) => n));
  if (!best) return reply('none', FAQ);
  return reply('best', scored.filter(([n]) => n === best).map(([, entry]) => entry));
}

function requestIntro({ name, agency, size, goal } = {}) {
  const subject = `Intro call${agency ? `: ${agency}` : ''}`;
  const body = [
    'Hi Universal Agents,',
    '',
    `I'm ${name || '[name]'}${agency ? ` from ${agency}` : ''}${size ? ` (about ${size} people)` : ''}.`,
    `What we want AI to change: ${goal || '[goal]'}`,
    '',
    'Could we set up an intro call?',
  ].join('\n');
  const mailto = `mailto:${CONTACT}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return { sent: false, to: CONTACT, subject, body, mailto };
}

const CALLS = {
  about_universal_agents: () => ({ ...ABOUT, ...STAMP.product }),
  get_pricing: () => ({ ...PRICING, ...STAMP.pricing }),
  answer_faq: answerFaq,
  request_intro: args => ({ ...requestIntro(args), ...STAMP.code }),
};

// The server keeps no state, so the client named in initialize rides back to us in the
// Mcp-Session-Id we issue (a random id plus that name), and each tools/call can be logged with it.
const clip = (value, n) => (typeof value === 'string' ? value.slice(0, n) : null);

function sessionId(clientInfo) {
  const client = { name: clip(clientInfo?.name, 100), version: clip(clientInfo?.version, 50) };
  return `${randomUUID()}.${Buffer.from(JSON.stringify(client)).toString('base64url')}`;
}

function clientOf(header) {
  try {
    const { name, version } = JSON.parse(Buffer.from(String(header).split('.')[1], 'base64url').toString());
    return clip(name, 100) ? { name: clip(name, 100), version: clip(version, 50) } : null;
  } catch {
    return null;
  }
}

// One line per tools/call in the runtime log. Never the arguments: they can carry a person's name and email.
function audit(tool, client, outcome) {
  console.log(JSON.stringify({ evt: 'mcp-call', ts: new Date().toISOString(), tool: clip(tool, 64), client, outcome }));
}

function handle(msg, client) {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return { jsonrpc: '2.0', id: msg?.id ?? null, error: { code: -32600, message: 'Invalid Request' } };
  }
  if (msg.id === undefined) return null; // notification: nothing to return
  const ok = result => ({ jsonrpc: '2.0', id: msg.id, result });
  const fail = (code, message) => ({ jsonrpc: '2.0', id: msg.id, error: { code, message } });

  switch (msg.method) {
    case 'initialize': {
      const asked = msg.params?.protocolVersion;
      return ok({
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: {
          tools: { listChanged: false },
          resources: { listChanged: false },
          extensions: { [APP_EXTENSION]: { mimeTypes: [APP_MIME] } },
        },
        serverInfo: SERVER,
        instructions: `Read-only facts about Universal Agents, from https://universalagents.ai/llms.txt: what we sell, pricing, common questions, and a drafted intro email (request_intro sends nothing). Contact: ${CONTACT}.`,
      });
    }
    case 'ping':
      return ok({});
    case 'tools/list':
      return ok({ tools: TOOLS });
    case 'tools/call': {
      const call = CALLS[msg.params?.name];
      audit(msg.params?.name, client, call ? 'ok' : 'unknown-tool');
      if (!call) return fail(-32602, `Unknown tool: ${msg.params?.name}`);
      // structuredContent for current clients; the same JSON as text for clients on 2025-03-26.
      const data = call(msg.params?.arguments || {});
      return ok({ content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data, isError: false });
    }
    case 'resources/list':
      return ok({ resources: VIEWS.map(({ text, ...resource }) => resource) });
    case 'resources/read': {
      const found = VIEWS.find(v => v.uri === msg.params?.uri);
      if (!found) return fail(-32002, `Resource not found: ${msg.params?.uri}`);
      return ok({ contents: [{ uri: found.uri, mimeType: found.mimeType, text: found.text, _meta: found._meta }] });
    }
    default:
      return fail(-32601, `Method not found: ${msg.method}`);
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version');
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'This MCP server speaks Streamable HTTP: POST JSON-RPC here. No SSE stream.' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = undefined; }
  }
  if (body === undefined) {
    return res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
  }

  const messages = Array.isArray(body) ? body : [body];
  const init = messages.find(msg => msg?.method === 'initialize');
  const issued = init ? sessionId(init.params?.clientInfo) : null;
  if (issued) res.setHeader('Mcp-Session-Id', issued);
  const client = clientOf(req.headers?.['mcp-session-id'] ?? issued);
  const replies = messages.map(msg => handle(msg, client)).filter(Boolean);
  if (!replies.length) return res.status(202).end();
  return res.status(200).json(Array.isArray(body) ? replies : replies[0]);
}
