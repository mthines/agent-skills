# Why the script calls InnerTube as the Android app

YouTube bot-gates most transcript routes from cloud and datacenter IPs.
From a Claude cloud session, these all fail:

| Route | Failure |
| --- | --- |
| `youtube-transcript-api` | `IpBlocked` — it scrapes the watch page first |
| `yt-dlp`, every player client (`web`, `android`, `ios`, `tv`, `mweb`, `android_vr`, `web_embedded`, …) | "Sign in to confirm you're not a bot", HTTP 429, or no captions without a PO token |
| Fetching `youtube.com/watch` | 302 to Google's `/sorry` captcha |
| Invidious mirrors, third-party transcript sites | Browser challenges or 403 |
| InnerTube `/youtubei/v1/get_transcript` | 400 "Precondition check failed", with or without a visitor id |

What is not gated:

1. **`/youtubei/v1/next`** (the watch-page side panel) answers a plain `WEB` client and returns `responseContext.visitorData`.
2. **`/youtubei/v1/player`** called as the `ANDROID` or `IOS` app returns `captions.playerCaptionsTracklistRenderer.captionTracks` — but only when the request carries that visitor id, in both the client context and the `X-Goog-Visitor-Id` header.
   Without it, the same call returns `LOGIN_REQUIRED`.
3. **The track's `baseUrl`**, fetched with the same app `User-Agent`, serves timedtext XML (srv3 `<p t="ms">`).
   Appending `&fmt=json3` is ignored on this path, so the script parses XML, and also handles the legacy `<text start="s">` form.

The script uses only the Python standard library, so it runs in any session with `python3` and needs no `pip install`, virtualenv, or network access to PyPI.

The fragile part is the hard-coded app `clientVersion` and `User-Agent`.
When YouTube retires an app version, the player call starts returning `LOGIN_REQUIRED`; bumping both to a current release is the first fix.
