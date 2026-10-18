---
type: regex
pattern: '<button[^>]*aria-(?:label|pressed)|aria-label[^\n]{0,60}(?:password|show|hide)|44\s?(?:x|×|by)\s?44|24\s?(?:x|×|by)\s?24'
flags: i
---

The review turns the clickable `div` into a labelled `<button>` (or names its accessible name) and/or gives the target size a concrete minimum.
