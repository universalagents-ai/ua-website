#!/usr/bin/env python3
"""Agent-readiness check: can an AI agent landing cold use this site?

Fetches a site the way AI agents do and reports each check as
pass, fail, or couldnt-check. An unrunnable check never passes.

Usage: python3 scripts/agent-check.py [https://universalagents.ai ...]
Exit:  0 all pass · 1 any fail · 2 no fail, but something couldn't be checked
Stdlib only, to match the site's no-npm stance.
"""
import html
import re
import sys
import urllib.error
import urllib.request
import urllib.robotparser
from urllib.parse import urljoin

AGENTS = {
    "ClaudeBot": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
    "Claude-User": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)",
    "GPTBot": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.1; +https://openai.com/gptbot)",
    "ChatGPT-User": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ChatGPT-User/1.0; +https://openai.com/bot)",
    "PerplexityBot": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
    "plain-http": "Python-urllib/3",
}
CHALLENGE = re.compile(r"Attention Required|Just a moment\.\.\.|cf-chl|challenge-platform|captcha", re.I)
# A price is an amount per something; a bare figure ("$490 million invested") is not a price.
PRICE = re.compile(r"[$€£]\s?\d[\d,.]*\s?[kK]?\s*(?:/|per|a|an|each)\s*(?:month|mo|year|yr|seat|user|call|credit)\b", re.I)
MCP = re.compile(r"https?://(?:mcp\.[^\s)\"'<>]+|[^\s)\"'<>]+/mcp/?)(?=[\s)\"'<>]|$)", re.I)
NEXT_STEP = re.compile(r"\]\((mailto:[^)]+|https?://[^)]*(book|demo|contact|trial|sign-?up|get-started|calendly|cal\.com)[^)]*)\)", re.I)
MIN_WORDS = 150

PASS, FAIL, GREY = "pass", "fail", "couldnt-check"


def fetch(url, agent="ClaudeBot", accept="*/*"):
    """Return (status, content_type, body) or (None, None, error-text)."""
    req = urllib.request.Request(url, headers={"User-Agent": AGENTS[agent], "Accept": accept})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, r.headers.get("Content-Type", ""), r.read(2_000_000).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get("Content-Type", ""), e.read(200_000).decode("utf-8", "replace")
    except Exception as e:  # network, TLS, timeout
        return None, None, str(e)


def visible_text(page):
    page = re.sub(r"(?is)<(script|style|noscript|template|svg)[^>]*>.*?</\1>", " ", page)
    return html.unescape(re.sub(r"<[^>]+>", " ", page))


def check_site(base):
    base = base.rstrip("/") + "/"
    results = []

    def record(name, verdict, detail):
        results.append((name, verdict, detail))

    # 1. Get in — every agent gets a real page, and robots.txt lets it.
    home, blocked, unreachable = None, [], []
    for agent in AGENTS:
        status, _, body = fetch(base, agent)
        if status is None:
            unreachable.append(agent)
        elif status >= 400 or CHALLENGE.search(body[:20000]):
            blocked.append(f"{agent}={status}")
        elif home is None:
            home = body
    rp = urllib.robotparser.RobotFileParser()
    r_status, _, r_body = fetch(urljoin(base, "robots.txt"))
    if r_status == 200:
        rp.parse(r_body.splitlines())
        blocked += [f"{a}=robots" for a in AGENTS if a != "plain-http" and not rp.can_fetch(a, base)]
    if blocked:
        record("1 get in", FAIL, "blocked: " + ", ".join(blocked))
    elif unreachable:
        record("1 get in", GREY, "unreachable for: " + ", ".join(unreachable))
    else:
        record("1 get in", PASS, f"{len(AGENTS)} agents got the page; robots.txt allows them")

    # 2. Understand it in one read — llms.txt, markdown pages, text without JavaScript.
    l_status, l_type, llms = fetch(urljoin(base, "llms.txt"))
    has_llms = l_status == 200 and "html" not in (l_type or "") and llms.lstrip().startswith("# ")
    if l_status is None:
        record("2a llms.txt", GREY, llms)
    else:
        record("2a llms.txt", PASS if has_llms else FAIL,
               "present, starts with an H1" if has_llms else f"status {l_status}, {l_type or 'no type'}")
    m_status, m_type, _ = fetch(base, accept="text/markdown")
    if m_status is None:
        record("2b markdown pages", GREY, "fetch failed")
    elif m_status != 200:
        record("2b markdown pages", FAIL, f"status {m_status}")
    else:
        md = "markdown" in (m_type or "") or "text/plain" in (m_type or "")
        record("2b markdown pages", PASS if md else FAIL,
               f"Accept: text/markdown returned {m_type or 'nothing'}")
    if home is None:
        record("2c text without JS", GREY, "no agent got the page")
    else:
        words = len(visible_text(home).split())
        record("2c text without JS", PASS if words >= MIN_WORDS else FAIL,
               f"{words} words in the raw HTML (need {MIN_WORDS})")

    # 3-5 read what an agent reads: llms.txt first, else the raw page.
    corpus = (llms if has_llms else "") + "\n" + (visible_text(home) if home else "")
    if home is None and not has_llms:
        for name in ("3 find the price", "4 use the product (MCP)", "5 next step"):
            record(name, GREY, "nothing readable to search")
        return results

    # 3. Find the price — as plain text an agent can quote.
    m = PRICE.search(corpus)
    record("3 find the price", PASS if m else FAIL, f"found '{m.group(0).strip()}'" if m else "no price in text")

    # 4. Use the product — a discoverable MCP endpoint.
    wk_status, wk_type, _ = fetch(urljoin(base, ".well-known/mcp.json"))
    wk_ok = wk_status == 200 and "json" in (wk_type or "")  # an HTML fallback is not a manifest
    m = MCP.search(corpus)
    if m or wk_ok:
        record("4 use the product (MCP)", PASS, m.group(0) if m else "/.well-known/mcp.json")
    else:
        record("4 use the product (MCP)", FAIL, "no MCP endpoint in llms.txt, page text or /.well-known/mcp.json")

    # 5. Next step — a link in llms.txt an agent can act on for its person.
    if not has_llms:
        record("5 next step", GREY, "needs llms.txt to judge (see 2a)")
    else:
        m = NEXT_STEP.search(llms)
        record("5 next step", PASS if m else FAIL, m.group(1) if m else "no contact / book / trial link in llms.txt")

    return results


def main(argv):
    sites = argv or ["https://universalagents.ai", "https://interplay.md"]
    verdicts = []
    for site in sites:
        print(f"\n{site}")
        for name, verdict, detail in check_site(site):
            verdicts.append(verdict)
            print(f"  {verdict:<14} {name:<26} {detail}")
    passed = verdicts.count(PASS)
    print(f"\n{passed}/{len(verdicts)} pass · {verdicts.count(FAIL)} fail · {verdicts.count(GREY)} couldnt-check")
    return 1 if FAIL in verdicts else 2 if GREY in verdicts else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
