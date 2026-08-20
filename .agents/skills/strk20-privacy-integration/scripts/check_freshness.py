#!/usr/bin/env python3
"""Check whether this skill's pinned facts still hold.

The skill tells you to verify versions, paths and statuses before finalising a
plan. That check is mechanical and identical every time, so it lives here rather
than being reinvented per run.

    python3 scripts/check_freshness.py            # everything
    python3 scripts/check_freshness.py --quick    # skip URL liveness (slowest part)

Exit code is 0 when nothing drifted, 1 when something did. DRIFT is not failure
— it means a claim needs re-reading before you cite it in a plan. Read the note
on each line: some drift is expected (a `next` tag moving) and some matters (a
package path disappearing, or a capability landing that the skill calls
"coming soon").

Stdlib only, so it runs anywhere Python does.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

UA = {"User-Agent": "strk20-skill-freshness-check"}
TIMEOUT = 20

# --- what the skill currently claims -------------------------------------
# Keep these in step with references/links.md when you update a pin.

# package: (dist-tag the skill points at, version it names, kind)
# kind "floor" means the skill pins ">= version", so a newer release is fine and
# only worth noting; "exact" means it names one version and any move needs review.
NPM_PINS = {
    "starknet": ("next", "10.4.0", "floor"),
    "@starknet-io/get-starknet-discovery": ("next", "6.0.3", "exact"),
    "@starknet-io/get-starknet-wallet-standard": ("next", "6.0.3", "exact"),
    "@starknet-io/types-js": ("latest", "0.10.3", "exact"),
    "@avnu/avnu-sdk": ("latest", "4.2.0", "exact"),
}


def version_key(v: str) -> tuple:
    """Compare release numbers, ignoring any prerelease suffix."""
    core = re.split(r"[-+]", v)[0]
    return tuple(int(p) if p.isdigit() else 0 for p in core.split("."))

MONOREPO = "starkware-libs/starknet-privacy"
EXPECTED_PACKAGES = {
    "ekubo_swap_anonymizer",
    "vesu_lending_anonymizer",
    "sub_account_anonymizer",
    "privacy",
}
# The skill explicitly tells agents NOT to cite the escrow page because this
# package does not exist. If it ever appears, that exclusion should be lifted.
ABSENT_PACKAGES = {"escrow"}

WALLET_API_SPEC = "0.10.3"  # latest stable the skill pins capability checks to


def get_json(url: str):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return json.load(r)


def line(status: str, label: str, note: str = "") -> tuple[bool, str]:
    mark = {"ok": "  ok  ", "drift": " DRIFT", "warn": " warn ", "err": " err  "}[status]
    return status == "drift", f"{mark} {label}" + (f"  — {note}" if note else "")


def check_npm() -> list[tuple[bool, str]]:
    out = []
    for pkg, (tag, expected, kind) in NPM_PINS.items():
        try:
            tags = get_json(f"https://registry.npmjs.org/{pkg}").get("dist-tags", {})
        except Exception as e:  # noqa: BLE001 - network shape varies
            out.append(line("err", pkg, f"lookup failed: {e}"))
            continue
        current = tags.get(tag)
        if current is None:
            out.append(line("drift", pkg, f"dist-tag '{tag}' no longer published"))
        elif current == expected:
            out.append(line("ok", pkg, f"{tag}={current}"))
        elif kind == "floor" and version_key(current) >= version_key(expected):
            # The skill pins a minimum, so a newer release is fine — but say so,
            # since a new major may still have broken something.
            out.append(line("ok", pkg, f"{tag}={current} (>= pinned {expected})"))
        else:
            out.append(
                line("drift", pkg, f"{tag} moved {expected} -> {current}; confirm the pin still applies")
            )
    return out


def check_monorepo() -> list[tuple[bool, str]]:
    out = []
    try:
        entries = get_json(f"https://api.github.com/repos/{MONOREPO}/contents/packages")
        names = {e["name"] for e in entries}
    except Exception as e:  # noqa: BLE001
        out.append(line("err", "monorepo packages", f"lookup failed: {e}"))
        return out

    for want in sorted(EXPECTED_PACKAGES):
        out.append(
            line("ok", f"packages/{want}") if want in names
            else line("drift", f"packages/{want}", "no longer present — the skill cites this path")
        )
    for gone in sorted(ABSENT_PACKAGES):
        out.append(
            line("drift", f"packages/{gone}", "now EXISTS — the skill's exclusion note should be lifted")
            if gone in names else line("ok", f"packages/{gone} absent", "exclusion note still valid")
        )
    for extra in sorted(names - EXPECTED_PACKAGES):
        out.append(line("warn", f"packages/{extra}", "new package the skill does not mention"))

    try:
        repo = get_json(f"https://api.github.com/repos/{MONOREPO}")
        out.append(line("ok", "monorepo last push", repo.get("pushed_at", "?")))
    except Exception:  # noqa: BLE001
        pass
    return out


def check_spec() -> list[tuple[bool, str]]:
    try:
        rels = get_json("https://api.github.com/repos/starkware-libs/starknet-specs/releases")
    except Exception as e:  # noqa: BLE001
        return [line("err", "wallet-api spec", f"lookup failed: {e}")]
    tags = [r.get("tag_name", "") for r in rels]
    stable = [t for t in tags if re.fullmatch(r"v?\d+\.\d+\.\d+", t)]
    latest = stable[0].lstrip("v") if stable else "?"
    if latest == WALLET_API_SPEC:
        note = f"latest stable v{latest}"
        if tags and tags[0].lstrip("v") != latest:
            note += f"; {tags[0]} in flight"
        return [line("ok", "wallet-api spec", note)]
    return [line("drift", "wallet-api spec", f"latest stable is now v{latest}, skill pins {WALLET_API_SPEC}")]


def check_urls(skill_dir: Path) -> list[tuple[bool, str]]:
    urls = set()
    for md in skill_dir.rglob("*.md"):
        for u in re.findall(r"https://[^\s)>,`\"']+", md.read_text(encoding="utf-8")):
            urls.add(u.rstrip(".,*"))

    def probe(u: str):
        try:
            req = urllib.request.Request(u, headers=UA, method="GET")
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                return u, r.status
        except urllib.error.HTTPError as e:
            return u, e.code
        except Exception:  # noqa: BLE001
            return u, 0

    out = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        for u, code in pool.map(probe, sorted(urls)):
            if code == 200:
                continue
            # 403/429 are near-universally bot-blocking (Voyager, npmjs), not rot.
            if code in (403, 429):
                out.append(line("warn", u, f"HTTP {code} (likely bot-blocking, check by hand)"))
            else:
                out.append(line("drift", u, f"HTTP {code or 'unreachable'}"))
    out.append(line("ok", f"{len(urls)} URLs checked"))
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--quick", action="store_true", help="skip URL liveness checks")
    args = ap.parse_args()

    skill_dir = Path(__file__).resolve().parent.parent
    sections = [
        ("npm pins", check_npm()),
        ("privacy monorepo", check_monorepo()),
        ("wallet API spec", check_spec()),
    ]
    if not args.quick:
        sections.append(("links", check_urls(skill_dir)))

    drifted = 0
    for title, results in sections:
        print(f"\n{title}")
        print("-" * len(title))
        for is_drift, text in results:
            drifted += is_drift
            print(text)

    print()
    if drifted:
        print(f"{drifted} item(s) drifted — re-read those claims before citing them in a plan.")
        print("Capability drift matters most: something the skill calls 'coming soon' may have shipped.")
        return 1
    print("No drift. Claims still hold, but a clean run only proves paths and versions —")
    print("read the monorepo CHANGELOG for capabilities that changed underneath them.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
