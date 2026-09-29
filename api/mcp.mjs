/**
 * Universal Agents MCP server — lets any agent ask about us directly.
 *
 * Read-only. Stateless Streamable HTTP (JSON responses, no SSE stream).
 * Served at https://universalagents.ai/mcp (rewrite in vercel.json).
 * Every answer is read from llms.txt; edit that file, not this one.
 * Changing a tool changes the tools/list digest pinned in .well-known/mcp.json; tests/ fails until it is updated.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

const SERVER = { name: 'universal-agents', title: 'Universal Agents', version: '1.2.0' };
const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];
const CONTACT = 'hello@universalagents.ai';

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
const FAQ = Object.entries(sections(need('FAQ'), 3));
const STOP = new Set('a an and are can do does for how i if in is it me my of on or our the to we what when who why will with you your'.split(' '));

// Replies are data: every tool declares the shape of what it returns, and no field carries
// an instruction to the agent reading it.
const text = { type: 'string' };
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });

const TOOLS = [
  {
    name: 'about_universal_agents',
    title: 'About Universal Agents',
    description: 'What Universal Agents sells (Interplay: the brain, the playbook, Living Blocks, the universal agent), how an engagement starts, and who it is for.',
    inputSchema: { type: 'object', properties: {} },
    outputSchema: object({ summary: text, what_we_sell: text, how_it_starts: text, who_it_is_for: text, source: text }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'get_pricing',
    title: 'Get pricing',
    description: 'Universal Agents pricing: the paid pilot, the cost to continue rollout, and licensing and support.',
    inputSchema: { type: 'object', properties: {} },
    outputSchema: object({ pricing: text }),
    annotations: { readOnlyHint: true, openWorldHint: false },
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
      answers: { type: 'array', items: object({ question: text, answer: text }) },
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
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
];

function answerFaq({ question } = {}) {
  const answers = entries => entries.map(([ask, answer]) => ({ question: ask, answer }));
  const words = String(question || '').toLowerCase().split(/[^a-z]+/).filter(w => w && !STOP.has(w));
  if (!words.length) return { match: 'all', answers: answers(FAQ) };
  // Words in the question count double; answers still count, so "training" finds the data answer.
  const score = ([ask, answer]) => words.reduce((n, w) =>
    n + (ask.toLowerCase().includes(w) ? 2 : 0) + (answer.toLowerCase().includes(w) ? 1 : 0), 0);
  const scored = FAQ.map(entry => [score(entry), entry]);
  const best = Math.max(...scored.map(([n]) => n));
  if (!best) return { match: 'none', answers: answers(FAQ) };
  return { match: 'best', answers: answers(scored.filter(([n]) => n === best).map(([, entry]) => entry)) };
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
  about_universal_agents: () => ABOUT,
  get_pricing: () => PRICING,
  answer_faq: answerFaq,
  request_intro: requestIntro,
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
        capabilities: { tools: { listChanged: false } },
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
