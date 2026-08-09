# AI Change Policy

This is the platform-neutral safety contract for every human or coding agent
that changes this trading system. It supplements `AGENTS.md`; source code,
tests, `SYSTEM_RULES.md`, and `ARCHITECTURE.md` remain the evidence for current
behavior.

No prompt can guarantee that an agent will never make a mistake. Safety comes
from layered controls: narrow scope, evidence, regression tests, automated
checks, review, protected branches, reversible data changes, and production
monitoring.

## 1. Required investigation before editing

1. Restate the requested outcome and the files/surfaces that are in scope.
2. Read each target file completely, then trace its callers, callees, duplicate
   implementations, scheduled jobs, process boundaries, exchange mutations,
   database writes, and UI/manual execution paths.
3. For a defect, first reproduce it with a failing test, log, trace, or a
   deterministic code path. Separate observations from hypotheses.
4. Identify the earliest violated invariant or incorrect state transition.
   Fixing only the final exception, display symptom, or corrupted output is not
   a root-cause fix.
5. If the root cause cannot be proven, stop and report the competing
   hypotheses, missing evidence, and safest next diagnostic. Do not guess in a
   trading, financial, or data-mutation path.

## 2. Logic and calculation protection

Before changing a formula, threshold, unit, rounding rule, quantity, price,
risk model, PnL calculation, optimizer input, or state transition:

- Write down inputs, outputs, units, sign conventions, allowed ranges,
  rounding direction, precision, boundary behavior, and failure behavior.
- Find every implementation and consumer. Do not assume similarly named
  frontend, main-daemon, and scalp functions have identical contracts.
- Preserve existing behavior with characterization tests before refactoring.
- Add tests for normal cases, zero, negative/invalid values, exact boundaries,
  just-below/just-above boundaries, extreme finite values, and rounding/tick or
  step-size behavior as applicable.
- For order sizing, re-evaluate the post-quantization and actual-fill behavior;
  distinguish notional, margin, equity, available balance, and risk at stop.
- Never replace an unknown value with `0`, `1`, an empty object, or stale data
  merely to keep the process running. Fail closed on safety decisions and make
  degraded presentation data explicit.
- Compare before/after outputs on representative fixtures. Any intentional
  behavior change must be stated in the handoff and backed by a test.

## 3. Data, schema, and persistence safety

- Treat exchange acceptance, fill, protection, persistence, reconciliation,
  and cleanup as distinct operations with distinct failure windows.
- Trace every reader and writer before changing a table, column, enum/status,
  event, cache key, client order ID, or API payload.
- Database migrations must be additive or backward-compatible first whenever
  possible. Include preconditions, a dry-run/query plan, validation queries,
  and a rollback or forward-recovery procedure.
- Do not delete, truncate, rewrite, backfill, or mass-update real data; place
  real orders; cancel symbol-wide orders; rotate credentials; or deploy to
  production without explicit user authorization and a verified exact target.
- Never use production credentials in tests. Prefer fixtures, mocks, testnet,
  or a disposable isolated database.
- Do not log secrets, full credentials, authentication headers, or unnecessary
  personal/trading data.

## 4. External platforms, APIs, and dependencies

When behavior depends on Binance, Supabase, OpenAI, a library, a protocol, or
another external platform:

1. Identify the exact installed/runtime version and relevant account mode or
   endpoint. Do not code against remembered defaults.
2. For details that may have changed, consult current official primary
   documentation or the provider's versioned source/changelog before editing.
   Search results, blog summaries, comments, and model memory are not authority.
3. Record the official URL and access date in the task handoff when it affects
   the implementation. Note any version mismatch or unresolved ambiguity.
4. Pin or deliberately constrain dependency versions. Review changelogs and
   migration guides before upgrades; do not mix an unrelated upgrade into a
   bug fix.
5. Validate API error cases, rate limits, pagination, retries/idempotency,
   precision/filter rules, and sandbox-versus-production differences that
   apply to the changed path.

## 5. Binance, Supabase, VPS, and local topology

Treat these as four separate operational boundaries. Never infer one boundary's
state from another without verification:

| Boundary | Evidence to verify |
|---|---|
| Binance | Account/position mode, balances, positions, open standard and algo orders, fills, filters, rate limits, server time, API environment, and stable order identifiers |
| Supabase | Project/environment, schema and migrations, RLS/service role, every reader/writer, row status/version, timestamps, retries, and reconciliation semantics |
| VPS | Exact host/service/process, deployed commit or artifact, Node/npm version, environment variables, working directory, timezone/clock sync, process manager, ports/firewall, logs, disk, restart policy, and concurrent instances |
| Local | Exact process(es), source commit and dirty state, local environment variables, ports, timezone, credentials, cached state, test/build artifacts, and whether it can run concurrently with the VPS |

For every change that crosses one or more of these boundaries:

- Draw or state the actual path, for example
  `local UI -> VPS HTTP/WS -> Binance + Supabase`, and verify it from current
  configuration and runtime evidence rather than naming conventions.
- Build an environment matrix showing what is shared and what differs between
  local, VPS, testnet/staging, and production. Do not silently copy secrets or
  production data to make environments match.
- Check clock skew, timezone conversion, network timeout/disconnection,
  retry/idempotency, duplicate processes, stale deployments, partial writes,
  restart ordering, and loss of process-local locks/caches.
- Use a stable correlation identifier across exchange requests, database rows,
  and logs when the existing contract supports it. Do not claim trade-level
  attribution when only symbol/direction/time heuristics exist.
- Deployments must identify the exact target and artifact/commit, run preflight
  checks, use a staged or canary path when practical, verify health and
  protection after rollout, and have a tested rollback or forward-recovery
  procedure.
- Never restart/stop a VPS service, change firewall/DNS/process-manager
  configuration, modify production environment variables, or switch Binance or
  Supabase environments without explicit user authorization.

## 6. Implementation and review rules

- Make the smallest change that fixes the proven cause. Avoid unrelated
  cleanup, broad rewrites, new abstractions, and formatting churn.
- Preserve public contracts unless the task explicitly authorizes a migration.
- Never weaken or delete a failing test to make a check pass. Change a test
  only when the intended contract changed, and explain that contract change.
- Do not use empty catches, unobserved promises, silent fallbacks, or
  best-effort behavior while describing the result as guaranteed.
- Review the final diff as a skeptical maintainer: concurrency, restart,
  partial failure, duplicate execution, stale state, ownership, precision,
  time zones, null/invalid input, and rollback.

## 7. Completion gate

A production-code task is not complete until all of the following are true:

- The root cause and evidence are stated.
- A focused regression/characterization test exists when practical.
- `npm run check` passes without ignored failures.
- `git diff` and `git status --short` were inspected.
- Only authorized files changed; pre-existing user work was preserved.
- Data/order/deployment effects, migrations, rollback, unresolved gaps, and
  official external sources are disclosed.
- Every affected Binance/Supabase/VPS/local boundary was either verified in the
  applicable environment or explicitly marked unverified with the exact
  remaining production risk.

If a required check cannot run, report the exact command, error, and resulting
uncertainty. Never claim success based only on code inspection.
