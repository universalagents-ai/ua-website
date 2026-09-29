#!/usr/bin/env python3
"""Agent-readiness check: can an AI agent landing cold use this site?

Fetches a site the way AI agents do and reports each check as
pass, fail, or couldnt-check. An unrunnable check never passes.

Checks 1-5: can an agent use the site cold. Checks 6-8 (numbered 8-10 in the
roadmap): structured data, a published agent-traffic report, an MCP registry listing.
Check 11: the MCP server's instructions, tools and replies carry no hidden instructions,
invisible Unicode or terminal controls.

Usage: python3 scripts/agent-check.py [https://universalagents.ai ...]
Exit:  0 all pass · 1 any fail · 2 no fail, but something couldn't be checked
Stdlib only, to match the site's no-npm stance.
"""
import html
import json
import re
import sys
import urllib.error
import urllib.request
import urllib.robotparser
from urllib.parse import urljoin, urlparse

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
PRICE = re.compile(r"[$€£]\s?\d[\d,.]*\s?[kK]?(?:\s?[–-]\s?[$€£]?\d[\d,.]*\s?[kK]?)?\s*(?:/|per|a|an|each|for)\s*(?:\d+\s*(?:to|–|-)\s*)?\d*\s*(?:month|mo|year|yr|seat|user|call|credit|weeks?)\b", re.I)
MCP = re.compile(r"https?://(?:mcp\.[^\s)\"'<>]+|[^\s)\"'<>]+/mcp/?)(?=[\s)\"'<>]|$)", re.I)
NEXT_STEP = re.compile(r"\]\((mailto:[^)]+|https?://[^)]*(book|demo|contact|trial|sign-?up|get-started|calendly|cal\.com)[^)]*)\)", re.I)
MIN_WORDS = 150
# Announce ourselves so the site's agent-traffic log can leave our fake agents out.
SELF = {"X-Agent-Check": "ua-agent-check"}

PASS, FAIL, GREY = "pass", "fail", "couldnt-check"


class _FollowAll(urllib.request.HTTPRedirectHandler):
    """Follow 308 like 307 — agents do, and Python before 3.11 does not."""
    def http_error_308(self, req, fp, code, msg, headers):
        return self.http_error_307(req, fp, code, msg, headers)

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if code == 308:
            code = 307
        return super().redirect_request(req, fp, code, msg, headers, newurl)


urllib.request.install_opener(urllib.request.build_opener(_FollowAll))

def fetch(url, agent="ClaudeBot", accept="*/*"):
    """Return (status, content_type, body) or (None, None, error-text)."""
    req = urllib.request.Request(url, headers={"User-Agent": AGENTS[agent], "Accept": accept, **SELF})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, r.headers.get("Content-Type", ""), r.read(2_000_000).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get("Content-Type", ""), e.read(200_000).decode("utf-8", "replace")
    except Exception as e:  # network, TLS, timeout
        return None, None, str(e)


def final_url(url, agent):
    """Where a fetch actually lands after redirects, or None if it failed."""
    req = urllib.request.Request(url, headers={"User-Agent": AGENTS[agent], **SELF})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.geturl()
    except Exception:
        return None

def mcp_rpc(url, session, payload):
    """POST one JSON-RPC message to an MCP endpoint. Returns (status, reply or None)."""
    headers = {"User-Agent": AGENTS["Claude-User"], "Content-Type": "application/json",
               "Accept": "application/json, text/event-stream", **SELF, **session}
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            if r.headers.get("Mcp-Session-Id"):
                session["Mcp-Session-Id"] = r.headers["Mcp-Session-Id"]
            text = r.read(1_000_000).decode("utf-8", "replace")
            if r.status == 202 or not text.strip():
                return r.status, None
            if "event-stream" in (r.headers.get("Content-Type") or ""):
                data = [l[5:].strip() for l in text.splitlines() if l.startswith("data:")]
                text = data[-1] if data else "null"
            return r.status, json.loads(text)
    except urllib.error.HTTPError as e:
        return e.code, None
    except (ValueError, json.JSONDecodeError):
        return 200, None


