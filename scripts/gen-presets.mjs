// Dev-time generator: turns the REA mode configs into AimLite's official presets with original
// names. Run once; the outputs are committed. The app never reads the reference folder at runtime.
// Usage: node scripts/gen-presets.mjs <path-to-REA-modes.json> [site-averages.json]
import fs from 'node:fs';

const src = process.argv[2];
if (!src) { console.error('usage: node scripts/gen-presets.mjs <modes.json>'); process.exit(2); }
const modes = JSON.parse(fs.readFileSync(src, 'utf8')).modes;

// sourceId -> [id, public name, category, short description]
const NAMES = {
  1: ['pinpoint-pulse', 'Pinpoint Pulse', 'Precision', 'Up to 8 pulsing targets; click them before they fade. Centre hits pay extra.'],
  11: ['pinpoint-sudden-death', 'Pinpoint Sudden Death', 'Precision', 'Pinpoint Pulse with no time limit: the first miss or lost target ends the run.'],
  13: ['pixel-dot', 'Pixel Dot', 'Precision', 'One tiny dot at a time. Precision, reaction and path bonuses.'],
  5: ['hub-line', 'Hub & Line', 'Precision + speed', 'Touch the hub before each click; straight paths and centre hits pay. Targets shrink as you hit.'],
  7: ['wide-line', 'Wide Line', 'Precision + speed', 'Large static targets; straight paths and centre hits pay. Targets shrink as you hit.'],
  12: ['triple-bonus', 'Triple Bonus', 'Precision + speed', 'Pulsing targets with big precision, reaction and path bonuses.'],
  2: ['hub-flick', 'Hub Flick', 'Flick', 'Flick out from the hub to a pulsing target, then come back.'],
  17: ['pair-sweep', 'Pair Sweep', 'Flick', 'Two targets at once: clear the pair, long straight sweeps pay.'],
  19: ['trio-sweep', 'Trio Sweep', 'Flick', 'Three targets at once: clear the set with clean paths.'],
  18: ['swarm-sweep', 'Swarm Sweep', 'Flick', 'Sets that grow from 2 up to 20 targets over the run.'],
  323: ['pair-sweep-timed', 'Pair Sweep Timed', 'Flick', 'Pairs that vanish after 0.8 s; distance pays, losses cost.'],
  6: ['hub-reflex', 'Hub Reflex', 'Reaction', 'Touch the hub, then react to the next static target. Speed and path pay.'],
  8: ['quick-reflex', 'Quick Reflex', 'Reaction', 'Static targets appear one at a time; fast, straight clicks pay.'],
  10: ['small-reflex', 'Small Reflex', 'Reaction', 'Small targets after a 1 s pause; reaction and precision pay.'],
  3: ['wait-click', 'Wait & Click', 'Reaction', 'A centre target appears after a random wait. Ten tries; early clicks cost a second.'],
  20: ['wait-flick', 'Wait & Flick', 'Reaction', 'Like Wait & Click, but the target can appear anywhere.'],
  21: ['wait-pair', 'Wait & Pair', 'Reaction', 'After a random wait, clear two targets as fast as you can. Ten sets.'],
  22: ['wait-trio', 'Wait & Trio', 'Reaction', 'After a random wait, clear three targets as fast as you can. Ten sets.'],
  16: ['clear-200', 'Clear 200', 'Speed clear', '200 targets on screen: clear them all against the clock. Misses add a second.'],
  316: ['waves-150', 'Waves 150', 'Speed clear', 'Three waves of 50 targets against the clock. Misses add 0.1 s.'],
  9: ['drift-200', 'Drift 200', 'Speed clear', '200 hits on slowly drifting targets.'],
  15: ['chase-fast', 'Chase Fast', 'Tracking', 'Keep the cursor on a large, fast-strafing target. Points per tick on target.'],
  385: ['chase-steady', 'Chase Steady', 'Tracking', 'Keep the cursor on a small, smoothly strafing target.'],
  602: ['chase-switch', 'Chase Switch', 'Tracking', 'Stay on a target until it breaks, then switch to the next. Targets shrink.'],
  637: ['chase-strafe', 'Chase Strafe', 'Tracking', 'A target that strafes hard left and right; stay on it.'],
  14: ['orbit-chaos', 'Orbit Chaos', 'Mixed', 'Pulsing targets that orbit and strafe at the same time.'],
  23: ['speed-up', 'Speed Up', 'Mixed', 'One target that gets faster with every hit. Misses cost a lot.'],
};
const ORDER = [1, 11, 13, 5, 7, 12, 2, 17, 19, 18, 323, 6, 8, 10, 3, 20, 21, 22, 16, 316, 9, 15, 385, 602, 637, 14, 23];

const presets = [];
const map = [];
for (const sid of ORDER) {
  const m = modes.find((x) => x.id === sid);
  if (!m) throw new Error('missing source mode ' + sid);
  const [slug, name, category, description] = NAMES[sid];
  const config = { ...m.config, name };
  presets.push({ id: 'official:' + slug, version: 1, official: true, name, category, description, config });
  map.push({ id: 'official:' + slug, sourceId: sid, sourceName: m.name, sourceUrl: `https://aim400kg.com/game/${sid}` });
}
fs.writeFileSync('src/presets/official.json', JSON.stringify(presets, null, 1) + '\n');
fs.writeFileSync('src/presets/source-map.json', JSON.stringify({ note: 'Private compatibility mapping (not shown in the UI). Source configs captured 2026-10-22 by the REA pass.', modes: map }, null, 1) + '\n');
// Optional: archived site averages (shown only when the user opts in, labelled with the snapshot date).
const avgPath = process.argv[3];
if (avgPath) {
  const rawAvg = fs.readFileSync(avgPath, "utf8");
  const avg = JSON.parse(rawAvg.charCodeAt(0) === 0xfeff ? rawAvg.slice(1) : rawAvg); // strip a BOM
  const out = {};
  for (const m of map) {
    const a = avg.find((x) => x.modeId === m.sourceId);
    if (a) out[m.id] = { value: Number(a.siteAverage), snapshotDate: a.snapshotDate };
  }
  fs.writeFileSync('src/presets/site-averages.json', JSON.stringify({ note: 'Archived site averages from captured pages, 2026-10-22. Not current and not a distribution: never derive percentiles.', averages: out }, null, 1) + '\n');
}
console.log(`wrote ${presets.length} presets`);
