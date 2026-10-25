# Engine time model and rules

`src/engine/game.ts` is a DOM-free state machine driven entirely by the times passed in. Rendering, audio and the frame rate cannot change what happens.

## States

`idle → countdown → playing → over` (end condition) or `→ cancelled` (Esc, restart, focus loss, stall, geometry/DPI change, click-rate guard). Cancelled runs are never valid bests.

## Time

- **Host time** = `performance.now()` (ms). **Engine time** `t` = ms since play started.
- **Simulation tick** every `1000/61` ms (≈16.393 ms) of engine time: targets expire, tracking scores, targets move/accelerate/orbit, pulses scale. Hover is re-evaluated after each tick.
- **Second timer** every 1000 ms: add targets (`addTargetPeriod`), pulse speed change by time, tracking score sample, last-ten-seconds cue, time limit.
- **Timeouts** (respawn delays, sync-set activation, strafe flips) are scheduled events at exact engine times.
- **Order at equal times:** second timer → scheduled timeouts (by creation order) → tick → input. Example: a click at exactly 100.000 s in a 100 s mode arrives after the run ended and does not count (tested).
- **Input** events carry their own timestamps. The play loop drains the input queue once per animation frame in timestamp order (stable for ties); before each input the engine advances to that input's time, so a click is judged against the state of the last tick before it.
- **Stale input:** an event older than the engine's current time (dispatched after a frame already advanced past it) is applied at the current engine time and counted in `input.stale`.
- **Stalls:** a gap of more than 250 ms between engine updates while playing cancels the run (`stall`) instead of simulating unseen ticks.
- **Clock domain:** if an event timestamp is more than 5 s away from the frame clock it is replaced by the frame time and counted (`clockMismatch`). Never seen in WebView2; it protects test hosts.

## Displayed state = judged state

Targets are drawn at their last simulated position (no interpolation between ticks). Between ticks the picture and the hit test agree exactly; moving targets visibly step at 61 Hz on faster displays. This is the legacy presentation; a smoothed variant would need its own versioned policy and comparison key, and is not implemented.

## Hits, boundaries, rounding

- Hit test: distance from the click to the target centre `< r − 0.25` (strict). Topmost (newest) target first. Clicks outside every live target are misses (not in tracking modes). Clicks outside the field are ignored.
- Hover (capture time, tracking): distance `≤ r`.
- Target centres sit on half pixels (`round(x) + 0.5`) as in the source.
- Precision `= max(0, 100 − 100·d/r)` with `d` rounded to 0.001 px and `d ≤ 1` treated as 0 (dead centre); rounded to 0.01.
- Path length since the previous hit: **legacy-v1** sums each pointermove segment rounded to whole pixels (the source's mousemove behaviour); **precise-v1** sums unrounded coalesced samples. Different policies get different comparison keys.
- Straight distance between hits: whole pixels; via the hub's edge when the hub is used.
- Radii: `width × (0.001 + 0.00199 × size)` rounded to 0.001 px; pulse updates rounded to 0.001 px each tick.

## Randomness

One seeded PRNG (mulberry32) per run, consumed only by the engine in simulation order: spawn positions, random delays, movement/strafe randomisation. Seed, config hash, engine version and input policy are stored with every run, so the same seed and the same input log reproduce the run.

## Scoring modes

| Mode | Score | Better |
|---|---|---|
| 0 Points | `spHit` + enabled bonuses per hit (once per set in score-per-set modes), − `spMiss`, − `spLoss` | higher |
| 1 Tracking | +1 per tick per hovered target (optionally only while the button is held); life points break a target | higher |
| 2 Stopwatch | run time + `spMissPenalty` per miss (rounded to 0.1 s); ends by hits or another non-time condition | lower |
| 3 Reaction | average reaction time; a miss or early click adds 1 s to the current try | lower |

Bonuses: precision `round(max × precision / 100)`; reaction full under 160 ms, linear to 0 at the target life, 0 beyond; path `round(max × max(0, eff − 80) × 5 / 100)`; distance `round(max × round4(minDist / width))`. The first hit has no aim time, distance, path or trajectory values (they need a previous hit).

## End conditions

Time limit (not in stopwatch mode), hits (sets in score-per-set modes), misses, losses, spawns, perfect hits, Space. The first condition met ends the run; within one click perfect hits are checked before the hit count.

## Validity

A run is valid (eligible as a best) when it completed by its own end condition and, for lower-is-better modes, has at least one hit and a positive score.
