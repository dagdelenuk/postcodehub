// Renders the PWA icon PNGs from the SVG sources in public/icons/. Run with `npm run icons` after changing either SVG.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public/icons");
const render = (svgFile, size, outFile) => {
  const png = new Resvg(readFileSync(path.join(dir, svgFile)), { fitTo: { mode: "width", value: size } }).render().asPng();
  writeFileSync(path.join(dir, outFile), png);
  console.log(`${outFile} (${size}x${size})`);
};

render("icon.svg", 192, "icon-192.png");
render("icon.svg", 512, "icon-512.png");
render("icon-maskable.svg", 512, "icon-maskable-512.png");

// favicon.ico: an ICO container holding 16, 32 and 48px PNGs, for browsers and tools that still ask for /favicon.ico.
const sizes = [16, 32, 48];
const pngs = sizes.map((size) => new Resvg(readFileSync(path.join(dir, "icon.svg")), { fitTo: { mode: "width", value: size } }).render().asPng());
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(sizes.length, 4);
let offset = 6 + sizes.length * 16;
const entries = sizes.map((size, i) => {
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size, 0); // width
  entry.writeUInt8(size, 1); // height
  entry.writeUInt16LE(1, 4); // colour planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(pngs[i].length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += pngs[i].length;
  return entry;
});
writeFileSync(path.join(dir, "../favicon.ico"), Buffer.concat([header, ...entries, ...pngs]));
console.log("favicon.ico (16, 32, 48)");

// iOS rounds the corners itself, so it wants a full-bleed square.
render("icon-maskable.svg", 180, "apple-touch-icon.png");
