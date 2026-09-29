// The agent-traffic log: which AI platforms read which kind of content, and when.
//
// Budget-shaped for Vercel Blob on Hobby (2,000 writes/month; over that, Blob locks for
// 30 days). So we record a first sighting, not every hit: one private blob per UTC day ×
// platform × content group. At most ~12 platforms × 5 groups = 60 writes/day.
import { head, put, list, del, get } from '@vercel/blob';

export const REPORT = 'reports/agent-traffic.json';
const WINDOW_DAYS = 30;
const KEEP_DAYS = 35;

// User-agent token → platform. The first match wins. User agents can be spoofed; the
// report says so.
export const AGENTS = [
  ['ClaudeBot', 'Anthropic'], ['Claude-User', 'Anthropic'], ['Claude-SearchBot', 'Anthropic'],
  ['GPTBot', 'OpenAI'], ['ChatGPT-User', 'OpenAI'], ['OAI-SearchBot', 'OpenAI'],
  ['PerplexityBot', 'Perplexity'], ['Perplexity-User', 'Perplexity'],
  ['Google-Extended', 'Google'], ['GoogleOther', 'Google'], ['Google-CloudVertexBot', 'Google'],
  ['Applebot-Extended', 'Apple'], ['Meta-ExternalAgent', 'Meta'], ['meta-externalfetcher', 'Meta'],
  ['Amazonbot', 'Amazon'], ['Bytespider', 'ByteDance'], ['CCBot', 'Common Crawl'],
  ['cohere-ai', 'Cohere'], ['MistralAI-User', 'Mistral'], ['DuckAssistBot', 'DuckDuckGo'],
];

export function matchAgent(userAgent) {
  const ua = (userAgent || '').toLowerCase();
  return AGENTS.find(([token]) => ua.includes(token.toLowerCase())) || null;
}

export function contentGroup(pathname, accept) {
  if (pathname === '/llms.txt') return 'llms.txt';
  if (pathname === '/mcp' || pathname.startsWith('/.well-known/mcp')) return 'mcp';
  if (pathname.endsWith('.md') || /text\/markdown/i.test(accept || '')) return 'markdown';
  if (pathname === '/' || pathname === '/interplay') return 'pages';
  return 'other';
}

const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const seenThisInstance = new Set();

export async function recordSighting({ agent, platform, group, at = new Date() }) {
  const day = at.toISOString().slice(0, 10);
  const pathname = `seen/${day}/${slug(platform)}/${group}.json`;
  if (seenThisInstance.has(pathname)) return;
  seenThisInstance.add(pathname);
  try {
    await head(pathname); // a simple op; the put below is the scarce one
    return;
  } catch {
    // not found: first sighting today
  }
  try {
    await put(pathname, JSON.stringify({ day, platform, agent, group, first: at.toISOString() }), {
      access: 'private', contentType: 'application/json', addRandomSuffix: false,
    });
  } catch {
    // another instance won the race, or Blob is unavailable; never break the request
  }
}

export async function buildReport(now = new Date()) {
  const since = new Date(now.getTime() - WINDOW_DAYS * 864e5).toISOString().slice(0, 10);
  const expire = new Date(now.getTime() - KEEP_DAYS * 864e5).toISOString().slice(0, 10);
  const platforms = {};
  const stale = [];
  let cursor;
  do {
    const page = await list({ prefix: 'seen/', limit: 1000, cursor });
    for (const { pathname } of page.blobs) {
      const [, day, platformSlug, file] = pathname.split('/');
      if (day < expire) { stale.push(pathname); continue; }
      if (day < since) continue;
      const group = file.replace(/\.json$/, '');
      const p = (platforms[platformSlug] ??= { days: new Set(), last_seen: day, content: {} });
      p.days.add(day);
      if (day > p.last_seen) p.last_seen = day;
      (p.content[group] ??= new Set()).add(day);
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  if (stale.length) await del(stale);

  const names = Object.fromEntries(AGENTS.map(([, name]) => [slug(name), name]));
  const report = {
    updated: now.toISOString(),
    window_days: WINDOW_DAYS,
    method: 'First sighting per UTC day of each AI platform on each kind of content, matched by user-agent token. User agents can be spoofed; our own checks are excluded. Counts are days seen, not requests.',
    platforms: Object.fromEntries(Object.entries(platforms)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([s, p]) => [names[s] || s, {
        days_seen: p.days.size,
        last_seen: p.last_seen,
        content: Object.fromEntries(Object.entries(p.content).map(([g, d]) => [g, d.size])),
      }])),
  };
  await put(REPORT, JSON.stringify(report, null, 2), {
    access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true,
  });
  return report;
}

export async function readReport() {
  const result = await get(REPORT, { access: 'private' });
  if (!result || !result.stream) return null;
  return await new Response(result.stream).text();
}
