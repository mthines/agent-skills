# Output format

Load before printing the result of any Phase 5 outcome — auto-fix, proposal-only, `--analyse-only`, below gate, or stopped.
The shape stays stable; only the `Outcome` tail varies.

```markdown
## Fix-bug summary

### Evidence
<Evidence Record from Phase 2, including bugClass and pre-flight findings>

### Triage (Phase 0.5)
- Classification: simple | complex
- Phase 6 lane: fast-lane | standard-lane | n/a (analyse-only) | n/a (below gate)
- Decision rule applied: <rule>
- Override: --force-holistic | none

### Reproduction
<repro path + command + status>

### Root cause
<one paragraph from the Root-Cause Record OR lightweight in-skill analysis — labelled accordingly>

### Proposed change
<plain-language description + impact + verification plan>

### Confidence (analysis)
- Evidence strength: X%
- Root cause certainty: X%
- Fix confidence: X%
- **Overall: X%**

### Outcome
<one of:>
- Auto-implemented (<lane>) + verified: draft PR <url> on branch <name>, verification green — a human undrafts. Telemetry decayed.
- Auto-implemented (<lane>), verification red: PR <url> still draft. Concerns: <list>.
- Auto-implemented (fast-lane → standard-lane fallback): PR <url>. Round-3 CEGIS triggered fallback. Verification <status>.
- Analyse-only (no PR): proposal returned at X% confidence; triage = <simple | complex>.
- Below gate (X%): proposal returned for review. To raise the score, collect: <specific evidence>.
- Stopped: <reason>.
```
