#!/usr/bin/env python3
"""Fetch today's prayer times from the EICT homepage and write times.json.

The homepage lists, for each prayer, two times: the adhan (start) time and the
jama'ah (congregation) time. They are written in 12-hour form with no am/pm,
so this script converts them to 24-hour form.

If anything looks wrong, the script exits with an error and leaves the old
times.json untouched, so the website keeps showing the last good times.

Usage:
    python scripts/fetch_times.py                      # fetch live site, write times.json
    python scripts/fetch_times.py --file page.html     # parse a saved page (for testing)
    python scripts/fetch_times.py --out /tmp/t.json    # write somewhere else
"""
import argparse
import json
import re
import sys
import time
from html.parser import HTMLParser
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo
import datetime

URL = "https://edgwareict.org.uk/"
LONDON = ZoneInfo("Europe/London")

ALIASES = {
    "fajr": "fajr", "fajar": "fajr",
    "sunrise": "sunrise", "shuruq": "sunrise",
    "zuhr": "zuhr", "dhuhr": "zuhr", "zohr": "zuhr",
    "asr": "asr",
    "maghrib": "maghrib",
    "isha": "isha", "esha": "isha",
}
ORDER = ["fajr", "sunrise", "zuhr", "asr", "maghrib", "isha"]
REQUIRED = ["fajr", "zuhr", "asr", "maghrib", "isha"]

TIME_RE = re.compile(r"^\s*(\d{1,2}):(\d{2})\s*([AaPp]\.?[Mm]\.?)?\s*$")
AMPM_RE = re.compile(r"^\s*([AaPp])\.?[Mm]\.?\s*$")
DATE_RE = re.compile(r"([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\s*[-\u2013\u2014]\s*(.+)")
MONTHS = {m: i + 1 for i, m in enumerate(
    ["january", "february", "march", "april", "may", "june", "july",
     "august", "september", "october", "november", "december"])}


class TextCollector(HTMLParser):
    """Collects visible text nodes, skipping <script> and <style>."""

    def __init__(self):
        super().__init__()
        self.tokens = []
        self._skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "noscript"):
            self._skip += 1

    def handle_endtag(self, tag):
        if tag in ("script", "style", "noscript") and self._skip:
            self._skip -= 1

    def handle_data(self, data):
        if self._skip:
            return
        text = " ".join(data.split())
        if text:
            self.tokens.append(text)


def fetch_html():
    last_error = None
    for attempt in range(3):
        try:
            req = Request(URL, headers={"User-Agent": "Mozilla/5.0 (EICT prayer-times mirror; GitHub Actions)"})
            with urlopen(req, timeout=30) as resp:
                return resp.read().decode("utf-8", errors="replace")
        except Exception as exc:  # network errors, timeouts, HTTP errors
            last_error = exc
            time.sleep(5 * (attempt + 1))
    raise RuntimeError("Could not fetch %s: %s" % (URL, last_error))


def to_24h(hour, minute, prayer, ampm=None):
    """Convert one mosque-style time to (hour, minute) on a 24-hour clock."""
    if ampm:
        ampm = ampm.lower().replace(".", "")
        if ampm.startswith("p") and hour < 12:
            hour += 12
        if ampm.startswith("a") and hour == 12:
            hour = 0
        return hour, minute
    if hour >= 13:                       # already 24-hour
        return hour, minute
    if prayer in ("fajr", "sunrise"):    # always morning
        return (0 if hour == 12 else hour), minute
    if prayer == "zuhr":                 # 10, 11 -> morning; 12 -> noon; 1..9 -> afternoon
        return (hour if hour in (10, 11, 12) else hour + 12), minute
    return (hour if hour == 12 else hour + 12), minute   # asr, maghrib, isha are PM


def parse_page(html):
    collector = TextCollector()
    collector.feed(html)
    tokens = collector.tokens

    raw = {}          # prayer -> list of [hour, minute, ampm_or_None]
    current = None
    last_time = None
    for tok in tokens:
        key = ALIASES.get(tok.lower().strip(":"))
        if key:
            if key in raw:               # first occurrence wins
                current = None
            else:
                current = key
                raw[key] = []
            last_time = None
            continue
        if current is None:
            continue
        m = TIME_RE.match(tok)
        if m and len(raw[current]) < 2:
            entry = [int(m.group(1)), int(m.group(2)), m.group(3)]
            raw[current].append(entry)
            last_time = entry
            continue
        a = AMPM_RE.match(tok)
        if a and last_time is not None and last_time[2] is None:
            last_time[2] = a.group(1) + "m"

    prayers = {}
    for key in ORDER:
        entries = raw.get(key, [])
        if not entries:
            continue
        times = []
        for h, mi, ap in entries:
            hh, mm = to_24h(h, mi, key, ap)
            times.append("%02d:%02d" % (hh, mm))
        prayers[key] = {"start": times[0]}
        if len(times) > 1 and key != "sunrise":
            prayers[key]["jamaah"] = times[1]

    # Date line, e.g. "October 27, 2026 - 16 Jumada al-Ula 1448"
    date_iso, hijri = None, None
    for tok in tokens:
        m = DATE_RE.search(tok)
        if m and m.group(1).lower() in MONTHS:
            date_iso = "%04d-%02d-%02d" % (int(m.group(3)), MONTHS[m.group(1).lower()], int(m.group(2)))
            hijri = m.group(4).strip()
            break
    return prayers, date_iso, hijri


def minutes(hhmm):
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def validate(prayers):
    problems = []
    for key in REQUIRED:
        if key not in prayers:
            problems.append("missing prayer: " + key)
    if problems:
        return problems
    previous = -1
    for key in ORDER:
        if key not in prayers:
            continue
        start = minutes(prayers[key]["start"])
        if start <= previous:
            problems.append("%s start %s is not after the previous prayer" % (key, prayers[key]["start"]))
        previous = start
        jam = prayers[key].get("jamaah")
        if jam and minutes(jam) < start:
            problems.append("%s jama'ah %s is before its start %s" % (key, jam, prayers[key]["start"]))
    return problems


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", help="parse a saved HTML file instead of fetching the site")
    ap.add_argument("--out", default="times.json")
    args = ap.parse_args()

    if args.file:
        with open(args.file, encoding="utf-8") as fh:
            html = fh.read()
    else:
        html = fetch_html()

    prayers, date_iso, hijri = parse_page(html)
    problems = validate(prayers)
    if problems:
        print("ERROR: page layout may have changed. Not updating times.json.", file=sys.stderr)
        for p in problems:
            print(" - " + p, file=sys.stderr)
        print("Parsed so far: " + json.dumps(prayers), file=sys.stderr)
        return 1

    now = datetime.datetime.now(LONDON)
    today = now.strftime("%Y-%m-%d")
    if date_iso is None:
        date_iso = today
    if date_iso != today:
        print("WARNING: page says %s but London date is %s" % (date_iso, today), file=sys.stderr)

    out = {
        "date": date_iso,
        "hijri": hijri or "",
        "source": URL,
        "updated_ts": int(time.time()),
        "updated_iso": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "prayers": prayers,
    }
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    print("Wrote %s for %s" % (args.out, date_iso))
    return 0


if __name__ == "__main__":
    sys.exit(main())
