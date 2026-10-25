// Collect upstream licence texts from already-downloaded dependencies; no network or installs.
// Run from repo root after npm ci / cargo fetch:
// node scripts/collect-notices.mjs [cargo-registry-src-directory] [node_modules-directory]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';

const cargoSrc = process.argv[2] ?? path.join(process.env.CARGO_HOME ?? path.join(os.homedir(), '.cargo'), 'registry', 'src');
const npmRoot = process.argv[3] ?? path.resolve('node_modules');
const inventory = fs.readFileSync('docs/THIRD-PARTY-LICENSES.md', 'utf8');
const entries = [...inventory.matchAll(/^\| ([a-zA-Z@][a-zA-Z0-9@/_-]*) \| ([0-9][^ ]*) \| ([^|]+) \|$/gm)]
  .map((m) => ({ name: m[1], version: m[2], license: m[3].trim() }));
const registries = fs.readdirSync(cargoSrc, { withFileTypes: true })
  .filter((d) => d.isDirectory()).map((d) => path.join(cargoSrc, d.name));
const out = 'third-party/licenses';
fs.mkdirSync(out, { recursive: true });
const missing = [];
const rows = [];
for (const p of entries) {
  const isNpm = p.name.startsWith('@');
  const source = isNpm ? path.join(npmRoot, p.name) : registries.map((r) => path.join(r, `${p.name}-${p.version}`)).find((r) => fs.existsSync(r));
  if (!source || !fs.existsSync(source)) { missing.push(`${p.name}@${p.version}: package missing`); continue; }
  const candidates = fs.readdirSync(source, { withFileTypes: true })
    .filter((d) => d.isFile() && /^(licen[cs]e|copying|copyright|notice|unlicense|authors)([._-]|$)/i.test(d.name))
    .map((d) => path.join(source, d.name));
  for (const dir of ['license', 'licenses', 'licences']) {
    const loc = path.join(source, dir);
    if (!fs.existsSync(loc) || !fs.statSync(loc).isDirectory()) continue;
    for (const name of fs.readdirSync(loc)) {
      const f = path.join(loc, name);
      if (fs.statSync(f).isFile()) candidates.push(f);
    }
  }
  // Some crates omit the repository-root licence from their published archive.
  // Reviewed upstream copies and provenance are retained with the public source.
  const supplement = path.join('third-party', 'upstream', `${p.name.replaceAll('/', '_')}-${p.version}`);
  if (!candidates.length && fs.existsSync(supplement)) {
    for (const name of fs.readdirSync(supplement)) {
      if (/^(licen[cs]e|copying|copyright|notice)([._-]|$)/i.test(name)) candidates.push(path.join(supplement, name));
    }
  }
  if (!candidates.length) { missing.push(`${p.name}@${p.version}: no licence file located`); continue; }
  const links = candidates.map((file) => {
    const bytes = fs.readFileSync(file);
    const hash = createHash('sha256').update(bytes).digest('hex');
    const dest = `${out}/${hash}.txt`;
    fs.writeFileSync(dest, bytes);
    return `[${path.basename(file)}](${dest})`;
  });
  const sourceUrl = isNpm ? `https://www.npmjs.com/package/${p.name}/v/${p.version}` : `https://crates.io/api/v1/crates/${p.name}/${p.version}/download`;
  rows.push(`| ${p.name} | ${p.version} | ${p.license} | ${links.join(', ')} | [exact version](${sourceUrl}) |`);
}
const header = '# Third-party notices and corresponding source\n\n'
  + 'AimLite dependencies retain their original licences. The texts below were copied byte-for-byte from the locally cached package versions in the dependency inventory. Identical texts share a SHA-256-named file; package/version attribution remains in the table. This is an automated collection, not a legal opinion.\n\n'
  + 'For unchanged MPL-2.0 components, the exact-version source downloads in this table make the corresponding source available under its original terms: cssparser, cssparser-macros, dtoa-short, option-ext and selectors. AimLite does not relicense those files. Preserve this notice and source availability when redistributing binaries.\n\n'
  + 'SQLite is compiled in through libsqlite3-sys; SQLite itself is in the public domain. Microsoft WebView2 and the offline runtime installer are Microsoft components under separate Microsoft terms. NSIS and its Tauri helper retain their own distribution terms; this file inventories application runtime dependencies, not every external build tool.\n\n'
  + '| Package | Version | Declared licence | Upstream notices | Corresponding source |\n|---|---|---|---|---|\n';
fs.writeFileSync('THIRD-PARTY-NOTICES.md', header + rows.join('\n') + '\n' + (missing.length ? '\n## Unresolved collection gaps\n\n' + missing.map((x) => `- ${x}`).join('\n') + '\n' : ''));
console.log(`Collected notices for ${rows.length}/${entries.length} packages; ${missing.length} gaps.`);
for (const m of missing) console.error(m);
if (missing.length) process.exitCode = 1;
