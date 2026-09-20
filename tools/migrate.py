#!/usr/bin/env python3
"""
QuantumindSSI — page migration to the new design system.

What this does to each page:
  1. Rewrites <head>: one font request, the five system stylesheets.
  2. Strips system-owned rules out of the page's inline <style>, leaving only
     genuinely page-specific CSS. (Cascade order then works correctly: system
     first, page overrides after.)
  3. Replaces the hand-rolled cockpit chrome, ticker, nav and clock bar with
     the canonical HUD + header, which reserve their own space.
  4. Deletes the dead legacy <header> that was killed by `header{display:none}`.
  5. Ensures the content sits inside <main id="main"> and adds a skip link.
  6. Replaces the link-less two-line footer with the canonical linked footer.
  7. Wires js/config.js, js/api.js and js/qssi.js.

Idempotent: running twice is a no-op.

Usage:  python3 tools/migrate.py [file.html ...]
"""

import re
import sys
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
MARKER = "<!-- qssi:migrated -->"

# ── Pages whose nav entry should light up for a given file ──────────────────
NAV_MATCH = {
    "products.html":   ["local-ai.html", "qmx-spec.html"],
    "technical.html":  ["10g.html"],
    "about-us.html":   ["careers.html"],
}

TITLE_FALLBACK = "QuantumindSSI"


# ════════════════════════════════════════════════════════════════════════════
# CSS STRIPPING
# ════════════════════════════════════════════════════════════════════════════

# Selectors now owned by the design system. A rule is dropped when EVERY one
# of its selectors matches one of these patterns.
SYSTEM_SELECTORS = [
    r"^:root$",
    r"^\*(\s*,\s*\*::(before|after))*$",
    r"^\*::(before|after)$",
    r"^html$", r"^body$", r"^a$", r"^img$", r"^svg$",
    r"^html\s*,\s*body$",
    r"^h[1-6]$",
    r"^button$", r"^input$", r"^textarea$", r"^select$",
    r"^(input|button|select|textarea)(\s*,\s*(input|button|select|textarea))*$",
    r"^::(-webkit-input-|-moz-|-ms-input-)?placeholder$",
    r"^::(-moz-)?selection$",
    r"^blockquote$", r"^cite$", r"^hr$", r"^table$", r"^caption$",

    # chrome
    r"^nav\b", r"^header\b", r"^footer\b",
    r"^\.nav[-_]",
    r"^\.brand\b",
    r"^\.logo", r"^\.header-content",
    r"^\.ticker",
    r"^\.clock-bar",
    r"^\.container$", r"^\.container\s",
    r"^\.ui-frame", r"^\.cockpit-frame",
    r"^\.rail", r"^\.bar$", r"^\.bar[-\s.]", r"^\.bar\.",
    r"^\.crosshair", r"^\.scanline", r"^\.scan-line",
    r"^\.tech-grid", r"^\.glow-orb", r"^\.bg-carousel",
    r"^\.corner-bracket", r"^\.rail-corner",
    r"^\.vertical-text", r"^\.v-text", r"^\.tick-marks",
    r"^\.status-dot", r"^\.unit-id",
    r"^\.grid-overlay", r"^\.node-lines",
    r"^\.footer[-_]",
    r"^\.hero$", r"^\.hero\s", r"^\.hero[-_]",
    r"^\.page-view$",
    r"^\.section-header",
    r"^\.skip",
    # The old pages hand-compensated for the fixed rails with
    # `main { margin: 0 36px }`. The shell reserves that space now.
    r"^main$",
    r"^\.visually-hidden$", r"^\.sr-only$",

    # buttons / forms now owned by components.css
    r"^\.btn$", r"^\.btn:", r"^\.btn-primary", r"^\.btn-preorder",
    r"^\.form-status", r"^\.form-group", r"^\.form-label",
    r"^\.qssi-modal",

    # legacy responsive hacks that matched inline style strings
    r"^\[style\*=",
]

