//! The rule between the sidebar's lists: a band in the selected gray around
//! the drag grip, lined above and below in the grip's gray, that fades into
//! the panel toward both ends so the headings beside them keep the eye.
//! Hosts that show Kitty images get it as one image under the row's text,
//! smooth to the pixel, sent once and placed by each frame; the rest, and a
//! frame before the host holds the image, get it cell by cell.
import { crc32, deflateSync } from "node:zlib";
import * as palette from "./palette";
import { bgRgb, colors, fgRgb, mix } from "./palette";
import { Rect } from "./layout";
import type { Cell } from "./fork_hero";

const image_id = 730140;

/** How strong the band is at `x`, in cells from the row's start, from 0 to
 * 1: whole across the grip and two cells either side, then easing out to
 * nothing by each end, the panel's edge a column before the row and the
 * border just after it. */
export function strength(x: number, cells: number, start: number, grip: number): number {
  const center = start + (grip - 1) / 2,
    full = 3,
    reach = Math.max(1, (x < center ? center + 1 : cells - center) - full),
    t = Math.min(1, Math.max(0, Math.abs(x - center) - full) / reach);
  return 0.5 * (1 + Math.cos(Math.PI * t));
}

/** The band cell by cell, `grip` from `start`: each cell's fill, text and
 * underline step toward the panel, and the text color carries the overline. */
export function cells(count: number, start: number, grip: string, panel: string): string {
  let out = "";
  for (let x = 0; x < count; x++) {
    const ch = grip[x - start] ?? " ",
      share = Math.round(100 * strength(x, count, start, grip.length));
    if (share < 3) {
      out += panel + ch;
      continue;
    }
    const ink = mix(colors.bg, colors.muted, share);
    out += "\x1b[0;4;53m" + bgRgb(mix(colors.bg, colors.selected, share)) + fgRgb(ink) + palette.underlineRgb(ink) + ch;
  }
  return out;
}

/** The lines' thickness in pixels, about an underline's. */
const line = (cell: Cell) => Math.max(1, Math.round(cell.height / 16));

function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length);
  out.write(type, 4, "latin1");
  out.set(data, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
/** The band's pixels, `count` cells wide and a cell tall: the selected gray
 * with the lines in the grip's gray along its top and bottom edges, each
 * column as strong as `strength` at its middle. */
export function pixels(count: number, start: number, grip: number, cell: Cell): Uint8Array {
  const width = count * cell.width,
    height = cell.height,
    t = line(cell),
    stride = 1 + width * 4,
    out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const [r, g, b] = y < t || y >= height - t ? colors.muted : colors.selected;
    for (let px = 0; px < width; px++) {
      const at = y * stride + 1 + px * 4;
      out[at] = r;
      out[at + 1] = g;
      out[at + 2] = b;
      out[at + 3] = Math.round(255 * strength((px + 0.5) / cell.width - 0.5, count, start, grip));
    }
  }
  return out;
}
/** The band as a PNG, base64: PNG rather than o=z, which Ghostty 1.3.1
 * crashes inflating over 64 KiB. */
function png(count: number, start: number, grip: number, cell: Cell): string {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(count * cell.width);
  ihdr.writeUInt32BE(cell.height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(pixels(count, start, grip, cell))),
    chunk("IEND", new Uint8Array()),
  ]).toString("base64");
}
const key = (count: number, start: number, grip: number, cell: Cell) =>
  `${count}:${start}:${grip}:${cell.width}x${cell.height}:${colors.selected}:${colors.muted}`;

/** The band as an image the host holds: sent once for each size, grip and
 * theme, then placed by each frame that shows it. */
export class Image {
  private held: string | null = null;
  private wanted: { count: number; start: number; grip: number; cell: Cell } | null = null;
  private placement = 0;
  /** Takes the last frame's band off the screen, keeping its pixels. */
  begin(): string {
    this.placement = 0;
    return this.held === null ? "" : `\x1b_Ga=d,d=i,i=${image_id},q=2\x1b\\`;
  }
  /** Whether the host holds the band drawn this way; asks for it when not. */
  ready(count: number, start: number, grip: number, cell: Cell): boolean {
    if (this.held === key(count, start, grip, cell)) return true;
    this.wanted = { count, start, grip, cell };
    return false;
  }
  /** Places the held band, `count` cells wide, at column `col` of row `row`,
   * cut around what covers it: under the text, it would show through. */
  place(col: number, row: number, count: number, cell: Cell, covered: readonly Rect[] = []): string {
    const whole = new Rect(col, row, count, 1);
    let pieces = [whole];
    for (const box of covered) pieces = pieces.flatMap(piece => piece.cut(box));
    return pieces
      .map(piece => {
        const source =
          piece === whole ? "" : `x=${(piece.x - col) * cell.width},y=0,w=${piece.w * cell.width},h=${cell.height},`;
        return `\x1b7\x1b[${piece.y + 1};${piece.x + 1}H\x1b_Ga=p,i=${image_id},p=${++this.placement},${source}z=-1,C=1,q=2\x1b\\\x1b8`;
      })
      .join("");
  }
  /** Sends the band the frame asked for. */
  end(): string {
    if (this.wanted === null) return "";
    const { count, start, grip, cell } = this.wanted,
      data = png(count, start, grip, cell);
    let out = "";
    for (let offset = 0; offset < data.length; offset += 4096) {
      const end = Math.min(offset + 4096, data.length),
        more = Number(end < data.length);
      out +=
        (offset === 0 ? `\x1b_Ga=t,t=d,f=100,i=${image_id},q=2,m=${more};` : `\x1b_Gm=${more};`) +
        data.slice(offset, end) +
        "\x1b\\";
    }
    this.held = key(count, start, grip, cell);
    this.wanted = null;
    return out;
  }
  /** Frees the band on the host. */
  clear(): string {
    const out = this.held === null ? "" : `\x1b_Ga=d,d=I,i=${image_id},q=2\x1b\\`;
    this.held = null;
    this.wanted = null;
    return out;
  }
}
