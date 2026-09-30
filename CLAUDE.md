# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Rules
- It is 2026!
- Make only what was asked for. Changes should be as small as possible.
- If possible spot and delete functions or code-lines that are no longer needed.

## Project Overview

Universal Agents marketing website: two static pages with GSAP-powered animations, plus an agent layer (llms.txt, markdown mirrors, an MCP server, an AI-crawler log).

## Tech Stack
- Plain HTML pages built from `src/pages/` + `src/partials/` by `node build.mjs` into the root `index.html` / `interplay.html` (edit `src/`, never the built files)
- GSAP 3.14.1 (CDN: gsap, ScrollTrigger, CustomEase, SplitText)
- Lenis 1.18 (smooth scroll, CDN)
- No framework or bundler. npm only for the two Vercel functions' dependencies (`@vercel/blob`, `@vercel/functions`)
- Deployed by Vercel from GitHub: a merge to `main` deploys production; every PR gets a preview

## Brand Tokens
```css
--ua-mint: #3FFF8C;
--ua-pink: #FF69BA;
--ua-blue: #25B1FF;
--ua-black: #0a0a0a;
--ua-dark-gray: #333333;
--ua-gray: #787878;
--ua-white: #ffffff;
```

## Fonts
- GeistMono (Regular 400, Bold 700) — local files in `assets/fonts/`
- Font stacks: `'GeistMono', monospace` for both display and body

## Design System (Osmo Supply)
- Fluid scaling system from [Osmo Supply](https://osmo.supply/)
- `--size-font` computed from container width for fluid typography
- Type scale: `--text-display`, `--text-heading`, `--text-title`, `--text-body`, `--text-label`
- 4 breakpoints: Desktop (1440), Tablet (834), Mobile Landscape (550), Mobile Portrait (390)
- Grid: 12→6→4→4 columns across breakpoints

## Animation Patterns
- **Loader**: GSAP timeline — bar fill + wordmark clip-path reveal + mint flash transition
- **Word reveal**: `[data-word-reveal]` — SplitText word-by-word with GSAP `yPercent`
- **Scroll reveal**: `[data-reveal]` — fade+translate on scroll via ScrollTrigger
- **Parallax**: `[data-parallax="trigger"]` — data-attribute driven, responsive breakpoint disabling
- **Logomark theme**: Auto-switches `is--dark` class when over `[data-theme="light"]` sections
- **Reduced motion**: All animations respect `prefers-reduced-motion: reduce`

## Easing Tokens
```css
--ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
--ease-out-quart: cubic-bezier(0.25, 1, 0.5, 1);
--ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
```

## File Structure
```
src/pages/          # Page sources: markup, styles, scripts (edit these)
src/partials/       # Nav, footer, wordmark, spliced in by build.mjs
index.html, interplay.html  # Built output (committed; Vercel serves the repo root)
llms.txt            # The agent summary, and the single source the MCP server reads
index.md, interplay.md      # Markdown mirrors of the pages (served on Accept: text/markdown)
api/mcp.mjs         # MCP server at /mcp (answers read from llms.txt)
views/card.html     # The MCP Apps view get_pricing and request_intro render in (served as two ui:// resources)
api/agent-traffic.mjs, api/cron-agent-traffic.mjs, lib/agent-traffic.mjs  # AI-crawler log + daily report
middleware.js       # Markdown negotiation + AI-crawler sightings
.well-known/        # mcp.json server card, mcp-registry-auth key
server.json         # The official MCP registry entry
scripts/agent-check.py      # Agent-readiness check: python3 scripts/agent-check.py https://universalagents.ai
assets/fonts/, assets/svg/, assets/video/
```

## Agents read this site too
- Prices and product wording come from ua-brain (the price card in `governance/pricing-rules.md`, the Interplay lexicon). When they change, update `llms.txt` (the MCP server follows) and the JSON-LD offers on `/interplay`; `agent-check` check 8 fails if JSON-LD prices disagree with `llms.txt`.
- Run `agent-check` after any deploy: 10/10 is the bar.

## Conventions
- All styles are in `<style>` in `<head>` — no external CSS files
- All scripts are in `<script>` before `</body>` — no external JS files
- CSS custom properties for all design tokens (colors, spacing, typography, easing, durations)
- BEM-ish class naming: `.section__element.is--modifier`
- Accessibility: skip link, `sr-only`, `aria-label`, semantic HTML
- SVG shared via `<symbol>/<use>` pattern

## Deployment
- Vercel static deployment (no build step)
- Project: `ua-website` (already linked)
- Deploy: `vercel` or `vercel --prod`

## Git Conventions
- Write commit messages thinking "This commit will..." then use that verb
- Format: `<Verb> <what it does>` (e.g., `Add nav section`, `Fix mobile hero sizing`)
- Branch naming: `feature:description`, `fix:description`