SYSTEM_KEYFRAMES = {
    "ticker", "pulse", "float", "gridpulse", "scanmove", "scanline",
    "kenburns", "spin", "fadein", "fadeinup", "slideup", "blink",
}

_sel_res = [re.compile(p, re.I) for p in SYSTEM_SELECTORS]


def _is_system_selector(sel: str) -> bool:
    sel = sel.strip()
    if not sel:
        return False
    return any(r.search(sel) for r in _sel_res)


def _split_selectors(prelude: str):
    depth = 0
    buf = ""
    out = []
    for ch in prelude:
        if ch in "([":
            depth += 1
        elif ch in ")]":
            depth -= 1
        if ch == "," and depth == 0:
            out.append(buf)
            buf = ""
        else:
            buf += ch
    if buf.strip():
        out.append(buf)
    return [s.strip() for s in out if s.strip()]


def _tokenize(css: str):
    """Yield (prelude, block_or_None, raw) for each top-level rule."""
    i, n = 0, len(css)
    while i < n:
        # comments
        if css.startswith("/*", i):
            j = css.find("*/", i + 2)
            j = n if j == -1 else j + 2
            yield (None, None, css[i:j])
            i = j
            continue

        if css[i] in " \t\r\n":
            j = i
            while j < n and css[j] in " \t\r\n":
                j += 1
            yield (None, None, css[i:j])
            i = j
            continue

        # find prelude up to { or ;
        depth = 0
        j = i
        while j < n:
            c = css[j]
            if c in "([":
                depth += 1
            elif c in ")]":
                depth -= 1
            elif c == "{" and depth == 0:
                break
            elif c == ";" and depth == 0:
                break
            j += 1

        if j >= n:
            yield (None, None, css[i:])
            return

        if css[j] == ";":                       # at-statement, e.g. @import
            yield (css[i:j].strip(), None, css[i:j + 1])
            i = j + 1
            continue

        prelude = css[i:j].strip()

        # balanced block
        k = j
        depth = 0
        while k < n:
            if css[k] == "{":
                depth += 1
            elif css[k] == "}":
                depth -= 1
                if depth == 0:
                    break
            k += 1

        block = css[j + 1:k]
        yield (prelude, block, css[i:k + 1])
        i = k + 1


def strip_system_css(css: str) -> str:
    out = []
    for prelude, block, raw in _tokenize(css):
        if prelude is None:                     # whitespace / comment
            out.append(raw)
            continue

        low = prelude.lower()

        if low.startswith("@keyframes") or low.startswith("@-webkit-keyframes"):
            name = low.split()[-1].strip()
            if name in SYSTEM_KEYFRAMES:
                continue
            out.append(raw)
            continue

        if low.startswith("@media") or low.startswith("@supports"):
            inner = strip_system_css(block)
            if inner.strip():
                out.append(f"{prelude} {{{inner}}}")
            continue

        if low.startswith("@font-face") or low.startswith("@import"):
            continue                            # fonts are loaded once, in <head>

        if low.startswith("@"):
            out.append(raw)
            continue

        sels = _split_selectors(prelude)
        if sels and all(_is_system_selector(s) for s in sels):
            continue

        out.append(raw)

    return "".join(out)


def tidy(css: str) -> str:
    css = re.sub(r"\n{3,}", "\n\n", css)
    css = re.sub(r"(\n\s*){2,}\}", "\n}", css)
    return css.strip()


# ════════════════════════════════════════════════════════════════════════════
# MARKUP FRAGMENTS
# ════════════════════════════════════════════════════════════════════════════

HEAD_ASSETS = """  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&display=swap">

  <link rel="stylesheet" href="css/tokens.css">
  <link rel="stylesheet" href="css/base.css">
  <link rel="stylesheet" href="css/layout.css">
  <link rel="stylesheet" href="css/hud.css">
  <link rel="stylesheet" href="css/components.css">
  <link rel="stylesheet" href="css/compat.css">"""

