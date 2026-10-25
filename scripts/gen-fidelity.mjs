// Generates docs/FIDELITY-MATRIX.md: every gameplay config field → source evidence, AimLite
// implementation, verification, known deviation, and which official presets set a non-baseline value.
// Usage: node scripts/gen-fidelity.mjs
import fs from 'node:fs';

const fields = JSON.parse(fs.readFileSync('src/schemas/fields.json', 'utf8')).fields;
const presets = JSON.parse(fs.readFileSync('src/presets/official.json', 'utf8'));

// Evidence = the captured client source (REA archive js/*.js). Impl = AimLite file › function.
// Test = automated check (rules.test.ts unless noted) or "playthrough" (presets.test.ts plays all 27).
const T = 'tests/engine/rules.test.ts';
const P = 'tests/engine/presets.test.ts (all 27 played to their end condition)';
const G = 'src/engine/game.ts';
const TG = 'src/engine/target.ts';
const M = {
  scoreMode: ['Scoring_M.calcScore switch (0–3); Scoring_V.renderScore', `${G} › processHit / registerMiss / onMultiHit / onSecond`, `${T}: scoring modes`, 'scoreMode 4 exists only as a display branch in the source; no preset uses it, so it is not offered.'],
  spHit: ['Scoring_M.calcScore case 0 hit/multiHit', `${G} › processHit, onMultiHit`, `${T}: hit and miss score; grouped sets score once`, ''],
  spMiss: ['Scoring_M.calcScore case 0 miss', `${G} › registerMiss`, `${T}: hit and miss score`, ''],
  spLoss: ['Scoring_M.calcScore case 0 loss', `${G} › loss`, `${T}: target expiry`, ''],
  spMissPenalty: ['Scoring_M.calcScore case 2 (round to 0.1 s)', `${G} › registerMiss`, `${T}: stopwatch`, ''],
  bonusProcPrecision: ['Hit.calcPrecisionBonus; Scoring_M.calcScore', 'src/engine/metrics.ts › precisionBonus', `${T}: bonus thresholds`, ''],
  bonusProcReaction: ['Hit.calcReactionBonus (160 ms floor, linear to target life)', 'metrics.ts › reactionBonus', `${T}: bonus thresholds`, ''],
  bonusProcEff: ['Hit.calcEfficiencyBonus ((eff−80)×5 %)', 'metrics.ts › effBonus', `${T}: bonus thresholds`, ''],
  bonusProcDistance: ['Hit.calcDistanceBonus (minDist / width)', 'metrics.ts › distanceBonus', `${T}: bonus thresholds`, ''],
  targetsOnStart: ['Game_V.createTargets', `${G} › startPlay`, P, ''],
  maxTargets: ['Timer.tick, Game_C.hitActions, Scoring_C.processMultiHit (limit for added targets)', `${G} › onSecond, registerHit, onMultiHit`, P, ''],
  addTargetPeriod: ['Timer.tick (seconds % period)', `${G} › onSecond`, `${P}; Swarm Sweep / Pinpoint Pulse grow`, ''],
  addTargetHits: ['Game_C.hitActions / processMultiHit (hits % N; 0 never)', `${G} › registerHit, onMultiHit`, 'not used by any official preset (0); covered by code review only', ''],
  randomTargetPosition: ['Target.changePos (false = centre)', `${TG} › changePos`, `${T}: moving-target adjudication (centre spawn); tests/ui (centre test mode)`, ''],
  strictInside: ['Target.changePos (margin = max or min radius)', `${TG} › changePos`, P, ''],
  changePositionOnHit: ['Target.activate case hit', `${G} › activate`, `${P} (Speed Up keeps position)`, ''],
  changePositionOnLoss: ['Target.activate case loss', `${G} › activate`, P, ''],
  targetDelay: ['Target.useDelay', `${G} › delayFor, useDelay`, `${T}: reaction mode`, ''],
  targetDelayRandom: ['Target.useDelay (random × delay, +3 s in mode 3 when > 0)', `${G} › delayFor`, `${T}: reaction random delay`, ''],
  targetLifeTime: ['Target.tick (now − spawn ≥ life → loss); Game_M.calcReactionLimits override', `${G} › tickTarget; geometry.ts › targetLifeMs`, `${T}: target expiry`, 'An expired target stops updating for the rest of that tick (the source kept moving it, which could double-count a loss in odd configs).'],
  hitsToKill: ['Game_C.hitActions (++damage < hitsToKill)', `${G} › clickTarget`, `${T}: hits-to-kill`, ''],
  oneTimeTargets: ['Target.hit (no useDelay)', `${G} › registerHit`, `${T}: stopwatch; ${P} (Clear 200)`, ''],
  syncTarget: ['Target.checkForActivate (all disabled → activate all; first timer cancels others)', `${G} › useDelay, cancelPending`, `${T}: grouped sets`, ''],
  multiMode: ['Scoring_C.processMultiHit; Game constructor (forced off without sync)', `${G} › onMultiHit; constructor`, `${T}: grouped sets score once`, 'Division by (n−1) is guarded for single-target sets; the builder refuses multiMode with fewer than 2 targets.'],
  disableLosses: ['Target.loss (no loss event, still respawns)', `${G} › loss`, 'not used by official presets; code review', ''],
  targetLifePoints: ['Target.tick tracking branch (lifePoints-- → forced hit)', `${G} › tickTarget`, `${T}: switch tracking`, ''],
  requireMousePressed: ['Target.tick / mouseoverHandler (tracking only while button down)', `${G} › tickTarget`, 'Speed Up sets it but is a points mode (no effect, as in the source); code review', ''],
  radiusMin: ['Game_M.calcRadius (width × (0.001 + 0.00199 v), swapped if min > max)', 'geometry.ts › radiusPx, radiusBounds', `${T}: geometry radius`, ''],
  radiusMax: ['Game_M.calcRadius', 'geometry.ts › radiusBounds', `${T}: geometry radius`, ''],
  animationSpeed: ['Game_M.calcAnimationSpeed (0.9 + 0.001 (100 − s))', 'geometry.ts › animationCoeff; game.ts › scaleTarget', `${T}: pulse coefficient`, ''],
  animationIncrease: ['Target.scaleAnimation / onlyIncrease / increaseAndDecrease', `${G} › scaleTarget`, `${P} (Pinpoint Pulse, Triple Bonus)`, ''],
  animationDecrease: ['Target.scaleAnimation / onlyDecrease', `${G} › scaleTarget`, P, ''],
  animationAccel: ['Game_C.changeAnimationSpeed (+accel, 0.1 precision)', `${G} › changeAnimationSpeed`, P, 'As in the source the reaction-bonus target life is computed once at start and not updated when the pulse speed changes.'],
  animationAccelByTime: ['Timer.tick', `${G} › onSecond`, P, ''],
  animationAccelByHit: ['Game_C.hitActions', `${G} › registerHit`, P, ''],
  changeRadiusOnHit: ['Target.changeRadius (floors max 6, min 4; immediate when pulse speed 0)', `${TG} › changeRadius`, `${P} (Hub & Line, Clear 200)`, ''],
  changeRadiusForAll: ['Game_C.hitActions; Target constructor copies first target bounds', `${G} › registerHit, createTarget`, P, ''],
  useCheckpoint: ['Checkpoint.init / Game_C.mouseDownHandler / checkpointHandler', `${G} › startPlay, pointerDown, pointerMove`, `${T}: checkpoint`, 'Not created in tracking mode (source rule).'],
  checkpointPositionX: ['Checkpoint.create (e + pos × (W − 2e) / 100)', `${G} › startPlay`, `${T}: checkpoint position`, ''],
  checkpointPositionY: ['Checkpoint.create', `${G} › startPlay`, `${T}: checkpoint position`, ''],
  checkpointSize: ['Checkpoint.create (radius = size + 1); Hit.calcHitMinDist via hub edge', `${G} › startPlay, minDistFrom`, `${T}: checkpoint`, ''],
  ggTimer: ['Game_C.start / Timer (not in stopwatch mode)', `${G} › onSecond, timerLimit`, `${T}: timer end + tie order`, ''],
  ggHits: ['Scoring_C.processHit / processMultiHit checkGG', `${G} › processHit, onMultiHit`, `${T}: stopwatch; ${P}`, ''],
  ggMisses: ['Scoring_M.calcMisses checkGG', `${G} › registerMiss`, `${T}: sudden death`, ''],
  ggLosses: ['Scoring_M.calcLosses checkGG', `${G} › loss`, P, ''],
  ggTargets: ['Scoring_M.calcTargets checkGG (spawn count, not in reaction mode)', `${G} › onChangePos`, 'not used by official presets; code review', ''],
  ggApples: ['Scoring_M.calcPrecision (precision 100 count) checkGG', `${G} › processHit`, `${T}: simultaneous end conditions`, ''],
  ggSpace: ['Game_C.keyDownHandler Space → gg', `${G} › space`, `${T}: Space ends only when allowed`, ''],
  gameFieldRatio: ['Game.setSize (height = width × ratio)', 'geometry.ts › classicField; presets/index.ts › fieldFor', `${T}: classic field`, ''],
  enableMoving: ['Target constructor / tick', `${TG} constructor; ${G} › moveTarget`, `${T}: moving-target adjudication`, ''],
  speedX: ['Target.setSpeed / tick (px per tick)', `${TG} › setSpeed; ${G} › moveTarget`, `${T}: moving-target adjudication`, 'Large-field mode scales px speeds with the field (own comparison key).'],
  speedY: ['Target.setSpeed / tick', 'as speedX', `${T}: moving-target adjudication`, 'as speedX'],
  allowRandomizeDirectionX: ['Target.randomizeSpeedDirection', `${TG} constructor`, `${T}: determinism`, ''],
  allowRandomizeDirectionY: ['Target.randomizeSpeedDirection', `${TG} constructor`, `${T}: determinism`, ''],
  allowRandomizeSpeedSizeX: ['Target.randomizeSpeedSize', `${TG} constructor`, 'not used by official presets; code review', ''],
  allowRandomizeSpeedSizeY: ['Target.randomizeSpeedSize', `${TG} constructor`, 'not used by official presets; code review', ''],
  directionOnHitX: ['Target.activate hit (1 random, 2 reverse)', `${TG} › applyRespawnRules`, `${P} (Speed Up reverses)`, ''],
  directionOnHitY: ['Target.activate hit', `${TG} › applyRespawnRules`, P, ''],
  directionOnLossX: ['Target.activate loss', `${TG} › applyRespawnRules`, P, ''],
  directionOnLossY: ['Target.activate loss', `${TG} › applyRespawnRules`, P, ''],
  speedSizeOnHitX: ['Target.activate hit (1 random, 2 step)', `${TG} › applySpeedSize`, `${P} (Speed Up steps)`, ''],
  speedSizeOnHitY: ['Target.activate hit', `${TG} › applySpeedSize`, P, ''],
  speedSizeOnLossX: ['Target.activate loss', `${TG} › applySpeedSize`, 'not used by official presets; code review', ''],
  speedSizeOnLossY: ['Target.activate loss', `${TG} › applySpeedSize`, 'not used by official presets; code review', ''],
  speedStepX: ['Target.changeSpeedSizeX (away from 0, clamps at 0)', `${TG} › stepSpeed`, P, ''],
  speedStepY: ['Target.changeSpeedSizeY', `${TG} › stepSpeed`, P, ''],
  reboundSpeed: ['Target.tick wall bounce (−v × (100 − r) / 100)', `${G} › moveTarget`, 'baseline 0 in all presets; code review', ''],
  resetSpeedOnHit: ['Target.activate hit → resetSpeed', `${TG} › applyRespawnRules`, 'not used by official presets; code review', ''],
  resetSpeedOnLoss: ['Target.activate loss → resetSpeed', `${TG} › applyRespawnRules`, 'not used by official presets; code review', ''],
  enableAccel: ['Target.tick → useAccelFunc', `${G} › accelerate`, `${T}: tracking across schedules; ${P}`, ''],
  accelX: ['Target.setAccel / useAccelFunc', `${G} › accelerate`, P, 'Scaled in large-field mode.'],
  accelY: ['Target.setAccel / useAccelFunc', `${G} › accelerate`, P, 'Scaled in large-field mode.'],
  maxSpeedX: ['Target.useAccelFunc clamp (0 = none)', `${G} › accelerate`, P, ''],
  maxSpeedY: ['Target.useAccelFunc clamp', `${G} › accelerate`, P, ''],
  allowRandomizeAccelDirectionX: ['Target.randomizeAccelDirection', `${TG} constructor`, P, ''],
  allowRandomizeAccelDirectionY: ['Target.randomizeAccelDirection', `${TG} constructor`, P, ''],
  allowRandomizeAccelSizeX: ['Target.randomizeAccelSize', `${TG} constructor`, 'not used by official presets; code review', ''],
  allowRandomizeAccelSizeY: ['Target.randomizeAccelSize', `${TG} constructor`, 'not used by official presets; code review', ''],
  accelDirectionOnHitX: ['Target.activate hit (2 reverses both axes)', `${TG} › applyAccelDirection`, 'not used by official presets; code review', 'Rule 2 reverses both axes, as the source does.'],
  accelDirectionOnHitY: ['Target.activate hit', `${TG} › applyAccelDirection`, 'not used by official presets; code review', 'as above'],
  accelDirectionOnLossX: ['Target.activate loss', `${TG} › applyAccelDirection`, 'not used by official presets; code review', 'as above'],
  accelDirectionOnLossY: ['Target.activate loss', `${TG} › applyAccelDirection`, 'not used by official presets; code review', 'as above'],
  randomizeAccelSizeOnHitX: ['Target.activate hit', `${TG} › applyRespawnRules`, 'not used by official presets; code review', ''],
  randomizeAccelSizeOnHitY: ['Target.activate hit', `${TG} › applyRespawnRules`, 'not used by official presets; code review', ''],
  randomizeAccelSizeOnLossX: ['Target.activate loss', `${TG} › applyRespawnRules`, 'not used by official presets; code review', ''],
  randomizeAccelSizeOnLossY: ['Target.activate loss', `${TG} › applyRespawnRules`, 'not used by official presets; code review', ''],
  reverseAccelDirectionOnWall: ['Target.tick wall bounce', `${G} › moveTarget`, P, ''],
  useStrafe: ['Target.useAccelFunc setTimeout(random × range) flips accel against velocity', `${G} › accelerate (scheduled event)`, `${T}: tracking identical across frame schedules`, 'Timeouts are engine-scheduled events in simulation time (the source used wall-clock setTimeout).'],
  strafeRangeX: ['Target.useAccelFunc', `${G} › accelerate`, P, ''],
  strafeRangeY: ['Target.useAccelFunc', `${G} › accelerate`, P, ''],
  roundMoving: ['Target.tick (spin = cos/sin(angle) × radius; angle −= step)', `${G} › moveTarget`, `${T}: determinism (Orbit Chaos)`, ''],
  synchRotation: ['Target constructor (angle 0 vs π × random)', `${TG} constructor`, 'not used by official presets; code review', 'The source starts at π × random (half a turn), reproduced as is.'],
  movingRadius: ['Target constructor', `${TG} constructor`, `${T}: determinism`, 'Scaled in large-field mode.'],
  randomizeMovingRadius: ['Target constructor', `${TG} constructor`, `${T}: determinism`, ''],
  randomizeRotateDirection: ['Target constructor', `${TG} constructor`, P, ''],
  angularVelocity: ['Target constructor / tick', `${TG} constructor; ${G} › moveTarget`, P, ''],
};

