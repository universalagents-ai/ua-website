# Privacy

> What universalagents.ai collects, why, for how long, who processes it, and how to reach us.

Last updated: 2026-09-29.

## Who we are

Universal Agents (Universal Agents Inc.), https://universalagents.ai. Contact: hello@universalagents.ai.

## Cookies

The site sets no cookies. No page script writes one.

## Page views: Vercel Web Analytics

We use Vercel Web Analytics to see which pages people read. It collects aggregate page-view data only.

For each page view it records the event timestamp, the URL, the dynamic path, the referrer, filtered query parameters, the geolocation (country, region, city), the device OS and version, the browser and version, the device type and the script version.

It identifies a visitor by a hash created from the incoming request, not by a cookie. Vercel discards that hash after 24 hours.

Vercel's policy for this data: https://vercel.com/docs/analytics/privacy-policy

## AI-agent sightings: the crawler log

We record which AI platforms read the site. A request counts only when its user agent carries the token of a known AI agent, such as GPTBot or ClaudeBot. Requests from other user agents are not recorded.

For a sighting we store the user-agent token, the platform, the content group (pages, markdown, llms.txt, mcp or other), the UTC day and the time of the first sighting. We store it once per UTC day for each platform and content group, in Vercel Blob. No IP address is stored.

A daily job deletes sightings older than 35 days. It also publishes a summary of the last 30 days: for each platform, the days it was seen and the kinds of content it read. The summary is public at https://universalagents.ai/.well-known/agent-traffic.json

Each such request also writes one line to the runtime log: the user-agent token, the platform, the content group, the path and the time.

## Calls to our MCP server

Our MCP server at https://universalagents.ai/mcp answers questions about Universal Agents. Nothing a caller sends is stored, except one line per tools/call in the runtime log: the tool name, the client name and version given at initialize, the outcome and the time. The arguments of a call are never logged. We keep the line to see which tools are called, by which clients, and whether they work.

`request_intro` drafts an intro email, with a mailto link, for the person to send themselves. It sends nothing and stores nothing.

## Runtime logs

Vercel keeps runtime logs for 1 hour on our plan.

## Email

Email to hello@universalagents.ai is handled by Google Workspace. We keep your email to answer it. Ask us, and we delete it.

## Who processes it

- Vercel: hosting, analytics, runtime logs and Blob storage. Every request to the site passes through Vercel.
- Google: email, through Google Workspace.
- jsDelivr: the scripts our pages load (GSAP, Lenis, three.js). Your browser fetches them from jsDelivr directly. Our fonts are served from this site.

## Ask us

To ask what we hold about you, or to ask us to delete it, write to hello@universalagents.ai.

## Changes

When what we collect changes, we update this page and its date.
