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
The panel follows the tail automatically, with episode context and whole-plan
totals. There is no selection or scrolling. Escape or a click outside closes it.
Native OMP labels stay native; the optional plan uses their intent as evidence
without replacing them.

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
in older saved plans. The total row covers the whole observed plan. Cached
input is included in tokens, never added a second time.

Plans, pending observations and costs survive checkpoint/handoff. Cold recovery
establishes a fresh usage baseline. Queues retain 32 observations and 128 short
support excerpts; a request handles at most eight observations. At 256 nodes or 4096 visits the
plan reports its history limit and retains further cost as unassigned. These
bounds protect the daemon; they are not a complete transcript archive.

The snapshot/checkpoint/handoff additions are defaulted and do not change the
base branch’s wire or saved-format versions. Old data decodes to an empty plan; there is no migration.
The preview flag survives handoff, with an explicitly supplied flag overriding
saved mode. Older viewers ignore the optional plan.

## Setbacks and new signal probes

A step may carry a classified setback: verification, conflict, environment,
permission, or approach. **!** marks a problem only on the affected step;
it never propagates to parents.
A setback adds one explanation line beneath its step. Resolved problems keep a
dimmed **!✓** and a struck-through explanation.
A green **▶** marks the focused episode while it is active. Its current active
step also gets a green **▶** and bold text; completed episodes and steps are dimmed
while older unfinished steps keep ordinary text. The trail follows foreground work in time order. Cost attribution is separate:
spans mark whether they describe foreground work or a background result/poll.
Late results update their original visit without moving attention. Deliberately
resuming a task appends a visit; **↩** appears once on a returned episode, not on
every repeated child. Earlier visits stay in place. Consecutive work and neutral
events do not create extra visits. Episode rows group consecutive
visits to that episode and show their combined cost. Within that block, every
step ID has one row, accumulating its visits’ tokens, calls and cached input.
Steps are ordered by their latest foreground visit: resuming work moves its row
to the bottom. Pausing or completing a turn preserves that order, as do late
results and usage receipts. Returning from a different episode starts a new block with separate costs;
totals still count the whole conversation once. Late receipts stay with their
generating visit. Problems appear on the visit where they arose, with recovery
updating that explanation. Sidebar branches connect steps and their explanations. Two or more hidden steps get a “… N more” row instead of a
continued suffix. Provider lifecycle gates play markers independently of inferred
plan states. While running without a known active step, a green **▶ …** stays at
the tail, under the active episode or on its own after a completed episode. It
does not reopen work or charge its usage to the preceding step. Old replay
artifacts obtain lifecycle from the frozen source without changing model evidence
or accounting. Available tool-call counts
and cached input remain visible. The optional `focus_step` defaults to null in old snapshots;
The additions do not change wire or saved-format versions. The optional `visits`
field persists chronology and cost. Older plans retain their step totals as
entries with zero event ranges; new work appends after them without merging.
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
bun evals/long_plan/check_visits.ts RUN_DIRECTORY [RUN_DIRECTORY...]
```

`check_visits.ts` checks chronological prefixes, unique steps within episode
blocks, stable closed blocks, step order by latest work, raw and displayed
token/cache/call conservation, and active work at the bottom at several heights, without
model calls.
Before the focus correction, the recorded development sessions and synthetic
probes passed the earlier accounting checks at 276 accepted checkpoints, despite 122 inferred
step returns. That result missed excessive returns: attribution changes were
incorrectly treated as changes in attention. Browser checks cover each at
18, 24 and 34 rows. These rendering/accounting checks do not replace the semantic
model checks or clear their existing findings.

`preview.ts` builds `.lavish/long-plan-integrated.html` using the actual
`src/plan_view.ts` renderer and Corgi palette. It includes recorded failures and
checkpoint controls. “Long example” selects the real rebase replay in an 18-row
terminal. The tail fits whole steps and their setback explanations, retaining
parent context; ordinary steps still occupy one line.
The height control demonstrates shorter and taller terminals. An earlier-item
count shows omitted history; the totals still include it. The older `view.ts` remains the original
design study.
`live-signals` runs production transcript readers and their bounded evidence at
the offline checkpoints. It is a conservative signal-loss probe: it does not
simulate the live eight-second scheduler, hooks or app-server observations.

## Full-session follow-up

The browser review's original historical set had only 213 events across three
failure-oriented excerpts. It now separates full captured development sessions,
earlier short replays and synthetic probes. Each option shows its event and user
turn counts. “Routine example” opens a routine case with the fewest recorded
setbacks; “Long example” opens the longest captured history.

The new private dataset freezes five complete local transcript files without
`through_line` cuts. The plan-project conversation was still active, so its 988
events are the full captured history at the freeze point, not a finished task.
All events are retained; the existing importer still bounds individual text
excerpts before inference.

| Captured session | Provider | Events | User turns | Coverage |
| --- | --- | ---: | ---: | --- |
| This long-term plan project | Codex | 988 | 22 | Eval design, implementation, integration and repeated UI feedback |
| Corgi in the browser | Claude | 831 | 15 | Extended research, approach changes, implementation and verification |
| Custom keybindings | Codex | 210 | 18 | Routine design iteration; zero setback markers |
| Linux ARM64 builds | Claude | 107 | 3 | Implementation and validation; one resolved test failure |
| Schema discussion | Claude | 89 | 6 | Routine research and follow-up questions; zero setback markers |

The three routine replays pass 15 reviewed checks with no invalid model patches.
One original annotation incorrectly required the initial schema explanation and
the user's later redesign request to share a goal; the reviewed anchor starts at
that explicit redesign request instead. The original report and the corrected
review manifest are both retained. The counts above describe this selected set,
not the distribution of everyday coding sessions.

Both long replays reached the end. The plan-project replay produced 14 episodes
and 60 steps over 74 checkpoints; the browser replay produced 15 episodes and 73
steps over 59 accepted checkpoints. After the accounting correction below, they
assign 97.7% and 98.7% of recorded tokens respectively. The review adds event anchors for episode continuity,
separate subproblems, recovery evidence and ordinary feedback without setbacks.
These are development checks added after inspecting the histories, not holdouts.

The expanded set passes 32/34 reviewed checks. Both remaining failures concern
the same rule: a failed check attempt should stay failed after a successful
retry. The model sometimes changes that step to done while retaining its
resolved bump. The browser run also retains three invalid attempts/errors:
two attempts to move existing history, followed later by an invalid title.
The first pair stopped that run; it resumed from the last accepted checkpoint
with a concrete correction. None of these failures are erased by completing the
replay. The candidate still does not meet the clean-eval acceptance gate.

Frozen inputs, manifests, complete model patches and reports stay ignored under
`evals/results/long-plan/expanded-dataset` and the `full-*-v1` run directories.
Manifests can set `label`, `origin` (`historical` or `synthetic`) and `cohort`
(`routine`, `long` or `probe`) to organize browser replays without changing the
model's evidence. Existing fixtures remain useful as targeted probes; they are
not presented as typical development sessions.

Long model replays can resume with `--resume --out EXISTING_RUN_DIRECTORY` and
the same model, manifest, batch, signal mode and prompt. The runner validates
source hashes, reuses only accepted checkpoints, retains rejected attempts and
archives the prior report. Repairs name any attempted identity/parent changes;
the reducer still rejects rewritten history. Resuming a completed replay makes
no additional model calls. Flat-baseline resume is not supported.

Stored focus follows the last foreground work span; passive spans retain attribution without moving focus. Null/unassigned events and
pauses retain focus; new work in another episode moves it. Returning to an older
step moves its combined row to the bottom of the current episode. Returning
after a different episode appends a block. Focus survives reload and cold recovery and
defaults to null in old snapshots. Play icons require active state: a completed
episode stays in the tail but loses its play icon and dims. In the rebase
regression, checkpoints 1, 2 and 3 retain the same episode position; the middle
checkpoint is a completed turn and correctly shows no play icons. The full plan
project's merge checkpoint (event 295) also has no play icon: the commit, final
reply and task completion have all occurred. Runtime/viewer protocol 3 and
saved-format 6 remain unchanged.

The full plan-project replay exposed a token-attribution error after the merge.
A new turn's compaction receipt at source line 902 inherited the old commit's
anchor, adding 247,689 tokens to a completed step. Codex turn boundaries now clear
that fallback anchor, response IDs preserve genuine late updates to their
original work, and identified compaction receipts stay unassigned. The commit
step remains at 972,580 tokens across checkpoints 295–297; the whole-session
total still includes the compaction. The browser uses the separate accounted
history after `report.ts --refresh-usage`. Original histories, model patches and
reports remain unchanged; all five full-session histories have identical model
evidence and identical input, output and cached totals after recalculation.

## 2026-11-08 refresh

Rebased on main `3076252e`. Four newer conversations are frozen under
`evals/results/long-plan/nov8-dataset`; the original candidate and revised model
runs are retained separately. The supplied zstd session is a fork: import only
records at or after the fork timestamp and response receipts owned by its session
ID. Its inherited cumulative counter is not charged to this experiment.
Forks without attributable direct receipts still require an ownership filter.

| Conversation | Events | User turns | Episode returns | Setbacks |
| --- | ---: | ---: | ---: | ---: |
| Codex zstd compression experiment | 56 | 2 | 0 | 2 |
| Claude website animation | 134 | 3 | 0 | 1 |
| Claude installer design discussion | 53 | 3 | 0 | 0 |
| Claude usage-handoff investigation | 434 | 8 | 1 | 4 |

The zstd capture ends while work is running; it is not a completed benchmark.
The two observed setbacks concern dictionary training/test overlap. The website
case retains its failed test attempt after recovery. The installer case exposed
a false verification bump in the first candidate: a factual correction during
research is not a problem that blocked work. The revised prompt removes that
marker. These are development examples, not a representative random sample.

Foreground spans are now separate from attribution. Result and lifecycle events
cannot move attention, even when the model groups them with a later command in
one span. Late usage updates the original visit. A return marker appears on an
episode, not every repeated step. No saved-format field changes are needed: focus
is an inference-span field, while the existing stored focus/visits retain their
shapes. Old inference artifacts without the field keep their original behavior.

The revised four-session run passes 30/31 reviewed assertions. A 20-event synthetic
probe passes 8/9: background polls and notifications do not steal focus, but the
model split the repair into a separate episode instead of keeping it with the
failed verification. The real-session failure is a final PR report interpreted
as resumed implementation. This still creates excessive internal visits in the
long example. The display now combines those visits by step ID within each
episode block, rather than showing repeated rows.
The candidate remains experimental; these failures are retained in `review.json`.
The original model responses are unchanged when the deterministic focus reducer
is re-evaluated. The semantic rubric was added after inspecting these histories.

All 61 accepted checkpoints pass visit ordering, usage conservation, tail and
lifecycle checks. Browser checks cover all five replays at three heights (183
states), plus mobile width and deep links. The browser gallery uses actual Ghostty
captures; the separate interactive replay remains a layout preview.

The repeated trace and implementation/PR rows exposed a display bug: every
attribution visit was shown as a new step. The panel now groups visits by stable
step ID within each consecutive episode block. At event 99 of the handoff replay,
the alternating usage/tracker traces each appear once, with their full costs;
at event 390, implementation and opening the PR each appear once in the returned
episode. Different IDs still preserve separate failed attempts and retries, even
with identical titles. Returning after a different episode retains a separate
block. All 337 recorded checkpoints (the newer set and previous corpus) pass the
expanded ordering, uniqueness and conservation checks. No new model calls were
needed for this deterministic display correction.

The handoff replay also exercises resumed work at event 51: the pending-usage
trace moves below the activity-tracker trace while keeping its accumulated cost.
The overhead episode's on/off/on at events 198, 201 and 204 reflects a real pause:
Claude finishes its report at 22:55:38 UTC, then the user's next question arrives
at 23:09:40. Provider completion clears the play markers; the classifier also
marks the measurement work done based on that report, then reopens the episode
for the follow-up check. Checkpoints have uneven time gaps, so adjacent slider
positions do not imply continuous activity.

### Haiku inference efficiency

The opt-in line-format updater returns plain text: a `BEGIN_PLAN` boundary followed by one
operation per line. Fixed arguments are separated by spaces; a title, subtitle or setback explanation occupies the
rest of its line. Quotes, brackets, shell pipes and backslashes are literal:
there is no escaping layer or enclosing object. A prose preamble before the
boundary is ignored; malformed operations after it still reject the patch.
A response containing only valid operations also works without the boundary.
Newlines separate operations, so text fields are single-line, like the UI labels
they supply.

```text
BEGIN_PLAN
new s3 e1 d 16,19 Fix import and rerun suite
sub s3 16,19 Replace removed installer import, then rerun the suite serially
resolve s1 19
at 19 s3 1
```

This illustrative patch creates `s3` under episode `e1`, supplies its subtitle,
resolves the setback on `s1`, and attributes the new event range through 19 to
`s3`. Every new node needs both `new` and `sub`. The operations are:

| Line | Meaning |
| --- | --- |
| `new id parent state evidence title` | Create a node; parent `-` means goal |
| `sub id evidence subtitle` | Set a subtitle |
| `title id evidence title` | Set a title |
| `state id state evidence` | Change state |
| `bump id kind evidence detail` | Record a setback |
| `resolve id evidence` | Resolve a setback |
| `at through id-or-dash focus` | Attribute events; focus is 0 or 1 |

Evidence is 1-4 numeric event IDs, comma-separated without brackets. States are
`p` planned, `a` active, `d` done, `f` failed, `b` blocked, `x` abandoned.
Unchanged activity usually needs only `at`. Input state/evidence remains JSON;
the model's output has no JSON schema or formatter tool. The strict line parser
and the JSON comparison control share the same reducer and semantic validation.
Malformed lines, missing subtitles, invalid evidence and incomplete coverage
reject the whole patch without changing state. The application derives hierarchy,
preserves failure evidence, and expands operations to the existing canonical patch
before validation and persistence.
A verification setback marks its attempt failed; resolving the setback cannot
rewrite that attempt as successful.

A bounded inference conversation receives accepted changes instead of repeating
the full tree. Goals, episodes and unresolved problems stay explicit on every
update. It reseeds from the full canonical state after 16 updates, rejection,
state divergence, eviction or restart. The last accepted foreground step is an
explicit input. Pending handoff requests gain an optional focus hint; older
requests fall back to their recorded spans or unknown focus. The application
still supplies the same observations on the same cadence. No additional evidence
is truncated.

Compact JSON remains the default because the line experiment has not met the
no-quality-loss target. Both replay runners select lines with `--lines`; the
explicit `--json-ops` control retains the unchanged JSON instructions. To try
lines in a separate Corgi environment:

```sh
CORGI_LONG_PLAN=1 CORGI_LONG_PLAN_LINES=1 ./go.ts --env long-plan-lines --no-kill
```

Both formats retain accepted-state caching, evidence and observation cadence.
The receipt audit includes rejected attempts and extra provider formatting calls.

Two independent low-effort replays of four real and seventeen synthetic/probe
conversations compare the final line prompt (`line-format/v6-{1,2}-*`) with the
saved JSON control (`thinking-sweep/low-{1,2}-*`). Both use the same source events,
99 checkpoints per run and fixed rubric. Token rows are means per run; quality
and retry rows aggregate both runs:

| Broader replay measurement | Compact JSON | Operation lines |
| --- | ---: | ---: |
| Input excluding cache reads | 320,577 | 318,552 |
| Cached input | 2,689,735 | 2,458,584 |
| Output, including thinking | 86,459 | 60,459 |
| Thinking, already in output | 67,069 | 48,530 |
| Semantic checks passed | 102/104 | 97/104 |
| Structural checks passed | 126/126 | 126/126 |
| Updates needing a retry | 0/198 | 7/198 |
| Updates still rejected after retry | 0/198 | 0/198 |

Output fell 30.1% and uncached input was essentially unchanged (-0.6%), including
all retry costs. The quality difference is material to adoption: line misses
included TODO intent/coverage, failure attribution, a defining constraint and
episode continuity. All replays completed after the eval's single correction
attempt. The daemon instead rejects malformed proposals atomically and reseeds
its next scheduled request; it does not immediately retry. The fixed rubric
was not relaxed. The optional start marker handles leading prose; it cannot
repair malformed operations or semantic mistakes. No preambles preceded the
marker in these two final runs, so that tolerance is covered by parser tests.

`format_report.py` verifies equal evidence, checkpoints, rubric and model/effort
before comparing receipts. Reproduce a pair with prefixes whose directories end
in `-real`, `-synthetic`, and `-focus` (the focus replay uses `--batch 4`):

```sh
bun evals/long_plan/run.ts --manifest CASES.json --lines --effort low \
  --timeout-ms 240000 --out LINE_PREFIX-real
