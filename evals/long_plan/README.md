# Long-term plan view

An experimental eval and opt-in Corgi integration for a durable account of an
agent's work. The replay and daemon share `src/activity/plan.ts`: the prompt,
patch validation, hierarchy and setback contract. Flat summaries remain the
default while historical replay failures are unresolved.

## Try the integration

From this checkout, start a separate environment:

```sh
CORGI_LONG_PLAN=1 ./go.ts --env long-plan --no-kill
```

Keep Activity summaries enabled in Clever Corgi. Select an agent, then use
**prefix P**, the command menu's **Long-term plan**, or `corgi action plan`.
Up/down select; Enter folds a goal or episode; mouse clicks select/fold and the
wheel moves through the panel. Escape closes it. Native OMP labels stay native;
the optional plan uses their intent as evidence without replacing them.

The worker samples commentary, recent/running tools, bounded result excerpts,
native intents, lifecycle and the provider's confirmed checklist. It updates
through the existing inference pool and cooldown, including a final observation
after work settles. Old-turn results may extend their own plan prefix, but never
replace a newer turn's live label. Agent lifecycle still comes from providers.
The bounded result history retains four individual tool outcomes, including
repeated commands, so a successful retry does not erase its preceding failure.

Live costs are observed intervals, not a reconstructed lifetime ledger. The
first usage sample establishes a baseline. Later usage rolls up once through
step → episode → goal; cached input is part of input. Unassigned intervals,
missing coverage and buffer overrun stay explicit. Child-agent costs and private
summarizer costs are excluded. The UI marks live coverage with ≥. Attribution
to a step is inferred, even when its observed token count is exact.
Tool calls follow the same observed-interval rollup, independently of whether
token usage has arrived. Missing usage fields stay blank, including tool counts
in older saved plans. Selection details show input, output and cached
input separately; cached input is included in input, never added a second time.

Plans, pending observations and costs survive checkpoint/handoff. Cold recovery
establishes a fresh usage baseline. Queues retain 32 observations and 128 short
support excerpts; a request handles at most eight observations. At 256 nodes the
plan reports its history limit and retains further cost as unassigned. These
bounds protect the daemon; they are not a complete transcript archive.

Defaulted snapshot/checkpoint/handoff additions keep runtime/viewer protocol 3
and checkpoint/handoff 6. Old data decodes to an empty plan; there is no migration.
The preview flag survives handoff, with an explicitly supplied flag overriding
saved mode. Older viewers ignore the optional plan.

## Setbacks and new signal probes

A step may carry a classified setback: verification, conflict, environment,
permission, or approach. **!** marks a problem only on the affected step;
it never propagates to parents.
Resolved problems keep a dimmed **!**, with recovery stated in the detail.
A green **▶** means running. Completed work is dimmed; future work is labeled
planned. Only collapsed rows show **+**. Available tool-call counts and
cached-input details remain visible.
An approach setback means rework caused by a disproved committed approach,
not every exploratory hypothesis. Expected red tests, no-match searches,
ordinary waits and error strings inside source code are negative controls.

The reducer keeps the original setback evidence even when a patch omits it.
Resolving a known open setback requires fresh evidence. Failed attempts cannot
be rewritten as successful retries. Done parents reopen around unfinished
children or open setbacks. These are application guarantees, not evidence that
the model always understood the task. New replay calls record `repairs` so a
normalization does not masquerade as flawless model output.

Codex `update_plan` and Claude `TodoWrite`/`TaskCreate`/`TaskUpdate` are folded
into the existing provider checklist boundary after tool confirmation. OMP
already supplies grouped TODOs. Unknown statuses and missing task history are
partial. TODO completion is intent evidence, never proof of passing tests.

```sh
bun test src/activity/roadmap.test.ts src/providers/claude/todos.test.ts src/providers/codex/todos.test.ts
bun run evals/long_plan/run.ts --manifest evals/long_plan/synthetic.json --model codex:gpt-6-luna
bun run evals/long_plan/run.ts --manifest evals/long_plan/holdout.json --model claude:claude-haiku-5-5
bun run evals/long_plan/run.ts --manifest evals/long_plan/todo_probe.json --ablation live-signals --model claude:claude-haiku-5-5
bun run evals/long_plan/run.ts --manifest PRIVATE_MANIFEST --ablation live-signals --model codex:gpt-6-luna
bun evals/long_plan/preview.ts RUN_DIRECTORY [RUN_DIRECTORY...]
```

