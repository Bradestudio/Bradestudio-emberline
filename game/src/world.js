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
  // scorch marks: dark radial burns where the yard caught fire
  for (let i = 0; i < 14; i += 1) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const r = 12 + Math.random() * 30;
    const grad = g.createRadialGradient(x, y, 2, x, y, r);
    grad.addColorStop(0, 'rgba(18,12,8,0.55)');
    grad.addColorStop(1, 'rgba(18,12,8,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  // tire tracks: paired dark arcs from haulers crossing the yard
  g.strokeStyle = 'rgba(30,24,18,0.4)';
  g.lineWidth = 4;
  for (let i = 0; i < 7; i += 1) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const r = 60 + Math.random() * 120;
    const a0 = Math.random() * Math.PI * 2;
    for (const off of [-4, 4]) {
      g.beginPath();
      g.arc(x, y, r + off, a0, a0 + 0.9 + Math.random() * 0.8);
      g.stroke();
    }
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
  // more container stacks: extra colour variety, extra lanes
  addBox(12, 2.6, 2.6, C.containerE, -46, 14, 0.15);
  addBox(12, 2.6, 2.6, C.containerF, 46, -26, -0.12);
  addBox(6, 2.6, 2.6, C.containerE, 8, -40, 0.2);
  addBox(12, 2.6, 2.6, C.containerF, -4, 46, -0.08);
  addBox(6, 2.6, 2.6, C.containerB, 44, 14, 0.3);
  const upper2 = box(6, 2.6, 2.6, C.containerA, 44, 2.6 + 1.3, 14);
  upper2.rotation.y = 0.3;
  group.add(upper2);
  obstacleMeshes.push(upper2);
  // barrel clusters: low round cover, scattered near the lanes
  {
    const barrelGeo = new THREE.CylinderGeometry(0.45, 0.45, 1.1, 10);
    const barrelCols = [0x8a2f2f, 0x2a6e7a, 0x9a6a2a, 0x5a5a5a];
    for (const [bx, bz] of [
      [-20, 18], [-19, 19.2], [12, -22], [13.2, -21], [-36, 36],
      [38, -2], [38.9, -1], [-8, 28], [24, 36], [-48, -20],
    ]) {
      const mat = new THREE.MeshStandardMaterial({ color: barrelCols[Math.floor(rng() * barrelCols.length)], roughness: 0.7, metalness: 0.4 });
      const barrel = new THREE.Mesh(barrelGeo, mat);
      barrel.position.set(bx, 0.55, bz);
      barrel.castShadow = true;
      group.add(barrel);
      obstacleMeshes.push(barrel);
      colliders.push({ minX: bx - 0.45, maxX: bx + 0.45, minZ: bz - 0.45, maxZ: bz + 0.45, height: 1.1 });
    }
  }
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
  // second watchtower, south-east, mirroring the north one
  const tower2X = 46;
  const tower2Z = 44;
  for (const [dx, dz] of [
    [-2.4, -2.4],
    [2.4, -2.4],
    [-2.4, 2.4],
    [2.4, 2.4],
  ]) {
    const leg = box(0.5, 7, 0.5, C.tower, tower2X + dx, 3.5, tower2Z + dz);
    group.add(leg);
    obstacleMeshes.push(leg);
  }
  const platform2 = box(6.4, 0.5, 6.4, C.tower, tower2X, 7.2, tower2Z);
  group.add(platform2);
  obstacleMeshes.push(platform2);
  colliders.push({ minX: tower2X - 3.2, maxX: tower2X + 3.2, minZ: tower2Z - 3.2, maxZ: tower2Z + 3.2, height: 7 });
  // gantry crane, north-west corner: mast, jib over the yard, counter-jib,
  // hanging cable and hook block — the yard's tallest silhouette
  {
    const craneMat = new THREE.MeshStandardMaterial({ color: 0xb5502a, roughness: 0.7, metalness: 0.4 });
    const craneDark = new THREE.MeshStandardMaterial({ color: 0x3a4048, roughness: 0.8 });
    const mast = new THREE.Mesh(new THREE.BoxGeometry(1.8, 18, 1.8), craneMat);
    mast.position.set(-44, 9, -40);
    mast.castShadow = true;
    group.add(mast);
    obstacleMeshes.push(mast);
    colliders.push({ minX: -44.9, maxX: -43.1, minZ: -40.9, maxZ: -39.1, height: 18 });
    const jib = new THREE.Mesh(new THREE.BoxGeometry(26, 1, 1), craneDark);
    jib.position.set(-31, 18, -40);
    jib.castShadow = true;
    group.add(jib);
    obstacleMeshes.push(jib);
    const counterJib = new THREE.Mesh(new THREE.BoxGeometry(8, 1, 1), craneDark);
    counterJib.position.set(-48.5, 18, -40);
    group.add(counterJib);
    obstacleMeshes.push(counterJib);
    const counterweight = new THREE.Mesh(new THREE.BoxGeometry(2, 2.4, 1.6), craneMat);
    counterweight.position.set(-51.5, 16.6, -40);
    group.add(counterweight);
    obstacleMeshes.push(counterweight);
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 7, 6), craneDark);
    cable.position.set(-20, 14.5, -40);
    group.add(cable);
    const hook = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.6), craneMat);
    hook.position.set(-20, 10.6, -40);
    hook.castShadow = true;
    group.add(hook);
    obstacleMeshes.push(hook);
  }
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
  // outer glow shell: a second, fainter cylinder that makes the wall read
  // as a band of fire rather than a single sheet
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0xff4d00,
    transparent: true,
    opacity: 0.08,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const glow = new THREE.Mesh(new THREE.CylinderGeometry(1.03, 1.03, 16, 48, 1, true), glowMat);
  glow.position.y = 8;
  scene.add(glow);
  const ringMat = new THREE.MeshBasicMaterial({ color: PALETTE.zone, transparent: true, opacity: 0.55 });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 64), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.06;
  scene.add(ring);
  return {
    update(cx, cz, radius, time = 0) {
      const pulse = 0.5 + 0.5 * Math.sin(time * 3);
      wallMat.opacity = 0.16 + 0.1 * pulse;
      glowMat.opacity = 0.05 + 0.07 * pulse;
      ringMat.opacity = 0.45 + 0.25 * pulse;
      wall.position.x = cx;
      wall.position.z = cz;
      wall.scale.set(radius, 1, radius);
      glow.position.x = cx;
      glow.position.z = cz;
      glow.scale.set(radius, 1, radius);
      ring.position.x = cx;
      ring.position.z = cz;
      ring.scale.set(radius, radius, 1);
    },
  };
}