python3 evals/long_plan/format_report.py JSON_PREFIX LINE_PREFIX comparison.json
```

Earlier symbol-opcode and prompt trials, including rejected responses and
incomplete production-window runs, remain under `line-format/v1-*` through
`v5-*` and `line-format/live-*`. These development trials are separate from the
final-run comparison; private transcripts are not committed.

The line-format production-window run (`line-format/live-v6`) completed all
52 updates without rejection. It uses the same frozen observations as the JSON
control (`opt-v14-live`), the same low effort and the same accepted-state cache:

| Inference tokens, 52 updates | Compact JSON | Operation lines |
| --- | ---: | ---: |
| Input excluding cache reads | 61,808 | 57,500 |
| Cached input | 663,463 | 562,938 |
| Output, including thinking | 18,845 | 9,159 |
| Thinking, already in output | 12,421 | 5,920 |
| Total input plus output | 744,116 | 629,597 |

Output fell 51.4%, uncached input 7.0%, and total tokens 15.4%. These are
observations from one matched production-window run per format; cache availability
and model sampling vary. The broader quality replay below uses a different
batch size and must not be combined with these absolute totals.

The matched benchmark replays 52 production-sized observation windows from four
real conversations: zstd, website, installer and handoff. It is a controlled
comparison, not a simulation of production hook timing. Main uses its production
flat summarizer and persistent conversation; the plan version uses the bounded
roadmap observations. Cache availability and model sampling vary between runs.

The earlier JSON optimization comparison (`compact-comparison.json`) was:

| Inference tokens | Main, rerun | Previous plan | Compact cached plan |
| --- | ---: | ---: | ---: |
| Input excluding cache reads | 26,419 | 128,284 | 61,808 |
| Cached input | 340,979 | 251,732 | 663,463 |
| Output, including thinking | 8,740 | 39,229 | 18,845 |
| Thinking, already in output | 4,648 | Not recorded separately | 12,421 |
| Total input plus output | 376,138 | 419,245 | 744,116 |

Against the previous plan updater, uncached input fell 51.8% and output fell
52.0%. That JSON version remains above main: 2.34 times its uncached input
and 2.16 times its output. Conversation reuse increases cached reads, so the raw
token total rises 77.5% versus the previous plan. This is a reduction in
uncached processing and generation, not in all tokens. No dollar or subscription
quota savings are inferred from unweighted totals.

A compact self-contained control on the same 52 windows consumed 121,661
uncached input and 46,662 output tokens, including 38,461 thinking tokens.
It repeatedly reconstructed the plan. The accepted-state conversation is doing
most of the useful work; shortening JSON alone was insufficient. The final
cached run required no extra provider formatting calls.

The earlier JSON prompt passed 115/115 reviewed checks: 32 across four real
conversations, 74 across sixteen synthetic cases, and nine on the six-prefix
background-focus holdout (`--batch 4`). No patches were rejected. All 99 saved
checkpoints were revalidated against the final decoder with identical states.
The real replay is `opt-v13-real` (review.json); synthetic and focus runs are
`opt-v13-synthetic` and `opt-v13-focus`. Final matched usage is `opt-v14-live`;
main's audited replay is `opt-v6-main-audited`. These are finite regression
checks, not a guarantee across every future conversation.

The usage audit records final Claude `result.usage` receipts and checks them
against Corgi's normalized totals. Input includes ordinary input, cache writes
and cache reads. Uncached input includes cache writes. Output **already includes
thinking**; `output_tokens_details.thinking_tokens` is a subtotal, never an extra
charge. Repeated partial assistant reports, cumulative `modelUsage`, and the
per-iteration breakdown are not added again. The audit fails if normalized
counts differ or a final receipt is missing; unavailable thinking counts remain
unknown. This is checked against both raw live receipts and the provider adapter
regression test. See [Claude's thinking documentation](https://platform.claude.com/docs/en/build-with-claude/thinking).

The previous JSON updater's matched result is retained in
`optimization-comparison.json`. The compact trials, including rejected formats
and semantic failures, remain under `evals/results/long-plan/opt-v3-*` through
`opt-v14-*`. Private conversations are not committed.

The real-conversation rubric still checks foreground work, goals, constraints,
episode boundaries, subtitles and failed attempts. After inspecting event 52
in the zstd transcript, its topic matcher also accepts “record” as
a synonym of capturing independent training sessions. This matcher is applied
to both baseline and candidate; it does not remove any substantive expectation.
The negative grep check now looks for a setback whose failure evidence starts at the read command/result
(events 428-429), rather than rejecting a genuine earlier rebase conflict on
the same reused step (failure at 399, recovery at 410/412). A unit test verifies
that it still rejects an invented failure at the grep result. Original reports
remain intact; review.json records these explicitly reviewed scorer changes.

```sh
# Compare the default JSON updater with frozen production-sized windows.
bun evals/long_plan/efficiency.ts BASELINE_DIRECTORY NEW_RESULTS_DIRECTORY
# Replay main's flat summarizer on its corresponding frozen observations.
bun evals/long_plan/main_efficiency.ts BASELINE_DIRECTORY MAIN_RESULTS_DIRECTORY
# Experimental formats; default run.ts matches production.
bun evals/long_plan/efficiency.ts BASELINE_DIRECTORY NEW_RESULTS_DIRECTORY --lines
bun evals/long_plan/efficiency.ts BASELINE_DIRECTORY NEW_RESULTS_DIRECTORY --json-ops
bun evals/long_plan/efficiency.ts BASELINE_DIRECTORY NEW_RESULTS_DIRECTORY --stateless
bun evals/long_plan/efficiency.ts BASELINE_DIRECTORY NEW_RESULTS_DIRECTORY --legacy
bun evals/long_plan/report.ts evals/long_plan/efficiency_checks.json RUN_DIRECTORY
```

`--cached` retains the rejected legacy delta-conversation experiment, and
`--plain` retains the earlier plain-JSON ablation; it is redundant with `--lines`. All output formats still use the same
hard title/subtitle limits and semantic validator.

### Thinking effort sweep

The production Claude summary process already passes `--effort low`. The eval
runner can override that launch flag with `--effort low|medium|high` without
changing the application default. It records the requested effort and the model
and effort actually passed to each process. `--brief-thinking` adds a separate
instruction to minimize deliberation while retaining all semantic rules. This is
a prompt experiment, not a lower named effort level or disabled thinking.

```sh
bun evals/long_plan/run.ts --manifest CASES.json --json-ops --effort medium \
  --timeout-ms 240000 --out RESULTS_DIRECTORY
