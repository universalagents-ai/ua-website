# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Rules
- It is 2026!
- Make only what was asked for. Changes should be as small as possible.
- If possible spot and delete functions or code-lines that are no longer needed.

## Project Overview

Universal Agents marketing website. Single-page static site with GSAP-powered animations.

## Tech Stack
- Plain HTML (single `index.html`)
- GSAP 3.14.1 (CDN: gsap, ScrollTrigger, CustomEase, SplitText)
- Lenis 1.18 (smooth scroll, CDN)
- No framework, no bundler, no npm
- Deployed via Vercel (static)

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
index.html          # Everything — markup, styles, scripts
assets/fonts/       # GeistMono TTF files
assets/svg/         # SVG assets
.vercel/            # Vercel project config (gitignored)
```

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
