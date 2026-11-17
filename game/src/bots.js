// EMBERLINE — bots: seven rival drifters with credible AI.
// Each bot thinks on a short clock: it loots when poor, hunts when it has a gun,
// fights in bursts when it sees someone, breaks for cover when hurt, and always
// respects the zone. Aim error, reaction time and burst pauses keep fights fair.
import * as THREE from 'three';
import { COMBAT, PLAYER, ZONE } from './config.js';
import { collideCircle, segmentBlocked } from './world.js';
import { WEAPONS, makeWeaponState, currentSpread, tickWeapon, tryFire, startReload } from './weapons.js';
import { hitscan, applyDamage, spawnTracer } from './combat.js';

// Callsigns: short ember names, shown in the kill feed and on the floating
// nameplates above each bot, so every rival reads as a character, not a drone.
export const BOT_CALLSIGNS = ['ASH', 'CINDER', 'SLAG', 'RUST', 'FLINT', 'SMOKE', 'EMBER'];
const BOT_NAMES = BOT_CALLSIGNS;
const LOADOUTS = ['rifle', 'shotgun', 'marksman', 'rifle', 'shotgun', 'rifle', 'marksman'];

export function makeBot(index, x, z) {
  const weaponId = LOADOUTS[index % LOADOUTS.length];
  return {
    id: `bot-${index}`,
    name: BOT_NAMES[index % BOT_NAMES.length],
    isPlayer: false,
    index,
    pos: new THREE.Vector3(x, 0, z),
    yaw: Math.random() * Math.PI * 2,
    vel: new THREE.Vector3(),
    health: 100,
    armor: 0,
    alive: true,
    kills: 0,
    lastDamageAt: -99,
    weapons: { [weaponId]: makeWeaponState(WEAPONS[weaponId]) },
    current: weaponId,
    slots: [weaponId],
    state: 'loot',
    thinkAt: 0,
    target: null,
    lastSeen: null,
    lastSeenAt: -99,
    reactAt: 0,
    burstLeft: 0,
    pauseUntil: 0,
    moveTarget: new THREE.Vector3(x, 0, z),
    stuckAt: 0,
    lastPos: new THREE.Vector3(x, 0, z),
    coverAt: 0,
    healAt: 0,
    hasMedkit: false,
    body: null,
    stepAt: 0,
  };
}

function botWeapon(bot) {
  return bot.weapons[bot.current];
}

function equipBest(bot, kind) {
  if (bot.weapons[kind]) {
    bot.current = kind;
    return;
  }
  bot.weapons[kind] = makeWeaponState(WEAPONS[kind]);
  bot.slots.push(kind);
  bot.current = kind;
}

function visibleEnemy(bot, fighters, colliders, now) {
  let best = null;
  let bestD = Infinity;
  for (const f of fighters) {
    if (f === bot || !f.alive) continue;
    const dx = f.pos.x - bot.pos.x;
    const dz = f.pos.z - bot.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 95) continue;
    if (segmentBlocked(bot.pos.x, bot.pos.z, f.pos.x, f.pos.z, colliders)) continue;
    // roughly facing, or close enough to notice
    const facing = Math.atan2(dx, dz);
    let diff = Math.abs(facing - bot.yaw);
    if (diff > Math.PI) diff = Math.PI * 2 - diff;
    if (d > 18 && diff > 1.9) continue;
    if (d < bestD) {
      bestD = d;
      best = f;
    }
  }
  return best ? { fighter: best, dist: bestD } : null;
}

function nearestCover(bot, colliders) {
  // a point just behind the nearest tall collider, away from the enemy
  let best = null;
  let bestD = Infinity;
  for (const c of colliders) {
    if (c.height < 1.8) continue;
    const cx = (c.minX + c.maxX) / 2;
    const cz = (c.minZ + c.maxZ) / 2;
    const d = Math.hypot(cx - bot.pos.x, cz - bot.pos.z);
    if (d < bestD && d > 4) {
      bestD = d;
      best = { x: cx, z: cz };
    }
  }
  return best;
}

function nearestLoot(bot, loot, want) {
  let best = null;
  let bestD = Infinity;
  for (const item of loot) {
    if (item.taken) continue;
    if (want && !want(item.kind)) continue;
    const d = Math.hypot(item.x - bot.pos.x, item.z - bot.pos.z);
    if (d < bestD) {
      bestD = d;
      best = item;
    }
  }
  return best ? { item: best, dist: bestD } : null;
}

