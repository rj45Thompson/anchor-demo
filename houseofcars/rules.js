// rules.js - the Time Trial's rules, ported from Epic's Blueprints (UE 5.7 Vehicle template, Time Trial variant).
// The Blueprints were exported as T3D (tools/ue_blueprints.py) and converted to code by Blueprint View (view/bp_cli.js convert ->
// ue_out/bp_code/*.ngl); every rule below names the converted graph and statement it ports. Constants come from
// data/timetrial_rules.json (tools/rules_data.py), each READ with its file:line; nothing is typed in here.
// Pure: no DOM, no clock of its own (the caller passes `now`, Unreal's GetGameTimeInSeconds). Runs in the browser and in node.
// Serves UC-2.1 (countdown, HUD), UC-2.3 (gates in order), UC-2.4 (laps, best time), UC-2.2a (reset, flip check).

// BP_TimeTrialGameMode.ReceiveBeginPlay s1-s2 + BP_TimeTrialPlayerController.ReceiveBeginPlay s4: the target starts at the
// finish line's Next Marker. UI_Timetrial CDO: TimeOffset and Best Time defaults. Start Timer / Has Race Started start false.
export function makeRace(gates, R) {
  const finish = gates.findIndex((g) => g.finish);
  if (finish < 0 || gates.filter((g) => g.finish).length !== 1) throw new Error('rules: exactly one gate must be the finish line');
  return {
    gates, R, finish,
    target: (finish + 1) % gates.length,           // FinishLineMarker.Next_Marker (gates are listed in Next Marker order)
    hasRaceStarted: false,                          // BP_TimeTrialPlayerController.Has_Race_Started
    startTimer: false,                              // UI_Timetrial.Start_Timer
    timeOffset: R.time_offset_default.value,        // UI_Timetrial.TimeOffset (class default)
    bestTime: R.best_time_default.value,            // UI_Timetrial.Best_Time (class default)
    bestText: null,                                 // Txt_BestTime is set only by Update_Lap_Count
    laps: 0,
    countdown: { t: 0, text: R.countdown.texts[0], done: false, removed: false },
    previousFlip: false,                            // BP_VehicleAdvPawnBase.Previous_Flip_Check
    flipClock: 0,
  };
}

// UI_Start: Construct shows texts[0] and plays POP; each POP's end fires the MultiGate's next output: texts[1], texts[2], then
// texts[3] ("GO") with Countdown_Finished.Broadcast, then POP reversed, then RemoveFromParent. POP lasts pop_seconds.
export function tickCountdown(race, dt, now) {
  const c = race.countdown, P = race.R.pop_seconds.value, texts = race.R.countdown.texts, go = race.R.countdown.go_index;
  if (c.removed) return race;
  c.t += dt;
  const pops = Math.floor(c.t / P);                 // POPs finished so far
  c.text = texts[Math.min(pops, texts.length - 1)];
  if (!c.done && pops >= go) { c.done = true; enableTimer(race, now - (c.t - go * P)); }
  if (pops >= go + 2) c.removed = true;             // Out_3 plays POP in reverse, Out_4 removes the widget
  return race;
}

// UI_Timetrial.Enable_Timer s1-s3 (bound to Countdown_Finished at UI_Timetrial.Construct s3), whose Start.Broadcast reaches
// BP_TimeTrialPlayerController.Start_Race (bound at ReceiveBeginPlay s8): s1 Has_Race_Started = true, s2 EnableInput.
export function enableTimer(race, now) {
  race.timeOffset = now;
  race.startTimer = true;
  race.hasRaceStarted = true;
  return race;
}

// BP_TimeTrialPlayerController.ReceivePossess s2: input stays disabled until the race has started.
export function inputEnabled(race) { return race.hasRaceStarted; }

