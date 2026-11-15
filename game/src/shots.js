// EMBERLINE — screenshot scenes behind ?shot=start|play|zone|end.
// Each scene plays the real rules forward from a fresh match for a fixed number
// of steps, steered by a simple autopilot (turn toward the nearest loot or enemy,
// fire when one is roughly ahead, run for the zone when outside it, sidestep when
// stuck on cover), so the frame is what a short game really looks like and the
// same seed always gives the same frame.
import * as THREE from 'three';
import { input } from './input.js';
import { STEP } from './config.js';
import { segmentBlocked } from './world.js';
import { applyDamage } from './combat.js';

const PLAY_SECONDS = 16;
const END_LIMIT_SECONDS = 150;

// pilot state, reset for every scene
const pilot = {
  lastX: 0,
  lastZ: 0,
  lastCheck: 0,
  sidestepUntil: 0,
  sidestepSign: 1,
  shotStep: 0,
  burstStep: 0,
};

function clearInput() {
  input.forward = false;
  input.back = false;
  input.left = false;
  input.right = false;
  input.sprint = false;
  input.fire = false;
  input.ads = false;
  input.lookDX = 0;
  input.lookDY = 0;
}

/**
 * Frame the shot: turn the player toward the most open sightline so the capture
 * is the yard, not the back of a container. Prefers a visible enemy (play) or
 * the nearest zone wall (zone) when one is in the open.
 */
function frameView(match, prefer) {
  const p = match.player;
  if (!p || !p.alive) return;
  const clearDist = (yaw) => {
    const dx = -Math.sin(yaw);
    const dz = -Math.cos(yaw);
    for (let s = 4; s <= 60; s += 4) {
      if (segmentBlocked(p.pos.x, p.pos.z, p.pos.x + dx * s, p.pos.z + dz * s, match.world.colliders)) return s;
    }
    return 60;
  };
  let bestYaw = p.yaw;
  let bestD = -1;
  if (prefer === 'enemy') {
    let enemy = null;
    let enemyD = Infinity;
    for (const f of match.fighters) {
      if (f === p || !f.alive) continue;
      const d = Math.hypot(f.pos.x - p.pos.x, f.pos.z - p.pos.z);
      if (d < enemyD && !segmentBlocked(p.pos.x, p.pos.z, f.pos.x, f.pos.z, match.world.colliders)) {
        enemyD = d;
        enemy = f;
      }
    }
    if (enemy && enemyD < 40) {
      const yaw = Math.atan2(-(enemy.pos.x - p.pos.x), -(enemy.pos.z - p.pos.z));
      if (clearDist(yaw) >= 8) {
        p.yaw = yaw;
        p.pitch = -0.03;
        return;
      }
    }
  }
  if (prefer === 'zone') {
    const z = match.zone;
    // face away from the zone centre: the nearest wall is straight ahead
    const yaw = Math.atan2(-(p.pos.x - z.cx), -(p.pos.z - z.cz));
    if (clearDist(yaw) >= 8) {
      p.yaw = yaw;
      p.pitch = -0.03;
      return;
    }
  }
  for (let i = 0; i < 12; i += 1) {
    const yaw = (i / 12) * Math.PI * 2;
    const d = clearDist(yaw);
    if (d > bestD) {
      bestD = d;
      bestYaw = yaw;
    }
  }
  p.yaw = bestYaw;
  p.pitch = -0.03;
}