function steer(bot, tx, tz, dt, colliders, speed) {
  const dx = tx - bot.pos.x;
  const dz = tz - bot.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.6) return;
  const nx = dx / d;
  const nz = dz / d;
  bot.vel.x += nx * PLAYER.accel * 0.55 * dt;
  bot.vel.z += nz * PLAYER.accel * 0.55 * dt;
  const sp = Math.hypot(bot.vel.x, bot.vel.z);
  const max = speed;
  if (sp > max) {
    bot.vel.x = (bot.vel.x / sp) * max;
    bot.vel.z = (bot.vel.z / sp) * max;
  }
  bot.vel.x *= Math.max(0, 1 - PLAYER.drag * 0.6 * dt);
  bot.vel.z *= Math.max(0, 1 - PLAYER.drag * 0.6 * dt);
  const nx2 = bot.pos.x + bot.vel.x * dt;
  const nz2 = bot.pos.z + bot.vel.z * dt;
  const solved = collideCircle(nx2, nz2, PLAYER.radius, colliders);
  bot.pos.x = solved.x;
  bot.pos.z = solved.z;
  if (Math.hypot(bot.vel.x, bot.vel.z) > 0.5) {
    bot.yaw = Math.atan2(bot.vel.x, bot.vel.z);
  }
}

/** One AI tick for a bot. `api` carries the shared match helpers. */
export function updateBot(bot, dt, now, api) {
  if (!bot.alive) return;
  const { fighters, colliders, loot, zone, scene, obstacleMeshes, onKill, onShot } = api;
  const w = botWeapon(bot);
  tickWeapon(w, dt);

  // slow heal out of combat
  if (bot.health < 70 && now - bot.lastDamageAt > 5 && now - bot.healAt > 1) {
    bot.healAt = now;
    bot.health = Math.min(70, bot.health + 6);
  }

  // --- think every 0.25s ---
  if (now >= bot.thinkAt) {
    bot.thinkAt = now + 0.25;
    const seen = visibleEnemy(bot, fighters, colliders, now);
    if (seen) {
      bot.lastSeen = seen.fighter.pos.clone();
      bot.lastSeenAt = now;
      if (bot.target !== seen.fighter) {
        bot.target = seen.fighter;
        bot.reactAt = now + COMBAT.botReactMin + Math.random() * (COMBAT.botReactMax - COMBAT.botReactMin);
        bot.burstLeft = 0;
      }
    } else if (bot.target && now - bot.lastSeenAt > 3) {
      bot.target = null;
    }
    // zone first: if outside, the move target is the zone
    const zd = Math.hypot(bot.pos.x - zone.cx, bot.pos.z - zone.cz);
    if (zd > zone.radius - 2) {
      bot.state = 'zone';
      bot.moveTarget.set(zone.cx, 0, zone.cz);
    } else if (bot.health < 35 && now - bot.coverAt > 4) {
      const cover = nearestCover(bot, colliders);
      if (cover) {
        bot.state = 'retreat';
        bot.coverAt = now;
        bot.moveTarget.set(cover.x, 0, cover.z);
      } else {
        bot.state = 'hunt';
      }
    } else if (bot.target) {
      bot.state = 'fight';
    } else if (Object.keys(bot.weapons).length < 2 || bot.weapons[bot.current].reserve < 20) {
      const found = nearestLoot(bot, loot, (k) => k === 'rifle' || k === 'shotgun' || k === 'marksman' || k.startsWith('ammo'));
      if (found) {
        bot.state = 'loot';
        bot.moveTarget.set(found.item.x, 0, found.item.z);
      } else {
        bot.state = 'hunt';
      }
    } else {
      bot.state = 'hunt';
      if (!bot.lastSeen || now - bot.lastSeenAt > 6) {
        bot.moveTarget.set(zone.cx + (Math.random() - 0.5) * zone.radius, 0, zone.cz + (Math.random() - 0.5) * zone.radius);
      } else {
        bot.moveTarget.copy(bot.lastSeen);
      }
    }
  }

  // --- act ---
  if (bot.state === 'fight' && bot.target && bot.target.alive) {
    const t = bot.target;
    const dx = t.pos.x - bot.pos.x;
    const dz = t.pos.z - bot.pos.z;
    const d = Math.hypot(dx, dz);
    bot.yaw = Math.atan2(dx, dz);
    // strafe to keep a fighting distance
    const want = botWeapon(bot).def.kind === 'shotgun' ? 9 : 22;
    if (d > want + 4) steer(bot, t.pos.x, t.pos.z, dt, colliders, PLAYER.walkSpeed * 0.9);
    else if (d < want - 4) steer(bot, bot.pos.x - dx, bot.pos.z - dz, dt, colliders, PLAYER.walkSpeed * 0.9);
    else steer(bot, bot.pos.x - dz * 0.4, bot.pos.z + dx * 0.4, dt, colliders, PLAYER.walkSpeed * 0.6);
    // fire in bursts once reacted
    if (now >= bot.reactAt && now >= bot.pauseUntil) {
      if (bot.burstLeft <= 0) {
        bot.burstLeft = COMBAT.botBurstMin + Math.floor(Math.random() * (COMBAT.botBurstMax - COMBAT.botBurstMin));
        bot.pauseUntil = now + 0.1;
      }
      if (w.mag <= 0) {
        if (startReload(w)) onShot(bot, 'reload');
      } else if (w.cooldown <= 0 && bot.burstLeft > 0) {
        bot.burstLeft -= 1;
        if (bot.burstLeft === 0) bot.pauseUntil = now + COMBAT.botPauseMin + Math.random() * (COMBAT.botPauseMax - COMBAT.botPauseMin);
        fireBotShot(bot, t, d, api);
      }
    }
  } else {
    // move toward the move target; if stuck, sidestep
    const moved = Math.hypot(bot.pos.x - bot.lastPos.x, bot.pos.z - bot.lastPos.z);
    if (moved < 0.05 && now - bot.stuckAt > 1.2) {
      bot.stuckAt = now;
      bot.moveTarget.set(bot.pos.x + (Math.random() - 0.5) * 16, 0, bot.pos.z + (Math.random() - 0.5) * 16);
    }
    bot.lastPos.set(bot.pos.x, 0, bot.pos.z);
    steer(bot, bot.moveTarget.x, bot.moveTarget.z, dt, colliders, bot.state === 'zone' ? PLAYER.sprintSpeed * 0.85 : PLAYER.walkSpeed);
    // face travel direction while moving
    if (bot.state === 'loot' || bot.state === 'hunt') {
      const dx = bot.moveTarget.x - bot.pos.x;
      const dz = bot.moveTarget.z - bot.pos.z;
      if (Math.hypot(dx, dz) > 1) bot.yaw = Math.atan2(dx, dz);
    }
  }

  // --- pick up loot on contact (supply drops are for the player only) ---
  for (const item of loot) {
    if (item.taken) continue;
    if (item.kind === 'supply') continue;
    const d = Math.hypot(item.x - bot.pos.x, item.z - bot.pos.z);
    if (d < 1.6) {
      item.taken = true;
      if (item.kind === 'rifle' || item.kind === 'shotgun' || item.kind === 'marksman') {
        equipBest(bot, item.kind);
      } else if (item.kind === 'medkit') {
        bot.health = Math.min(100, bot.health + 50);
      } else if (item.kind === 'armor') {
        bot.armor = Math.min(PLAYER.armorMax, bot.armor + 50);
      } else if (item.kind.startsWith('ammo')) {
        const ammoKind = item.kind.slice(5);
        for (const key of Object.keys(bot.weapons)) {
          if (bot.weapons[key].def.ammo === ammoKind) {
            bot.weapons[key].reserve = Math.min(bot.weapons[key].def.reserveMax, bot.weapons[key].reserve + 40);
          }
        }
      }
      api.onPickup(bot, item.kind);
    }
  }

  // --- reload when the mag is dry and no enemy is near ---
  if (w.mag === 0 && !bot.target) startReload(w);

  // --- sync the visible body ---
  if (bot.body) {
    bot.body.group.position.set(bot.pos.x, 0, bot.pos.z);
    bot.body.group.rotation.y = bot.yaw;
    const bob = Math.hypot(bot.vel.x, bot.vel.z) > 0.5 ? Math.sin(now * 9) * 0.05 : 0;
    bot.body.group.position.y = bob;
  }
}

