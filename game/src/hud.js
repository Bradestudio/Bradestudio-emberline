// EMBERLINE — hud: the DOM overlay. Cached reads, throttled minimap, one place
// for every number the player sees, so the 3D loop never touches the DOM itself.
import { MAP } from './config.js';
import { input } from './input.js';
import { nextRankBonus } from './ranks.js';

const $ = (id) => document.getElementById(id);

const els = {};
let last = {};
let minimapAt = 0;
let toastAt = -99;
let hitAt = -99;
const dmgEls = new Map();

export function initHud() {
  for (const id of [
    'health-num', 'health-fill', 'armor-fill', 'ammo-mag', 'ammo-reserve', 'weapon-name',
    'weapon-slots', 'alive-num', 'zone-timer', 'zone-label', 'zone-hint', 'killfeed',
    'banner', 'banner-title', 'banner-sub', 'toast', 'prompt', 'crosshair', 'hitmarker',
    'damage-vignette', 'zone-vignette', 'minimap', 'ammo', 'overlay', 'overlay-title',
    'overlay-copy', 'end-stats', 'play', 'ember-rank', 'dmgnums', 'best-place',
  ]) {
    els[id] = $(id);
  }
}

function setText(el, value) {
  if (last[el.id] !== value) {
    last[el.id] = value;
    el.textContent = value;
  }
}