HUD = """  <a class="skip-link" href="#main">Skip to content</a>

  <div class="hud" aria-hidden="true">
    <div class="hud__bar hud__bar--top">
      <span class="hud__readout hud__readout--key">QuantumindSSI</span>
      <span class="hud__readout">
        <span class="hud__value" data-clock-time>00:00:00 UTC</span>
        <span class="hud__sep"></span>
        <span class="hud__lamp"></span>Systems nominal
      </span>
      <span class="hud__readout">LDN-01</span>
    </div>
    <div class="hud__rail hud__rail--left">
      <span class="hud__vtext">London node &middot; Online</span>
      <span class="hud__ticks"></span>
      <span class="hud__lamp"></span>
    </div>
    <div class="hud__rail hud__rail--right">
      <span class="hud__lamp"></span>
      <span class="hud__ticks"></span>
      <span class="hud__vtext">Research node &middot; Active</span>
    </div>
    <div class="hud__bar hud__bar--bottom">
      <span class="hud__readout">Victron hardware</span>
      <span class="hud__readout">Heimdall robotics</span>
      <span class="hud__readout hud__readout--ok">Sovereign AI active</span>
    </div>
    <span class="hud__bracket hud__bracket--tl"></span>
    <span class="hud__bracket hud__bracket--tr"></span>
    <span class="hud__bracket hud__bracket--bl"></span>
    <span class="hud__bracket hud__bracket--br"></span>
  </div>

  <div class="hud-grid" aria-hidden="true"></div>
  <div class="hud-scan" aria-hidden="true"></div>

  <div class="ticker" data-ticker>
    <div class="ticker__track">
      <span class="ticker__item"><b>QuantumindSSI</b><span class="ticker__dot">&middot;</span>Victron computing platform</span>
      <span class="ticker__item"><b>Heimdall</b><span class="ticker__dot">&middot;</span>Sovereign humanoid robotics</span>
      <span class="ticker__item"><b>13 core pillars</b><span class="ticker__dot">&middot;</span>260 products</span>
      <span class="ticker__item"><b>Sovereign AI</b><span class="ticker__dot">&middot;</span>Zero cloud dependency</span>
      <span class="ticker__item"><b>Quantum resistant</b><span class="ticker__dot">&middot;</span>Post-quantum cryptography</span>
      <span class="ticker__item"><b>London HQ</b><span class="ticker__dot">&middot;</span>Online</span>
    </div>
  </div>
"""


def header_markup(filename: str) -> str:
    def attr(href):
        extra = NAV_MATCH.get(href)
        return f' data-nav-match="{" ".join(extra)}"' if extra else ""

    links = [
        ("index.html", "Home"),
        ("products.html", "Products"),
        ("technical.html", "Technical"),
        ("fbc.html", "FBC"),
        ("research.html", "Research"),
        ("case-studies.html", "Case Studies"),
        ("community.html", "Community"),
        ("about-us.html", "About"),
    ]
    items = "\n".join(
        f'          <a href="{h}"{attr(h)}>{label}</a>' for h, label in links
    )

    return f"""  <header class="site-header">
    <nav class="site-nav" aria-label="Primary">
      <a class="brand" href="index.html">
        <img class="brand__mark" src="quantumind-logo-transparent.png" alt="" width="34" height="34">
        <span><span class="brand__name">Quantumind</span><span class="brand__suffix">SSI</span></span>
      </a>

      <div class="nav-drawer" data-nav-drawer id="nav-drawer">
        <div class="nav-drawer__head">
          <span class="text-label">Navigation</span>
          <button type="button" class="btn-icon" data-nav-toggle aria-label="Close menu">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>

        <div class="nav-links" data-nav-links>
{items}
        </div>

        <div class="nav-actions">
          <span class="nav-status">System online</span>
          <a class="btn btn--ghost btn--sm" href="contact.html">Contact</a>
          <a class="btn btn--primary btn--sm" href="pre-order.html">Pre-order</a>
        </div>
      </div>

      <button type="button" class="nav-toggle" data-nav-toggle
              aria-expanded="false" aria-controls="nav-drawer" aria-label="Open menu">
        <span class="nav-toggle__bars"></span>
      </button>
    </nav>

    <div class="systembar">
      <span class="systembar__group">
        <time data-clock-date>&mdash;</time>
        <span class="hud__sep"></span>
        <time data-clock-time>00:00:00 UTC</time>
      </span>
      <span class="systembar__group systembar__group--secondary">
        <span>London &middot; United Kingdom</span>
        <span class="hud__sep"></span>
        <span class="text-ok">All systems operational</span>
      </span>
    </div>
  </header>

  <div class="nav-scrim" data-nav-scrim></div>
"""


