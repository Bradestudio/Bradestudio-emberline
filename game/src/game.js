// EMBERLINE — game: the match. One mode, done well: last drifter standing.
// Eight fighters drop into the Ashen Reach; loot is scattered, the ashfall zone
// shrinks in phases, and the last one alive wins. This file owns the match state,
// the player, the zone, the loot, the kill feed and the win/lose call.
import * as THREE from 'three';
import { MAP, PLAYER, ZONE, STEP, SUPPLY_DROP } from './config.js';
import { applyRankBonus, nextRankBonus } from './ranks.js';
import { WEAPONS, makeWeaponState, currentSpread, tickWeapon, tryFire, startReload } from './weapons.js';
import { buildWorld, makeZoneVisual, makeAshfall, collideCircle } from './world.js';
import { makeBotBody, hitscan, applyDamage, spawnTracer, tickTracer, removeTracer } from './combat.js';
import { makeBot, updateBot } from './bots.js';
import { input, wasPressed } from './input.js';
import { audio } from './audio.js';

const LOOT_COLORS = {
  rifle: 0x39d0c4,
  shotgun: 0xff7a2f,
  marksman: 0xc77dff,
  medkit: 0xffffff,
  armor: 0x7fa8c9,
  'ammo-light': 0xffe066,
  'ammo-shell': 0xffb703,
  'ammo-long': 0xff8fa3,
};

function lootMesh(kind) {
  const group = new THREE.Group();
  const color = LOOT_COLORS[kind] || 0xffffff;
  if (kind === 'rifle' || kind === 'shotgun' || kind === 'marksman') {
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.12, 0.14),
      new THREE.MeshStandardMaterial({ color: 0x22262b, roughness: 0.6, metalness: 0.5 }),
    );
    const grip = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.3, 0.12),
      new THREE.MeshStandardMaterial({ color: 0x22262b, roughness: 0.6, metalness: 0.5 }),
    );
    grip.position.set(-0.2, -0.16, 0);
    const accent = new THREE.Mesh(
      new THREE.BoxGeometry(0.92, 0.04, 0.16),
      new THREE.MeshBasicMaterial({ color }),
    );
    accent.position.y = 0.08;
    group.add(body, grip, accent);
  } else if (kind === 'medkit') {
    const boxMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.34, 0.36),
      new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5 }),
    );
    const crossA = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.02), new THREE.MeshBasicMaterial({ color: 0x2fae7d }));
    crossA.position.set(0, 0, 0.19);
    const crossB = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.3, 0.02), new THREE.MeshBasicMaterial({ color: 0x2fae7d }));
    crossB.position.set(0, 0, 0.19);
    group.add(boxMesh, crossA, crossB);
  } else if (kind === 'armor') {
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.62, 0.1),
      new THREE.MeshStandardMaterial({ color: 0x7fa8c9, roughness: 0.35, metalness: 0.6 }),
    );
    group.add(plate);
  } else {
    const boxMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.24, 0.34),
      new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.4 }),
    );
    group.add(boxMesh);
  }
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(1.1, 1.1),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }),
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = -0.32;
  group.add(glow);
  return group;
}

export class Match {
  constructor(scene, seed = 1) {
    this.scene = scene;
    this.seed = seed;
    this.world = buildWorld(scene, seed);
    this.zoneVisual = makeZoneVisual(scene);
    this.ashfall = makeAshfall(scene);
    this.rng = (() => {
      let a = (seed * 2654435761) >>> 0;
      return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    })();
    this.phase = 'menu';
    this.time = 0;
    this.feed = [];
    this.tracers = [];
    this.banners = [];
    this.placement = 0;
    this.playerHitFlash = 0;
    this.playerHealFlash = 0;
    this.zoneWarned = false;
    this.bursts = [];
    this.damageNumbers = [];
    this.damageSeq = 0;
    this.shake = 0;
    this.dropTimer = SUPPLY_DROP.firstAt;
    this.fighters = [];
    this.loot = [];
    this.zone = null;
    this.player = null;
    this.camera = null;
    this.switchTimer = 0;
    this.stepAcc = 0;
    this.zoneDpsAcc = 0;
    this.muzzleAt = -99;
    this.lastHitAt = -99;
    this.lastHitKill = false;
    this.lastToast = null;
  }