function fmtTime(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function showBanner(title, sub, now) {
  setText(els['banner-title'], title);
  setText(els['banner-sub'], sub);
  els.banner.classList.add('on');
  els.banner.dataset.at = String(now);
}

export function showToast(text, now) {
  setText(els.toast, text);
  els.toast.classList.add('on');
  toastAt = now;
}

export function updateHud(match, now) {
  const p = match.player;
  if (!p) return;
  const w = p.weapons[p.current];
  setText(els['health-num'], String(Math.ceil(p.health)));
  els['health-fill'].style.width = `${Math.max(0, p.health)}%`;
  els['health-fill'].classList.toggle('low', p.health <= 30);
  els['armor-fill'].style.width = `${Math.max(0, p.armor)}%`;
  setText(els['ammo-mag'], String(w ? w.mag : 0));
  setText(els['ammo-reserve'], `/ ${w ? w.reserve : 0}`);
  setText(els['weapon-name'], w ? w.def.name : '—');
  els.ammo.classList.toggle('empty', !w || w.mag === 0);
  const slots = p.slots.map((id, i) => (id === p.current ? `<b>[${i + 1}] ${p.weapons[id].def.name}</b>` : `[${i + 1}] ${p.weapons[id].def.name}`)).join('  ');
  if (last.slots !== slots) {
    last.slots = slots;
    els['weapon-slots'].innerHTML = slots;
  }
  setText(els['alive-num'], String(match.aliveCount()));

  // ember rank: current rank + the bonus the next rank grants
  if (els['ember-rank']) {
    const rank = p.emberRank || 0;
    const next = nextRankBonus(rank);
    setText(els['ember-rank'], rank > 0 ? `★ EMBER RANK ${rank} · NEXT: ${next.label}` : `EMBER RANK 0 · NEXT: ${next.label}`);
  }

  // floating damage numbers: project each recent hit to screen space
  renderDamageNumbers(match, now);

  // zone timer + label
  const z = match.zone;
  if (z) {
    if (z.state === 'wait') {
      setText(els['zone-timer'], fmtTime(z.timer));
      setText(els['zone-label'], 'ZONE SHRINKS');
      els['zone-timer'].className = z.timer <= 5 ? 'urgent' : '';
    } else if (z.state === 'shrink') {
      setText(els['zone-timer'], fmtTime(z.timer));
      setText(els['zone-label'], 'ASHFALL CLOSING');
      els['zone-timer'].className = 'shrinking';
    } else {
      setText(els['zone-timer'], '—');
      setText(els['zone-label'], 'FINAL ZONE');
      els['zone-timer'].className = '';
    }
    const zd = Math.hypot(p.pos.x - z.cx, p.pos.z - z.cz);
    els['zone-hint'].hidden = zd <= z.radius;
    els['zone-vignette'].classList.toggle('on', zd > z.radius);
  }

  // crosshair spread from the current weapon
  const spread = w ? 4 + w.recoil * 260 : 4;
  els.crosshair.style.setProperty('--gap', `${Math.min(14, spread).toFixed(1)}px`);
  els.crosshair.classList.toggle('ads', input.ads);

  // hitmarker: 140ms after a hit lands
  if (match.lastHitAt > hitAt) {
    hitAt = match.lastHitAt;
    els.hitmarker.classList.add('on');
    els.hitmarker.classList.toggle('kill', match.lastHitKill);
    els.hitmarker.dataset.at = String(now);
  }
  if (now - Number(els.hitmarker.dataset.at || -99) > 0.14) els.hitmarker.classList.remove('on');

  // damage vignette
  els['damage-vignette'].classList.toggle('on', match.playerHitFlash > 0.35);

  // banner: show 3s
  if (match.banners.length > 0) {
    const b = match.banners[match.banners.length - 1];
    if (now - b.at < 3) showBanner(b.title, b.sub, now);
    else els.banner.classList.remove('on');
  }
  // toast: show 2.2s
  if (match.lastToast && now - match.lastToast.at < 2.2) {
    showToast(match.lastToast.text, now);
  } else if (now - toastAt > 2.2) {
    els.toast.classList.remove('on');
  }

  // killfeed (kills + rank-up / drop notes)
  const feedHtml = match.feed.slice(-5).map((f) => {
    if (f.note) return `<div class="feed-line note">${f.note}</div>`;
    const k = f.killer === 'You' ? '<b class="you">You</b>' : `<b>${f.killer}</b>`;
    const v = f.victim === 'You' ? '<b class="you">You</b>' : `<b>${f.victim}</b>`;
    const wname = f.weaponName ? ` <span style="color:#93a8ad">[${f.weaponName}]</span>` : '';
    return `<div class="feed-line">${k} ▸ ${v}${wname}</div>`;
  }).join('');
  if (last.feed !== feedHtml) {
    last.feed = feedHtml;
    els.killfeed.innerHTML = feedHtml;
  }

  // minimap at 10 Hz
  if (now - minimapAt > 0.1) {
    minimapAt = now;
    drawMinimap(match);
  }
}

function renderDamageNumbers(match, now) {
  const box = els.dmgnums;
  if (!box || !match.camera) return;
  const seen = new Set();
  for (const d of match.damageNumbers) {
    seen.add(d.id);
    let el = dmgEls.get(d.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'dmgnum';
      box.appendChild(el);
      dmgEls.set(d.id, el);
    }
    el.textContent = `-${d.amount}`;
    const age = now - d.at;
    el.style.opacity = String(Math.max(0, 1 - age / 0.9));
    el.dataset.x = String(d.x);
    el.dataset.y = String(d.y);
    el.dataset.z = String(d.z);
    el.dataset.age = String(age);
  }
  for (const [id, el] of [...dmgEls]) {
    if (!seen.has(id)) {
      el.remove();
      dmgEls.delete(id);
    }
  }
  // position each number from its stored world coords
  positionDamageNumbers(match);
}

function positionDamageNumbers(match) {
  if (!match.camera) return;
  const cam = match.camera;
  const w = window.innerWidth;
  const h = window.innerHeight;
  for (const [id, el] of dmgEls) {
    const x = Number(el.dataset.x || 0);
    const y = Number(el.dataset.y || 0);
    const z = Number(el.dataset.z || 0);
    const age = Number(el.dataset.age || 0);
    // forward vector from yaw/pitch (camera rotation order YXZ)
    const cy = Math.cos(cam.rotation.y);
    const sy = Math.sin(cam.rotation.y);
    const cp = Math.cos(cam.rotation.x);
    const sp = Math.sin(cam.rotation.x);
    const fx = -sy * cp;
    const fy = sp;
    const fz = -cy * cp;
    const rx = cy;
    const rz = -sy;
    const dx = x - cam.position.x;
    const dy = y - cam.position.y;
    const dz = z - cam.position.z;
    const depth = dx * fx + dy * fy + dz * fz;
    if (depth < 0.5) {
      el.style.display = 'none';
      continue;
    }
    el.style.display = 'block';
    const right = dx * rx + dz * rz;
    // camera up for rotation order YXZ: (sin(pitch)*sin(yaw), cos(pitch), sin(pitch)*cos(yaw))
    const up = dx * sp * sy + dy * cp + dz * sp * cy;
    const f = (h / 2) / Math.tan((cam.fov * Math.PI / 180) / 2);
    const sx = w / 2 + (right / depth) * f;
    const sy2 = h / 2 - (up / depth) * f - age * 60;
    el.style.left = `${sx.toFixed(1)}px`;
    el.style.top = `${sy2.toFixed(1)}px`;
  }
}

function drawMinimap(match) {
  const canvas = els.minimap;
  const g = canvas.getContext('2d');
  const S = canvas.width;
  const scale = S / (MAP.size + 16);
  const toX = (x) => (x + MAP.size / 2 + 8) * scale;
  const toZ = (z) => (z + MAP.size / 2 + 8) * scale;
  g.clearRect(0, 0, S, S);
  g.fillStyle = '#0e1518';
  g.fillRect(0, 0, S, S);
  // cover blocks
  g.fillStyle = '#3a4a52';
  for (const c of match.world.colliders) {
    if (c.height < 1) continue;
    g.fillRect(toX(c.minX), toZ(c.minZ), (c.maxX - c.minX) * scale, (c.maxZ - c.minZ) * scale);
  }
  // zone
  const z = match.zone;
  if (z) {
    g.fillStyle = 'rgba(255,122,47,0.16)';
    g.beginPath();
    g.arc(toX(z.cx), toZ(z.cz), z.radius * scale, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#ff7a2f';
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(toX(z.cx), toZ(z.cz), z.radius * scale, 0, Math.PI * 2);
    g.stroke();
    if (z.state === 'wait' && z.phase < 5) {
      const next = [46, 32, 20, 11, 5][z.phase];
      g.strokeStyle = 'rgba(255,255,255,0.7)';
      g.setLineDash([4, 4]);
      g.beginPath();
      g.arc(toX(z.cx), toZ(z.cz), next * scale, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
    }
  }
  // loot dots (supply drops read orange)
  for (const item of match.loot) {
    if (item.taken) continue;
    g.fillStyle = item.kind === 'supply' ? '#ffb703' : '#39d0c4';
    g.fillRect(toX(item.x) - 1, toZ(item.z) - 1, item.kind === 'supply' ? 4 : 2, item.kind === 'supply' ? 4 : 2);
  }
  // player arrow
  const p = match.player;
  if (p) {
    g.save();
    g.translate(toX(p.pos.x), toZ(p.pos.z));
    g.rotate(Math.atan2(Math.sin(p.yaw), Math.cos(p.yaw)) + Math.PI);
    g.fillStyle = '#39d0c4';
    g.beginPath();
    g.moveTo(0, -6);
    g.lineTo(4.5, 5);
    g.lineTo(-4.5, 5);
    g.closePath();
    g.fill();
    g.restore();
  }
}

function bestPlacement() {
  try {
    const v = Number(window.localStorage.getItem('emberline-best-placement') || 0);
    return v > 0 ? v : null;
  } catch {
    return null;
  }
}

function recordPlacement(place) {
  try {
    const best = bestPlacement();
    if (best === null || place < best) window.localStorage.setItem('emberline-best-placement', String(place));
  } catch {
    /* ignore */
  }
}

export function showEndScreen(win, match) {
  const p = match.player;
  const place = win ? 1 : match.placement;
  recordPlacement(place);
  const s = p.stats || { shots: 0, hits: 0, damage: 0 };
  const acc = s.shots > 0 ? Math.round((s.hits / s.shots) * 100) : 0;
  const survived = `${Math.floor(match.time / 60)}:${String(Math.floor(match.time % 60)).padStart(2, '0')}`;
  els['overlay-title'].innerHTML = win ? 'LAST DRIFTER <span class="ember">STANDING</span>' : 'SIGNAL LOST';
  els['overlay-copy'].innerHTML = win
    ? 'The ashfall takes the rest. The Reach is yours, Drifter.'
    : `You placed <b>#${place}</b> of 8. The Reach keeps what it takes.`;
  els['end-stats'].hidden = false;
  els['end-stats'].innerHTML =
    `KILLS <b>${p.kills}</b><br>` +
    `DAMAGE DEALT <b>${Math.round(s.damage).toLocaleString('en-US')}</b><br>` +
    `SHOTS <b>${s.shots}</b> &nbsp;·&nbsp; HITS <b>${s.hits}</b> &nbsp;·&nbsp; ACCURACY <b>${acc}%</b><br>` +
    `SURVIVED <b>${survived}</b> &nbsp;·&nbsp; PLACEMENT <b>#${place}</b> of 8<br>` +
    `EMBER RANK <b>${p.emberRank || 0}</b> &nbsp;·&nbsp; SCORE <b>${(p.kills * 100 + (win ? 500 : 0)).toLocaleString('en-US')}</b>`;
  els.play.textContent = 'Play again';
  els.overlay.hidden = false;
}

export function showMenu() {
  els['overlay-title'].innerHTML = 'EMBERLINE';
  els['overlay-copy'].innerHTML =
    'Eight drifters drop into the <b>Ashen Reach</b>. The ashfall closes in — loot fast, fight smart, be the <b>last drifter standing</b>. Click to play.';
  els['end-stats'].hidden = true;
  els.play.textContent = 'Click to play';
  els.overlay.hidden = false;
  if (els['best-place']) {
    const best = bestPlacement();
    els['best-place'].textContent = best ? `Best placement: #${best} of 8` : 'No matches played yet — good luck, Drifter.';
  }
}