`preview.ts` builds `.lavish/long-plan-integrated.html` using the actual
`src/plan_view.ts` renderer and Corgi palette. It includes recorded failures and
checkpoint controls. The older `view.ts` remains the original design study.
`live-signals` runs production transcript readers and their bounded evidence at
the offline checkpoints. It is a conservative signal-loss probe: it does not
simulate the live eight-second scheduler, hooks or app-server observations.

## 2026-10-31 results

The new suite has 12 development conversations / 54 checks, plus three separate
Claude-format holdouts / 13 checks after the review addition below. They contain
no historical private text. A separate TODO-specificity probe adds seven checks.
Real replays cover three frozen Claude/Codex excerpts (213 normalized events),
including the previous rebase and stale-push cases and the review holdout.
Scanning 194 local Claude, 40 recent Codex and 28 Pi sessions found no TODO tool
calls. TODO coverage is therefore synthetic; no real TODO coverage is claimed.

| Run | Checks | Invalid/errors | Interpretation |
| --- | ---: | ---: | --- |
| Haiku development, v4 | 54/54 | 0 | All synthetic assertions passed |
| Haiku holdout, v4, reviewed rubric | 13/13 | 0 | Confirmed TODOs, recovered missing dependency, source error strings |
| Haiku TODO intent probe, full + production signals | 7/7 each | 0 | Specific future tasks survive both paths without invented work |
| Luna development, v3, reviewed rubric | 54/54 | 0 | Original report retains 53/54; corrected approach anchor below |
| Luna holdout, v4, reviewed rubric | 11/13 | 0 | Missed a dependency failure and recovery within one checkpoint |
| Luna real stale-push + review, v2 | 13/13 | 0 | Existing hierarchy/subtitle checks passed |
| Luna real rebase, v4 | 8/10 | 0 | Wrong episode continuity and a failed test labeled done |
| Luna production signals, stale-push, v4 | 4/7 | 0 | Coarse bounded snapshots lost context; 77.8% of tokens assigned |
| Haiku real conversations, v5 | 23/23 | 3 | Final hierarchy checks pass; three recovery patches needed validation retries |
| Haiku production signals, stale-push, v5 | 7/7 | 0 | Current bounded outcome history; different model/revision from Luna |
| Haiku production signals, holdout, v5, reviewed rubric | 12/13 | 0 | Retained the resolved bump but merged the failed attempt with the successful retry |

Development latencies were 3.03s mean / 3.84s p95 for Luna and 5.30s mean /
10.29s p95 for Haiku, each over 30 updates. These include harness overhead;
concurrent runs and different prompt revisions prevent a controlled ranking.
Luna consumed 227,065 input (137,600 cached) + 5,487 output inference tokens;
Haiku consumed 171,110 input (99,327 cached) + 22,903 output. These are summarizer
costs, separate from the historical agent's usage.

Haiku's real replays took 32 updates, 7.94s mean / 16.21s p95, and consumed
384,038 input (49,287 cached) + 42,119 output inference tokens. The bounded
stale-push replay took six updates, 5.03s mean / 7.13s p95, consuming 34,454 input
(4,043 cached) + 4,477 output. Neither is a controlled latency comparison.

Earlier v1/v2 failures are retained under ignored `evals/results/long-plan/`.
They exposed planned steps receiving work spans, an unrelated README edit
entering a failed-test episode, and forgotten recovery updates. The approach
probe was clarified to describe an actual discarded rewrite. Its first anchor
pointed to the successful trace command; it now points to the explicit course
correction. Luna's original failed report is unchanged; `review.json` records
the revised scorer. No historical expectations were loosened.

Manual review also found an omission in the holdout rubric: a resolved bump
could pass while its original failed build was labeled done. A thirteenth check
now requires the failed attempt to remain failed. The full-transcript Haiku run
passes it; the production-signal run fails it. Original 12-check reports remain
unchanged; reviewed scorecards and the browser show the stronger result.

