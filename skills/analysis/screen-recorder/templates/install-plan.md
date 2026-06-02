Playwright and/or Chromium are not installed in this repo. To proceed:

  {{INSTALL_COMMAND}}
  npx playwright install chromium

This downloads ~150 MB (the Chromium driver). The skill will not record
until you approve.

Proceed? [y/N]

---

ffmpeg is not installed. Cropping the recording to a single element
needs it. Without ffmpeg, the recording will be the full viewport.

To install:

  macOS:   brew install ffmpeg
  Debian:  sudo apt-get install ffmpeg
  Other:   https://ffmpeg.org/download.html

Proceed without cropping? [y / install / abort]
