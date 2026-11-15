// EMBERLINE — main: renderer, lights, the frame loop, screens and quality.
// The loop runs the match in fixed 1/60s steps; the DOM HUD is updated from the
// match state each frame. ?shot= stages a screenshot scene; ?selftest=1 runs the
// scripted end-to-end test and writes its verdict into the page.
import * as THREE from 'three';
import { Match } from './game.js';
import { input, bindInput, requestLock, releaseLock, wasPressed, endFrame } from './input.js';
import { audio } from './audio.js';
import { initHud, updateHud, showEndScreen, showMenu } from './hud.js';
import { stageShot } from './shots.js';
import { runSelfTest } from './selftest.js';
import { STEP, PLAYER } from './config.js';

const params = new URLSearchParams(window.location.search);
const seed = Number(params.get('seed') || 7) || 7;
const shotName = params.get('shot');
const selftest = params.get('selftest') === '1';

const container = document.getElementById('game');
const canvasHolder = container;
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: Boolean(shotName || selftest) });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoft was removed in three 0.187
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
canvasHolder.appendChild(renderer.domElement);
const canvas = renderer.domElement;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a3542);
scene.fog = new THREE.Fog(0x8a6f5c, 45, 170);
// dusk sky dome: deep blue overhead, ember band at the horizon
{
  const skyCanvas = document.createElement('canvas');
  skyCanvas.width = 4;
  skyCanvas.height = 256;
  const sg = skyCanvas.getContext('2d');
  const grad = sg.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#141c28');
  grad.addColorStop(0.45, '#3a3a42');
  grad.addColorStop(0.58, '#8a5a38');
  grad.addColorStop(0.68, '#c97a3a');
  grad.addColorStop(1, '#2a1e16');
  sg.fillStyle = grad;
  sg.fillRect(0, 0, 4, 256);
  const skyTex = new THREE.CanvasTexture(skyCanvas);
  skyTex.colorSpace = THREE.SRGBColorSpace;
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(320, 24, 16),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false }),
  );
  scene.add(sky);
}

const hemi = new THREE.HemisphereLight(0xffd9a0, 0x3a2f28, 1.0);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffb36b, 2.2);
sun.position.set(45, 70, -25);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -75;
sun.shadow.camera.right = 75;
sun.shadow.camera.top = 75;
sun.shadow.camera.bottom = -75;
sun.shadow.camera.far = 220;
sun.shadow.bias = -0.0006;
scene.add(sun);
// cool fill from the west so shadowed faces never go black at eye level
const fill = new THREE.DirectionalLight(0x9fb8d8, 0.55);
fill.position.set(-40, 30, 25);
scene.add(fill);
// warm ambient lift: no face in the yard is ever pitch black
scene.add(new THREE.AmbientLight(0xffe0b8, 0.35));

const camera = new THREE.PerspectiveCamera(PLAYER.hipFov, window.innerWidth / window.innerHeight, 0.1, 400);
camera.rotation.order = 'YXZ';

const match = new Match(scene, seed);
match.camera = camera;

initHud();
bindInput(canvas);

