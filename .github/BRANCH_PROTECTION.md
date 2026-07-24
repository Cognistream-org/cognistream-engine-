# Require PR review before merge to main
# Configure in GitHub: Settings → Branches → Branch protection rules → main
# - Require a pull request before merging
# - Require approvals: 1
# - Require status checks to pass: lint, typecheck, test, audit
# - Block merge if ANY CI job fails

version: 1
