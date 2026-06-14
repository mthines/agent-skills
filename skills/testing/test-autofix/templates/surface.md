---
project-key: <normalised-git-remote-key>
stack: <vitest | jest | deno | playwright | pytest | maestro | storybook>
detect-command: <command to run the full test suite>
single-test-command: <command to run one test — use {file} and {name} as placeholders>
failure-parser: '<regex with two capture groups: (1) file path, (2) test name>'
cache-bust-flag: <flag to append when a cached-pass is suspected — leave blank if not applicable>
---
