#!/usr/bin/env bun
import * as fs from "node:fs";
import * as path from "node:path";
import * as plan from "./plan";
import * as roadmap from "../../src/activity/roadmap";
import * as planView from "../../src/plan_view";
import type { History } from "./history";
import * as histories from "./history";

let checkpoints = 0,
  returns = 0,
  pending = 0;
const cases: { id: string; checkpoints: number; visits: number }[] = [];
for (const directory of process.argv.slice(2)) {
  const report: { cases: { id: string }[] } = JSON.parse(fs.readFileSync(path.join(directory, "report.json"), "utf8"));
  for (const { id } of report.cases) {
    const accounted = path.join(directory, `${id}.accounted.history.json`),
      data: History = JSON.parse(
        fs.readFileSync(fs.existsSync(accounted) ? accounted : path.join(directory, `${id}.history.json`), "utf8"),
      ),
      calls: { state?: plan.State; through: number }[] = JSON.parse(
        fs.readFileSync(path.join(directory, `${id}.calls.json`), "utf8"),
      );
    const activity = histories.activity(data);
    let previous: roadmap.Visit[] = [],
      previousRows: string[] = [],
      checked = 0;
    for (const call of calls) {
      if (!call.state) continue;
      const line = data.events.find(e => e.id === call.through)?.line ?? 0,
        view = plan.snapshot(call.state, data, line),
        running = histories.runningAt(activity, line);
      const check = (ok: boolean, message: string) => {
        if (!ok) throw Error(`${id}/${call.through}: ${message}`);
      };
      check(view.visits.length >= previous.length, "visits disappeared");
      previous
        .slice(0, -1)
        .forEach((v, i) =>
          check(
            view.visits[i].step === v.step && view.visits[i].from === v.from && view.visits[i].to === v.to,
            "earlier visit moved",
          ),
        );
      for (const node of view.nodes.filter(n => n.kind === "step")) {
        const sum = view.visits
          .filter(v => v.step === node.id)
          .reduce((sum, v) => roadmap.add(sum, v.counts), roadmap.zero());
        for (const field of ["input", "cached", "output", "tools"] as const)
          check(sum[field] === view.counts[node.id][field], `${node.id}: ${field} not conserved`);
      }
      const displayed = planView
        .tail(view, view.visits.length * 3 + view.nodes.length + 1, false)
        .rows.filter(r => r.kind === "node");
      const rowIds = displayed.map(r => r.node.id);
      check(
        previousRows.every((id, i) => rowIds[i] === id),
        "displayed history reordered",
      );
      previousRows = rowIds;
      let children = new Set<string>();
      for (const row of displayed) {
        if (row.depth === 0) children = new Set();
        else {
          check(!children.has(row.node.id), `duplicate step ${row.node.id} within an episode`);
          children.add(row.node.id);
        }
      }
      for (const node of view.nodes.filter(n => n.kind === "step")) {
        const sum = displayed
          .filter(r => r.node.id === node.id)
          .reduce((sum, row) => roadmap.add(sum, row.counts ?? roadmap.zero()), roadmap.zero());
        for (const field of ["input", "cached", "output", "tools"] as const)
          check(sum[field] === view.counts[node.id][field], `${node.id}: displayed ${field} not conserved`);
      }
      const last = view.visits.at(-1),
        step = view.nodes.find(n => n.id === last?.step);
      if (step)
        for (const capacity of [3, 9, 15, 25]) {
          const rows = planView.tail(view, capacity, running).rows,
            leaves = rows.filter(r => r.kind === "node").filter(r => r.depth === 1);
          if (running !== false && step.state === "active")
            check(
              leaves.some(r => r.node.id === step.id && r.current),
              `active step missing at height ${capacity}`,
            );
          check(
            leaves.filter(r => r.current).length === (running !== false && step.state === "active" ? 1 : 0),
            "wrong active visit",
          );
          const current = rows.findIndex(r => r.kind === "node" && r.current && r.depth === 1);
          check(
            current < 0 || !rows.slice(current + 1).some(r => r.kind === "node" && r.depth === 0),
            "active work outside the latest episode",
          );
          const playing = rows.some(r => (r.kind === "node" && r.current) || (r.kind === "pending" && r.active));
          if (running !== null) check(playing === running, "play markers disagree with provider lifecycle");
        }
      if (planView.tail(view, 15, running).rows.some(r => r.kind === "pending" && r.active)) pending++;
      previous = view.visits;
      checked++;
      checkpoints++;
    }
    const seen = new Set<string>();
    for (const visit of previous) {
      if (seen.has(visit.step)) returns++;
      seen.add(visit.step);
    }
    cases.push({ id, checkpoints: checked, visits: previous.length });
  }
}
if (!checkpoints) throw Error("Provide completed replay directories");
console.log(JSON.stringify({ checkpoints, returns, pending, cases }, null, 2));