def mcp_probe(url):
    """Talk to an MCP endpoint the way an agent would: initialize, list tools, call one.

    Returns (verdict, detail). Finding an address proves nothing; only a working call passes.
    """
    session = {}

    def rpc(payload):
        return mcp_rpc(url, session, payload)

    try:
        status, init = rpc({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
            "protocolVersion": "2025-06-18", "capabilities": {},
            "clientInfo": {"name": "ua-agent-check", "version": "1.0"}}})
    except Exception as e:  # network, TLS, timeout
        return GREY, f"{url} unreachable: {e}"
    if status in (401, 403):
        return GREY, f"{url} needs auth ({status}); tools not verifiable cold"
    if not (init or {}).get("result", {}).get("protocolVersion"):
        return FAIL, f"{url} did not answer initialize (status {status})"
    rpc({"jsonrpc": "2.0", "method": "notifications/initialized"})
    _, listed = rpc({"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
    tools = (listed or {}).get("result", {}).get("tools") or []
    if not tools:
        return FAIL, f"{url} initialized but lists no tools"
    callable_ = [t for t in tools if not (t.get("inputSchema") or {}).get("required")]
    if not callable_:
        return PASS, f"{url}: {len(tools)} tools (none callable without arguments, so none called)"
    tool = callable_[0]["name"]
    _, called = rpc({"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": tool, "arguments": {}}})
    result = (called or {}).get("result") or {}
    if result.get("isError") or not result.get("content"):
        return FAIL, f"{url}: {len(tools)} tools, but calling {tool} returned no content"
    return PASS, f"{url}: {len(tools)} tools; called {tool} and got an answer"


# Check 11's rules: phrasing aimed at a model, invisible or bidirectional Unicode, and
# terminal controls (everything below U+0020 except tab, newline and return; DEL; C1).
# tests/mcp-island.test.mjs reads this JSON from here, so the two scans cannot drift apart.
SCAN_RULES = json.loads(r"""{
  "phrases": [
    "(ignore|disregard|forget) (all |any )?(the |your )?(previous|prior|above|earlier)",
    "(do not|don[’']?t|never) (mention|tell|reveal|disclose)",
    "without (telling|informing) the user",
    "\\binvisible\\b",
    "system prompt",
    "<\\s*/?\\s*(system|important|instructions?)\\s*>",
    "(new|hidden|secret) instructions",
    "\\byou are now\\b"
  ],
  "invisible": ["00AD", "061C", "180E", "200B-200F", "202A-202E", "2060-2064", "2066-2069", "FEFF", "E0000-E007F"],
  "control": ["0000-0008", "000B-000C", "000E-001F", "007F-009F"]
}""")
SCAN_PHRASES = [re.compile(p, re.I) for p in SCAN_RULES["phrases"]]


def code_span(rule):
    """'200B-200F' -> (0x200B, 0x200F); 'FEFF' -> (0xFEFF, 0xFEFF)."""
    lo, _, hi = rule.partition("-")
    return int(lo, 16), int(hi or lo, 16)


SCAN_CHARS = {kind: [code_span(r) for r in SCAN_RULES[kind]] for kind in ("invisible", "control")}


def scan_findings(value, where="$"):
    """Every rule hit in the keys and strings of a JSON value."""
    found = []
    if isinstance(value, dict):
        for k, v in value.items():
            found += scan_findings(k, where) + scan_findings(v, f"{where}.{k}")
    elif isinstance(value, list):
        for i, v in enumerate(value):
            found += scan_findings(v, f"{where}[{i}]")
    elif isinstance(value, str):
        found += [f"{where}: /{p.pattern}/" for p in SCAN_PHRASES if p.search(value)]
        for kind, ranges in SCAN_CHARS.items():
            hits = sorted({f"U+{ord(c):04X}" for c in value if any(lo <= ord(c) <= hi for lo, hi in ranges)})
            if hits:
                found.append(f"{where}: {kind} {' '.join(hits)}")
    return found


def mcp_scan(url):
    """Scan what an MCP server tells an agent: its instructions, tools/list, and one call of
    each tool that needs no arguments. Returns (verdict, detail)."""
    session = {}
    try:
        _, init = mcp_rpc(url, session, {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
            "protocolVersion": "2025-06-18", "capabilities": {},
            "clientInfo": {"name": "ua-agent-check", "version": "1.0"}}})
        if not (init or {}).get("result"):
            return GREY, f"{url} did not answer initialize; nothing to scan (see 4)"
        mcp_rpc(url, session, {"jsonrpc": "2.0", "method": "notifications/initialized"})
        _, listed = mcp_rpc(url, session, {"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
        tools = (listed or {}).get("result", {}).get("tools") or []
        if not tools:
            return GREY, f"{url} lists no tools; nothing to scan (see 4)"
        found = scan_findings(init["result"].get("instructions", ""), "instructions") + scan_findings(tools, "tools")
        called = [t.get("name") for t in tools if not (t.get("inputSchema") or {}).get("required")]
        for i, name in enumerate(called):
            _, reply = mcp_rpc(url, session, {"jsonrpc": "2.0", "id": 3 + i, "method": "tools/call",
                                              "params": {"name": name, "arguments": {}}})
            found += scan_findings((reply or {}).get("result"), str(name))
    except Exception as e:  # network, TLS, timeout
        return GREY, f"{url} unreachable: {e}"
    if found:
        return FAIL, f"{len(found)} hits: " + "; ".join(found[:5])
    return PASS, f"{len(tools)} tools and {len(called)} calls scanned: no hidden instructions, invisible Unicode or terminal controls"


REGISTRY = "https://registry.modelcontextprotocol.io/v0/servers"
LD_JSON = re.compile(r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', re.S | re.I)
MONEY = re.compile(r"\$\s?(\d[\d,.]*)\s?([kK])?(?:\s?[–-]\s?\$?(\d[\d,.]*)\s?([kK])?)?")


def money_values(text):
    """Every dollar amount in text, with ranges expanded ('$24–28K' -> 24000, 28000)."""
    out = set()
    for lo, lo_k, hi, hi_k in MONEY.findall(text):
        k = 1000 if (lo_k or hi_k) else 1
        out.add(round(float(lo.replace(",", "")) * (1000 if lo_k else k)))
        if hi:
            out.add(round(float(hi.replace(",", "")) * (1000 if hi_k else 1)))
    return out


def ld_nodes(page):
    """All JSON-LD nodes on a page, flattened out of @graph."""
    nodes = []
    for block in LD_JSON.findall(page):
        try:
            data = json.loads(block)
        except ValueError:
            continue
        for item in data if isinstance(data, list) else [data]:
            nodes += item.get("@graph", [item]) if isinstance(item, dict) else []
    return nodes


def ld_prices(node, found=None):
    found = set() if found is None else found
    if isinstance(node, dict):
        for key in ("price", "minPrice", "maxPrice"):
            if isinstance(node.get(key), (int, float)) or str(node.get(key, "")).replace(".", "").isdigit():
                found.add(round(float(node[key])))
        for v in node.values():
            ld_prices(v, found)
    elif isinstance(node, list):
        for v in node:
            ld_prices(v, found)
    return found


def reverse_dns(host):
    return ".".join(reversed(host.removeprefix("www.").split(".")))

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
        landed = final_url(base, agent)
        if status is None:
            unreachable.append(agent)
        elif landed and urlparse(landed).netloc.removeprefix("www.") != urlparse(base).netloc.removeprefix("www."):
            blocked.append(f"{agent}=redirected to {urlparse(landed).netloc}")  # a login wall is not the site
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

    # 4. Use the product — an advertised MCP endpoint that actually answers.
    candidates = []
    wk_status, wk_type, wk_body = fetch(urljoin(base, ".well-known/mcp.json"))
    if wk_status == 200 and "json" in (wk_type or ""):  # an HTML fallback is not a manifest
        try:
            card_url = json.loads(wk_body).get("url")
            if card_url:
                candidates.append(card_url)
        except (ValueError, AttributeError):
            pass
    candidates += [u for u in MCP.findall(corpus) if u not in candidates]
    if not candidates:
        record("4 use the product (MCP)", FAIL, "no MCP endpoint in llms.txt, page text or /.well-known/mcp.json")
    else:
        verdict, detail = mcp_probe(candidates[0])
        record("4 use the product (MCP)", verdict, detail)

    # 5. Next step — a link in llms.txt an agent can act on for its person.
    if not has_llms:
        record("5 next step", GREY, "needs llms.txt to judge (see 2a)")
    else:
        m = NEXT_STEP.search(llms)
        record("5 next step", PASS if m else FAIL, m.group(1) if m else "no contact / book / trial link in llms.txt")


    # 8. Structured data — schema.org JSON-LD names the organization, and any price in it
    #    matches llms.txt (prices have drifted between copies here before).
    pages = [home or ""]
    links = set()
    for href in re.findall(r'href="([^"#?]+)"', home or ""):
        u = urljoin(base, href)
        if urlparse(u).netloc == urlparse(base).netloc and not re.search(r"\.(css|js|png|svg|ico|jpg|mp4|xml|txt|md|json)$", u) \
                and u.rstrip("/") != base.rstrip("/"):
            links.add(u)
    for u in sorted(links)[:5]:
        _, _, body = fetch(u)
        pages.append(body or "")
    nodes = [n for p in pages for n in ld_nodes(p)]
    orgs = [n for n in nodes if "Organization" in str(n.get("@type")) and n.get("name") and n.get("url")]
    ld_money = ld_prices(nodes)
    if home is None:
        record("8 structured data", GREY, "no agent got the page")
    elif not orgs:
        record("8 structured data", FAIL, f"no schema.org Organization with name and url ({len(nodes)} JSON-LD nodes)")
    elif ld_money and has_llms and not ld_money <= money_values(llms):
        record("8 structured data", FAIL, f"JSON-LD prices {sorted(ld_money - money_values(llms))} are not in llms.txt")
    else:
        extra = f"; {len(ld_money)} prices, all match llms.txt" if ld_money and has_llms else ""
        record("8 structured data", PASS, f"Organization '{orgs[0]['name']}' in {len(nodes)} JSON-LD nodes{extra}")

    # 9. Agent traffic — the site publishes which AI platforms read it. Private logs can't be
    #    seen from outside, so without a public report this is couldnt-check, never pass.
    t_status, t_type, t_body = fetch(urljoin(base, ".well-known/agent-traffic.json"))
    report = None
    if t_status == 200 and "json" in (t_type or ""):
        try:
            report = json.loads(t_body)
        except ValueError:
            report = None
    if report is None:
        record("9 agent traffic", GREY, "no public /.well-known/agent-traffic.json; any logging is invisible from outside")
    else:
        from datetime import datetime, timezone
        try:
            age = (datetime.now(timezone.utc) - datetime.fromisoformat(str(report.get("updated")).replace("Z", "+00:00"))).days
        except ValueError:
            age = None
        platforms = report.get("platforms") or {}
        if age is None:
            record("9 agent traffic", FAIL, "report has no valid 'updated' timestamp")
        elif age > 7:
            record("9 agent traffic", FAIL, f"report is {age} days old")
        else:
            record("9 agent traffic", PASS, f"report updated {age}d ago; platforms: {', '.join(sorted(platforms)) or 'none yet'}")

    # 10. Registry — the advertised MCP endpoint is listed in the official MCP registry.
    if not candidates:
        record("10 MCP registry", GREY, "no MCP endpoint advertised (see 4)")
    else:
        ns = reverse_dns(urlparse(base).netloc)
        r_status, _, r_body = fetch(f"{REGISTRY}?search={ns}&limit=100")
        if r_status != 200:
            record("10 MCP registry", GREY, f"registry unreachable (status {r_status})")
        else:
            entries = [e.get("server", e) for e in json.loads(r_body).get("servers", [])]
            listed = [e["name"] for e in entries if any(r.get("url") == candidates[0] for r in e.get("remotes") or [])]
            if listed:
                record("10 MCP registry", PASS, f"{listed[0]} lists {candidates[0]}")
            else:
                record("10 MCP registry", FAIL, f"no registry entry under {ns} lists {candidates[0]}")

    # 11. MCP scan — nothing the server tells an agent hides an instruction (Island's manipulation risk).
    if not candidates:
        record("11 MCP scan", GREY, "no MCP endpoint advertised (see 4)")
    else:
        verdict, detail = mcp_scan(candidates[0])
        record("11 MCP scan", verdict, detail)

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