FOOTER = """  <footer class="site-footer">
    <div class="container">
      <div class="site-footer__main">
        <div class="site-footer__brand stack">
          <a class="brand" href="index.html">
            <img class="brand__mark" src="quantumind-logo-transparent.png" alt="" width="34" height="34" loading="lazy">
            <span><span class="brand__name">Quantumind</span><span class="brand__suffix">SSI</span></span>
          </a>
          <p>The sovereign AI lab. Frontier intelligence engineered end to end &mdash; silicon, systems and the infrastructure that powers them.</p>
          <p class="text-label">London &middot; United Kingdom</p>
        </div>

        <div class="site-footer__nav">
          <div class="footer-col">
            <h2 class="footer-col__title">Platform</h2>
            <ul>
              <li><a href="products.html">Products</a></li>
              <li><a href="local-ai.html">Local AI instance</a></li>
              <li><a href="qmx-spec.html">QMX specification</a></li>
              <li><a href="10g.html">10G networking</a></li>
              <li><a href="pre-order.html">Pre-order</a></li>
            </ul>
          </div>
          <div class="footer-col">
            <h2 class="footer-col__title">Research</h2>
            <ul>
              <li><a href="technical.html">Technical</a></li>
              <li><a href="fbc.html">FBC cognition</a></li>
              <li><a href="research.html">Research</a></li>
              <li><a href="case-studies.html">Case studies</a></li>
            </ul>
          </div>
          <div class="footer-col">
            <h2 class="footer-col__title">Company</h2>
            <ul>
              <li><a href="about-us.html">About us</a></li>
              <li><a href="careers.html">Careers</a></li>
              <li><a href="community.html">Community</a></li>
              <li><a href="news.html">News</a></li>
            </ul>
          </div>
          <div class="footer-col">
            <h2 class="footer-col__title">Support</h2>
            <ul>
              <li><a href="contact.html">Contact</a></li>
              <li><a href="faq.html">FAQ</a></li>
              <li><a href="privacy-policy.html">Privacy policy</a></li>
              <li><a href="terms-and-conditions.html">Terms &amp; conditions</a></li>
            </ul>
          </div>
        </div>
      </div>

      <div class="site-footer__bottom">
        <span>&copy; <span data-year>2026</span> QuantumindSSI Ltd &middot; Intelligence without compromise</span>
        <span class="cluster cluster--sm">
          <a href="privacy-policy.html">Privacy</a>
          <span class="hud__sep"></span>
          <a href="terms-and-conditions.html">Terms</a>
        </span>
      </div>
    </div>
  </footer>
"""

SCRIPTS = """  <script src="js/config.js"></script>
  <script src="js/api.js"></script>
  <script src="js/qssi.js" defer></script>
  <script>
    document.querySelectorAll('[data-year]').forEach(function (el) {
      el.textContent = new Date().getFullYear();
    });
  </script>
"""