Release blockers remain: preserve failed attempts when failure and recovery
arrive together, keep episode identity through follow-ups, and retain enough
live evidence to match full replay quality. The integration stays opt-in.
The earlier pilot below remains historical context, not the current scorecard.

## Product contract

The view has three levels:

- **Goal:** the user's outcome, retained across turns and compactions.
- **Episode:** one coherent subproblem, such as repairing branch history or
  getting macOS CI to build. Reading, editing, testing, retries and committing
  can all belong to one episode.
- **Step:** a meaningful activity within that episode. Repeated commands and
  polling do not each need a row. Failed attempts remain visible.

The title names the work. The subtitle carries a defining constraint, finding,
approach or outcome. A commit should not replace a useful explanation of a shell
startup bug with commit-message bookkeeping. An agent's stated intent and visible
reasoning can inform that explanation; the UI does not reproduce raw reasoning
or claim access to unavailable reasoning.

An explicit rebase/squash sequence deserves a Git episode. A routine `git diff`
while implementing a feature belongs to that feature. “Again”, “fix it”, “commit”,
an interruption or a status question does not automatically create a goal.
Returning to an episode preserves its identity; a new attempt can add a step.
Only explicitly announced future work becomes a planned step, with no tokens yet.

The prototype keeps episodes collapsed by default, expands the selected episode,
aligns token totals in one column and exposes evidence on selection. Replay
controls belong to the eval, not to the proposed live product. Narrow layouts
remove the sidebar and retain access to the selected row's detail.

## Signals and accounting

`history.ts` reads local Claude JSONL transcripts and Codex rollouts without
executing any recorded commands. It preserves source lines and ordered event IDs.
The model sees user steering, assistant updates, concrete tool arguments and
results, explicit plan tools, available plaintext reasoning, task notices and
lifecycle events. Opaque reasoning remains unavailable. Long records retain a
head and tail, marked as excerpts, up to roughly 1,800 characters per event.
Repository instructions inside transcripts are evidence, never eval instructions.

| Signal | Useful for | Limit |
| --- | --- | --- |
| User request and steering | Goal continuity and changes of scope | A request does not prove work started |
| Assistant updates | Immediate intent, findings and approach | Can become stale or overstate success |
| Tool arguments and results | Actual work, boundaries, failures, verification | Long output is excerpted; images are not interpreted |
| Explicit plans | Pending work and announced decomposition | Plans can become stale; this pilot has no real plan-tool examples |
| Plaintext reasoning | An intended approach before a tool makes it obvious | Provider-dependent, sensitive and sometimes absent |
| Task notices and lifecycle | Background work, interruption, compaction | A transport completion is not a successful goal |
| Usage receipts | Recorded consumption | Episode attribution is approximate, not per-token semantic ownership |

Usage is deterministic code, never generated by the summarizer:

- Codex response receipts are deduplicated by response ID. When those are present,
  the duplicate cumulative `token_count` transport is ignored. Legacy rollouts use
  cumulative deltas, exclude an opening historical baseline and flag counter resets.
- Claude receipts use message ID and component-wise high-water counts. A thinking
  block can report usage before its tool block. Those records are joined to the
  same response's first concrete action; before it is observed, usage is unassigned.
- Input includes cache reads and cache creation. Cached input is a subset of input,
  not a third additive charge. Output already includes reasoning output. All
  counters use bigint internally and decimal strings in eval files.
- Each receipt belongs to at most one step. Parent totals sum descendant usage.
  Unassigned usage stays visible and participates in the conservation check.
  A response that spans multiple steps cannot be divided exactly from these logs.
- Parent transcripts exclude child-agent usage. Forked Codex histories are rejected
  until an ownership filter is supplied; copied history must not be charged twice.
  Do not interpret these totals as team totals or dollar cost.

Hook timing, terminal-only approval state, a historical live Git snapshot and
external process state cannot be reconstructed reliably from these files. Tool
results provide some of that evidence, but the eval does not invent missing signals.

## Replay contract

`plan.ts` defines the experimental prompt, JSON schema and atomic reducer. Each
inference receives the previous tree, short excerpts supporting that tree, and
only the next prefix of events. There is no full-transcript hindsight and no
hidden model conversation carrying an unbounded history.

