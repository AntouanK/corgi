import * as fs from "node:fs";
import { Agent, Text } from "../../src/agents";
import { Tail } from "../../src/usage/worker";
import { adapter } from "../../src/providers";
import * as checklist from "../../src/activity/checklist";
import { clip } from "../../src/activity/tools";
import type { TranscriptReader } from "../../src/providers/adapter";
import type { Event, Provider } from "./history";

/** Replays the production readers, with only the observations available at each checkpoint. */
export class Signals {
  tail = new Tail();
  records: unknown[];
  cursor = 0;
  session = "";
  turn = 0;
  reader: TranscriptReader;
  constructor(
    readonly source: string,
    readonly provider: Provider,
  ) {
    this.reader = adapter(provider).transcript!.reader(() => []);
    this.records = fs
      .readFileSync(source, "utf8")
      .split("\n")
      .map(line => (line.trim() ? JSON.parse(line) : {}));
    const row = this.records.find(v => v && typeof v === "object" && ("sessionId" in v || "payload" in v)) as
      { sessionId?: string; payload?: { id?: string } } | undefined;
    this.session = row?.sessionId ?? row?.payload?.id ?? "synthetic";
  }
  batch(events: Event[]): Event[] {
    const agent = new Agent();
    agent.provider = this.provider;
    agent.session = new Text(this.session);
    agent.state = "working";
    const last = events.at(-1)!;
    if (last.turn !== this.turn) {
      this.turn = last.turn;
      this.tail.progress.bind(String(this.turn));
    }
    agent.setTurn(String(this.turn));
    const req = { actor: 1, workspace: 1, since: 0, child: false, tracked_since: 0, agent };
    while (this.cursor < last.line) {
      const value = this.records[this.cursor++];
      this.reader.record(this.tail, req, value, true, null);
    }
    const progress = this.tail.progress.view(),
      list = this.tail.checklist ?? new checklist.List();
    const text =
      clip(progress.evidence.text() + progress.commentary.text(), 2048) +
      "\n" +
      progress.road_evidence.text() +
      "\nTODO snapshot: " +
      JSON.stringify(list);
    return events.map(e => ({
      ...e,
      kind: "assistant",
      text: e.id === last.id ? clip(text, 6000) : "[Observed only through the interval snapshot below]",
    }));
  }
}
