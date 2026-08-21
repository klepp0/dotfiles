---
name: ci-watchdog
description: Manage the hourly CI watchdog loop (loop #2) for signavio/x2p-service. Retries transient CI failures on open PRs and main, triggers CodeQL on main, and emits a security status block. Automatically runs vulnerability assessments when a new BlackDuck or CodeQL policy violation is detected. Use when the user wants to start, stop, inspect, or reconfigure the CI watchdog, or wants a one-off status check.
---

# CI Watchdog Skill

Manages **loop #2** — the hourly CI health monitor for `signavio/x2p-service`.

## What the loop does each hour

**Part A — Retry transient CI failures**

Scans all non-draft open PRs (<90 days old) + `main`. For each branch, keeps the latest run per workflow and retries any that match the transient patterns below.

**Retry** (transient infra):
- `Run integration tests` failing with `RetryableOrchestrationError` / `OrchestrationError` / `ORCHESTRATION_TRANSIENT_ERROR` / `STEP_RETRIES_EXHAUSTED` / `RetryError: too many 500`
- `Run mypy` or `Run pre-commit` failing with `setup-python 429 Too Many Requests`

**Never retry**:
- `Run pre-commit` with linting/formatting diffs (real code issue)
- `BlackDuck Security Scan` — `FAILURE_POLICY_VIOLATION` (real policy)
- `Run integration tests` with model-not-supported 400 (real config bug)
- Runs stuck at attempt ≥6 with no change since last check
- Any PR that is draft or older than 90 days

**Part B — Security scan on main**

1. Triggers `codeql-sast-analysis.yml` via `workflow_dispatch` on `main`
2. Polls until complete (≤15 min, 90s interval)
3. Reads latest `security.yml` (BlackDuck) result — not re-triggered (no `workflow_dispatch`)
4. On CodeQL failure: fetches log summary

**Part C — Vulnerability assessment on new policy violations**

Triggered automatically when a **new** BlackDuck or CodeQL failure is detected (run ID not in the known-skip set). Steps:

1. Extract the violated policy and affected component(s) from the failed log:
   ```bash
   gh run view RUN_ID --repo signavio/x2p-service --log-failed | grep -i "violates policy\|Component.*version\|findings\|rule\|BDSA\|CVE" | head -20
   ```
2. For each new finding, run a vulnerability assessment:
   - Search app code for the vulnerable API/method: `grep -r 'VULNERABLE_METHOD' --include='*.py' -rn --exclude-dir='.venv' --exclude-dir='poc' .`
   - Check if the vulnerable package is a direct or transitive dependency: look in `pyproject.toml` and `uv.lock`
   - Check if the attack-enabling configuration is present (API keys, env vars, tracing flags)
   - Check if the vulnerable code path is reachable from any request handler or called at all
3. Produce an assessment for each finding:
   - **NOT EXPLOITABLE** — state which of the above checks rules it out; copy mitigation text to clipboard with `pbcopy`
   - **POTENTIALLY EXPLOITABLE** — describe the reachable path; flag for immediate human review
4. Mitigation comment format (copy to clipboard via `pbcopy`):
   ```
   ## BlackDuck [BDSA-ID] — Mitigation Statement
   **Component:** pypi:PACKAGE/VERSION
   **Vulnerability:** [one-line description of the flaw]
   **Severity:** High/Critical

   ### Not exploitable in x2p-service
   [Reason in one sentence]

   1. **No [vulnerable_method] calls** — [evidence]
   2. **[Package] not imported in app code** — [evidence]  
   3. **No [config/env] configured** — [evidence]
   4. **[Alternative] used instead** — [evidence]

   ### Attack path absent
   [Why the preconditions for exploitation cannot be met]

   ### Recommendation
   Waive / mark as not applicable. Re-evaluate if [condition] changes.
   ```
5. Add the run ID to the known-skip set so it is not re-assessed next hour.

**Status block** emitted at end of every run:

```
╔══════════════════════════════════════════╗
║  SECURITY STATUS  <HH:MM UTC>            ║
╠══════════════════════════════════════════╣
║ CodeQL:    ✅ clean  /  ❌ FINDINGS      ║
║ BlackDuck: ✅ clean  /  ❌ POLICY FAIL   ║
╠══════════════════════════════════════════╣
║ CI retries this hour: N retried, N skip  ║
║ Overall: ✅ ALL CLEAR / ⚠️ ACTION NEEDED ║
╚══════════════════════════════════════════╝
```

If a vulnerability assessment was run this hour, append below the box:
```
🔍 Vuln assessment: [BDSA/CVE ID] — [NOT EXPLOITABLE / ⚠️ REVIEW NEEDED] — mitigation copied to clipboard
```

Overall is ✅ ALL CLEAR only when CodeQL=clean AND BlackDuck=clean AND no new unretried transient failures.

---

## Known persistent non-retryable run IDs

These are real failures (policy violations, config bugs, old security findings) that must never be retried:

| Run ID | Branch | Workflow | Reason |
|---|---|---|---|
| 47259102 | `PROCESSAICO-659-slim-prompt-and-json-repair` | Run mypy | `setup-python` 429, attempt 6, stuck |
| 47259101 | `PROCESSAICO-659-slim-prompt-and-json-repair` | Run pre-commit | same |
| 47279119 | `renovate/lock-file-maintenance` | BlackDuck Security Scan | `FAILURE_POLICY_VIOLATION` |
| 36930639 | `feat/premium-billing-header` | CodeQL SAST Scan | real security finding |
| 36930640 | `feat/premium-billing-header` | BlackDuck Security Scan | `FAILURE_POLICY_VIOLATION` |
| 37175893 | `PROCESSAICO-329-1-t2p-eval-prod-fixes` | BlackDuck Security Scan | `FAILURE_POLICY_VIOLATION` |
| 47756835 | `main` | BlackDuck Security Scan | BDSA-2026-10450 `langchain:1.3.15` — assessed NOT EXPLOITABLE, waiver applied |
| 47756838 | `main` | Signavio Piper | OSS scan fail same root cause as above |
| 47757101 | `renovate/signavio-shared-workflows-3.x` | BlackDuck Security Scan | same BDSA-2026-10450 |
| 47758251 | `feature/PROCESSAICO-656-ignore-old-messages` | BlackDuck Security Scan | same BDSA-2026-10450 |

When a run in this table is no longer the *latest* run for that workflow on that branch (i.e. a new push superseded it), remove it from the set.

---

## Vulnerability assessment methodology

When Part C triggers, apply these checks in order. Stop at the first check that rules out exploitability.

### Check 1 — Is the vulnerable method called?
```bash
grep -r 'VULNERABLE_METHOD' --include='*.py' -rn \
  --exclude-dir='.venv' --exclude-dir='poc' --exclude-dir='__pycache__' .
```
If zero results → **NOT EXPLOITABLE** (dead code path).

### Check 2 — Is the package imported in app code?
```bash
grep -r 'from PACKAGE\|import PACKAGE' --include='*.py' -rn \
  --exclude-dir='.venv' --exclude-dir='poc' .
```
If zero results in app code → transitive dep only, attack surface absent.

### Check 3 — Is the package a direct dependency?
```bash
grep 'PACKAGE' pyproject.toml
grep -A3 'name = "PACKAGE"' uv.lock | head -5   # get pinned version
```

### Check 4 — Is the attack-enabling config present?
```bash
grep -r 'API_KEY\|TRACING\|ENDPOINT_VAR' \
  --include='*.py' --include='*.yaml' --include='*.yml' --include='*.env' \
  --include='*.toml' -rn --exclude-dir='.venv' --exclude-dir='poc' .
```
If no config → service cannot reach the vulnerable endpoint.

### Check 5 — What does the app actually use from this package?
```bash
grep -r 'from PACKAGE\|import PACKAGE' --include='*.py' -rn \
  --exclude-dir='.venv' --exclude-dir='poc' . | head -20
```
If usage is limited to unrelated types/utilities → attack path absent.

---

## Common tasks

### One-off status check

Run Part A + Part B + Part C manually (outside the scheduled loop):

```bash
# Part A: scan failures
gh pr list --repo signavio/x2p-service --state open --json number,headRefName,isDraft,createdAt --limit 50
# For each branch:
gh run list --repo signavio/x2p-service --branch BRANCH --limit 10 --json databaseId,name,status,conclusion

# Part B: trigger CodeQL
gh workflow run codeql-sast-analysis.yml --repo signavio/x2p-service --ref main
# Poll:
gh run list --repo signavio/x2p-service --workflow codeql-sast-analysis.yml --branch main --limit 1 --json databaseId,status,conclusion
# BlackDuck latest:
gh run list --repo signavio/x2p-service --workflow security.yml --branch main --limit 1 --json databaseId,conclusion,createdAt

# Part C (if new policy violation): extract finding and assess
gh run view RUN_ID --repo signavio/x2p-service --log-failed | grep -i "violates policy\|Component.*version\|BDSA\|CVE" | head -20
```

### Add a run to the known-skip set

When a new run is confirmed as a real (non-transient) failure, add its ID to the known-skip set in the loop prompt and to the table above. Update loop #2:

```
Use LoopDelete to delete loop #2, then LoopCreate with the updated known-skip set.
```

### Stop the watchdog

```
LoopDelete id=2
```

### Restart the watchdog

Re-read this skill and recreate the loop with `LoopCreate` using the prompt template in the **Loop prompt** section below.

### Change the schedule

Default: `0 * * * *` (every hour on the hour). To change to every 2 hours: `0 */2 * * *`.

---

## Loop prompt (canonical — use this to recreate loop #2)

```
Each hour: (A) retry retryable failed CI runs on open PRs + main, (B) trigger + check the security pipeline on main, and (C) auto-assess any new policy violations. End with a status block.

── PART A: RETRY POLICY ────────────────────────────────────────
Only retry a run if ALL hold:
1. conclusion == "failure"
2. Latest run of that workflow on that branch
3. Failure is transient/infra — NOT a real code/config problem

Retry these (transient):
- "Run integration tests" failing with RetryableOrchestrationError / OrchestrationError / ORCHESTRATION_TRANSIENT_ERROR / STEP_RETRIES_EXHAUSTED / RetryError: too many 500
- "Run mypy" or "Run pre-commit" failing with setup-python 429 Too Many Requests (GitHub infra rate-limit)

Never retry (skip always):
- "Run pre-commit" failing with linting/formatting diffs (not 429)
- "BlackDuck Security Scan" — FAILURE_POLICY_VIOLATION
- "Run integration tests" failing with model-not-supported 400
- Any run where PR is draft or >90 days old
- Any run stuck at attempt >=6 that hasn't changed since last check

Steps:
1. gh pr list --repo signavio/x2p-service --state open --json number,headRefName,isDraft,createdAt --limit 50
2. For each non-draft PR <90 days old + main: gh run list --repo signavio/x2p-service --branch BRANCH --limit 10 --json databaseId,name,status,conclusion
3. Keep only latest run per workflow name. Filter conclusion==failure.
4. Known-skip set (persistent non-retryable): 47259102, 47259101, 47279119, 36930639, 36930640, 37175893, 47756835, 47756838, 47757101, 47758251
5. For NEW failure IDs only: fetch log tail and classify.
6. Retry transient: gh run rerun RUN_ID --repo signavio/x2p-service --failed

── PART B: SECURITY SCAN ──────────────────────────────────────
1. Trigger CodeQL on main: gh workflow run codeql-sast-analysis.yml --repo signavio/x2p-service --ref main
   (skip trigger if latest CodeQL run is <60 min old and already completed successfully)
2. Wait up to 15 minutes for it to complete by polling every 90 seconds (use bash sleep):
   gh run list --repo signavio/x2p-service --workflow codeql-sast-analysis.yml --branch main --limit 1 --json databaseId,status,conclusion
   The triggered run will appear as the latest; wait until status != "in_progress" and status != "queued" and status != "waiting".
   If poll times out (30 min), check status directly before declaring result unknown.
3. Also get the latest BlackDuck result on main (do NOT trigger — no workflow_dispatch):
   gh run list --repo signavio/x2p-service --workflow security.yml --branch main --limit 1 --json databaseId,conclusion,createdAt
4. If CodeQL conclusion == failure: fetch failed log for summary: gh run view RUN_ID --repo signavio/x2p-service --log-failed | tail -40

── PART C: VULNERABILITY ASSESSMENT (run only on NEW violations) ──
Trigger: any BlackDuck or CodeQL failure whose run ID is NOT in the known-skip set.

For each new violation:
1. Extract the finding:
   gh run view RUN_ID --repo signavio/x2p-service --log-failed | grep -i "violates policy\|Component.*version\|BDSA\|CVE\|findings" | head -20

2. Assess exploitability in x2p-service (stop at first ruling-out check):
   a. Grep for the vulnerable method/API in app code (exclude .venv, poc):
      grep -r 'VULNERABLE_METHOD' --include='*.py' -rn --exclude-dir='.venv' --exclude-dir='poc' .
   b. Grep for the package import in app code:
      grep -r 'from PACKAGE\|import PACKAGE' --include='*.py' -rn --exclude-dir='.venv' --exclude-dir='poc' .
   c. Check if attack-enabling config (API keys, env vars) is present:
      grep -r 'RELEVANT_ENV_VAR' --include='*.py' --include='*.yaml' --include='*.env' --include='*.toml' -rn --exclude-dir='.venv' --exclude-dir='poc' .
   d. Check what the app actually uses from the package (look at import sites)
   e. Check pyproject.toml (direct dep?) and uv.lock (pinned version)

3. Verdict:
   - NOT EXPLOITABLE → produce mitigation comment, copy to clipboard via pbcopy, state evidence
   - POTENTIALLY EXPLOITABLE → describe reachable path, set Overall to ⚠️ ACTION NEEDED

4. Mitigation comment template (pipe to pbcopy):
   ## BlackDuck [BDSA/CVE ID] — Mitigation Statement
   **Component:** pypi:PACKAGE/VERSION
   **Vulnerability:** [one-line flaw description]
   **Severity:** [High/Critical]

   ### Not exploitable in x2p-service
   [One-sentence reason]

   1. **No [vulnerable_method] calls** — zero occurrences in app code
   2. **[Package] not imported** — transitive dep only, never imported in app
   3. **No [attack config] configured** — [env var] absent from all config
   4. **[Alt approach] used instead** — [brief description]

   ### Attack path absent
   [Why preconditions cannot be met]

   ### Recommendation
   Waive / mark as not applicable for x2p-service. Re-evaluate if [condition] changes.

── OUTPUT FORMAT ──────────────────────────────────────────────
End every response with this exact block:

╔══════════════════════════════════════════╗
║  SECURITY STATUS  <HH:MM UTC>            ║
╠══════════════════════════════════════════╣
║ CodeQL:    ✅ clean  /  ❌ FINDINGS      ║
║ BlackDuck: ✅ clean  /  ❌ POLICY FAIL   ║
╠══════════════════════════════════════════╣
║ CI retries this hour: N retried, N skip  ║
║ Overall: ✅ ALL CLEAR / ⚠️ ACTION NEEDED ║
╚══════════════════════════════════════════╝
🔍 [BDSA/CVE ID] — NOT EXPLOITABLE / ⚠️ REVIEW NEEDED — mitigation copied to clipboard
   (omit 🔍 line if no new violation this hour)

(if ⚠️ ACTION NEEDED: add one line below the box stating what needs attention)

Overall is ✅ ALL CLEAR only when CodeQL=clean AND BlackDuck=clean AND no new unretried transient failures.
Otherwise ⚠️ ACTION NEEDED with one-line reason.
```