The model returns node upserts and an ordered partition of the new event range
into step assignments. IDs and parentage are stable; existing nodes cannot be
deleted or moved. New parents precede children. Evidence references must point
into the observed prefix. Coverage gaps, overlaps, future evidence, invalid
hierarchies and work assigned to a planned step reject the entire patch.
Sparse evidence may remain unassigned. A failed patch gets one explicit correction
attempt, but the invalid attempt still fails the run and its output is retained.

The cadence is deterministic: cut before a user message, after the first concrete
tool/plan of a turn, at turn completion, or after 24 events. The early checkpoint
tests recognition when an episode starts. This is an offline comparison cadence,
not the production worker's eight-second scheduler. Production would coalesce
tool noise and update at meaningful boundaries; measure that separately.

All nodes are retained in this prototype. Model input grows with tree size and
support excerpts; no memory or latency bound for day-long use is claimed. The
production design needs durable archived episodes and a bounded inference index
that can retrieve an old episode when work resumes. Do not silently drop old
nodes to meet a context limit.

## Dataset and rubric

Keep frozen source snapshots, manifests, transcripts and reports under ignored
`evals/results/` or outside the checkout. Do not check historical chats into public
fixtures. The renderer also writes only to ignored `.lavish/`.

The first pilot uses six development conversations, three from each provider:
rebase/conflict/test recovery, CI setup and branch repair, an interactive review
feature, stale push-retry repair, native cleanup and terminal-image debugging.
Four are development cases; the review and image cases were withheld from prompt
tuning. Some are deliberate prefix excerpts. A separate complete CI stress replay
spans more than six hours, including the repeated build/test repairs after the
Git episode. It shares a conversation with a development case and is **not an
independent holdout**.

Before calling a model, annotate event anchors and broad expectations. Use pairwise
relationships rather than one supposedly perfect tree: these actions must share
an episode, those actions must be separate, and a continuation must retain its
goal. Give recognition a prefix deadline. Topic expressions check broad naming
and subtitle facts, not exact prose. They can reject a reasonable synonym, so
review failures rather than loosening a regex until a model passes.

Every run checks complete replay, exact token conservation and consistency between
parent completion and child states. Case checks cover grouping, goal continuity,
topic/subtitle facts and states at selected prefixes. Reports also track row count,
title churn, rewrites of closed nodes, assigned usage, inference tokens and latency.
Invalid outputs, missing results and inference failures are failures.

Automated checks cannot prove that a hierarchy or subtitle is sensible. For each
frozen case, review the early, middle and final tree with source evidence:

| Dimension | Accept | Reject |
| --- | --- | --- |
| Grouping | Episodes explain subproblems and contain related attempts | One row per command; one giant episode hiding distinct subproblems |
| Titles | Concrete names that distinguish siblings | Generic “working” or obsolete diagnosis-only titles after a repair |
| Subtitles | Add a supported constraint, finding or outcome | Repeat the title, hallucinate intent, or lose the cause after a commit |
| Continuity | Stable IDs across follow-ups and compaction | Restart the goal on “again”; erase a failed attempt |
| Status | Success has evidence; unfinished children remain unfinished | Call failed tests done; mark a parent done with active children |
| Tokens | Conserved receipts, explicit cache and missing-data semantics | Double-count cache, cloned history or subagents; guess a precise split |

Require all hard checks and no unsupported completion/intent claim before enabling
the feature. For a broader quality decision, expand to at least 12 independent
conversations per provider, include explicit plan changes, compaction, sparse and
approval-only turns, canceled/abandoned work, delegation with owned usage, and
several episode revisits. Split by conversation family (including forks), not by
nearby excerpts. Run at least three repeats. Record human rubric decisions beside
the evidence; the current pilot is too small for a model ranking.

## Commands

A private manifest is an array of cases. `source` points to a frozen JSONL file;
`through_line` optionally selects a prefix before normalization. Example shape:

```json
[
  {
    "id": "branch-repair",
    "provider": "claude",
    "source": "/private/evals/branch-repair.jsonl",
    "split": "development",
    "checks": [
      {"name": "Rebase and squash stay together", "kind": "same_episode", "a": 12, "b": 30},
      {"name": "Recognize repair early", "kind": "topic", "event": 12, "at": 12,
       "level": "episode", "pattern": "branch|rebas|histor"}
    ]
  }
]
```