# ════════════════════════════════════════════════════════════════════════════
# ELEMENT REMOVAL
# ════════════════════════════════════════════════════════════════════════════

def remove_element(html: str, pattern: str, limit: int = 0) -> str:
    """Remove balanced elements whose opening tag matches `pattern`."""
    count = 0
    while limit == 0 or count < limit:
        m = re.search(pattern, html, re.I)
        if not m:
            break

        tag = re.match(r"<\s*([a-zA-Z][\w-]*)", m.group(0)).group(1)
        start = m.start()

        # self-closing / void
        if m.group(0).rstrip().endswith("/>"):
            html = html[:start] + html[m.end():]
            count += 1
            continue

        depth = 0
        pos = start
        open_re = re.compile(rf"<\s*{tag}\b", re.I)
        close_re = re.compile(rf"<\s*/\s*{tag}\s*>", re.I)

        while pos < len(html):
            o = open_re.search(html, pos)
            c = close_re.search(html, pos)
            if not c:
                break
            if o and o.start() < c.start():
                depth += 1
                pos = o.end()
            else:
                depth -= 1
                pos = c.end()
                if depth == 0:
                    break

        html = html[:start] + html[pos:]
        count += 1

    return html


# ════════════════════════════════════════════════════════════════════════════
# ACCESSIBILITY REPAIRS
# ════════════════════════════════════════════════════════════════════════════

def fix_labels(html: str) -> str:
    """
    Associate orphaned <label> elements with the control that follows them.

    The previous build wrote labels as siblings with no `for` and no wrapping,
    across 48 controls on 7 pages. Every <select> therefore had no accessible
    name at all, and the only name source for text inputs was the placeholder.
    """
    pattern = re.compile(
        r"(<label(?![^>]*\bfor=)([^>]*)>)(.*?)(</label>)"
        r"(\s*)"
        r"(<(input|select|textarea)\b[^>]*>)",
        re.S | re.I,
    )

    def repl(m):
        open_tag, attrs, text, close, gap, ctrl, _ = m.groups()

        id_m = re.search(r'\bid="([^"]+)"', ctrl)
        if not id_m:
            return m.group(0)

        ctrl_id = id_m.group(1)
        open_tag = open_tag[:-1] + f' for="{ctrl_id}">'

        # Mirror `required` onto the label so the marker is not colour-only
        if re.search(r"\brequired\b", ctrl, re.I) and "data-required" not in open_tag:
            open_tag = open_tag[:-1] + " data-required>"

        # Placeholders are no longer doing label duty; give inputs autocomplete
        ac = {
            "name": "name", "email": "email", "org": "organization",
            "country": "country-name", "linkedin": "url", "portfolio": "url",
        }
        for key, token in ac.items():
            if re.search(rf'\bid="[\w-]*{key}"', ctrl) and "autocomplete=" not in ctrl:
                ctrl = ctrl[:-1].rstrip() + f' autocomplete="{token}">'
                break

        return f"{open_tag}{text}{close}{gap}{ctrl}"

    return pattern.sub(repl, html)


