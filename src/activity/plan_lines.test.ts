import { expect, test } from "bun:test";
import * as plan from "./plan";
import * as lines from "./plan_lines";
import * as json from "./plan_protocol";
import type { Input } from "./roadmap";

const event = (id: number): plan.Event => ({ id, turn: 1, line: id, at: "", kind: "tool", text: "Verify downloads" });
const seed = `cite 1
new g - active Fix downloads
sub g Resume interrupted transfers
new e g active Repair offsets
sub e Retain downloaded bytes
new s e active Test resume
sub s Check retry offsets
work 1 s`;
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
    raw = `cite 2\ntitle s ${title}\ncite 2,3\nsub s ${subtitle}\ncite 3\nstate s done\nwork 3 s`;
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
  expect(lines.apply(input(), "skip 1").patch.nodes).toEqual([]);
});

test("line setbacks and recoveries preserve failed attempts and original evidence", () => {
  const source = next(),
    before = structuredClone(source),
    raw = `cite 2
bump s verification Retry duplicated bytes
cite 3
new retry e done Retry resume
sub retry Repaired offsets passed
resolve s
work 2 s
work 3 retry`;
  const result = lines.apply(source, raw);
  expect(source).toEqual(before);
  expect(result.state.nodes.find(n => n.id === "s")).toMatchObject({
    state: "failed",
    bump: { kind: "verification", state: "resolved", detail: "Retry duplicated bytes", evidence: [2, 3] },
  });
  expect(plan.apply(source.state, JSON.stringify(result.patch), source.events).state).toEqual(result.state);
  expect(() => lines.apply(source, raw + "\nstate s done")).toThrow("RewrittenFailure");
});

test("an explicit start boundary tolerates preambles without ignoring malformed operations", () => {
  const source = next(),
    raw = "cite 2\nsub s BEGIN_PLAN is ordinary text here\nwork 3 s",
    expected = lines.apply(source, raw);
  expect(lines.apply(source, "BEGIN_PLAN\n" + raw)).toEqual(expected);
  expect(lines.apply(source, "Here is the update.\n\nBEGIN_PLAN\n" + raw)).toEqual(expected);
  for (const invalid of [
    "Here is the update.\n" + raw,
    "BEGIN_PLAN",
    "BEGIN_PLAN\nBEGIN_PLAN\n" + raw,
    "BEGIN_PLAN\n" + raw + "\nAll done.",
    "BEGIN_PLAN\ncite nope\nsub s Mixed arguments\nwork 3 s",
  ])
    expect(() => lines.apply(source, invalid)).toThrow();
});

test("line parser rejects malformed proposals atomically and requires subtitles and full coverage", () => {
  const source = next(),
    before = structuredClone(source);
  for (const raw of [
    "",
    "```\nwork 3 s\n```",
    '{"ops":[["@",3,"s",1]]}',
    "work 3 s extra",
    "work 3 e",
    "work 2 s",
    "work 4 s",
    "work 3 missing",
    "note 3 -",
    "cite 2\nstate missing done\nwork 3 s",
    "cite 2\nsub s",
    "sub s Missing citation\nwork 3 s",
    "cite [2]\nwork 3 s",
    "cite 2,\nwork 3 s",
    "cite 2e0\nwork 3 s",
    "cite 0\nwork 3 s",
    "cite 9007199254740992\nwork 3 s",
    `cite ${Array(65).fill(1).join(",")}\nwork 3 s`,
    "cite 4\nwork 3 s",
    "cite 4\nsub s Future evidence\nwork 3 s",
    "cite 2\nresolve s\nwork 3 s",
    "cite 2\nbump s unknown Failed check\nwork 3 s",
    "cite 2\nnew s e active Duplicate node\nsub s Duplicate subtitle\nwork 3 s",
    "cite 2\nnew fresh e active Missing subtitle\nwork 3 fresh",
    "cite 2\nnew - e active Reserved identity\nsub - No node\nskip 3",
    "cite 2\nsub s Invalid\tsubtitle\nwork 3 s",
    "please work 3 s",
    "work 3 s\nskip 3",
    "work 2,3 s",
    "skip 3 s",
  ]) {
    expect(() => lines.apply(source, raw)).toThrow();
    expect(source).toEqual(before);
  }
});

