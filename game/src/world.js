// EMBERLINE — world: the Ashen Reach, a derelict freight yard at dusk.
// Hand-placed cover (containers, barriers, crates, a watchtower, a wrecked hauler)
// so lanes, sightlines and the zone fight are deliberate, not random.
// Colliders are AABBs on the XZ plane; the renderer only draws what this builds.
import * as THREE from 'three';
import { MAP, PALETTE } from './config.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function groundTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#6b6156';
  g.fillRect(0, 0, 512, 512);
  // dust noise
  for (let i = 0; i < 5200; i += 1) {
    const v = 95 + Math.random() * 60;
    g.fillStyle = `rgba(${v | 0},${(v * 0.92) | 0},${(v * 0.8) | 0},0.25)`;
    g.fillRect(Math.random() * 512, Math.random() * 512, 2 + Math.random() * 3, 2 + Math.random() * 3);
  }
  // cracked concrete seams
  g.strokeStyle = 'rgba(40,34,28,0.55)';
  g.lineWidth = 2;
  for (let i = 0; i < 9; i += 1) {
    g.beginPath();
    let x = Math.random() * 512;
    let y = Math.random() * 512;
    g.moveTo(x, y);
    for (let s = 0; s < 5; s += 1) {
      x += (Math.random() - 0.5) * 120;
      y += (Math.random() - 0.5) * 120;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  // faded yard lines
  g.strokeStyle = 'rgba(255,190,90,0.35)';
  g.lineWidth = 5;
  g.setLineDash([26, 20]);
  g.beginPath();
  g.moveTo(0, 256);
  g.lineTo(512, 256);
  g.stroke();
  g.beginPath();
  g.moveTo(256, 0);
  g.lineTo(256, 512);
  g.stroke();
  g.setLineDash([]);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(9, 9);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function box(w, h, d, color, x, y, z, ry = 0) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.25 }),
  );
  mesh.position.set(x, y, z);
  mesh.rotation.y = ry;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Resolve a circle (x,z,r) against the AABB list; returns the corrected position. */
export function collideCircle(x, z, r, colliders) {
  let nx = x;
  let nz = z;
  for (const c of colliders) {
    const cx = Math.max(c.minX, Math.min(nx, c.maxX));
    const cz = Math.max(c.minZ, Math.min(nz, c.maxZ));
    const dx = nx - cx;
    const dz = nz - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      if (d2 > 1e-6) {
        const d = Math.sqrt(d2);
        nx = cx + (dx / d) * r;
        nz = cz + (dz / d) * r;
      } else {
        // centre inside the box: push out along the smallest penetration axis
        const pl = nx - c.minX;
        const pr = c.maxX - nx;
        const pt = nz - c.minZ;
        const pb = c.maxZ - nz;
        const m = Math.min(pl, pr, pt, pb);
        if (m === pl) nx = c.minX - r;
        else if (m === pr) nx = c.maxX + r;
        else if (m === pt) nz = c.minZ - r;
        else nz = c.maxZ + r;
      }
    }
  }
  const half = MAP.size / 2 - 1;
  nx = Math.max(-half, Math.min(half, nx));
  nz = Math.max(-half, Math.min(half, nz));
  return { x: nx, z: nz };
}

/** True when the segment (x1,z1)-(x2,z2) is blocked by any collider. */
export function segmentBlocked(x1, z1, x2, z2, colliders) {
  const dx = x2 - x1;
  const dz = z2 - z1;
  for (const c of colliders) {
    // slab test on the XZ segment
    let tmin = 0;
    let tmax = 1;
    let ok = true;
    for (const [o, d, mn, mx] of [
      [x1, dx, c.minX, c.maxX],
      [z1, dz, c.minZ, c.maxZ],
    ]) {
      if (Math.abs(d) < 1e-9) {
        if (o < mn || o > mx) {
          ok = false;
          break;
        }
      } else {
        let t1 = (mn - o) / d;
        let t2 = (mx - o) / d;
        if (t1 > t2) {
          const tmp = t1;
          t1 = t2;
          t2 = tmp;
        }
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) {
          ok = false;
          break;
        }
      }
    }
    if (ok) return true;
  }
  return false;
}

