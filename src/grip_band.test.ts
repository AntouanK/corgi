import { expect, test } from "bun:test";
import { inflateSync } from "node:zlib";
import { colors } from "./palette";
import * as gripBand from "./grip_band";
import { Rect } from "./layout";

// A 26-cell row with the grip, " ⠶⠶⠶ ", from cell 11: its dots at 12 to 14.
const count = 26,
  start = 11,
  grip = 5;
const at = (x: number) => gripBand.strength(x, count, start, grip);

test("the band is whole around the grip and eases out to nothing at each end", () => {
  for (let x = 10; x <= 16; x++) expect(at(x)).toBe(1);
  // Gone a column before the row on the left and at the border on the right.
  expect(at(-1)).toBeCloseTo(0);
  expect(at(count)).toBeCloseTo(0);
  for (let x = 10; x > -1; x--) expect(at(x - 1)).toBeLessThanOrEqual(at(x));
  for (let x = 16; x < count; x++) expect(at(x + 1)).toBeLessThanOrEqual(at(x));
});

test("the image is the band to the pixel: the selected gray, lined in the grip's gray at its edges", () => {
  const cell = { width: 10, height: 20 };
  const rows = gripBand.pixels(count, start, grip, cell),
    stride = 1 + count * cell.width * 4,
    pixel = (px: number, y: number) => Array.from(rows.slice(y * stride + 1 + px * 4, y * stride + 5 + px * 4));
  const middle = 13 * cell.width + 5;
  expect(pixel(middle, 10)).toEqual([...colors.selected, 255]);
  expect(pixel(middle, 0)).toEqual([...colors.muted, 255]);
  expect(pixel(middle, 19)).toEqual([...colors.muted, 255]);
  // Each pixel column a little fainter than the one before it, out to nothing.
  for (let px = middle; px > 0; px--) expect(pixel(px - 1, 10)[3]).toBeLessThanOrEqual(pixel(px, 10)[3]);
  expect(pixel(0, 10)[3]).toBeLessThan(8);
});

test("the host gets the band once; each frame only places it, around what covers it", () => {
  const cell = { width: 10, height: 20 },
    image = new gripBand.Image();
  expect(image.begin()).toBe("");
  // Not held yet: the frame draws cells and asks for the image.
  expect(image.ready(count, start, grip, cell)).toBe(false);
  const sent = image.end();
  expect(sent.startsWith("\x1b_Ga=t,t=d,f=100,i=730140,q=2,m=")).toBe(true);
  const png = Buffer.from(
    sent
      .split("\x1b\\")
      .filter(Boolean)
      .map((part: string) => part.slice(part.indexOf(";") + 1))
      .join(""),
    "base64",
  );
  const idat = png.indexOf("IDAT");
  expect(inflateSync(png.subarray(idat + 4, idat + 4 + png.readUInt32BE(idat - 4)))).toEqual(
    Buffer.from(gripBand.pixels(count, start, grip, cell)),
  );
  // Held now: later frames place it and send nothing more.
  expect(image.begin()).toBe("\x1b_Ga=d,d=i,i=730140,q=2\x1b\\");
  expect(image.ready(count, start, grip, cell)).toBe(true);
  expect(image.place(1, 13, count, cell)).toBe("\x1b7\x1b[14;2H\x1b_Ga=p,i=730140,p=1,z=-1,C=1,q=2\x1b\\\x1b8");
  expect(image.end()).toBe("");
  // A menu over the row's middle splits it in two, each showing its part.
  const placed = image.place(1, 13, count, cell, [new Rect(10, 12, 6, 4)]);
  expect(placed).toContain("\x1b[14;2H\x1b_Ga=p,i=730140,p=2,x=0,y=0,w=90,h=20,");
  expect(placed).toContain("\x1b[14;17H\x1b_Ga=p,i=730140,p=3,x=150,y=0,w=110,h=20,");
  // Another theme or size sends it again; freeing it forgets it.
  expect(image.ready(count, start, grip, { width: 12, height: 24 })).toBe(false);
  expect(image.clear()).toBe("\x1b_Ga=d,d=I,i=730140,q=2\x1b\\");
  expect(image.begin()).toBe("");
});