const baseline = {};
for (const f of fields) {
  const counts = new Map();
  for (const p of presets) { const v = JSON.stringify(p.config[f.key]); counts.set(v, (counts.get(v) ?? 0) + 1); }
  baseline[f.key] = JSON.parse([...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]);
}

let md = `# Fidelity matrix\n\nGenerated by \`node scripts/gen-fidelity.mjs\` from \`src/schemas/fields.json\` and \`src/presets/official.json\`.\n\n`;
md += `Evidence refers to the client source captured on 2026-10-22 (REA archive \`js/*.js\`, read-only reference, not shipped). AimLite re-implements each rule; no source code is included.\n\n`;
md += `**Status of the whole engine:** all 96 fields are implemented, typed and range-checked (TypeScript and Rust), and all 27 official presets play to their end condition through the real engine in the automated tests. "Rule-compatible" means the recovered formulas and update order are reproduced; it does **not** make AimLite scores equal to website scores (field size, timer delivery, input events and rendering differ).\n\n`;
md += `Global time-model differences (apply to every row): the simulation runs on fixed 61 Hz engine time with seconds and timeouts as scheduled events (ties: second timer → timeouts → tick → input); the source used \`setInterval\`/\`setTimeout\` wall-clock timers that drift. Hover is re-evaluated after every tick and every pointer sample (the source relied on DOM mouseover). A gap > 250 ms between updates cancels the run instead of catching up. Anti-cheat checks (page offset, hover time, radius tampering) and online features are not reproduced; the 25-clicks-in-2-s guard is an option for official presets.\n\n`;
md += `| Field | Baseline | Non-baseline in official presets | Source evidence | AimLite implementation | Verification | Known deviation |\n|---|---|---|---|---|---|---|\n`;
const missing = [];
for (const f of fields) {
  const m = M[f.key];
  if (!m) { missing.push(f.key); continue; }
  const users = presets.filter((p) => JSON.stringify(p.config[f.key]) !== JSON.stringify(baseline[f.key])).map((p) => `${p.name} (${JSON.stringify(p.config[f.key])})`);
  const cell = (s) => String(s).replace(/\|/g, '\\|');
  md += `| \`${f.key}\` | ${cell(JSON.stringify(baseline[f.key]))} | ${cell(users.length ? users.join('; ') : '—')} | ${cell(m[0])} | ${cell(m[1])} | ${cell(m[2])} | ${cell(m[3] || '—')} |\n`;
}
if (missing.length) { console.error('fields without a matrix row:', missing.join(', ')); process.exit(1); }
md += `\n## Rows marked "code review"\n\nThese fields are not used (or only at their baseline value) by any official preset. They are implemented, validated and exposed in the Builder, and were checked against the source by reading; they have no dedicated automated test yet.\n`;
fs.writeFileSync('docs/FIDELITY-MATRIX.md', md);
console.log(`docs/FIDELITY-MATRIX.md: ${fields.length} fields`);
