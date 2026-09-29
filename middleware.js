// Two jobs, both for AI agents:
// 1. Serve the markdown version of a page to agents that ask for it (Accept: text/markdown).
//    A vercel.json rewrite can't do this for "/": the real index.html wins before rewrites run.
// 2. Record which AI platforms read the site (lib/agent-traffic.mjs), published daily at
//    /.well-known/agent-traffic.json.
import { waitUntil } from '@vercel/functions';
import { matchAgent, contentGroup, recordSighting } from './lib/agent-traffic.mjs';

const MARKDOWN = { '/': '/index.md', '/interplay': '/interplay.md' };

export const config = {
  matcher: ['/((?!assets/|favicon|android-chrome|apple-touch-icon|og-image).*)'],
  runtime: 'nodejs',
};

export default function middleware(request) {
  const url = new URL(request.url);
  const accept = request.headers.get('accept') || '';
  const hit = matchAgent(request.headers.get('user-agent'));
  // Record only real production traffic: previews share the store, and our agent-check announces itself.
  if (hit && process.env.VERCEL_ENV === 'production' && !request.headers.get('x-agent-check')) {
    const [agent, platform] = hit;
    const group = contentGroup(url.pathname, accept);
    console.log(JSON.stringify({ evt: 'ai-agent-hit', agent, platform, group, path: url.pathname, at: new Date().toISOString() }));
    waitUntil(recordSighting({ agent, platform, group }));
  }

  const target = MARKDOWN[url.pathname];
  if (!target || !/text\/markdown/i.test(accept)) return;
  return new Response(null, { headers: { 'x-middleware-rewrite': new URL(target, url).toString() } });
}