  makeFighter(isPlayer, index, x, z) {
    if (isPlayer) {
      const hitbox = new THREE.Mesh(
        new THREE.BoxGeometry(0.9, 1.7, 0.9),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
      );
      hitbox.position.set(x, 0.85, z);
      this.scene.add(hitbox);
      const f = {
        id: 'player',
        name: 'You',
        isPlayer: true,
        pos: new THREE.Vector3(x, 0, z),
        vel: new THREE.Vector3(),
        yaw: 0,
        pitch: 0,
        health: 100,
        maxHealth: 100,
        armor: 0,
        alive: true,
        kills: 0,
        emberRank: 0,
        reloadMult: 1,
        speedMult: 1,
        damageMult: 1,
        stats: { shots: 0, hits: 0, damage: 0 },
        weapons: { pistol: makeWeaponState(WEAPONS.pistol) },
        current: 'pistol',
        slots: ['pistol'],
        body: { group: null, parts: [hitbox] },
        lastDamageAt: -99,
        onGround: true,
      };
      hitbox.userData.fighter = f;
      return f;
    }
    const bot = makeBot(index, x, z);
    bot.body = makeBotBody(this.scene, index, bot.name);
    for (const part of bot.body.parts) part.userData.fighter = bot;
    return bot;
  }

  start() {
    // clear previous run's bodies and loot
    for (const f of this.fighters) {
      if (f.body && f.body.group) this.scene.remove(f.body.group);
      if (f.body && f.body.parts) for (const p of f.body.parts) this.scene.remove(p);
    }
    for (const item of this.loot) this.scene.remove(item.mesh);
    for (const t of this.tracers) removeTracer(this.scene, t);
    this.tracers = [];
    for (const b of this.bursts) this.removeBurst(b);
    this.bursts = [];
    this.damageNumbers = [];
    this.shake = 0;
    this.dropTimer = SUPPLY_DROP.firstAt;
    this.feed = [];
    this.time = 0;
    this.placement = 0;
    this.zoneWarned = false;

    const spawns = [...this.world.spawnPoints].sort(() => this.rng() - 0.5);
    this.fighters = [];
    this.player = this.makeFighter(true, -1, spawns[0][0], spawns[0][1]);
    this.player.yaw = Math.atan2(-spawns[0][0], -spawns[0][1]);
    this.fighters.push(this.player);
    for (let i = 0; i < 7; i += 1) {
      const bot = this.makeFighter(false, i, spawns[i + 1][0], spawns[i + 1][1]);
      this.fighters.push(bot);
    }

    this.loot = this.world.lootSpawns.map((s) => {
      const mesh = lootMesh(s.kind);
      mesh.position.set(s.x, 0.55, s.z);
      this.scene.add(mesh);
      return { kind: s.kind, x: s.x, z: s.z, mesh, taken: false, phase: this.rng() * Math.PI * 2 };
    });

    const cx = (this.rng() - 0.5) * 30;
    const cz = (this.rng() - 0.5) * 30;
    this.zone = {
      cx,
      cz,
      radius: ZONE.startRadius,
      fromRadius: ZONE.startRadius,
      toRadius: ZONE.startRadius,
      phase: 0,
      timer: ZONE.phases[0].wait,
      state: 'wait',
      dps: 0,
      announced: false,
    };
    this.phase = 'playing';
    this.pushBanner('DROP IN', 'Last drifter standing wins — first ashfall closes in 22s. Loot up now.');
    audio.zoneWarn();
  }

  // ---- ember ranks ----
  /** Grant the player one rank: apply its bonus, toast it, log it in the feed. */
  grantEmberRank(reason) {
    const p = this.player;
    if (!p || !p.alive) return null;
    p.emberRank += 1;
    const bonus = applyRankBonus(p, p.emberRank);
    const next = nextRankBonus(p.emberRank);
    this.toast(`EMBER RANK ${p.emberRank} — ${bonus.label} (next: ${next.label})`);
    this.pushNote(`★ EMBER RANK ${p.emberRank} — ${bonus.label} (${reason})`);
    return bonus;
  }