function fireBotShot(bot, target, dist, api) {
  const w = botWeapon(bot);
  if (!tryFire(w)) {
    if (w.mag === 0) api.onShot(bot, 'dry');
    return;
  }
  const { scene, obstacleMeshes, fighters } = api;
  const muzzle = new THREE.Vector3(bot.pos.x, 1.45, bot.pos.z);
  const aimErr = COMBAT.botAimError * (1 + Math.min(1, dist / 60));
  const pellets = w.def.pellets;
  let hitAny = false;
  for (let i = 0; i < pellets; i += 1) {
    const spread = currentSpread(w, false, true) + (Math.random() - 0.5) * aimErr * 2;
    const yaw = bot.yaw + (Math.random() - 0.5) * spread * 2;
    const pitch = (Math.random() - 0.5) * spread;
    const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch) + 0.02, Math.cos(yaw) * Math.cos(pitch)).normalize();
    const hit = hitscan(muzzle, dir, w.def.range, obstacleMeshes, fighters);
    const end = hit ? hit.point : muzzle.clone().addScaledVector(dir, w.def.range);
    api.addTracer(muzzle, end);
    if (hit && hit.fighter && hit.fighter !== bot) {
      hitAny = true;
      const mult = hit.part === 'head' ? w.def.headMult : 1;
      const falloff = Math.max(0.45, 1 - hit.distance / (w.def.range * 1.6));
      const died = applyDamage(hit.fighter, w.def.damage * mult * falloff * (hit.fighter.isPlayer ? 0.6 : 1));
      if (hit.fighter.isPlayer) api.onPlayerHit(w.def.damage * mult * falloff);
      if (died) {
        bot.kills += 1;
        api.onKill(bot, hit.fighter, w.def.name);
      }
    }
  }
  api.onShot(bot, w.def.kind, dist);
  void hitAny;
}