/** Steer the player: chase loot/enemies, fire in-cone, flee to the zone. */
export function autopilot(match, reckless, now) {
  const p = match.player;
  if (!p || !p.alive) {
    clearInput();
    return;
  }
  const z = match.zone;
  const zd = Math.hypot(p.pos.x - z.cx, p.pos.z - z.cz);
  let tx = null;
  let tz = null;
  let fire = false;
  let enemyD = Infinity;

  // stuck detection: barely moved in the last 1.5s while trying to move
  if (now - pilot.lastCheck >= 1.5) {
    const moved = Math.hypot(p.pos.x - pilot.lastX, p.pos.z - pilot.lastZ);
    pilot.lastX = p.pos.x;
    pilot.lastZ = p.pos.z;
    pilot.lastCheck = now;
    if (moved < 0.5 && (input.forward || input.sprint)) {
      pilot.sidestepUntil = now + 1.1;
      pilot.sidestepSign = pilot.sidestepSign * -1;
    }
  }

  // nearest visible enemy
  let enemy = null;
  for (const f of match.fighters) {
    if (f === p || !f.alive) continue;
    const d = Math.hypot(f.pos.x - p.pos.x, f.pos.z - p.pos.z);
    if (d < enemyD && !segmentBlocked(p.pos.x, p.pos.z, f.pos.x, f.pos.z, match.world.colliders)) {
      enemyD = d;
      enemy = f;
    }
  }
  if (!reckless && zd > z.radius - 4) {
    tx = z.cx;
    tz = z.cz;
  } else if (p.slots.length === 1) {
    // pistol only: grab a real gun before picking fights
    let gun = null;
    let bestD = Infinity;
    for (const item of match.loot) {
      if (item.taken) continue;
      if (item.kind !== 'rifle' && item.kind !== 'shotgun' && item.kind !== 'marksman') continue;
      const d = Math.hypot(item.x - p.pos.x, item.z - p.pos.z);
      if (d < bestD) {
        bestD = d;
        gun = item;
      }
    }
    if (gun) {
      tx = gun.x;
      tz = gun.z;
    } else if (enemy && enemyD < 45) {
      tx = enemy.pos.x;
      tz = enemy.pos.z;
      const dx = enemy.pos.x - p.pos.x;
      const dz = enemy.pos.z - p.pos.z;
      const desired = Math.atan2(-dx, -dz);
      let diff = desired - p.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      fire = Math.abs(diff) < 0.08 && enemyD < 55;
    } else {
      tx = z.cx;
      tz = z.cz;
    }
  } else if (p.health < 45) {
    // hurt: break off and grab the nearest medkit instead of fighting
    let medkit = null;
    let bestD = Infinity;
    for (const item of match.loot) {
      if (item.taken || item.kind !== 'medkit') continue;
      const d = Math.hypot(item.x - p.pos.x, item.z - p.pos.z);
      if (d < bestD) {
        bestD = d;
        medkit = item;
      }
    }
    if (medkit) {
      tx = medkit.x;
      tz = medkit.z;
    } else if (enemy && enemyD < 45) {
      tx = enemy.pos.x;
      tz = enemy.pos.z;
      const dx = enemy.pos.x - p.pos.x;
      const dz = enemy.pos.z - p.pos.z;
      const desired = Math.atan2(-dx, -dz);
      let diff = desired - p.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      // tight cone: a 20-degree spray wastes the mag, aimed shots land
      fire = Math.abs(diff) < 0.08 && enemyD < 55;
    } else {
      tx = z.cx;
      tz = z.cz;
    }
  } else if (enemy && enemyD < 45) {
    tx = enemy.pos.x;
    tz = enemy.pos.z;
    const dx = enemy.pos.x - p.pos.x;
    const dz = enemy.pos.z - p.pos.z;
    const desired = Math.atan2(-dx, -dz);
    let diff = desired - p.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    fire = Math.abs(diff) < 0.08 && enemyD < 55;
  } else {
    // nearest untaken loot
    let best = null;
    let bestD = Infinity;
    for (const item of match.loot) {
      if (item.taken) continue;
      const d = Math.hypot(item.x - p.pos.x, item.z - p.pos.z);
      if (d < bestD) {
        bestD = d;
        best = item;
      }
    }
    if (best) {
      tx = best.x;
      tz = best.z;
    } else {
      tx = z.cx;
      tz = z.cz;
    }
  }
  if (tx !== null) {
    let dx = tx - p.pos.x;
    let dz = tz - p.pos.z;
    // sidestep: run perpendicular for a second to get around cover
    if (now < pilot.sidestepUntil) {
      const px = -dz;
      const pz = dx;
      dx = px * pilot.sidestepSign;
      dz = pz * pilot.sidestepSign;
    }
    const desired = Math.atan2(-dx, -dz);
    let diff = desired - p.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    // lookDX drives yaw -= lookDX*sens, so the sign flips: a positive diff
    // (target to the left of the current yaw) needs a negative lookDX
    input.lookDX = Math.max(-60, Math.min(60, -diff * 400));
    input.lookDY = 0;
    const dist = Math.hypot(dx, dz);
    input.forward = Math.abs(diff) < 1.1 && dist > 2;
    input.sprint = dist > 18;
    // kite: point-blank is a bad screenshot and a bad fight — back off
    if (enemy && enemyD < 7) {
      input.forward = false;
      input.back = true;
      input.sprint = false;
    } else {
      input.back = false;
    }
  }
  // fire: autos hold the trigger in bursts (sustained fire blooms the spread
  // until nothing lands); semi-autos need a fresh click per shot
  if (fire) {
    const w = p.weapons[p.current];
    if (w.def.auto) {
      pilot.burstStep += 1;
      input.fire = pilot.burstStep % 60 < 24;
    } else {
      pilot.shotStep += 1;
      input.fire = pilot.shotStep % 10 === 0;
    }
    // plant feet to shoot: moving wrecks accuracy, and at range the shots
    // are what matter — unless the enemy is point-blank, then keep backing off
    if (enemyD > 8) {
      input.forward = false;
      input.back = false;
      input.sprint = false;
    }
  } else {
    input.fire = false;
  }
  input.ads = fire && enemyD > 25;
}

