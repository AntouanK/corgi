import { expect, test } from "bun:test";
import * as plan from "./plan";
import * as lines from "./plan_lines";
import * as json from "./plan_protocol";
import type { Input } from "./roadmap";

const event = (id: number): plan.Event => ({ id, turn: 1, line: id, at: "", kind: "tool", text: "Verify downloads" });
const seed = `new g - a 1 Fix downloads
sub g 1 Resume interrupted transfers
new e g a 1 Repair offsets
sub e 1 Retain downloaded bytes
new s e a 1 Test resume
sub s 1 Check retry offsets
at 1 s 1`;
const input = (): Input => ({ state: plan.empty(), support: [], events: [event(1)] });
const next = (): Input => ({
  state: lines.apply(input(), seed).state,
  support: [event(1)],
  events: [event(2), event(3)],
});

test("line operations preserve the JSON protocol's canonical patch without escaping text", () => {
  const source = next(),
    title = 'Check "retry" | offsets',
    subtitle = String.raw`Keep C:\tmp\part and {"offset": 2}; literal \n, \", pipe | and  double spaces`,
    raw = `title s 2 ${title}\nsub s 2,3 ${subtitle}\nstate s d 3\nat 3 s 1`;
  const expected = json.apply(
    source,
    JSON.stringify({
      ops: [
        ["~", "s", { t: title }, 2],
        ["~", "s", { s: subtitle }, [2, 3]],
        ["=", "s", "d", 3],
        ["@", 3, "s", 1],
      ],
    }),
  );
  expect(lines.apply(source, raw)).toEqual(expected);
  expect(lines.apply(source, raw).state.nodes.at(-1)?.subtitle).toBe(subtitle);
  expect(lines.apply(input(), `\n  ${seed.replaceAll("\n", "\r\n  ")}\r\n`)).toEqual(lines.apply(input(), seed));
  expect(lines.apply(input(), "at 1 - 0").patch.nodes).toEqual([]);
});

test("line setbacks and recoveries preserve failed attempts and original evidence", () => {
  const source = next(),
    before = structuredClone(source),
    raw = `bump s verification 2 Retry duplicated bytes
new retry e d 3 Retry resume
sub retry 3 Repaired offsets passed
resolve s 3
at 2 s 1
at 3 retry 1`;
  const result = lines.apply(source, raw);
  expect(source).toEqual(before);
  expect(result.state.nodes.find(n => n.id === "s")).toMatchObject({
    state: "failed",
    bump: { kind: "verification", state: "resolved", detail: "Retry duplicated bytes", evidence: [2, 3] },
  });
  expect(plan.apply(source.state, JSON.stringify(result.patch), source.events).state).toEqual(result.state);
  expect(() => lines.apply(source, raw + "\nstate s d 3")).toThrow("RewrittenFailure");
});

test("an explicit start boundary tolerates preambles without ignoring malformed operations", () => {
  const source = next(),
    raw = "sub s 2 BEGIN_PLAN is ordinary text here\nat 3 s 1",
    expected = lines.apply(source, raw);
  expect(lines.apply(source, "BEGIN_PLAN\n" + raw)).toEqual(expected);
  expect(lines.apply(source, "Here is the update.\n\nBEGIN_PLAN\n" + raw)).toEqual(expected);
  for (const invalid of [
    "Here is the update.\n" + raw,
    "BEGIN_PLAN",
    "BEGIN_PLAN\nBEGIN_PLAN\n" + raw,
    "BEGIN_PLAN\n" + raw + "\nAll done.",
    "BEGIN_PLAN\nsub s d 2 Mixed arguments\nat 3 s 1",
  ])
    expect(() => lines.apply(source, invalid)).toThrow();
});

test("line parser rejects malformed proposals atomically and requires subtitles and full coverage", () => {
  const source = next(),
    before = structuredClone(source);
  for (const raw of [
    "",
    "```\nat 3 s 1\n```",
    '{"ops":[["@",3,"s",1]]}',
    "at 3 s 1 extra",
    "at 3 s 2",
    "at 3 e 1",
    "at 2 s 1",
    "at 4 s 1",
    "at 3 missing 1",
    "state missing d 2\nat 3 s 1",
    "sub s 2",
    "sub s [2] Invalid evidence\nat 3 s 1",
    "sub s 2, Invalid evidence\nat 3 s 1",
    "sub s 2e0 Invalid number\nat 3 s 1",
    "sub s 0 Invalid number\nat 3 s 1",
    "sub s 9007199254740992 Unsafe integer\nat 3 s 1",
    "sub s 1,1,1,2,3 Too many citations\nat 3 s 1",
    "sub s 4 Future evidence\nat 3 s 1",
    "resolve s 2\nat 3 s 1",
    "bump s unknown 2 Failed check\nat 3 s 1",
    "new s e a 2 Duplicate node\nsub s 2 Duplicate subtitle\nat 3 s 1",
    "new new e a 2 Missing subtitle\nat 3 new 1",
    "new - e a 2 Reserved identity\nsub - 2 No node\nat 3 - 0",
    "sub s 2 Invalid\tsubtitle\nat 3 s 1",
    "please @ 3 s 1",
  ]) {
    expect(() => lines.apply(source, raw)).toThrow();
    expect(source).toEqual(before);
  }
});
