import { writeFileSync } from "node:fs";
import { registerCase } from "./support";
import { Summaries } from "./activity_summary";
import { Viewer } from "./viewer_client";
import { A } from "./codex_titles";
import { EXE, screen_text } from "./runtime";

class Plans extends Summaries {
  async configure() {
    await super.configure();
    this.env.CORGI_LONG_PLAN = "1";
  }
  async test_live_plan_reaches_the_viewer_and_keeps_its_episode_across_turns() {
    writeFileSync(this.control, JSON.stringify({ delay: 0, roadmap: true, bump: true }));
    await this.start_turn("first", false);
    const view = async () => (await this.session()).conversations.find((c: any) => c.agent.session === A).activity_plan;
    await this.until(async () => (await view()).nodes.length === 3);
    const first = await view();
    this.assertEqual(
      first.nodes.map((n: any) => n.id),
      ["g", "e", "s"],
    );
    this.assertTrue(first.partial);
    const viewer = await Viewer.create(this);
    const screen = async () => screen_text((await viewer.poll()).data, 100, 30).join("\n");
    try {
      await viewer.input("\x02P");
      await this.until(async () => (await screen()).includes("Restore terminal focus"));
      const beforeNavigation = await screen();
      await viewer.input("\x1b[6~");
      await viewer.input("\r");
      this.assertEqual(await screen(), beforeNavigation);
      await viewer.input("\x1b");
      await this.until(async () => !(await screen()).includes("Restore terminal focus"));
    } finally {
      await viewer.close();
    }
    const tokens = (input: number) =>
      this.append_record("event_msg", {
        type: "token_count",
        info: {
          total_token_usage: { input_tokens: input, cached_input_tokens: 50, output_tokens: 10 },
          last_token_usage: { input_tokens: input === 100 ? 100 : 200, cached_input_tokens: 50, output_tokens: 10 },
        },
      });
    tokens(100);
    await this.until(async () => (await view()).known);
    tokens(300);
    await this.until(async () => BigInt((await view()).counts.g.input) >= 200n);
    this.tools(2, "bun test focus");
    await this.until(async () => {
      const plan = await view();
      return BigInt(plan.counts.g.tools) + BigInt(plan.unassigned.tools) === 2n;
    });
    await this.advance(10);
    await this.until(async () => (await view()).counts.g.tools === "2");
    const before = await view(),
      pid = (await this.session()).server_pid;
    this.assertEqual(before.nodes[2].bump.kind, "verification");
    await this.rpc({ op: "server.reload", executable: EXE });
    await this.attachment.select(A);
    this.assertNotEqual((await this.session()).server_pid, pid);
    this.assertEqual(await view(), before);
    await this.start_turn("second", false);
    this.tools(1, "bun test focus");
    await this.advance(10);
    await this.until(() => this.calls().some(raw => JSON.parse(raw).tree?.length === 3));
    this.assertEqual(
      (await view()).nodes.map((n: any) => n.id),
      ["g", "e", "s"],
    );
  }
}
registerCase("Plans", Plans, { inherited: false });
