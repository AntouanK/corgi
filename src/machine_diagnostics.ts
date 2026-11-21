import type { Endpoint } from "./machine_connection";
import * as card from "./connectivity_card";
import * as text from "./text";
import { Rect } from "./layout";

export class Notice {
  private message: string[] | null = null;
  private offset = 0;
  private height = 0;
  private length = 0;
  get open(): boolean {
    return this.message !== null;
  }
  /** Opens `endpoint`'s problem; false when it has none to show. */
  show(endpoint: Endpoint): boolean {
    if (endpoint.updateError && !endpoint.error) {
      this.message = [
        `${endpoint.name} · Update failed`,
        "",
        ...this.updateLines(endpoint),
        "",
        "Ctrl+R in the machine picker to retry",
      ];
      this.offset = 0;
      return true;
    }
    if (!endpoint.error) return false;
    const command = endpoint.issue === "auth" || endpoint.issue === "host-key" ? "reconnect" : "status";
    this.message = [
      `${endpoint.name} · ${endpoint.issue === "auth" ? "Authentication required" : "Connection problem"}`,
      "",
      endpoint.error.replace(/[\x00-\x1f\x7f]/g, " "),
      "",
      "Run in a terminal:",
      `corgi machine ${command} ${endpoint.name}`,
      ...(endpoint.updateError ? ["", "Update failed", ...this.updateLines(endpoint)] : []),
      ...(endpoint.issue === "host-key" ? ["Verify the host fingerprint before approving its key."] : []),
    ];
    this.offset = 0;
    return true;
  }
  private updateLines(endpoint: Endpoint): string[] {
    return endpoint.updateLog.replace(/[\x00-\x09\x0b-\x1f\x7f]/g, " ").split("\n");
  }
  close(): void {
    this.message = null;
  }
  scroll(delta: number): void {
    this.offset = Math.max(0, Math.min(Math.max(0, this.length - this.height), this.offset + delta));
  }
  key(value: string, cp: number | null): void {
    if (cp === 27 || cp === 13 || value === "q") this.close();
    else if (value === "\x1b[A" || cp === 57352) this.scroll(-1);
    else if (value === "\x1b[B" || cp === 57353) this.scroll(1);
    else if (value === "\x1b[5~") this.scroll(-this.height);
    else if (value === "\x1b[6~") this.scroll(this.height);
  }
  private layout(cols: number, rows: number): { rect: Rect; lines: string[] } | null {
    if (!this.message || cols < 6 || rows < 5) return null;
    const width = Math.min(76, cols);
    const lines = this.message.flatMap(line => (line ? text.wrap(line, width - 4) : [""]));
    const height = Math.min(rows - 4, lines.length);
    return {
      rect: new Rect(Math.floor((cols - width) / 2), Math.floor((rows - height - 4) / 2), width, height + 4),
      lines,
    };
  }
  /** Where the notice draws on a `cols` × `rows` screen; null when it draws nothing. */
  rect(cols: number, rows: number): Rect | null {
    return this.layout(cols, rows)?.rect ?? null;
  }
  draw(cols: number, rows: number): string {
    const laid = this.layout(cols, rows);
    if (laid === null) return "";
    const { rect, lines } = laid;
    this.length = lines.length;
    this.height = rect.h - 4;
    this.scroll(0);
    const writer = new text.Writer();
    card.draw(writer, {
      rect,
      lines: [
        ...lines.slice(this.offset, this.offset + this.height).map(line => ({ text: line })),
        { text: "", color: "muted" },
        { text: "Esc close · ↑↓ scroll", color: "muted" },
      ],
    });
    return writer.buffered();
  }
}