def fix_a11y(html: str) -> str:
    # Status containers must be announced
    html = re.sub(
        r'(<(?:div|span|p)\b[^>]*class="[^"]*\b(?:modal-status|form-status)\b[^"]*")((?![^>]*\brole=)[^>]*>)',
        r'\1 role="status" aria-live="polite"\2',
        html, flags=re.I,
    )

    # "&times;" close buttons announce as "multiplication sign"
    html = re.sub(
        r'(<button\b(?![^>]*aria-label)[^>]*class="[^"]*\bqssi-modal-close\b[^"]*")',
        r'\1 aria-label="Close dialog"',
        html, flags=re.I,
    )

    # Decorative SVGs must not be exposed
    html = re.sub(
        r"<svg\b(?![^>]*(?:aria-label|aria-hidden|role=))",
        '<svg aria-hidden="true"',
        html, flags=re.I,
    )

    # The logo sits inside a link that already says "QuantumindSSI"
    html = re.sub(
        r'(<img\b[^>]*src="quantumind-logo-transparent\.png"[^>]*\balt=")[^"]*(")',
        r"\1\2",
        html, flags=re.I,
    )

    # Images need intrinsic dimensions and lazy loading below the fold
    html = re.sub(
        r"<img\b(?![^>]*\bloading=)((?:[^>]*?))>",
        lambda m: f'<img{m.group(1)} loading="lazy" decoding="async">',
        html, flags=re.I,
    )

    # Placeholder links go nowhere and all read "Read More"
    html = re.sub(r'<a\s+href="#"', '<a href="news.html"', html, flags=re.I)

    # External links need rel
    html = re.sub(
        r'(<a\b[^>]*target="_blank"(?![^>]*\brel=)[^>]*)>',
        r'\1 rel="noopener noreferrer">',
        html, flags=re.I,
    )

    return html


CHROME_PATTERNS = [
    r'<div[^>]*class="[^"]*\bticker\b[^"]*"[^>]*>',
    r'<div[^>]*class="[^"]*\bui-frame\b[^"]*"[^>]*>',
    r'<div[^>]*class="[^"]*\bcockpit-frame\b[^"]*"[^>]*>',
    r'<div[^>]*class="[^"]*\bbg-carousel\b[^"]*"[^>]*>',
    r'<div[^>]*class="[^"]*\btech-grid\b[^"]*"[^>]*>',
    r'<div[^>]*class="[^"]*\bscan-?line\b[^"]*"[^>]*>',
    r'<div[^>]*class="[^"]*\bglow-orb\b[^"]*"[^>]*>',
    r'<div[^>]*class="[^"]*\bclock-bar\b[^"]*"[^>]*>',
]


# ════════════════════════════════════════════════════════════════════════════
# PAGE MIGRATION
# ════════════════════════════════════════════════════════════════════════════