window.addEventListener('error', (event) => {
  const el = document.getElementById('errors');
  if (el) el.textContent += `${event.message}\n`;
});
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---- quality: High / Auto / Low, like the DUSTLINE revision ----
const quality = {
  mode: window.localStorage.getItem('emberline-quality') || 'auto',
  level: 0, // 0 high, 1 medium, 2 low
  fpsWindow: [],
  toastAt: -99,
};
if (params.get('lowfx') === '1') quality.mode = 'low';
function applyQuality() {
  const low = quality.mode === 'low' || (quality.mode === 'auto' && quality.level === 2);
  const medium = quality.mode === 'auto' && quality.level === 1;
  renderer.setPixelRatio(low ? 1 : medium ? 1.25 : Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.shadowMap.enabled = !low;
  sun.castShadow = !low;
  if (!low) sun.shadow.mapSize.set(medium ? 1024 : 2048, medium ? 1024 : 2048);
  if (sun.shadow.map) {
    sun.shadow.map.dispose();
    sun.shadow.map = null;
  }
}
function setQuality(mode, silent = false) {
  quality.mode = mode;
  quality.level = 0;
  try {
    window.localStorage.setItem('emberline-quality', mode);
  } catch {
    /* ignore */
  }
  document.querySelectorAll('[data-quality]').forEach((b) => b.classList.toggle('active', b.dataset.quality === mode));
  applyQuality();
  if (!silent && match.phase === 'playing') showToastOnce(`Quality: ${mode}`);
}
let toastShownAt = -99;
function showToastOnce(text) {
  if (match.time - toastShownAt < 3) return;
  toastShownAt = match.time;
  match.toast(text);
}
document.querySelectorAll('[data-quality]').forEach((b) => {
  b.addEventListener('click', () => setQuality(b.dataset.quality));
});
setQuality(quality.mode, true);

// ---- muzzle flash: a quick additive sprite at the gun ----
const flashCanvas = document.createElement('canvas');
flashCanvas.width = 64;
flashCanvas.height = 64;
{
  const g = flashCanvas.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,240,180,1)');
  grad.addColorStop(0.4, 'rgba(255,180,80,0.7)');
  grad.addColorStop(1, 'rgba(255,120,40,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
}
const flashTex = new THREE.CanvasTexture(flashCanvas);
const flashMat = new THREE.SpriteMaterial({ map: flashTex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
const flash = new THREE.Sprite(flashMat);
flash.scale.set(0.55, 0.55, 1);
flash.position.set(0.28, -0.24, -0.9);
camera.add(flash);
scene.add(camera);

// ---- screens ----
const overlay = document.getElementById('overlay');
const playBtn = document.getElementById('play');
let endAtMs = -99;

function startMatch() {
  audio.unlock();
  audio.click();
  match.start();
  overlay.hidden = true;
  endAtMs = -99;
  requestLock(canvas);
}

playBtn.addEventListener('click', () => {
  if (match.phase === 'menu' || match.phase === 'dead' || match.phase === 'victory' || match.phase === 'paused') {
    startMatch();
  }
});

function pauseGame() {
  if (match.phase !== 'playing') return;
  match.phase = 'paused';
  releaseLock();
  document.getElementById('overlay-title').innerHTML = 'PAUSED';
  document.getElementById('overlay-copy').innerHTML = 'The Reach waits. Click to keep fighting.';
  document.getElementById('end-stats').hidden = true;
  playBtn.textContent = 'Resume';
  overlay.hidden = false;
}

function resumeGame() {
  if (match.phase !== 'paused') return;
  match.phase = 'playing';
  overlay.hidden = true;
  requestLock(canvas);
}

document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && match.phase === 'playing' && !selftest && !shotName) {
    pauseGame();
  }
});

