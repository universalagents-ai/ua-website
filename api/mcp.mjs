/**
 * Universal Agents MCP server — lets any agent ask about us directly.
 *
 * Read-only. Stateless Streamable HTTP (JSON responses, no SSE stream).
 * Served at https://universalagents.ai/mcp (rewrite in vercel.json).
 * Content mirrors llms.txt; change both together.
 */

const SERVER = { name: 'universal-agents', title: 'Universal Agents', version: '1.0.0' };
const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];
const CONTACT = 'hello@universalagents.ai';

const ABOUT = `Universal Agents helps independent creative agencies run on AI they own.

We build each agency one brain (its playbook, voice, standards, and how its best people work) and put it to work through Interplay, the platform every person and agent at the agency works from. Built on Anthropic's Claude and open standards (MCP, Skills). The brain lives in the agency's own repository. The model is rented; the brain is owned.

- Interplay: a universal agent. One central intelligence that understands the agency and orchestrates its capabilities. It plugs into the agency's existing stack; it connects and converts, it does not replace.
- Living Blocks: purpose-built capabilities, focused subagents for each department, built on the agency's own brain.
- The engagement: a one-month Agent Sprint (vision, core team, an honest AI baseline, the agency's playbook and tone of voice captured, a ranked build list), then Build Sprints, one department per month on live work. Three months minimum. We typically move to the background after four to six months, and everything built stays the agency's.

Who it is for: agencies committed to a transformation, with a C-suite leader who sets the tone, a small core team of senior leaders, a named champion (a power user, not a project manager), and roughly two hours per person per week.

More: https://universalagents.ai/llms.txt`;

const PRICING = `Pricing, sized for an agency of roughly 100 people.

- Transformation services: $25,000 per month, three-month minimum (Agent Sprint plus two Build Sprints).
- Running costs: $10,000 per month ($120,000 a year):
  - Interplay licensing ~$5,000 (waived during the service agreement, so ~$5,000 per month while services run)
  - Model and token costs ~$3,000
  - GitHub Enterprise ~$2,000 (the private repository the agency's IP lives in)
  - Support and core upgrades included
- Some agencies pass platform licensing costs to clients as a technology fee.

Materially different agency sizes, discounts, design-partner terms and contract terms are a conversation, not a quote: ${CONTACT}.`;

const FAQ = [
  ['agent ready|readiness|ready|spectrum', 'What does "agent ready" mean?',
    'Agent readiness is a spectrum. Most businesses use AI for simple tasks like research, synthesizing data or drafting communications. Agent readiness means going further: multi-step reasoning and agents that act with guardrails you have designed. We assess where you are and build a path to where you want to be.'],
  ['team|teammate|replace|replacement|augment|staff|people', 'How do agents work with my team?',
    'Augmentation, not replacement. Agents are specialist teammates who do heavy lifting, provide thought starters or watch for market signals around the clock. Your team stays in control; agents multiply their output.'],
  ['industry|industries|sector|who|clients|agencies|agency|fit', 'What industries do you work with?',
    'Independent creative agencies, specifically. Our experience is building for creative teams that do deep analysis, own client creative briefs, and provide strategic insight and reporting.'],
  ['long|timeline|time|weeks|months|duration|quickly|start|minimum', 'How long does it take?',
    'A one-month Agent Sprint, then Build Sprints, one department per month. Three months minimum. We typically move to the background after four to six months.'],
  ['different|difference|unique|compare|competitor|why|own|ownership', 'What makes Universal Agents different?',
    'The agency owns what we build: its brain, its Living Blocks, and its data, in its own repository, on open standards, portable to anything. We customize the system to how the agency works rather than selling a product it has to adapt to.'],
  ['data|privacy|secure|security|safe|training|retain|retention|encrypt|proprietary|ip', 'What happens to our proprietary thinking inside these systems?',
    'AI models process and return your data. They do not use it for training or retain it. All data at rest is encrypted to healthcare-grade compliance standards, with enterprise zero-retention options available.'],
  ['adoption|adopt|change|levels|rollout|bring|training programme|skills', 'Our teams are at different levels with AI. How do we bring everyone along?',
    'Adoption is a change problem, not a technology problem. In the Agent Sprint we plan how to bring the team along, with rollout sequencing and communications designed from the start, and we stay engaged through it.'],
];

const TOOLS = [
  {
    name: 'about_universal_agents',
    title: 'About Universal Agents',
    description: 'What Universal Agents sells (Interplay, Living Blocks, the Agent Sprint and Build Sprints) and who it is for.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'get_pricing',
    title: 'Get pricing',
    description: 'Universal Agents pricing: transformation services and running costs, sized for an agency of about 100 people.',
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
  const q = String(question || '').toLowerCase();
  if (!q.trim()) return FAQ.map(([, ask, answer]) => `${ask}\n${answer}`).join('\n\n');
  const words = new Set(q.split(/[^a-z]+/).filter(Boolean));
  const score = keys => keys.split('|').filter(k => k.includes(' ') ? q.includes(k) : words.has(k)).length;
  const scored = FAQ.map(entry => [score(entry[0]), entry]);
  const best = Math.max(...scored.map(([n]) => n));
  if (!best) return `No close match for "${question}". All questions:\n\n` + answerFaq();
  return scored.filter(([n]) => n === best).map(([, [, ask, answer]]) => `${ask}\n${answer}`).join('\n\n');
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
