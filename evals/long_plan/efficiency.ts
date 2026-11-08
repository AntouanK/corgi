#!/usr/bin/env bun
// Compare against recorded production-sized requests at exactly the same checkpoints.
import * as fs from "node:fs";
import * as path from "node:path";
import { Pool } from "../../src/inference/harness";
import * as plan from "../../src/activity/plan";
import * as roadmap from "../../src/activity/roadmap";
import * as compact from "../../src/activity/plan_protocol";
import { Audit } from "./usage_audit";
import { Context } from "../../src/activity/plan_context";
import { Conversation } from "./cached";

type Usage = { input: string; cached_input: string; output: string };
type Call = { through: number; input: roadmap.Input; raw: string; usage: Usage };
const args = process.argv.slice(2),
  cached = args.includes("--cached"),
  ops = !args.includes("--legacy") && !cached,
  plain = args.includes("--plain"),
  reuse = ops && !args.includes("--stateless"),
  [directory, destination] = args.filter(arg => !["--cached", "--legacy", "--plain", "--stateless"].includes(arg));
if (!directory || !destination)
  throw Error("Usage: efficiency.ts BASELINE_DIRECTORY OUTPUT_DIRECTORY [--legacy | --cached | --stateless] [--plain]");
const json = (value: unknown) => JSON.stringify(value, (_, v) => (typeof v === "bigint" ? String(v) : v), 2);
fs.mkdirSync(destination, { recursive: true });
for (const file of fs
  .readdirSync(directory)
  .filter(f => f.endsWith(".plan.json"))
  .sort()) {
  const baseline: { complete: boolean; model: string; case: string; calls: Call[] } = JSON.parse(
    fs.readFileSync(path.join(directory, file), "utf8"),
  );
  if (!baseline.complete) throw Error(`IncompleteBaseline:${file}`);
  const output = path.join(destination, file);
  if (fs.existsSync(output)) throw Error(`OutputExists:${file}`);
  const pool = new Pool({
      config: { provider: "claude", model: baseline.model.replace(/^claude:/, ""), timeout_ms: 60000 },
    }),
    road = new roadmap.Roadmap(),
    session = new Conversation(),
    context = new Context(),
    calls: unknown[] = [],
    audit = new Audit();
  const save = (complete: boolean) =>
    fs.writeFileSync(
      output,
      json({
        complete,
        model: baseline.model,
        case: baseline.case,
        baseline: path.resolve(directory, file),
        transport: reuse
          ? plain
            ? "compact-text-deltas"
            : "compact-deltas"
          : ops
            ? plain
              ? "compact-text"
              : "compact"
            : cached
              ? "cached-deltas"
              : "stateless",
        instructions: ops ? compact.instructions : plan.instructions,
        schema: ops ? (plain ? null : compact.schema) : plan.schema,
        calls,
      }) + "\n",
    );
  try {
    for (const previous of baseline.calls) {
      const input = structuredClone({
          state: road.state,
          events: previous.input.events,
          support: road.support,
          focus: road.focus_step,
        }),
        request = reuse
          ? context.prepare(input)
          : ops
            ? {
                instructions: compact.instructions,
                schema: plain ? null : compact.schema,
                content: compact.content(input),
              }
            : cached
              ? session.prepare(input)
              : { instructions: plan.instructions, schema: plan.schema, content: roadmap.content(input) },
        started = Date.now();
      if (plain && ops) request.schema = null;
      const response = await pool.infer(request);
      const call = {
        through: previous.through,
        input,
        request,
        fresh: response.fresh,
        raw: response.text(),
        usage: response.usage,
        audit: audit.take(response.usage),
        elapsed_ms: Date.now() - started,
      };
      calls.push(call);
      save(false);
      if (!road.apply(input, ops ? JSON.stringify(compact.apply(input, call.raw).patch) : call.raw))
        throw Error("PlanApplyFailed");
      if (cached) session.accept(input, road.state);
      if (reuse) context.accept(input, road.state);
      console.log(`${baseline.case} ${calls.length}/${baseline.calls.length}`);
    }
    save(true);
  } finally {
    pool.close();
    audit.close();
  }
}