test("long valid citation lists preserve every supporting ID", () => {
  const source = next();
  source.events = Array.from({ length: 11 }, (_, i) => ({ ...source.events[0], id: i + 2 }));
  const result = lines.apply(source, "cite 2,4,6,8,10,12\nsub s All retry offsets verified\nwork 12 s");
  expect(result.state.nodes.find(n => n.id === "s")?.evidence).toEqual([2, 4, 6, 8, 10, 12]);
  expect(result.repairs).toEqual([]);
  expect(() => lines.apply(source, "cite 2,4,6,8,10,13\nsub s Unsupported result\nwork 12 s")).toThrow(
    "InvalidEvidence",
  );
});

test("an exact repeated creation is a no-op, while changed identities still reject", () => {
  const source = next(),
    old = source.state.nodes.find(n => n.id === "s")!;
  const repeated = `cite 2\nnew s ${old.parent} ${old.state} ${old.title}\nsub s Verified byte offsets\nwork 3 s`;
  const result = lines.apply(source, repeated),
    plain = lines.apply(source, "cite 2\nsub s Verified byte offsets\nwork 3 s");
  expect(result.state).toEqual(plain.state);
  expect(result.repairs).toEqual(["ignored redundant creation: s"]);
  expect(() => lines.apply(source, repeated.replace(`new s ${old.parent}`, "new s g"))).toThrow("InvalidCreation");
  expect(() => lines.apply(source, repeated.replace(old.title, "Different work activity"))).toThrow("InvalidCreation");
  expect(() =>
    lines.apply(source, repeated.replace(`new s ${old.parent} ${old.state}`, `new s ${old.parent} done`)),
  ).toThrow("InvalidCreation");
});

test("harmless syntax repairs preserve meaning and remain visible to the eval", () => {
  const source = next();
  const plain = lines.apply(source, "work 3 s");
  const repaired = lines.apply(source, "BEGIN_PLAN\nwork through 3 s\nwork 3 s\nEOF");
  expect(repaired.state).toEqual(plain.state);
  expect(repaired.patch).toEqual(plain.patch);
  expect(repaired.repairs).toHaveLength(3);
  expect(() => lines.apply(source, "BEGIN_PLAN\nwork 2 s\nEOF")).toThrow();
  expect(() => lines.apply(source, "BEGIN_PLAN\nwork 3 s\nskip 3\nEOF")).toThrow();
  expect(() => lines.apply(source, "BEGIN_PLAN\nwork 3 s\nEOF\nstate s done")).toThrow();
  expect(() => lines.apply(source, "BEGIN_PLAN\nEOF")).toThrow();
});

test("citation scopes are local and setback expansion cannot alter another edit's evidence", () => {
  const source = next();
  source.state.nodes[2].bump = { kind: "environment", state: "open", detail: "Missing dependency", evidence: [1] };
  const result = lines.apply(
    source,
    "cite 2\nsub e Repaired setup\nbump s environment Still missing dependency\nsub g Preserve all downloaded bytes\nwork 3 s",
  );
  expect(result.state.nodes.find(n => n.id === "e")?.evidence).toEqual([2]);
  expect(result.state.nodes.find(n => n.id === "g")?.evidence).toEqual([2]);
  expect(result.state.nodes.find(n => n.id === "s")?.bump?.evidence).toEqual([1, 2]);
  expect(() => lines.apply(source, "sub g Evidence does not leak between responses\nwork 3 s")).toThrow();
});

test("the response default citation can follow edits without inventing evidence", () => {
  const source = next(),
    expected = lines.apply(source, "cite 2\nsub s Repaired offsets\nwork 3 s");
  const result = lines.apply(source, "sub s Repaired offsets\ncite 2\nwork 3 s");
  expect(result.state).toEqual(expected.state);
  expect(result.repairs).toEqual(["applied response default citation before its declaration"]);
  expect(() => lines.apply(source, "sub s Repaired offsets\nwork 3 s")).toThrow("InvalidEvidence");
  expect(() => lines.apply(source, "sub s Repaired offsets\ncite 4\nwork 3 s")).toThrow("InvalidEvidence");
});
