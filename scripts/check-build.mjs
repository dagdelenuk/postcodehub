// Smoke checks on the built site (dist/). Run after `npm run build`: it fails, with a list of problems, if pages that should be there are missing or
// hold obvious data bugs ("undefined", "NaN"), if internal links point nowhere, or if the sitemap, manifest or data files are broken.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = process.env.DIST_DIR ? path.resolve(process.env.DIST_DIR) : path.join(root, "dist");
const problems = [];
const fail = (message) => problems.push(message);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

if (!existsSync(DIST)) {
  console.error("dist/ not found - run `npm run build` first.");
  process.exit(1);
}
const files = walk(DIST);
const rel = (f) => path.relative(DIST, f).split(path.sep).join("/");
const htmlFiles = files.filter((f) => f.endsWith(".html"));
const fileSet = new Set(files.map(rel));

// ---- 1. Pages that must exist, with text they must contain ----
const REQUIRED = [
  ["index.html", ["PostcodeHub"]],
  ["london/index.html", ["London"]],
  ["london/statistics/index.html", ["Statistics", "Housing", "Demographics", "Crime", "Environment"]],
  ["london/rankings/index.html", ["rankings"]],
  ["london/rankings/quietest-areas/index.html", ["Quietest"]],
  ["london/richmond-upon-thames/index.html", ["Richmond upon Thames", "At a glance", "Council Services"]],
  ["london/richmond-upon-thames/tw11/index.html", ["TW11", "Areas like TW11"]],
  ["london/richmond-upon-thames/statistics/index.html", ["Statistics", "Housing", "Demographics", "Crime", "Environment"]],
  ["commute/index.html", ["Commute checker", "Work postcode"]],
  ["london/richmond-upon-thames/tw11/statistics/index.html", ["Statistics in TW11", "Road noise", "Green space", "Compare with other areas"]],
  ["london/richmond-upon-thames/tw11/transport/index.html", ["Journey times", "EV charge points", "Cycle hire"]],
  ["london/richmond-upon-thames/tw11/food/index.html", ["Food hygiene"]],
  ["london/richmond-upon-thames/services/index.html", ["first-month checklist"]],
  ["compare/index.html", ["Compare areas"]],
  ["offline/index.html", ["offline"]],
  ["robots.txt", ["Sitemap:"]],
  ["sw.js", ["addEventListener", "caches"]],
];
for (const [file, needles] of REQUIRED) {
  if (!fileSet.has(file)) {
    fail(`missing ${file}`);
    continue;
  }
  const text = readFileSync(path.join(DIST, file), "utf8");
  for (const needle of needles) if (!text.toLowerCase().includes(needle.toLowerCase())) fail(`${file} does not contain "${needle}"`);
}

