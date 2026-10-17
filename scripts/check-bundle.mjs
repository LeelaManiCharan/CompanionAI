#!/usr/bin/env node
/**
 * Client bundle secret check (Requirements 6.15, 7.1, 7.12).
 *
 * Run after `next build`. Recursively scans `.next/static` (everything shipped
 * to browsers) for:
 *   - the literal "GEMINI_API_KEY"
 *   - "generativelanguage.googleapis.com" (Gemini must only be called server-side)
 *   - the actual value of process.env.GEMINI_API_KEY, if set
 *   - the value of process.env.CHECK_BUNDLE_SECRET, if set (e.g. a test key)
 * Exits 1 listing offending files, otherwise prints OK.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const STATIC_DIR = path.resolve(process.cwd(), ".next", "static");

/** @type {{ label: string, value: string }[]} */
const needles = [
  { label: '"GEMINI_API_KEY"', value: "GEMINI_API_KEY" },
  { label: '"generativelanguage.googleapis.com"', value: "generativelanguage.googleapis.com" },
];
const envKey = process.env.GEMINI_API_KEY?.trim();
if (envKey) needles.push({ label: "value of GEMINI_API_KEY", value: envKey });
const extra = process.env.CHECK_BUNDLE_SECRET?.trim();
if (extra) needles.push({ label: "value of CHECK_BUNDLE_SECRET", value: extra });

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

async function main() {
  try {
    if (!(await stat(STATIC_DIR)).isDirectory()) throw new Error("not a directory");
  } catch {
    console.error(`check:bundle: ${path.relative(process.cwd(), STATIC_DIR)} not found. Run \`npm run build\` first.`);
    process.exit(1);
  }

  /** @type {Map<string, string[]>} */
  const offenders = new Map();
  let scanned = 0;

  for await (const file of walk(STATIC_DIR)) {
    scanned++;
    // latin1 keeps a 1:1 byte mapping so ASCII needles match in any file type.
    const content = (await readFile(file)).toString("latin1");
    const hits = needles.filter((n) => content.includes(n.value)).map((n) => n.label);
    if (hits.length) offenders.set(path.relative(process.cwd(), file), hits);
  }

  if (offenders.size) {
    console.error(`check:bundle: FAILED. Found forbidden strings in ${offenders.size} client file(s):`);
    for (const [file, hits] of offenders) console.error(`  ${file}: ${hits.join(", ")}`);
    process.exit(1);
  }

  console.log(`check:bundle: OK (${scanned} files scanned in .next/static, ${needles.length} patterns).`);
}

main().catch((err) => {
  console.error("check:bundle: error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
