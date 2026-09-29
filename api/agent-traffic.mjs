// Serves /.well-known/agent-traffic.json: which AI platforms read this site (see lib/agent-traffic.mjs).
import { readReport } from '../lib/agent-traffic.mjs';

export default async function handler(req, res) {
  const body = await readReport().catch(() => null);
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (!body) return res.status(503).json({ error: 'No agent-traffic report yet; it is rebuilt daily.' });
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
  return res.status(200).send(body);
}
