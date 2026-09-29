// Serve the markdown version of a page to agents that ask for it (Accept: text/markdown).
// A vercel.json rewrite can't do this for "/": the real index.html wins before rewrites run.
const MARKDOWN = { '/': '/index.md', '/interplay': '/interplay.md' };

export const config = { matcher: ['/', '/interplay'] };

export default function middleware(request) {
  const url = new URL(request.url);
  const target = MARKDOWN[url.pathname];
  if (!target || !/text\/markdown/i.test(request.headers.get('accept') || '')) return;
  return new Response(null, { headers: { 'x-middleware-rewrite': new URL(target, url).toString() } });
}
