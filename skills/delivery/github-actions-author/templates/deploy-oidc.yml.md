# Deploy with OIDC template

No long-lived cloud credentials. The runner exchanges a short-lived
OIDC JWT for a cloud role.

## AWS example

`.github/workflows/deploy.yml`:

```yaml
name: Deploy

on:
  push:
    branches: [main]
    paths:
      - 'src/**'
      - '.github/workflows/deploy.yml'
  workflow_dispatch: {}

permissions: {}

concurrency:
  group: deploy-${{ github.ref }}
  cancel-in-progress: false        # Never cancel an in-flight deploy.

jobs:
  deploy:
    name: Deploy to production
    runs-on: ubuntu-latest
    environment: production         # Required reviewers / wait timer.
    permissions:
      contents: read
      id-token: write               # Required to request the OIDC token.
    timeout-minutes: 20
    steps:
      - name: Checkout
        uses: actions/checkout@692973e3d937129bcbf40652eb9f2f61becf3332 # v4.1.7

      - name: Assume AWS role via OIDC
        uses: aws-actions/configure-aws-credentials@e3dd6a429d7300a6a4c196c26e071d42e0343502 # v4.0.2
        with:
          role-to-assume: arn:aws:iam::123456789012:role/github-actions-deploy
          role-session-name: gha-deploy-${{ github.run_id }}
          aws-region: us-east-1

      - name: Build
        run: ./scripts/build.sh

      - name: Sync to S3
        run: aws s3 sync ./dist s3://my-bucket/ --delete

      - name: Invalidate CloudFront
        run: |
          aws cloudfront create-invalidation \
            --distribution-id ${{ vars.CF_DISTRIBUTION_ID }} \
            --paths '/*'

      - name: Record deployment URL
        run: |
          echo "## Deploy complete" >> "$GITHUB_STEP_SUMMARY"
          echo "" >> "$GITHUB_STEP_SUMMARY"
          echo "URL: https://example.com" >> "$GITHUB_STEP_SUMMARY"
          echo "Commit: \`${{ github.sha }}\`" >> "$GITHUB_STEP_SUMMARY"
```

## AWS IAM trust policy

The cloud-side trust policy that the role above assumes. **Scope by
ref**, not `repo:<org>/<repo>:*`.

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
        "token.actions.githubusercontent.com:sub": "repo:my-org/my-repo:ref:refs/heads/main"
      }
    }
  }]
}
```

For environment-scoped deploys:

```
"token.actions.githubusercontent.com:sub": "repo:my-org/my-repo:environment:production"
```

## GCP and Azure

Equivalents:

- **GCP:** `google-github-actions/auth@<sha>` with Workload Identity
  Federation. Map a GCP service account to the federated subject.
- **Azure:** `azure/login@<sha>` with a federated credential on an
  Entra app registration.

The pattern is identical: `id-token: write` on the job, the cloud
provider's auth action, then your deploy commands.