```sh
# Inspect normalized events and receipts before annotating anchors.
bun evals/long_plan/run.ts --manifest /private/cases.json --prepare --out evals/results/plan-data

# Calls the existing tool-free production inference harness and consumes model usage.
bun evals/long_plan/run.ts --manifest /private/cases.json --model codex:gpt-6-luna --out evals/results/plan-luna
bun evals/long_plan/run.ts --manifest /private/cases.json --model claude:claude-haiku-5-5 --out evals/results/plan-haiku

# Focused controls; --case and --batch are also available.
bun evals/long_plan/run.ts --manifest /private/cases.json --flat
bun evals/long_plan/run.ts --manifest /private/cases.json --ablation no-reasoning
# Other ablations: no-plans, tools-only. Removed signals stay removed in support excerpts.

bun evals/long_plan/report.ts /private/cases.json evals/results/plan-luna
bun evals/long_plan/view.ts evals/results/plan-luna
# Open .lavish/long-plan.html directly, or use Lavish for a design review.

bun test evals
```

`--flat` uses the production phase prompt, parser, turn reset and bounded phase
memory, with reconstructed evidence clipped to its 2048-byte bound. It is a prompt
baseline, not a reproduction of production hook timing or the capped 16-row UI.
Its synthetic root is not evidence of a successful goal summary.

The runner writes source hashes, exact inputs/outputs, per-attempt usage, elapsed
time, prefix trees and checks. `report.ts` creates a readable scorecard and a new
`review.json` with the current scorer hash, retaining the original report.
`--refresh-usage` recomputes receipts after an importer correction only if source
events exactly match the recorded evidence; it saves a separate accounted history
and records the accounting hash. It never reruns or edits the model's labels.
The UI uses accounted history when present and computes totals at each prefix.

## Findings from the first pilot

Both models completed the same six case excerpts and recognized the CI branch
repair at its first work checkpoint. In the initial full-signal run, Luna scored
39/44 assertions with one invalid attempt; Haiku scored 41/44 with no invalid
attempts. These counts include the added parent/child consistency check. Neither
run meets the acceptance gate. Private reports preserve all failures.

The CI case passed 9/9 with hierarchy on both models; an earlier turn-aware flat-prompt
control passed 6/9. A follow-up control, after also matching the bounded evidence
in phase memory, timed out before completion; that failure is retained. The
no-reasoning CI probe passed 7/9 with one invalid attempt,
but one run does not establish the value of reasoning: nondeterminism is a
confounder, and there are no real plan-tool examples in this pilot.

The runs exposed three substantive issues: parent completion can contradict
unfinished children, episode subtitles can lose the technical cause after a
commit, and generating a final report can be left unassigned. A prompt follow-up
retained the cause and assigned all usage in the rebase case, but still failed
parent/child consistency. The next implementation should make parent status a
checked aggregate and keep the episode's defining fact separate from transient
step updates. Do not ship the candidate by hiding these failures.

Across 79 updates per model, observed mean latency was 3.36 seconds for Luna and
7.75 seconds for Haiku, including harness overhead and retries. They ran
concurrently, so this is descriptive, not a controlled speed comparison.
Luna consumed about 0.99 million inference input-plus-output tokens and Haiku
about 1.12 million; these are the summarizer's costs, separate from the historical
work's consumption. Rebuilding full tree context each time is still expensive.

The complete CI stress case contains 579 events and 183 tool calls over six hours
and 37 minutes, with 30.30 million recorded input-plus-output tokens. The initial
candidate collapsed most repair work into one episode. Adding distinct-blocker
probes and tightening the episode rule produced seven episodes and 58 steps,
recognized the branch repair at its start, and assigned 99.74% of recorded usage.
It scored 12/13 hard checks; parent completion still contradicted unfinished
children at some intermediate checkpoints. The broad integration-failure episode
also needs human review for further useful subdivision. This is a development
stress result, not an additional independent holdout pass.

The design artifacts use Corgi's palette and termhtml rather than a separate UI
theme. Browser checks cover normal/narrow/mobile layouts, replay and row
interaction. They do not substitute for terminal integration tests once a live
viewer implementation exists. No saved-format or wire version changed: all new
data structures currently belong only to the eval.