export function buildWorld(scene, seed = 1) {
  const rng = mulberry32(seed);
  const colliders = [];
  const obstacleMeshes = [];
  const group = new THREE.Group();
  scene.add(group);

  // ground
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(MAP.size + 60, MAP.size + 60),
    new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 0.95, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  // perimeter wall (low, keeps the eye inside the yard)
  const wallMat = new THREE.MeshStandardMaterial({ color: PALETTE.concrete, roughness: 0.9 });
  const half = MAP.size / 2;
  for (const [w, d, x, z] of [
    [MAP.size + 4, 1.2, 0, -half - 0.6],
    [MAP.size + 4, 1.2, 0, half + 0.6],
    [1.2, MAP.size + 4, -half - 0.6, 0],
    [1.2, MAP.size + 4, half + 0.6, 0],
  ]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 2.6, d), wallMat);
    wall.position.set(x, 1.3, z);
    wall.castShadow = true;
    wall.receiveShadow = true;
    group.add(wall);
    obstacleMeshes.push(wall);
    colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, height: 2.6 });
  }

  function addBox(w, h, d, color, x, z, ry = 0) {
    const mesh = box(w, h, d, color, x, h / 2, z, ry);
    group.add(mesh);
    obstacleMeshes.push(mesh);
    const cos = Math.cos(ry);
    const sin = Math.sin(ry);
    const hw = (Math.abs(w * cos) + Math.abs(d * sin)) / 2;
    const hd = (Math.abs(w * sin) + Math.abs(d * cos)) / 2;
    colliders.push({ minX: x - hw, maxX: x + hw, minZ: z - hd, maxZ: z + hd, height: h });
    return mesh;
  }

  const C = PALETTE;
  // container rows: two lanes of stacked boxes forming the yard's spine
  addBox(12, 2.6, 2.6, C.containerA, -32, -28);
  addBox(12, 2.6, 2.6, C.containerB, -32, -24.6);
  addBox(12, 2.6, 2.6, C.containerC, -18, -28, 0.12);
  addBox(6, 2.6, 2.6, C.containerD, -38, -14);
  addBox(12, 2.6, 2.6, C.containerB, 30, -30);
  addBox(12, 2.6, 2.6, C.containerA, 30, -26.6);
  addBox(12, 2.6, 2.6, C.containerD, 16, -30, -0.1);
  addBox(6, 2.6, 2.6, C.containerC, 40, -16);
  addBox(12, 2.6, 2.6, C.containerC, -30, 30);
  addBox(12, 2.6, 2.6, C.containerA, -30, 33.4);
  addBox(12, 2.6, 2.6, C.containerB, 32, 28);
  addBox(12, 2.6, 2.6, C.containerD, 32, 31.4);
  addBox(12, 2.6, 2.6, C.containerA, 4, 34, 0.08);
  // stacked pair for height play
  addBox(12, 2.6, 2.6, C.containerB, -8, -2);
  const upper = box(12, 2.6, 2.6, C.containerD, -8, 2.6 + 1.3, -2);
  group.add(upper);
  obstacleMeshes.push(upper);
  // concrete barriers: low cover dotted through the middle
  for (const [x, z, ry] of [
    [-14, 8, 0.4],
    [-4, 16, -0.3],
    [10, 6, 0.9],
    [18, -8, 0.2],
    [-20, -6, 1.1],
    [2, -16, 0],
    [-10, 40, 0.5],
    [22, 18, -0.6],
    [-42, 6, 0],
    [44, 2, 0.3],
  ]) {
    addBox(4.4, 1.15, 0.8, C.concrete, x, z, ry);
  }
  // crates: small cover, scattered
  for (const [x, z, s] of [
    [-24, 12, 1.6],
    [-22, 13.5, 1.2],
    [6, 24, 1.8],
    [8, 22, 1.2],
    [26, -12, 1.6],
    [-2, -34, 1.8],
    [36, 38, 1.5],
    [-44, -38, 1.7],
    [14, 42, 1.4],
    [42, -38, 1.6],
  ]) {
    addBox(s, s, s, C.crate, x, z, rng() * 0.8);
  }
  // watchtower at the centre-north: legs + platform (legs collide, platform is cover)
  const towerX = 0;
  const towerZ = -42;
  for (const [dx, dz] of [
    [-2.4, -2.4],
    [2.4, -2.4],
    [-2.4, 2.4],
    [2.4, 2.4],
  ]) {
    const leg = box(0.5, 7, 0.5, C.tower, towerX + dx, 3.5, towerZ + dz);
    group.add(leg);
    obstacleMeshes.push(leg);
  }
  const platform = box(6.4, 0.5, 6.4, C.tower, towerX, 7.2, towerZ);
  group.add(platform);
  obstacleMeshes.push(platform);
  colliders.push({ minX: towerX - 3.2, maxX: towerX + 3.2, minZ: towerZ - 3.2, maxZ: towerZ + 3.2, height: 7 });
  // wrecked hauler: cab + flatbed, south lane
  addBox(2.4, 2.2, 2.2, 0x3a3f45, -16, 22, 0.5);
  addBox(6, 1.0, 2.2, 0x3a3f45, -12.5, 20.4, 0.5);
  // pipes along the east edge: a proper stack, two on the ground, one on top
  {
    const pipeGeo = new THREE.CylinderGeometry(0.55, 0.55, 14, 10);
    const pipeMat = new THREE.MeshStandardMaterial({ color: C.pipe, roughness: 0.6, metalness: 0.6 });
    const pipeDefs = [
      [50, 0.55, -7.1],
      [50, 0.55, -4.9],
      [50, 1.62, -6.0],
    ];
    for (const [x, y, z] of pipeDefs) {
      const pipe = new THREE.Mesh(pipeGeo, pipeMat);
      pipe.rotation.z = Math.PI / 2;
      pipe.rotation.y = 0.35;
      pipe.position.set(x, y, z);
      pipe.castShadow = true;
      pipe.receiveShadow = true;
      group.add(pipe);
      obstacleMeshes.push(pipe);
    }
    colliders.push({ minX: 43, maxX: 57, minZ: -8.2, maxZ: -3.8, height: 2.2 });
  }

  // spawn points: eight, around the edges
  const spawnPoints = [
    [-52, -52],
    [52, -52],
    [-52, 52],
    [52, 52],
    [0, -54],
    [0, 54],
    [-54, 0],
    [54, 0],
  ];

  // loot spawns: weapons near cover, meds/armor/ammo spread out
  const lootSpawns = [];
  const weaponSpots = [
    [-26, -20, 'rifle'],
    [-36, -8, 'shotgun'],
    [24, -20, 'rifle'],
    [36, -10, 'marksman'],
    [-24, 24, 'shotgun'],
    [26, 22, 'rifle'],
    [-8, 12, 'marksman'],
    [12, -12, 'rifle'],
    [-44, 40, 'rifle'],
    [44, 40, 'shotgun'],
    [0, 44, 'marksman'],
    [-2, -44, 'rifle'],
  ];
  for (const [x, z, kind] of weaponSpots) lootSpawns.push({ x, z, kind });
  const supportSpots = [
    [-18, 2, 'medkit'],
    [6, 14, 'medkit'],
    [-38, -20, 'armor'],
    [20, -24, 'armor'],
    [34, 12, 'medkit'],
    [-12, -36, 'armor'],
    [40, 26, 'armor'],
    [-30, 44, 'medkit'],
    [8, -28, 'medkit'],
    [-46, 18, 'armor'],
  ];
  for (const [x, z, kind] of supportSpots) lootSpawns.push({ x, z, kind });
  const ammoSpots = [
    [-28, -32, 'ammo-light'],
    [28, -34, 'ammo-light'],
    [-14, 20, 'ammo-shell'],
    [16, 10, 'ammo-long'],
    [44, -24, 'ammo-light'],
    [-40, 28, 'ammo-shell'],
    [2, 30, 'ammo-light'],
    [-6, -8, 'ammo-long'],
    [38, 34, 'ammo-light'],
    [-34, 2, 'ammo-shell'],
    [20, 44, 'ammo-long'],
    [-48, -44, 'ammo-light'],
  ];
  for (const [x, z, kind] of ammoSpots) lootSpawns.push({ x, z, kind });

  return { group, colliders, obstacleMeshes, spawnPoints, lootSpawns };
}

/** The shrinking-zone wall: a translucent cylinder + a ground ring, repositioned per frame. */
export function makeZoneVisual(scene) {
  const wallMat = new THREE.MeshBasicMaterial({
    color: PALETTE.zone,
    transparent: true,
    opacity: 0.2,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 16, 48, 1, true), wallMat);
  wall.position.y = 8;
  scene.add(wall);
  const ringMat = new THREE.MeshBasicMaterial({ color: PALETTE.zone, transparent: true, opacity: 0.55 });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 64), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.06;
  scene.add(ring);
  return {
    update(cx, cz, radius) {
      wall.position.x = cx;
      wall.position.z = cz;
      wall.scale.set(radius, 1, radius);
      ring.position.x = cx;
      ring.position.z = cz;
      ring.scale.set(radius, radius, 1);
    },
  };
}
