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
// iOS rounds the corners itself, so it wants a full-bleed square.
render("icon-maskable.svg", 180, "apple-touch-icon.png");
