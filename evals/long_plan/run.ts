#!/usr/bin/env bun
import * as fs from "node:fs";
import * as path from "node:path";
import { Pool } from "../../src/inference";
import * as flat from "../../src/activity/prompt";
import * as history from "./history";
import * as plan from "./plan";
import * as scoring from "./score";
import type { Provider } from "./history";
import type { Check } from "./score";

export type Case = {
  id: string;
  provider: Provider;
  source: string;
  split: "development" | "holdout";
  through_line?: number;
  checks: Check[];
};
const json = (v: unknown) => JSON.stringify(v, (_, value) => (typeof value === "bigint" ? String(value) : value), 2);
const write = (file: string, value: unknown) => fs.writeFileSync(file, json(value) + "\n");

async function main() {
  const args = process.argv.slice(2),
    option = (name: string, fallback = "") => {
      const i = args.indexOf(name);
      return i < 0 ? fallback : args[i + 1];
    };
  const manifest = option("--manifest");
  if (!manifest)
    throw Error(
      "Usage: bun evals/long_plan/run.ts --manifest PATH [--prepare | --model claude:MODEL] [--case ID] [--batch 24] [--ablation no-reasoning] [--flat] [--out DIR]",
    );
  const selection = option("--case"),
    model = option("--model", "claude:claude-haiku-5-5"),
    [provider, ...parts] = model.split(":"),
    modelId = parts.join(":");
  if (provider !== "claude" && provider !== "codex") throw Error("InvalidProvider");
  const batchSize = Number(option("--batch", "24")),
    ablation = option("--ablation", "all"),
    baseline = args.includes("--flat");
  if (!["all", "no-reasoning", "no-plans", "tools-only"].includes(ablation)) throw Error("InvalidAblation");
  const dir = option("--out", `evals/results/long-plan/${new Date().toISOString().replaceAll(":", "-")}`);
  fs.mkdirSync(dir, { recursive: true });
  const raw = fs.readFileSync(manifest, "utf8"),
    cases: Case[] = JSON.parse(raw);
  const selected = cases.filter(c => !selection || c.id === selection);
  if (!selected.length) throw Error("NoCases");
  const pool = new Pool({ config: { provider, model: modelId, timeout_ms: 60000 } });
  const stopping = { value: false };
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => (stopping.value = true));
  const sourceHashes = Object.fromEntries(
    [
      "history.ts",
      "plan.ts",
      "score.ts",
      "run.ts",
      "../../src/inference/harness.ts",
      "../../src/activity/prompt.ts",
    ].map(file => [file, history.hash(fs.readFileSync(path.join(import.meta.dir, file), "utf8"))]),
  );
  const report: {
    model: string;
    baseline: boolean;
    ablation: string;
    batch: number;
    manifest_hash: string;
    instructions: string;
    schema: string;
    source_hashes: typeof sourceHashes;
    cases: unknown[];
    failures: number;
  } = {
    model,
    baseline,
    ablation,
    batch: batchSize,
    manifest_hash: history.hash(raw),
    instructions: baseline ? flat.instructions : plan.instructions,
    schema: baseline ? flat.schema : plan.schema,
    source_hashes: sourceHashes,
    cases: [],
    failures: 0,
  };
  try {
    for (const c of selected) {
      if (!/^[a-z0-9_-]+$/.test(c.id)) throw Error("InvalidCaseId");
      const data = history.read(c.source, c.provider);
      if (c.through_line !== undefined) {
        data.events = data.events.filter(e => e.line <= c.through_line!);
        data.receipts = data.receipts.filter(r => r.line <= c.through_line!);
        data.warnings.push(`Prefix excerpt ending at source line ${c.through_line}.`);
      }
      if (data.warnings.some(w => w.startsWith("Fork/child"))) throw Error("ForkRequiresOwnershipFilter");
      write(path.join(dir, `${c.id}.history.json`), data);
      if (args.includes("--prepare")) {
        console.log(
          `${c.id}: ${data.events.length} events, ${data.receipts.length} receipts, ${history.total(data.receipts.reduce((t, r) => history.add(t, r.tokens), history.zero()))} tokens`,
        );
        continue;
      }
      let state = plan.empty(),
        phase: string | null = null,
        phaseId = "",
        phaseIndex = 0;
      const flatContext = new flat.Context();
      const snapshots: plan.State[] = [],
        calls: unknown[] = [],
        errors: string[] = [];
      for (const batch of plan.batches(data.events, batchSize)) {
        if (stopping.value) throw Error("Cancelled");
        const withhold = (e: history.Event) => ({
          ...e,
          text:
            (ablation === "no-reasoning" && e.kind === "reasoning") ||
            (ablation === "no-plans" && e.kind === "plan") ||
            (ablation === "tools-only" && !["tool", "result", "lifecycle"].includes(e.kind))
              ? "[signal withheld]"
              : e.text,
        });
        const events = batch.map(withhold);
        const support = [...new Set(state.nodes.flatMap(n => n.evidence))]
          .map(id => data.events[id - 1])
          .filter(Boolean)
          .map(withhold)
          .map(e => ({ ...e, text: e.text.slice(0, 350) }));
        const evidence = events.map(e => `${e.id} ${e.kind}: ${e.text}`).join("\n");
        const flatEvidence = Buffer.from(evidence).subarray(-2048).toString("utf8").replaceAll("\ufffd", "");
        const turn = String(batch.at(-1)!.turn);
        if (baseline) phase = flatContext.phase(turn);
        const input = baseline
          ? {
              provider: c.provider,
              turn: flat.turnTag(turn),
              phase,
              earlier: flatContext.earlier(turn),
              history: flatContext.recent.slice(0, flatContext.len).map(entry => entry.text()),
              evidence: flatEvidence,
            }
          : {
              provider: c.provider,
              assign_from: events[0].id,
              assign_through: events.at(-1)!.id,
              tree: state.nodes,
              support,
              events,
            };
        const started = Date.now();
        let rawResponse: string | null = null;
        const attempts: unknown[] = [];
        try {
          const request = {
            instructions: baseline ? flat.instructions : plan.instructions,
            schema: baseline ? flat.schema : plan.schemaFor(events[0].id, events.at(-1)!.id),
            content: JSON.stringify(input),
          };
          let response = await pool.infer(request, stopping);
          rawResponse = response.text();
          attempts.push({ raw: rawResponse, usage: response.usage });
          if (!baseline) {
            try {
              plan.apply(state, rawResponse, batch);
            } catch (error) {
              const invalid = error instanceof Error ? error.message : String(error);
              errors.push(`Invalid first attempt: ${invalid}`);
              response = await pool.infer(
                {
                  ...request,
                  content: JSON.stringify({
                    ...input,
                    correction: `Previous patch was rejected: ${invalid}. Return a corrected patch. Assign ONLY events ${events[0].id} through ${events.at(-1)!.id}.`,
                    rejected: rawResponse,
                  }),
                },
                stopping,
              );
              rawResponse = response.text();
              attempts.push({ raw: rawResponse, usage: response.usage, correction: invalid });
            }
          }
          if (baseline) {
            const decision = flat.parse(rawResponse, phase);
            if (decision.label) {
              const title = decision.label.text();
              if (!phaseId || decision.action === "new") {
                phaseId = `phase_${++phaseIndex}`;
                if (!state.nodes.length)
                  state.nodes.push({
                    id: "goal",
                    parent: null,
                    kind: "goal",
                    title: "Flat activity baseline",
                    subtitle: "Production phase labels",
                    state: "active",
                    evidence: [events[0].id],
                  });
                state.nodes.push(
                  {
                    id: phaseId,
                    parent: "goal",
                    kind: "episode",
                    title,
                    subtitle: title,
                    state: "active",
                    evidence: [events.at(-1)!.id],
                  },
                  {
                    id: `${phaseId}_step`,
                    parent: phaseId,
                    kind: "step",
                    title,
                    subtitle: title,
                    state: "active",
                    evidence: [events.at(-1)!.id],
                  },
                );
              } else
                for (const n of state.nodes.filter(n => n.id === phaseId || n.id === `${phaseId}_step`))
                  n.title = title;
              phase = title;
              flatContext.remember(turn, flatEvidence, decision.label, decision.action);
            }
            state.spans.push({
              from: events[0].id,
              to: events.at(-1)!.id,
              node: decision.label ? `${phaseId}_step` : null,
            });
            state.through = events.at(-1)!.id;
          } else state = plan.apply(state, rawResponse, batch).state;
          const snapshot = structuredClone(state),
            elapsed = Date.now() - started;
          snapshots.push(snapshot);
          const tokens = plan.ledger(state, data, batch.at(-1)!.line);
          calls.push({
            through: state.through,
            input,
            raw: rawResponse,
            elapsed_ms: elapsed,
            attempts,
            state: snapshot,
            ledger: tokens,
          });
          console.log(`${c.id} ${state.through}/${data.events.length}: ${state.nodes.length} nodes, ${elapsed}ms`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          errors.push(message);
          calls.push({
            through: batch.at(-1)!.id,
            input,
            raw: rawResponse,
            error: message,
            attempts,
            elapsed_ms: Date.now() - started,
          });
          console.error(`${c.id}: ${message}`);
          break;
        } finally {
          write(path.join(dir, `${c.id}.calls.json`), calls);
        }
      }
      const checks = scoring.score(data, snapshots, c.checks),
        result = {
          id: c.id,
          split: c.split,
          source_hash: data.sha256,
          warnings: data.warnings,
          errors,
          checks,
          metrics: scoring.metrics(data, snapshots),
          ledger: plan.ledger(state, data),
          state,
        };
      report.failures += errors.length + checks.filter(r => !r.pass).length;
      report.cases.push(result);
      write(path.join(dir, "report.json"), report);
    }
  } finally {
    pool.close();
  }
  if (!args.includes("--prepare")) {
    console.log(`${report.failures} failures; ${dir}/report.json`);
    process.exitCode = report.failures ? 1 : 0;
  }
}
if (import.meta.main)
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