// BP_TrackGate.ReceiveActorBeginOverlap s3-s6: only the controller's TargetGate counts; it moves the target to its Next_Marker,
// and the finish line also calls Increment_Lap_Count. Any other gate does nothing (no message: the Blueprint has none).
export function gateOverlapBegin(race, gateIndex, now) {
  if (race.target !== gateIndex) return false;     // s3: TargetGate == this
  race.target = (gateIndex + 1) % race.gates.length; // s4: TargetGate = Next_Marker
  if (race.gates[gateIndex].finish) incrementLapCount(race, now); // s5-s6
  return true;
}

// BP_TimeTrialPlayerController.Increment_Lap_Count -> UI_Timetrial.Update_Lap_Count s1-s5: a lap faster than Best Time becomes
// the best and is shown; then the lap clock restarts (TimeOffset = now).
export function incrementLapCount(race, now) {
  const lap = now - race.timeOffset;
  if (lap < race.bestTime) {                        // s1
    race.bestTime = lap;                            // s2
    race.bestText = formatTime(lap, race.R);        // s4, s3
  }
  race.timeOffset = now;                            // s5
  race.laps += 1;
  return lap;
}

// UI_Timetrial.Update_Time: "---:---:---" until the timer starts, then the running lap as {min}:{sec}:{mil}.
export function timeText(race, now) {
  return race.startTimer ? formatTime(now - race.timeOffset, race.R) : race.R.time_placeholder.value;
}

// KismetMathLibrary.FromSeconds -> FTimespan (ticks of 100 ns); its Minutes / Seconds / Milliseconds are the components (the minute
// wraps at 60, the second at 60, the millisecond at 1000); Conv_IntToText pads each to its minimum digits.
export function formatTime(seconds, R) {
  const ticks = Math.trunc(seconds * 1e7);
  const parts = { min: Math.trunc(ticks / 6e8) % 60, sec: Math.trunc(ticks / 1e7) % 60, mil: Math.trunc(ticks / 1e4) % 1000 };
  const [dMin, dSec, dMil] = R.time_digits.value.map((d) => d[0]);
  return R.time_format.value.replace('{min}', pad(parts.min, dMin)).replace('{sec}', pad(parts.sec, dSec)).replace('{mil}', pad(parts.mil, dMil));
}

// UI_Vehicle.UpdateSpeed: |forward speed| x factor (km/h: the HUD is created with bIsMPH false), HalfToEven, as many digits as
// the widget's minimum. UpdateGear: -1 and 0 have their own labels, a forward gear shows its number.
export function speedText(forwardSpeedCmS, R) {
  const x = Math.abs(forwardSpeedCmS) * R.speed.factor;
  return pad(roundHalfEven(x), R.speed.digits[0]);
}
export function gearText(gear, R) {
  const k = String(gear);
  return k in R.gear_labels ? R.gear_labels[k] : String(gear);
}

// BP_VehicleAdvPawnBase.IA_Reset_Triggered s1-s3 (and Manual_Reset, the same three): put the car where it is plus the reset
// offset, keep only its yaw, and stop it.
export function resetPose(posCm, yawDeg, R) {
  const o = R.reset_offset_cm.value;
  return { pos: [posCm[0] + o[0], posCm[1] + o[1], posCm[2] + o[2]], yawDeg, linearVel: [0, 0, 0], angularVel: [0, 0, 0] };
}

// BP_VehicleAdvPawnBase.ReceiveBeginPlay s3 sets a looping timer on Flipped_Check every flip_check_seconds; Flipped_Check s1-s5:
// upside down (up . Z below the threshold) on two checks in a row means Manual_Reset. Returns true when the car must be reset.
export function tickFlipCheck(race, dt, upDotZ) {
  race.flipClock += dt;
  const T = race.R.flip_check_seconds.value;
  let reset = false;
  while (race.flipClock >= T) {
    race.flipClock -= T;
    if (upDotZ < race.R.flip_dot_below.value) {
      if (race.previousFlip) reset = true; else race.previousFlip = true;
    } else {
      race.previousFlip = false;
    }
  }
  return reset;
}

function pad(n, digits) { return String(n).padStart(digits, '0'); }
function roundHalfEven(x) {
  const f = Math.floor(x), d = x - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}