/**
 * Stage the named scene. Returns { phase, win } — win is true/false when the
 * end screen should show, null otherwise.
 */
export function stageShot(name, match, camera, renderer) {
  pilot.lastX = 0;
  pilot.lastZ = 0;
  pilot.lastCheck = 0;
  pilot.sidestepUntil = 0;
  if (name === 'start') {
    // menu backdrop: a high vantage over the yard at dusk
    camera.position.set(38, 24, 38);
    camera.lookAt(0, 1, 0);
    camera.fov = 60;
    camera.updateProjectionMatrix();
    renderer.render(match.scene, camera);
    return { phase: 'menu', win: null };
  }
  match.start();
  let now = 0;
  if (name === 'zone') {
    // mid-game zone, closing: deterministic centre and radius so the wall reads
    // as a band 15m out, with the yard in front of it — player mid-yard, alive
    match.zone.phase = 1;
    match.zone.cx = 0;
    match.zone.cz = 0;
    match.zone.fromRadius = 40;
    match.zone.toRadius = 32;
    match.zone.radius = 38;
    match.zone.state = 'shrink';
    match.zone.timer = 15;
    match.zone.dps = 6;
    const zp = match.player;
    zp.pos.set(0, 0, 14);
    zp.health = 100;
    for (let i = 0; i < 4 / STEP; i += 1) {
      autopilot(match, false, now);
      match.update(STEP, now);
      now += STEP;
      if (match.phase !== 'playing') break;
    }
    clearInput();
    // stage the player 12m inside the wall on the north side so the wall-facing
    // direction is clear (the south container row blocks it) — the wall reads
    // as a band ahead with the ring on the ground and sky above
    zp.pos.set(0, 0, -26);
    zp.health = 100;
    match.scene.updateMatrixWorld();
    frameView(match, 'zone');
    match.updateCamera();
    renderer.render(match.scene, camera);
    return { phase: match.phase === 'playing' ? 'playing' : match.phase, win: null };
  }
  if (name === 'end') {
    for (let i = 0; i < END_LIMIT_SECONDS / STEP; i += 1) {
      autopilot(match, true, now);
      match.update(STEP, now);
      now += STEP;
      if (match.phase !== 'playing') break;
    }
    if (match.phase === 'playing') {
      // the reckless pilot survived the cap: finish it honestly with zone damage
      const p = match.player;
      p.pos.x = match.zone.cx + match.zone.radius + 10;
      p.pos.z = match.zone.cz;
      for (let i = 0; i < 40 / STEP; i += 1) {
        match.update(STEP, now);
        now += STEP;
        if (match.phase !== 'playing') break;
      }
    }
    if (match.phase === 'playing') {
      applyDamage(match.player, 9999);
      match.phase = 'dead';
      match.placement = match.aliveCount() + 1;
    }
    clearInput();
    match.updateCamera();
    renderer.render(match.scene, camera);
    return { phase: 'dead', win: false };
  }
  // play: a real firefight — drop the player mid-yard with two rivals in sight
  const p = match.player;
  p.pos.set(0, 0, 18);
  p.yaw = Math.PI;
  const rivals = match.fighters.filter((f) => !f.isPlayer && f.alive).slice(0, 2);
  if (rivals[0]) rivals[0].pos.set(-14, 0, 2);
  if (rivals[1]) rivals[1].pos.set(15, 0, 0);
  for (let i = 0; i < PLAY_SECONDS / STEP; i += 1) {
    autopilot(match, false, now);
    match.update(STEP, now);
    now += STEP;
    if (match.phase !== 'playing') break;
  }
  clearInput();
  // stage a full mag so the HUD never shows an empty gun in the shot
  const w = p.weapons[p.current];
  if (w) {
    w.mag = w.def.magSize;
    w.reloading = 0;
  }
  frameView(match, 'enemy');
  match.updateCamera();
  renderer.render(match.scene, camera);
  return { phase: match.phase === 'playing' ? 'playing' : match.phase, win: null };
}