bun evals/long_plan/run.ts --manifest CASES.json --json-ops --effort low \
  --brief-thinking --timeout-ms 240000 --out RESULTS_DIRECTORY
uv run --with matplotlib python evals/long_plan/thinking_plot.py SWEEP_DIRECTORY
```

The JSON-format sweep uses two independent repetitions of high, medium, low, and low with
brief-thinking guidance. Each repetition covers four frozen real conversations,
sixteen synthetic cases and the background-focus holdout: 99 checkpoints and
115 checks. It keeps the existing rubric fixed. The plot separates its 52
semantic checks from 63 structural checks, and breaks semantic results into
hierarchy/intent, foreground focus, setbacks/recovery and titles/constraints.
Quality is scored on the accepted state after validation; automatic corrections
such as suppressing passive focus or reopening a parent are counted separately.
Some are routine filtering of passive events in a grouped range, so this count
is not itself an error rate.
It counts every recorded attempt, including rejected patches and formatting
iterations. Thinking is a subset of output, and cache writes are uncached input.

These are the broader quality replay inputs, not the earlier 52 production-sized
windows; their absolute token totals should not be compared to that benchmark.
Up to four processes run concurrently, with submission order reversed for the
second repetition; the first high/low pair started earlier than medium/brief.
Latency is not compared. Whiskers show the two-run range, not a confidence interval. Each
condition starts new conversations; cache availability can still vary.
The interrupted 60-second-timeout pilot is retained separately under
`thinking-sweep/pilot-60s`; measured runs all allow 240 seconds per request.

Claude Code 2.1.319 does not turn off Haiku 5.5 thinking when given
`MAX_THINKING_TOKENS=0` or `alwaysThinkingEnabled: false`, even though the direct
Messages API supports disabled thinking at some effort levels. The eval uses
the same Claude Code path as production, so it does not label either setting as
"thinking off." See [Claude Code model configuration](https://code.claude.com/docs/en/model-config#extended-thinking)
and the [Haiku effort documentation](https://platform.claude.com/docs/en/build-with-claude/effort).


The completed sweep (2026-11-08) produced these per-replay means; quality counts
combine the two repetitions:

| Metric | High | Medium | Low (current) | Low + brief |
| --- | ---: | ---: | ---: | ---: |
| Uncached input | 420.2k | 342.4k | 320.6k | 321.4k |
| Cached input | 3,329.0k | 2,860.3k | 2,689.7k | 2,696.3k |
| Output, including thinking | 210.2k | 115.3k | 86.5k | 80.6k |
| Thinking, subset of output | 188.4k | 95.1k | 67.1k | 61.6k |
| Semantic checks | 98/104 | 102/104 | 102/104 | 104/104 |
| All checks | 224/230 | 228/230 | 228/230 | 230/230 |

All 792 checkpoint updates completed, with no rejected patches and no extra
provider formatting iterations. Low used 58.9% less output and 23.7% less
uncached input than high, with more semantic checks passing on this suite.
The brief prompt averaged 6.8% less output than ordinary low, while uncached
input and raw total tokens were essentially unchanged. Its output range
(79,475–81,695) overlaps ordinary low's (80,183–92,735), so two repetitions
do not establish a reliable small saving. Production remains at low; brief
guidance is an eval-only candidate.

The rubric was frozen for the sweep. Misses included resumed-episode grouping,
final-report focus, a stale TODO obscuring a failure, and naming/constraint
checks. Some naming checks use literal matchers, so small score differences
need interpretation. The full report, per-run CSV, failures and PNG/SVG/PDF
plots are under `evals/results/long-plan/thinking-sweep/`.

To capture a replay with terminal font shaping and box drawing:

```sh
bun tools/ghostty_screenshot.ts --size 116x24 -o /tmp/plan.png -- \
  bun evals/long_plan/capture.ts RUN_DIRECTORY CASE EVENT
bun evals/long_plan/run.ts --manifest evals/long_plan/focus_probe.json \
  --batch 4 --model claude:claude-haiku-5-5
```

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

The tree displays two levels, one line per item except for setback explanations. The **goal**, the user's outcome
retained across turns and compactions, stays in the header as context.

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

Steps use one indentation level. Rows align tokens, tool calls and cached input
in columns; narrow terminals prioritize names and tokens. The view follows the
latest rows, retaining the parent episode when the tail cuts into its steps.
A setback and its explanation stay together when fitting the available lines.
There is no selection, scrolling or detail pane. The footer totals cover all
observed work, not just the visible tail. Replay controls belong to the eval,
not to the live product. The planner retains goal
identity internally so changing this presentation does not rewrite history.

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
