// Two jobs, both for AI agents:
// 1. Serve the markdown version of a page to agents that ask for it (Accept: text/markdown).
//    A vercel.json rewrite can't do this for "/": the real index.html wins before rewrites run.
// 2. Log every request from a known AI crawler or assistant, one JSON line each, so we can
//    see which platforms read the site (grep the Vercel logs for "ai-agent-hit").
const MARKDOWN = { '/': '/index.md', '/interplay': '/interplay.md' };

// User-agent token → platform. Order matters: the first match wins.
const AGENTS = [
  ['ClaudeBot', 'Anthropic'], ['Claude-User', 'Anthropic'], ['Claude-SearchBot', 'Anthropic'],
  ['GPTBot', 'OpenAI'], ['ChatGPT-User', 'OpenAI'], ['OAI-SearchBot', 'OpenAI'],
  ['PerplexityBot', 'Perplexity'], ['Perplexity-User', 'Perplexity'],
  ['Google-Extended', 'Google'], ['GoogleOther', 'Google'], ['Google-CloudVertexBot', 'Google'],
  ['Applebot-Extended', 'Apple'], ['Meta-ExternalAgent', 'Meta'], ['meta-externalfetcher', 'Meta'],
  ['Amazonbot', 'Amazon'], ['Bytespider', 'ByteDance'], ['CCBot', 'Common Crawl'],
  ['cohere-ai', 'Cohere'], ['MistralAI-User', 'Mistral'], ['DuckAssistBot', 'DuckDuckGo'],
];

export const config = {
  matcher: ['/((?!assets/|favicon|android-chrome|apple-touch-icon|og-image).*)'],
  runtime: 'nodejs',
};

export default function middleware(request) {
  const url = new URL(request.url);
  const ua = request.headers.get('user-agent') || '';
  const hit = AGENTS.find(([token]) => ua.toLowerCase().includes(token.toLowerCase()));
  if (hit) {
    console.log(JSON.stringify({ evt: 'ai-agent-hit', agent: hit[0], platform: hit[1], path: url.pathname, at: new Date().toISOString() }));
  }

  const target = MARKDOWN[url.pathname];
  if (!target || !/text\/markdown/i.test(request.headers.get('accept') || '')) return;
  return new Response(null, { headers: { 'x-middleware-rewrite': new URL(target, url).toString() } });
}
