x
<!-- deployment-verify:v1 -->
<details><summary>🚦 Deployment contract</summary>

```json
{ "service": "ui", "root_spans": ["GET /x"], "flag": { "key": "newHeader", "provider": "posthog" }, "cohort": { "attribute": "a", "test": "true", "control": "false", "on": "root" }, "reversibility": "flag" }
```

</details>
<!-- /deployment-verify:v1 -->
