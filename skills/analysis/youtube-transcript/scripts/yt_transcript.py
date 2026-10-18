#!/usr/bin/env python3
"""Fetch a YouTube transcript with the Python stdlib only — works from cloud IPs.

The watch page, youtube-transcript-api, and yt-dlp's web clients are bot-gated
from datacenter IPs. The InnerTube `player` endpoint called as the ANDROID or
IOS app is not, and its caption-track baseUrl serves timedtext XML directly.

Usage: python3 -I yt_transcript.py <url-or-id> [--lang en] [--timestamps]
"""
import argparse
import json
import re
import sys
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET

CLIENTS = [
    ({"clientName": "ANDROID", "clientVersion": "20.10.38", "androidSdkVersion": 30},
     "com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip"),
    ({"clientName": "IOS", "clientVersion": "20.10.4", "deviceModel": "iPhone16,2"},
     "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3 like Mac OS X)"),
]


def video_id(s):
    m = re.search(r"(?:v=|youtu\.be/|shorts/|embed/|live/)([\w-]{11})", s)
    return m.group(1) if m else s


def http(url, ua, body=None, visitor=None):
    headers = {"User-Agent": ua}
    if visitor:
        headers["X-Goog-Visitor-Id"] = visitor
    if body is not None:
        headers["Content-Type"] = "application/json"
        body = json.dumps(body).encode()
    return urllib.request.urlopen(urllib.request.Request(url, data=body, headers=headers), timeout=20).read()


def visitor_data(vid):
    # Without a visitor id the app clients get "Sign in to confirm you're not a bot".
    body = {"context": {"client": {"clientName": "WEB", "clientVersion": "2.20260915.01.00", "hl": "en"}},
            "videoId": vid}
    resp = json.loads(http("https://www.youtube.com/youtubei/v1/next?prettyPrint=false", "Mozilla/5.0", body))
    return resp.get("responseContext", {}).get("visitorData")


def caption_tracks(vid):
    errors = []
    visitor = visitor_data(vid)
    for client, ua in CLIENTS:
        body = {"context": {"client": dict(client, hl="en", visitorData=visitor)}, "videoId": vid,
                "contentCheckOk": True, "racyCheckOk": True}
        try:
            resp = json.loads(http("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", ua, body, visitor))
        except urllib.error.HTTPError as e:
            errors.append(f"{client['clientName']}: HTTP {e.code}")
            continue
        tracks = resp.get("captions", {}).get("playerCaptionsTracklistRenderer", {}).get("captionTracks", [])
        if tracks:
            return tracks, ua, resp.get("videoDetails", {}).get("title", "")
        status = resp.get("playabilityStatus", {})
        errors.append(f"{client['clientName']}: {status.get('status')} {status.get('reason', 'no captions')}")
    sys.exit("No caption tracks: " + "; ".join(errors))


def pick(tracks, lang):
    # Prefer a human-made track in the language, then auto-generated (kind=asr), then anything.
    same = [t for t in tracks if t["languageCode"].split("-")[0] == lang]
    return next((t for t in same if t.get("kind") != "asr"), None) or (same or tracks)[0]


def parse(xml_bytes, timestamps):
    root = ET.fromstring(xml_bytes)
    # srv3 uses <p t="ms">; legacy format uses <text start="s">.
    nodes = list(root.iter("p")) or list(root.iter("text"))
    out = []
    for n in nodes:
        text = re.sub(r"\s+", " ", "".join(n.itertext())).strip()
        if not text:
            continue
        if timestamps:
            sec = int(n.get("t", 0)) // 1000 if n.tag == "p" else int(float(n.get("start", 0)))
            text = f"[{sec // 60:02d}:{sec % 60:02d}] {text}"
        out.append(text)
    return ("\n" if timestamps else " ").join(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("--lang", default="en")
    ap.add_argument("--timestamps", action="store_true")
    a = ap.parse_args()
    tracks, ua, title = caption_tracks(video_id(a.video))
    track = pick(tracks, a.lang)
    print(f"# {title} [{track['languageCode']}, {track.get('kind', 'manual')}]", file=sys.stderr)
    print(parse(http(track["baseUrl"], ua), a.timestamps))


if __name__ == "__main__":
    main()
