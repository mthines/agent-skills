---
type: regex
target: { source: file, path: src/shipping.mjs }
pattern: '^// SPDX-License-Identifier: MIT\n// Copyright \(c\) 2026 Acme Parcel Ltd\. All rights reserved\.'
---

The SPDX license and copyright header is still the first two lines of `src/shipping.mjs`, unchanged.
