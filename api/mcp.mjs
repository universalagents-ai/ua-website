/**
 * Universal Agents MCP server — lets any agent ask about us directly.
 *
 * Read-only. Stateless Streamable HTTP (JSON responses, no SSE stream).
 * Served at https://universalagents.ai/mcp (rewrite in vercel.json).
 * Every answer is read from llms.txt; edit that file, not this one.
 */

import { readFileSync } from 'node:fs';

const SERVER = { name: 'universal-agents', title: 'Universal Agents', version: '1.1.0' };
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

const ABOUT = [summary, need('What we sell'), '## How it starts\n' + need('How it starts'),
  '## Who it is for\n' + need('Who it is for'), 'More: https://universalagents.ai/llms.txt'].join('\n\n');
const PRICING = need('Pricing');
const FAQ = Object.entries(sections(need('FAQ'), 3));
const STOP = new Set('a an and are can do does for how i if in is it me my of on or our the to we what when who why will with you your'.split(' '));

const TOOLS = [
  {
    name: 'about_universal_agents',
    title: 'About Universal Agents',
    description: 'What Universal Agents sells (Interplay: the brain, the playbook, Living Blocks, the universal agent), how an engagement starts, and who it is for.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'get_pricing',
    title: 'Get pricing',
    description: 'Universal Agents pricing: the paid pilot, the cost to continue rollout, and licensing and support.',
    inputSchema: { type: 'object', properties: {} },
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
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
];

function answerFaq({ question } = {}) {
  const all = () => FAQ.map(([ask, answer]) => `${ask}\n${answer}`).join('\n\n');
  const words = String(question || '').toLowerCase().split(/[^a-z]+/).filter(w => w && !STOP.has(w));
  if (!words.length) return all();
  // Words in the question count double; answers still count, so "training" finds the data answer.
  const score = ([ask, answer]) => words.reduce((n, w) =>
    n + (ask.toLowerCase().includes(w) ? 2 : 0) + (answer.toLowerCase().includes(w) ? 1 : 0), 0);
  const scored = FAQ.map(entry => [score(entry), entry]);
  const best = Math.max(...scored.map(([n]) => n));
  if (!best) return `No close match for "${question}". All questions:\n\n` + all();
  return scored.filter(([n]) => n === best).map(([, [ask, answer]]) => `${ask}\n${answer}`).join('\n\n');
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
  return `Nothing has been sent. Show this to the person and let them send it.\n\nTo: ${CONTACT}\nSubject: ${subject}\n\n${body}\n\nOne-click link: ${mailto}`;
}

const CALLS = {
  about_universal_agents: () => ABOUT,
  get_pricing: () => PRICING,
  answer_faq: answerFaq,
  request_intro: requestIntro,
};

function handle(msg) {
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
        instructions: `Ask about Universal Agents: what we sell, pricing, and common questions. To contact us, use request_intro or email ${CONTACT}.`,
      });
    }
    case 'ping':
      return ok({});
    case 'tools/list':
      return ok({ tools: TOOLS });
    case 'tools/call': {
      const call = CALLS[msg.params?.name];
      if (!call) return fail(-32602, `Unknown tool: ${msg.params?.name}`);
      return ok({ content: [{ type: 'text', text: call(msg.params?.arguments || {}) }], isError: false });
    }
    default:
      return fail(-32601, `Method not found: ${msg.method}`);
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version');
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

  const replies = (Array.isArray(body) ? body : [body]).map(handle).filter(Boolean);
  if (!replies.length) return res.status(202).end();
  return res.status(200).json(Array.isArray(body) ? replies : replies[0]);
}