def migrate(path: pathlib.Path) -> str:
    html = path.read_text(encoding="utf-8")

    if MARKER in html:
        return "already migrated"

    # ── HEAD ────────────────────────────────────────────────────────────────
    title_m = re.search(r"<title>(.*?)</title>", html, re.S | re.I)
    title = title_m.group(1).strip() if title_m else TITLE_FALLBACK

    desc_m = re.search(r'<meta\s+name="description"[^>]*>', html, re.I)
    desc = desc_m.group(0) if desc_m else ""

    # Strip all existing stylesheet + font links
    html = re.sub(r'\s*<link[^>]*rel="stylesheet"[^>]*>', "", html, flags=re.I)
    html = re.sub(r'\s*<link[^>]*fonts\.(googleapis|gstatic)[^>]*>', "", html, flags=re.I)
    html = re.sub(r'\s*<link[^>]*rel="preconnect"[^>]*>', "", html, flags=re.I)

    # Normalise viewport
    html = re.sub(
        r'<meta\s+name="viewport"[^>]*>',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        html, flags=re.I,
    )

    # ── PAGE CSS ────────────────────────────────────────────────────────────
    styles = re.findall(r"<style[^>]*>(.*?)</style>", html, re.S | re.I)
    html = re.sub(r"<style[^>]*>.*?</style>", "", html, flags=re.S | re.I)

    kept = tidy("\n".join(strip_system_css(s) for s in styles))

    page_css = ""
    if kept:
        page_css = (
            "\n  <style>\n"
            "  /* ── Page-specific styles ───────────────────────────────────\n"
            "     System-owned rules (reset, tokens, nav, footer, ticker,\n"
            "     cockpit chrome, container, hero, buttons, forms) have been\n"
            "     removed; they now live in css/. What remains is unique to\n"
            "     this page and cascades on top of the system. */\n"
            + kept + "\n  </style>\n"
        )

    # ── SCRIPTS: drop retired ones ──────────────────────────────────────────
    html = re.sub(r'\s*<script[^>]*src="(app|supabase-client)\.js"[^>]*>\s*</script>', "", html, flags=re.I)
    html = re.sub(r'\s*<script[^>]*src="https://cdn\.jsdelivr\.net/npm/@supabase[^"]*"[^>]*>\s*</script>', "", html, flags=re.I)

    # Retire inline chrome scripts (clock, carousel, hamburger) — js/qssi.js owns these
    def drop_chrome_script(m):
        body = m.group(0)
        if re.search(r"toggleNav|bg-carousel|clock-bar|live-clock|updateClock|nav-hamburger|bgCarousel", body, re.I):
            return ""
        return body

    html = re.sub(r"<script(?![^>]*src)[^>]*>.*?</script>", drop_chrome_script, html, flags=re.S | re.I)

    # ── ACCESSIBILITY REPAIRS ───────────────────────────────────────────────
    html = fix_labels(html)
    html = fix_a11y(html)

    # ── BODY CHROME ─────────────────────────────────────────────────────────
    for pat in CHROME_PATTERNS:
        html = remove_element(html, pat)

    # Existing nav / header / footer
    html = remove_element(html, r"<nav\b[^>]*>")
    html = remove_element(html, r"<header\b[^>]*>")
    html = remove_element(html, r"<footer\b[^>]*>")

    # ── ASSEMBLE HEAD ───────────────────────────────────────────────────────
    head_block = f"""<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{title}</title>
  {desc}
  <meta name="theme-color" content="#06080a">
  <link rel="icon" type="image/png" href="quantumind-logo-transparent.png">

{HEAD_ASSETS}
{page_css}</head>"""

    html = re.sub(r"<head>.*?</head>", lambda _: head_block, html, flags=re.S | re.I)

    # ── ASSEMBLE BODY ───────────────────────────────────────────────────────
    body_m = re.search(r"<body[^>]*>(.*)</body>", html, re.S | re.I)
    if not body_m:
        return "no <body>"

    inner = body_m.group(1)

    # Pull trailing scripts out so they land after the footer
    scripts = re.findall(r"<script\b.*?</script>", inner, re.S | re.I)
    inner = re.sub(r"<script\b.*?</script>", "", inner, flags=re.S | re.I)

    # Dialogs must sit outside <main>
    dialogs = re.findall(r"<dialog\b.*?</dialog>", inner, re.S | re.I)
    inner = re.sub(r"<dialog\b.*?</dialog>", "", inner, flags=re.S | re.I)

    inner = re.sub(r"\n{3,}", "\n\n", inner).strip()

    if re.search(r"<main\b", inner, re.I):
        inner = re.sub(r"<main\b[^>]*>", '<main class="site-main" id="main">', inner, count=1, flags=re.I)
        content = inner
    else:
        content = f'  <main class="site-main" id="main">\n{inner}\n  </main>'

    page_scripts = "\n".join("  " + s for s in scripts)
    page_dialogs = "\n".join("  " + d for d in dialogs)

    new_body = "\n".join(filter(None, [
        '<body class="page">',
        MARKER,
        HUD,
        header_markup(path.name),
        content,
        FOOTER,
        page_dialogs,
        SCRIPTS,
        page_scripts,
        "</body>",
    ]))

    html = html[:body_m.start()] + new_body + html[body_m.end():]
    html = re.sub(r"\n{3,}", "\n\n", html)

    path.write_text(html, encoding="utf-8")
    return "migrated"


def main():
    targets = sys.argv[1:]
    if targets:
        files = [ROOT / t for t in targets]
    else:
        files = sorted(p for p in ROOT.glob("*.html") if p.name != "index.html")

    for f in files:
        if not f.exists():
            print(f"  ??  {f.name}: not found")
            continue
        print(f"  ->  {f.name}: {migrate(f)}")


if __name__ == "__main__":
    main()