// ---- 2. Data files ----
try {
  const compare = JSON.parse(readFileSync(path.join(DIST, "compare-data.json"), "utf8"));
  if (compare.districts.length < 250) fail(`compare-data.json has only ${compare.districts.length} districts`);
  if (compare.boroughs.length < 33) fail(`compare-data.json has only ${compare.boroughs.length} boroughs`);
} catch (e) {
  fail(`compare-data.json unreadable: ${e.message}`);
}
try {
  const search = JSON.parse(readFileSync(path.join(DIST, "search-index.json"), "utf8"));
  if (Object.keys(search.index).length < 250 || search.quick.length < 250) fail("search-index.json looks incomplete");
} catch (e) {
  fail(`search-index.json unreadable: ${e.message}`);
}
try {
  const manifest = JSON.parse(readFileSync(path.join(DIST, "manifest.webmanifest"), "utf8"));
  for (const icon of manifest.icons) if (!fileSet.has(icon.src.replace(/^\//, ""))) fail(`manifest icon missing: ${icon.src}`);
  if (!manifest.start_url || !manifest.name) fail("manifest lacks name or start_url");
} catch (e) {
  fail(`manifest unreadable: ${e.message}`);
}
if (fileSet.has("sitemap-0.xml")) {
  const urls = [...readFileSync(path.join(DIST, "sitemap-0.xml"), "utf8").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  if (urls.length < 4000) fail(`sitemap lists only ${urls.length} URLs`);
  if (urls.some((u) => /\/(property|admin|compare|offline)\/?$/.test(u))) fail("sitemap contains a page that should be excluded (property/admin/compare/offline)");
} else fail("missing sitemap-0.xml");
const robots = fileSet.has("robots.txt") ? readFileSync(path.join(DIST, "robots.txt"), "utf8") : "";
if (/User-agent:\s*\*\s*\n(?:.*\n)*?Disallow:\s*\/\s*$/m.test(robots.replace(/\r/g, ""))) fail("robots.txt blocks everything for all crawlers");

// ---- 3. Every page: title, description, canonical, JSON-LD, no data bugs, links that resolve ----
const BAD_TOKENS = [/\bundefined\b/, /\bNaN\b/, /\[object Object\]/, /Invalid Date/, /\bnull%/, /£NaN|£undefined/];
const linkTargets = new Map(); // target path -> first page that links to it
const linkExists = (href) => {
  const clean = decodeURIComponent(href.split("#")[0].split("?")[0]);
  if (clean === "" || clean === "/") return true;
  const p = clean.replace(/^\//, "");
  return fileSet.has(p) || fileSet.has(`${p.replace(/\/$/, "")}/index.html`) || fileSet.has(`${p}.html`);
};

let pagesChecked = 0;
for (const file of htmlFiles) {
  const name = rel(file);
  const html = readFileSync(file, "utf8");
  // Astro's generated redirect stubs (old /property/ URLs) carry none of the usual page furniture.
  if (html.includes("http-equiv=\"refresh\"") || name.startsWith("admin/")) continue;
  pagesChecked++;

  if (!/<title>[^<]+<\/title>/.test(html)) fail(`${name}: no <title>`);
  if (!/<meta name="description" content="[^"]+"/.test(html)) fail(`${name}: no meta description`);
  if (!/<link rel="canonical" href="https:\/\/postcodehub\.uk\//.test(html)) fail(`${name}: no canonical URL`);
  if (/<meta name="robots"[^>]*noindex/.test(html) && !name.startsWith("compare/") && !name.startsWith("offline/")) fail(`${name}: unexpectedly noindex`);
  for (const block of html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)) {
    try {
      JSON.parse(block[1]);
    } catch {
      fail(`${name}: invalid JSON-LD`);
    }
  }

  // Visible text only: drop scripts, styles and JSON payloads first.
  const visible = html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ");
  for (const token of BAD_TOKENS) {
    const match = visible.match(token);
    if (match) {
      fail(`${name}: visible text contains "${match[0]}"`);
      break;
    }
  }

  for (const m of html.matchAll(/<a [^>]*href="(\/[^"#]*[^"]*)"/g)) {
    const href = m[1].replace(/&amp;/g, "&");
    if (/^\/(auth|callback|admin)/.test(href)) continue;
    if (!linkTargets.has(href)) linkTargets.set(href, name);
  }
}

const broken = [];
for (const [href, from] of linkTargets) if (!linkExists(href)) broken.push(`${href}  (linked from ${from})`);
for (const b of broken.slice(0, 25)) fail(`broken internal link: ${b}`);
if (broken.length > 25) fail(`... and ${broken.length - 25} more broken internal links`);

console.log(`Checked ${pagesChecked} pages, ${linkTargets.size} distinct internal links.`);
if (problems.length > 0) {
  console.error(`\n${problems.length} problem${problems.length === 1 ? "" : "s"}:`);
  for (const p of problems.slice(0, 60)) console.error(`  - ${p}`);
  if (problems.length > 60) console.error(`  ... and ${problems.length - 60} more`);
  process.exit(1);
}
console.log("All checks passed.");
