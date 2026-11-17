// EMBERLINE — combat: hitscan shooting, damage with armour, tracers.
// One raycast per trigger pull against obstacles and fighter bodies; the nearest
// hit wins, so cover really blocks shots and a headshot really pays.
import * as THREE from 'three';
import { COMBAT } from './config.js';

const raycaster = new THREE.Raycaster();
raycaster.far = 200;

const BODY_COLORS = [0xff7a2f, 0xffd166, 0x7fb069, 0x9b5de5, 0xef476f, 0x06d6a0, 0x118ab2];

/** Visible body for a bot: torso, head, legs, gun — all raycastable — plus a
 * floating callsign nameplate (a cheap canvas sprite, not raycastable). */
export function makeBotBody(scene, index, name = '') {
  const color = BODY_COLORS[index % BODY_COLORS.length];
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.15 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x3a4048, roughness: 0.85 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.34), mat);
  torso.position.y = 1.12;
  torso.castShadow = true;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.32, 0.34), dark);
  head.position.y = 1.66;
  head.castShadow = true;
  // glowing visor so the bot reads as a robot at a glance, even in shadow
  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.26, 0.07, 0.02),
    new THREE.MeshBasicMaterial({ color }),
  );
  visor.position.set(0, 1.68, 0.18);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.72, 0.26), dark);
  legL.position.set(-0.16, 0.36, 0);
  const legR = legL.clone();
  legR.position.x = 0.16;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.78), dark);
  gun.position.set(0.3, 1.28, 0.3);
  group.add(torso, head, visor, legL, legR, gun);
  // callsign nameplate: a small canvas sprite floating above the head,
  // readable at range, one draw call per bot
  let nameplate = null;
  if (name) {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 64;
    const g = c.getContext('2d');
    g.font = 'bold 34px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = 'rgba(0,0,0,0.9)';
    g.shadowBlur = 6;
    g.fillStyle = '#ffd9a0';
    g.fillText(name, 128, 32);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    nameplate = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    nameplate.scale.set(1.9, 0.48, 1);
    nameplate.position.y = 2.15;
    group.add(nameplate);
  }
  group.traverse((m) => {
    if (m.isMesh) m.userData.part = m === head ? 'head' : 'body';
  });
  scene.add(group);
  return { group, color, parts: [torso, head, legL, legR, gun], nameplate };
}

/**
 * Fire one hitscan pellet from `origin` along `dir`.
 * Returns { point, fighter, part, distance } for the nearest hit, else null.
 */
export function hitscan(origin, dir, range, obstacleMeshes, fighters) {
  raycaster.set(origin, dir);
  raycaster.far = range;
  const targets = [];
  for (const f of fighters) {
    if (!f.alive) continue;
    for (const part of f.body.parts) targets.push(part);
  }
  const hits = raycaster.intersectObjects([...obstacleMeshes, ...targets], false);
  if (hits.length === 0) return null;
  const hit = hits[0];
  const fighter = hit.object.userData.fighter || null;
  return {
    point: hit.point.clone(),
    fighter,
    part: hit.object.userData.part || 'body',
    distance: hit.distance,
  };
}

/** Apply damage to a fighter: armour eats a share first. Returns true if it died. */
export function applyDamage(fighter, damage) {
  if (!fighter.alive) return false;
  let rest = damage;
  if (fighter.armor > 0) {
    const absorbed = Math.min(fighter.armor, rest * COMBAT.armorAbsorb);
    fighter.armor -= absorbed;
    rest -= absorbed;
  }
  fighter.health -= rest;
  fighter.lastDamageAt = performance.now() / 1000;
  if (fighter.health <= 0) {
    fighter.health = 0;
    fighter.alive = false;
    return true;
  }
  return false;
}

/** A fading tracer line from muzzle to impact point. */
export function spawnTracer(scene, from, to) {
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  const geo = new THREE.BoxGeometry(0.03, 0.03, len);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.9 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(from).addScaledVector(dir, 0.5);
  mesh.lookAt(to);
  scene.add(mesh);
  return { mesh, life: 0.07, maxLife: 0.07 };
}

export function tickTracer(tracer, dt) {
  tracer.life -= dt;
  tracer.mesh.material.opacity = Math.max(0, (tracer.life / tracer.maxLife) * 0.9);
  return tracer.life > 0;
}

export function removeTracer(scene, tracer) {
  scene.remove(tracer.mesh);
  tracer.mesh.geometry.dispose();
  tracer.mesh.material.dispose();
}
