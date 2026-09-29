// Daily (vercel.json crons): rebuild the agent-traffic report from the day's sightings.
import { buildReport } from '../lib/agent-traffic.mjs';

export default async function handler(req, res) {
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const report = await buildReport();
  return res.status(200).json({ ok: true, updated: report.updated, platforms: Object.keys(report.platforms) });
}