  /** A feed line that is a note, not a kill (rank-ups, drops). */
  pushNote(text) {
    this.feed.push({ note: text, at: this.time });
    if (this.feed.length > 6) this.feed.shift();
  }

  /** An ember-burst particle explosion at `pos` (world Vector3). */
  spawnBurst(pos, color = 0xff7a2f, count = 26) {
    const positions = new Float32Array(count * 3);
    const vels = [];
    for (let i = 0; i < count; i += 1) {
      positions[i * 3] = pos.x;
      positions[i * 3 + 1] = pos.y + 1;
      positions[i * 3 + 2] = pos.z;
      const a = Math.random() * Math.PI * 2;
      const up = Math.random() * 4 + 1;
      const out = Math.random() * 3.5 + 0.5;
      vels.push(new THREE.Vector3(Math.cos(a) * out, up, Math.sin(a) * out));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color,
      size: 0.28,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geo, mat);
    this.scene.add(points);
    const burst = { points, geo, mat, vels, life: 0.7, maxLife: 0.7 };
    this.bursts.push(burst);
    return burst;
  }

  removeBurst(burst) {
    this.scene.remove(burst.points);
    burst.geo.dispose();
    burst.mat.dispose();
  }

  tickBursts(dt) {
    for (let i = this.bursts.length - 1; i >= 0; i -= 1) {
      const b = this.bursts[i];
      b.life -= dt;
      const arr = b.geo.attributes.position.array;
      for (let j = 0; j < b.vels.length; j += 1) {
        const v = b.vels[j];
        v.y -= 9 * dt;
        arr[j * 3] += v.x * dt;
        arr[j * 3 + 1] += v.y * dt;
        arr[j * 3 + 2] += v.z * dt;
        if (arr[j * 3 + 1] < 0.05) arr[j * 3 + 1] = 0.05;
      }
      b.geo.attributes.position.needsUpdate = true;
      b.mat.opacity = Math.max(0, b.life / b.maxLife);
      if (b.life <= 0) {
        this.removeBurst(b);
        this.bursts.splice(i, 1);
      }
    }
    // floating damage numbers fade out after 0.9s
    for (let i = this.damageNumbers.length - 1; i >= 0; i -= 1) {
      if (this.time - this.damageNumbers[i].at > 0.9) this.damageNumbers.splice(i, 1);
    }
  }