/**
 * Ashfall: drifting ember motes across the yard (one THREE.Points cloud) plus
 * a denser ring of motes hugging the zone wall, re-seated every frame.
 */
export function makeAshfall(scene) {
  const COUNT = 500;
  const positions = new Float32Array(COUNT * 3);
  const speeds = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i += 1) {
    positions[i * 3] = (Math.random() - 0.5) * 130;
    positions[i * 3 + 1] = Math.random() * 22;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 130;
    speeds[i] = 0.4 + Math.random() * 0.9;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xffa050,
    size: 0.32,
    transparent: true,
    opacity: 0.75,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  scene.add(points);

  const WALL_COUNT = 220;
  const wallPos = new Float32Array(WALL_COUNT * 3);
  const wallAngle = new Float32Array(WALL_COUNT);
  const wallH = new Float32Array(WALL_COUNT);
  for (let i = 0; i < WALL_COUNT; i += 1) {
    wallAngle[i] = Math.random() * Math.PI * 2;
    wallH[i] = Math.random() * 14;
  }
  const wallGeo = new THREE.BufferGeometry();
  wallGeo.setAttribute('position', new THREE.BufferAttribute(wallPos, 3));
  const wallMat = new THREE.PointsMaterial({
    color: 0xff7a2f,
    size: 0.45,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const wallPoints = new THREE.Points(wallGeo, wallMat);
  scene.add(wallPoints);

  return {
    points,
    wallPoints,
    count: COUNT + WALL_COUNT,
    update(dt, time, zone) {
      const arr = geo.attributes.position.array;
      for (let i = 0; i < COUNT; i += 1) {
        arr[i * 3 + 1] -= speeds[i] * dt;
        arr[i * 3] += Math.sin(time * 0.7 + i) * dt * 0.6;
        if (arr[i * 3 + 1] < 0) {
          arr[i * 3 + 1] = 20 + Math.random() * 2;
          arr[i * 3] = (Math.random() - 0.5) * 130;
          arr[i * 3 + 2] = (Math.random() - 0.5) * 130;
        }
      }
      geo.attributes.position.needsUpdate = true;
      if (zone) {
        const warr = wallGeo.attributes.position.array;
        for (let i = 0; i < WALL_COUNT; i += 1) {
          const a = wallAngle[i] + time * 0.05;
          const r = zone.radius + (Math.random() - 0.5) * 3;
          warr[i * 3] = zone.cx + Math.cos(a) * r;
          warr[i * 3 + 1] = wallH[i] + Math.sin(time * 0.9 + i) * 0.5;
          warr[i * 3 + 2] = zone.cz + Math.sin(a) * r;
        }
        wallGeo.attributes.position.needsUpdate = true;
      }
    },
  };
}