// ---- frame loop ----
let last = performance.now();
let acc = 0;
let fpsFrames = 0;
let fpsTime = 0;

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  // menu keys
  if (wasPressed('m') || wasPressed('M')) audio.toggleMute();
  if ((wasPressed('p') || wasPressed('P')) && !shotName && !selftest) {
    if (match.phase === 'playing') pauseGame();
    else if (match.phase === 'paused') resumeGame();
  }

  if (match.phase === 'playing') {
    // look once per frame, then fixed steps
    const p = match.player;
    if (p && p.alive) {
      const sens = input.ads ? 0.0013 : 0.0023;
      p.yaw -= input.lookDX * sens;
      p.pitch = Math.max(-1.5, Math.min(1.5, p.pitch - input.lookDY * sens));
      input.lookDX = 0;
      input.lookDY = 0;
    }
    acc += dt;
    let steps = 0;
    while (acc >= STEP && steps < 5) {
      match.update(STEP, now / 1000);
      acc -= STEP;
      steps += 1;
      if (match.phase !== 'playing') break;
    }
    if (steps === 5) acc = 0;
    match.updateCamera();
    // muzzle flash
    const sinceShot = match.time - match.muzzleAt;
    flashMat.opacity = sinceShot < 0.05 ? 0.95 : 0;
    updateHud(match, match.time);
    // end screens, once, shortly after the moment lands
    if ((match.phase === 'dead' || match.phase === 'victory') && endAtMs < 0) {
      endAtMs = now;
    }
    if (endAtMs >= 0 && now - endAtMs > 900 && overlay.hidden) {
      showEndScreen(match.phase === 'victory', match);
      releaseLock();
    }
  } else if (match.phase === 'dead' || match.phase === 'victory') {
    match.updateCamera();
    if (endAtMs < 0) endAtMs = now;
    if (now - endAtMs > 900 && overlay.hidden) {
      showEndScreen(match.phase === 'victory', match);
      releaseLock();
    }
  }

  // auto quality: measure FPS over 2.5s windows while playing
  if (quality.mode === 'auto' && match.phase === 'playing') {
    fpsFrames += 1;
    fpsTime += dt;
    if (fpsTime >= 2.5) {
      const fps = fpsFrames / fpsTime;
      fpsFrames = 0;
      fpsTime = 0;
      if (fps < 45 && quality.level < 2) {
        quality.level += 1;
        applyQuality();
        showToastOnce(quality.level === 1 ? 'Quality lowered to keep it smooth' : 'Quality lowered to Low');
      }
    }
  }

  renderer.render(scene, camera);
  endFrame();
  requestAnimationFrame(frame);
}

if (selftest) {
  const box = document.getElementById('selftest');
  const m2 = new Match(scene, seed);
  m2.camera = camera;
  runSelfTest(m2, camera, renderer, (result) => {
    document.title = result.pass ? 'SELFTEST PASS' : 'SELFTEST FAIL';
    if (box) {
      box.style.display = 'block';
      box.textContent = JSON.stringify(result, null, 1);
    }
  });
  renderer.render(scene, camera);
} else if (shotName) {
  // Screenshot mode: stage once, render once, stay still — the capture takes
  // the staged frame, not a game that has run on past it.
  const staged = stageShot(shotName, match, camera, renderer);
  match.phase = staged.phase;
  const overlayEl = document.getElementById('overlay');
  const hudEl = document.getElementById('hud');
  if (staged.phase === 'menu') {
    // title shot: the yard shows through a lighter veil, HUD hidden
    hudEl.style.display = 'none';
    overlayEl.style.background = 'rgba(8,12,15,0.42)';
  } else {
    overlayEl.hidden = true;
    if (staged.win !== null) {
      showEndScreen(staged.win, match);
      overlayEl.style.background = 'rgba(8,12,15,0.55)';
    }
    updateHud(match, match.time);
    match.updateCamera();
    renderer.render(scene, camera);
  }
  // Keep re-presenting the staged frame: a resize during load reallocates the
  // canvas and clears the buffer, and a single render can be lost that way.
  // The match does not advance here — this loop only re-renders the same view.
  (function shotLoop() {
    match.updateCamera();
    renderer.render(scene, camera);
    requestAnimationFrame(shotLoop);
  })();
} else {
  showMenu();
  // idle menu backdrop: a slow orbit over the yard
  const menuCam = { t: 0 };
  const origFrame = frame;
  camera.position.set(40, 26, 40);
  camera.lookAt(0, 0, 0);
  requestAnimationFrame(function menuLoop(now) {
    if (match.phase !== 'menu') {
      requestAnimationFrame(origFrame);
      return;
    }
    menuCam.t += 0.0004;
    camera.position.set(Math.sin(menuCam.t) * 46, 24 + Math.sin(menuCam.t * 0.7) * 4, Math.cos(menuCam.t) * 46);
    camera.lookAt(0, 1, 0);
    renderer.render(scene, camera);
    requestAnimationFrame(menuLoop);
  });
}