  /** Spawn a supply-drop crate with a light-pillar beacon inside the zone. */
  spawnSupplyDrop() {
    const z = this.zone;
    if (!z) return;
    const a = this.rng() * Math.PI * 2;
    const r = this.rng() * z.radius * 0.6;
    const x = Math.max(-55, Math.min(55, z.cx + Math.cos(a) * r));
    const zz = Math.max(-55, Math.min(55, z.cz + Math.sin(a) * r));
    const group = new THREE.Group();
    const crate = new THREE.Mesh(
      new THREE.BoxGeometry(1.1, 0.8, 1.1),
      new THREE.MeshStandardMaterial({ color: 0xffb703, roughness: 0.5, metalness: 0.3 }),
    );
    crate.position.y = 0.4;
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(1.14, 0.18, 1.14),
      new THREE.MeshBasicMaterial({ color: 0xff4d00 }),
    );
    stripe.position.y = 0.4;
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.9, 30, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffb703, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    beam.position.y = 15;
    group.add(crate, stripe, beam);
    group.position.set(x, 0.55, zz);
    this.scene.add(group);
    this.loot.push({ kind: 'supply', x, z: zz, mesh: group, taken: false, phase: this.rng() * Math.PI * 2, supply: true });
    this.pushBanner('SUPPLY DROP', 'A crate fell inside the zone — follow the light pillar');
    this.pushNote('⬇ SUPPLY DROP inbound — follow the light pillar');
    audio.zoneWarn();
  }

  aliveCount() {
    return this.fighters.filter((f) => f.alive).length;
  }

  pushBanner(title, sub) {
    this.banners.push({ title, sub, at: this.time });
  }

  pushFeed(killer, victim, weaponName) {
    this.feed.push({ killer, victim, weaponName, at: this.time, you: killer === 'You' || victim === 'You' });
    if (this.feed.length > 6) this.feed.shift();
  }

  // ---- zone ----
  updateZone(dt) {
    const z = this.zone;
    if (!z || z.phase >= ZONE.phases.length) return;
    const def = ZONE.phases[z.phase];
    if (z.state === 'wait') {
      z.timer -= dt;
      if (z.timer <= 0) {
        z.state = 'shrink';
        z.timer = def.shrink;
        z.fromRadius = z.radius;
        z.toRadius = def.radius;
        z.dps = def.dps;
        this.pushBanner('ASHFALL CLOSING', 'Get inside the circle');
        audio.zoneWarn();
      }
    } else if (z.state === 'shrink') {
      z.timer -= dt;
      const t = Math.max(0, Math.min(1, 1 - z.timer / def.shrink));
      z.radius = z.fromRadius + (z.toRadius - z.fromRadius) * t;
      if (z.timer <= 0) {
        z.radius = def.radius;
        z.phase += 1;
        // surviving a phase earns the player an ember rank
        if (this.player && this.player.alive) this.grantEmberRank('survived the ashfall');
        if (z.phase < ZONE.phases.length) {
          z.state = 'wait';
          z.timer = ZONE.phases[z.phase].wait;
        } else {
          z.state = 'done';
        }
      }
    }
    this.zoneVisual.update(z.cx, z.cz, z.radius, this.time);
  }

  zoneDamage(dt) {
    const z = this.zone;
    if (!z) return;
    this.zoneDpsAcc += dt;
    const tick = this.zoneDpsAcc >= 1;
    if (tick) this.zoneDpsAcc = 0;
    for (const f of this.fighters) {
      if (!f.alive) continue;
      const d = Math.hypot(f.pos.x - z.cx, f.pos.z - z.cz);
      if (d > z.radius) {
        if (f.isPlayer) this.zoneWarned = true;
        if (tick) {
          const died = applyDamage(f, z.dps);
          if (f.isPlayer) {
            this.playerHitFlash = 1;
            this.shake = Math.min(1, this.shake + 0.4);
            audio.hurt();
          }
          if (died) this.onFighterDown(f, null, 'the ashfall');
        }
      }
    }
  }

  onFighterDown(victim, killer, weaponName) {
    this.pushFeed(killer ? killer.name : '—', victim.name, weaponName || '');
    this.spawnBurst(victim.pos, victim.isPlayer ? 0x39d0c4 : 0xff7a2f);
    if (victim.isPlayer) {
      this.placement = this.aliveCount() + 1;
      this.phase = 'dead';
      audio.defeat();
      return;
    }
    if (killer) killer.kills += 1;
    if (this.aliveCount() === 1 && this.player.alive) {
      this.phase = 'victory';
      audio.victory();
    }
  }

  // ---- player ----
  playerWeapon() {
    return this.player.weapons[this.player.current];
  }

  updatePlayer(dt) {
    const p = this.player;
    if (!p.alive) return;
    const w = this.playerWeapon();
    const finishedReload = tickWeapon(w, dt);
    if (finishedReload) audio.reload();

    // look
    const sens = input.ads ? 0.0013 : 0.0023;
    p.yaw -= input.lookDX * sens;
    p.pitch -= input.lookDY * sens;
    // arrow-key look fallback: playable with no pointer lock at all
    const turnRate = 2.4;
    const pitchRate = 1.9;
    if (input.arrowLeft) p.yaw += turnRate * dt;
    if (input.arrowRight) p.yaw -= turnRate * dt;
    if (input.arrowUp) p.pitch += pitchRate * dt;
    if (input.arrowDown) p.pitch -= pitchRate * dt;
    p.pitch = Math.max(-1.5, Math.min(1.5, p.pitch));

    // move
    const sprinting = input.sprint && input.forward && !input.ads;
    const speed = (sprinting ? PLAYER.sprintSpeed : PLAYER.walkSpeed) * (p.speedMult || 1);
    const penalty = w.def.movePenalty * (input.ads ? 1.5 : 1);
    const wish = new THREE.Vector3(
      (input.right ? 1 : 0) - (input.left ? 1 : 0),
      0,
      (input.back ? 1 : 0) - (input.forward ? 1 : 0),
    );
    if (wish.lengthSq() > 0) {
      wish.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw);
      p.vel.x += wish.x * PLAYER.accel * dt;
      p.vel.z += wish.z * PLAYER.accel * dt;
    }
    const drag = Math.max(0, 1 - PLAYER.drag * dt);
    p.vel.x *= drag;
    p.vel.z *= drag;
    const sp = Math.hypot(p.vel.x, p.vel.z);
    const max = speed * (1 - penalty);
    if (sp > max) {
      p.vel.x = (p.vel.x / sp) * max;
      p.vel.z = (p.vel.z / sp) * max;
    }
    const solved = collideCircle(p.pos.x + p.vel.x * dt, p.pos.z + p.vel.z * dt, PLAYER.radius, this.world.colliders);
    p.pos.x = solved.x;
    p.pos.z = solved.z;

    // jump + gravity
    if (input.jump && p.onGround) {
      p.vel.y = PLAYER.jumpSpeed;
      p.onGround = false;
      audio.jump();
    }
    p.vel.y -= PLAYER.gravity * dt;
    p.pos.y += p.vel.y * dt;
    if (p.pos.y <= 0) {
      p.pos.y = 0;
      p.vel.y = 0;
      p.onGround = true;
    }

    // footsteps
    this.stepAcc += Math.hypot(p.vel.x, p.vel.z) * dt;
    if (this.stepAcc > 2.4 && p.onGround && sp > 1) {
      this.stepAcc = 0;
      audio.footstep();
    }

    // weapon switch
    this.switchTimer = Math.max(0, this.switchTimer - dt);
    for (let i = 0; i < 4; i += 1) {
      if (input.slots[i] && this.switchTimer <= 0) {
        const id = p.slots[i];
        if (id && id !== p.current) {
          p.current = id;
          this.switchTimer = 0.35;
          audio.click();
        }
      }
    }

    // reload
    if (wasPressed('r') && startReload(w, p.reloadMult || 1)) audio.reload();

    // fire
    const moving = sp > 1;
    if (input.fire && this.switchTimer <= 0) {
      if (!w.def.auto && !w.triggerReady) {
        /* wait for the trigger to lift */
      } else if (tryFire(w)) {
        w.triggerReady = false;
        this.firePlayerShot(w, moving);
      } else if (w.mag === 0 && w.reloading <= 0) {
        audio.dryFire();
        if (startReload(w, p.reloadMult || 1)) audio.reload();
      }
    }
    if (!input.fire) w.triggerReady = true;

    // pickup: walk over loot to take it
    for (const item of this.loot) {
      if (item.taken) continue;
      const d = Math.hypot(item.x - p.pos.x, item.z - p.pos.z);
      if (d < 1.9) this.takeLoot(p, item);
    }

    // sync the hitbox
    p.body.parts[0].position.set(p.pos.x, 0.85, p.pos.z);
    this.playerHitFlash = Math.max(0, this.playerHitFlash - dt * 2.2);
  }

  firePlayerShot(w, moving) {
    const p = this.player;
    // the camera must be fresh: callers that step the match without a frame
    // loop (tests, autopilot soaks) do not call updateCamera themselves
    this.updateCamera();
    const cam = this.camera;
    this.muzzleAt = this.time;
    audio.shot(w.def.kind, 0);
    const spread = currentSpread(w, input.ads, moving);
    for (let i = 0; i < w.def.pellets; i += 1) {
      const dir = new THREE.Vector3();
      cam.getWorldDirection(dir);
      // spread: perturb in camera space
      const right = new THREE.Vector3().setFromMatrixColumn(cam.matrix, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(cam.matrix, 1);
      const sx = (Math.random() - 0.5) * 2 * spread;
      const sy = (Math.random() - 0.5) * 2 * spread;
      dir.addScaledVector(right, sx).addScaledVector(up, sy).normalize();
      const origin = cam.position.clone();
      const hit = hitscan(origin, dir, w.def.range, this.world.obstacleMeshes, this.fighters);
      const end = hit ? hit.point : origin.clone().addScaledVector(dir, w.def.range);
      const tracer = spawnTracer(this.scene, origin.clone().addScaledVector(dir, 0.6), end);
      this.tracers.push(tracer);
      p.stats.shots += 1;
      if (hit && hit.fighter && hit.fighter !== p) {
        const mult = hit.part === 'head' ? w.def.headMult : 1;
        const falloff = Math.max(0.45, 1 - hit.distance / (w.def.range * 1.6));
        const dmg = w.def.damage * mult * falloff * (p.damageMult || 1);
        p.stats.hits += 1;
        p.stats.damage += dmg;
        this.damageNumbers.push({
          id: this.damageSeq += 1,
          x: hit.point.x,
          y: hit.point.y,
          z: hit.point.z,
          amount: Math.round(dmg),
          at: this.time,
        });
        const died = applyDamage(hit.fighter, dmg);
        this.lastHitAt = this.time;
        this.lastHitKill = died;
        audio.hit();
        if (died) {
          p.kills += 1;
          audio.kill();
          this.pushFeed(p.name, hit.fighter.name, w.def.name);
          const left = this.aliveCount();
          this.pushBanner(`ELIMINATED ${hit.fighter.name}`, `${p.kills} ${p.kills === 1 ? 'kill' : 'kills'} — ${left} ${left === 1 ? 'drifter' : 'drifters'} left`);
          this.spawnBurst(hit.fighter.pos, 0xff7a2f);
          this.grantEmberRank(`eliminated ${hit.fighter.name}`);
          if (this.aliveCount() === 1 && p.alive) {
            this.phase = 'victory';
            audio.victory();
          }
        }
      }
    }
  }

  /** Give fighter `p` the weapon `kind` (new slot, or ammo if already owned). */
  giveWeapon(p, kind) {
    if (p.weapons[kind]) {
      p.weapons[kind].reserve = Math.min(p.weapons[kind].def.reserveMax, p.weapons[kind].reserve + 60);
      this.toast(`+60 ${WEAPONS[kind].name} ammo`);
    } else if (p.slots.length < 4) {
      p.weapons[kind] = makeWeaponState(WEAPONS[kind]);
      p.slots.push(kind);
      p.current = kind;
      this.switchTimer = 0.35;
      this.toast(`Picked up ${WEAPONS[kind].name}`);
    } else {
      // full: swap the current gun out
      const old = p.current;
      delete p.weapons[old];
      p.slots[p.slots.indexOf(old)] = kind;
      p.weapons[kind] = makeWeaponState(WEAPONS[kind]);
      p.current = kind;
      this.switchTimer = 0.35;
      this.toast(`Swapped to ${WEAPONS[kind].name}`);
    }
    audio.pickup();
  }

  takeLoot(p, item) {
    item.taken = true;
    item.mesh.visible = false;
    if (item.kind === 'supply') {
      // supply drop: a random high-tier weapon plus armour
      const kinds = ['rifle', 'shotgun', 'marksman'];
      const kind = kinds[Math.floor(this.rng() * kinds.length)];
      this.giveWeapon(p, kind);
      p.armor = Math.min(PLAYER.armorMax, p.armor + 50);
      this.toast(`SUPPLY DROP: ${WEAPONS[kind].name} + 50 armour`);
      audio.armor();
      return;
    }
    if (item.kind === 'rifle' || item.kind === 'shotgun' || item.kind === 'marksman') {
      this.giveWeapon(p, item.kind);
    } else if (item.kind === 'medkit') {
      p.health = Math.min(p.maxHealth || 100, p.health + 50);
      this.playerHealFlash = 1;
      this.toast('+50 health');
      audio.heal();
    } else if (item.kind === 'armor') {
      p.armor = Math.min(PLAYER.armorMax, p.armor + 50);
      this.toast('+50 armour');
      audio.armor();
    } else if (item.kind.startsWith('ammo')) {
      const ammoKind = item.kind.slice(5);
      let got = false;
      for (const key of Object.keys(p.weapons)) {
        if (p.weapons[key].def.ammo === ammoKind) {
          p.weapons[key].reserve = Math.min(p.weapons[key].def.reserveMax, p.weapons[key].reserve + 40);
          got = true;
        }
      }
      this.toast(got ? `+40 ${ammoKind.toUpperCase()} ammo` : 'Ammo (no gun for it)');
      audio.pickup();
    }
  }

  toast(text) {
    this.lastToast = { text, at: this.time };
  }

  // ---- frame ----
  update(dt, nowSeconds) {
    if (this.phase !== 'playing') return;
    this.time += dt;
    // Raycasts read matrixWorld: keep it fresh here so hits never depend on
    // whether a frame happened to render since the last move.
    this.scene.updateMatrixWorld();
    this.updateZone(dt);
    this.updatePlayer(dt);
    // bots
    const api = {
      fighters: this.fighters,
      colliders: this.world.colliders,
      loot: this.loot,
      zone: this.zone,
      scene: this.scene,
      obstacleMeshes: this.world.obstacleMeshes,
      onKill: (killer, victim, weaponName) => {
        this.pushFeed(killer.name, victim.name, weaponName);
        this.spawnBurst(victim.pos, victim.isPlayer ? 0x39d0c4 : 0xff7a2f);
        if (victim.isPlayer) {
          this.placement = this.aliveCount() + 1;
          this.phase = 'dead';
          audio.defeat();
        } else if (this.aliveCount() === 1 && this.player.alive) {
          this.phase = 'victory';
          audio.victory();
        }
      },
      onShot: (fighter, kind, dist = 0) => {
        if (kind === 'reload' || kind === 'dry') return;
        const d = Math.hypot(fighter.pos.x - this.player.pos.x, fighter.pos.z - this.player.pos.z);
        if (d < 70) audio.shot(kind, d);
      },
      onPlayerHit: () => {
        this.playerHitFlash = 1;
        this.shake = Math.min(1, this.shake + 0.55);
        audio.hurt();
      },
      onPickup: () => {},
      addTracer: (from, to) => {
        this.tracers.push(spawnTracer(this.scene, from, to));
      },
    };
    for (const f of this.fighters) {
      if (!f.isPlayer) updateBot(f, dt, nowSeconds, api);
    }
    this.zoneDamage(dt);
    // supply drops on a timer while the match runs
    this.dropTimer -= dt;
    if (this.dropTimer <= 0) {
      this.dropTimer = SUPPLY_DROP.every;
      this.spawnSupplyDrop();
    }
    // ashfall drift + wall motes, bursts, shake decay
    if (this.ashfall) this.ashfall.update(dt, this.time, this.zone);
    this.tickBursts(dt);
    this.shake = Math.max(0, this.shake - dt * 2.2);
    // safety net: whatever felled the last rival, the match ends
    if (this.phase === 'playing' && this.aliveCount() === 1 && this.player.alive) {
      this.phase = 'victory';
      audio.victory();
    }
    // loot bob + spin, hide taken
    for (const item of this.loot) {
      if (item.taken) continue;
      item.mesh.position.y = 0.55 + Math.sin(this.time * 2 + item.phase) * 0.08;
      item.mesh.rotation.y += dt * 0.8;
    }
    // tracers
    for (let i = this.tracers.length - 1; i >= 0; i -= 1) {
      if (!tickTracer(this.tracers[i], dt)) {
        removeTracer(this.scene, this.tracers[i]);
        this.tracers.splice(i, 1);
      }
    }
    this.playerHealFlash = Math.max(0, this.playerHealFlash - dt * 2);
  }

  /** Camera transform for the player view, with recoil and landing bob. */
  updateCamera() {
    const p = this.player;
    const cam = this.camera;
    if (!cam || !p) return;
    const bob = Math.hypot(p.vel.x, p.vel.z) > 0.5 && p.onGround ? Math.sin(this.time * 11) * 0.03 : 0;
    // screen shake: a small random offset that decays after taking damage
    const sh = this.shake * 0.07;
    const shX = sh ? (Math.random() - 0.5) * 2 * sh : 0;
    const shY = sh ? (Math.random() - 0.5) * 2 * sh : 0;
    cam.position.set(p.pos.x + shX, p.pos.y + PLAYER.eye + bob + shY, p.pos.z);
    cam.rotation.order = 'YXZ';
    cam.rotation.y = p.yaw;
    cam.rotation.x = p.pitch;
    cam.rotation.z = this.shake ? (Math.random() - 0.5) * this.shake * 0.02 : 0;
    const w = this.playerWeapon();
    const targetFov = input.ads ? PLAYER.adsFov / (w ? w.def.zoom : 1) : PLAYER.hipFov;
    cam.fov += (targetFov - cam.fov) * 0.18;
    cam.updateProjectionMatrix();
  }
}
