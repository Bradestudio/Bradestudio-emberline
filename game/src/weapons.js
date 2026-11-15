// EMBERLINE — weapons: four original guns, each with its own feel.
// A weapon is a definition plus a runtime state (magazine, reserve, cooldown,
// recoil that blooms with fire and recovers when the trigger lifts).
export const WEAPONS = {
  pistol: {
    id: 'pistol',
    name: 'P8 Sidekick',
    kind: 'pistol',
    ammo: 'light',
    damage: 22,
    headMult: 1.8,
    magSize: 12,
    reserveStart: 48,
    reserveMax: 120,
    fireInterval: 0.16,
    auto: false,
    pellets: 1,
    spreadHip: 0.011,
    spreadAds: 0.004,
    recoil: 0.011,
    recoilMax: 0.05,
    recovery: 0.14,
    reloadTime: 1.1,
    range: 60,
    zoom: 1.25,
    movePenalty: 0,
  },
  rifle: {
    id: 'rifle',
    name: 'VK-9 Tempest',
    kind: 'rifle',
    ammo: 'light',
    damage: 26,
    headMult: 1.8,
    magSize: 30,
    reserveStart: 90,
    reserveMax: 240,
    fireInterval: 0.085,
    auto: true,
    pellets: 1,
    spreadHip: 0.02,
    spreadAds: 0.007,
    recoil: 0.016,
    recoilMax: 0.085,
    recovery: 0.11,
    reloadTime: 1.9,
    range: 110,
    zoom: 1.5,
    movePenalty: 0.06,
  },
  shotgun: {
    id: 'shotgun',
    name: 'BR-12 Breaker',
    kind: 'shotgun',
    ammo: 'shell',
    damage: 13,
    headMult: 1.6,
    magSize: 6,
    reserveStart: 18,
    reserveMax: 48,
    fireInterval: 0.85,
    auto: false,
    pellets: 8,
    spreadHip: 0.055,
    spreadAds: 0.038,
    recoil: 0.055,
    recoilMax: 0.16,
    recovery: 0.2,
    reloadTime: 2.4,
    range: 26,
    zoom: 1.2,
    movePenalty: 0.08,
  },
  marksman: {
    id: 'marksman',
    name: 'LW-7 Longeye',
    kind: 'marksman',
    ammo: 'long',
    damage: 92,
    headMult: 2.0,
    magSize: 5,
    reserveStart: 15,
    reserveMax: 40,
    fireInterval: 1.15,
    auto: false,
    pellets: 1,
    spreadHip: 0.03,
    spreadAds: 0.0015,
    recoil: 0.07,
    recoilMax: 0.18,
    recovery: 0.22,
    reloadTime: 2.6,
    range: 180,
    zoom: 2.4,
    movePenalty: 0.14,
  },
};

export const AMMO_LABEL = { light: 'LIGHT', shell: 'SHELL', long: 'LONG' };

/** Fresh runtime state for a weapon the fighter carries. */
export function makeWeaponState(def) {
  return {
    def,
    mag: def.magSize,
    reserve: def.reserveStart,
    cooldown: 0,
    recoil: 0,
    reloading: 0,
    triggerReady: true,
  };
}

/** Current spread in radians: base + bloom from recoil + movement. */
export function currentSpread(state, ads, moving) {
  const base = ads ? state.def.spreadAds : state.def.spreadHip;
  return base + state.recoil * 0.55 + (moving ? 0.012 : 0);
}

/** Advance cooldowns and bleed recoil off. Returns true when a reload finished. */
export function tickWeapon(state, dt) {
  state.cooldown = Math.max(0, state.cooldown - dt);
  state.recoil = Math.max(0, state.recoil - state.def.recovery * dt);
  if (state.reloading > 0) {
    state.reloading -= dt;
    if (state.reloading <= 0) {
      state.reloading = 0;
      const need = state.def.magSize - state.mag;
      const take = Math.min(need, state.reserve);
      state.mag += take;
      state.reserve -= take;
      return true;
    }
  }
  return false;
}

export function startReload(state) {
  if (state.reloading > 0 || state.mag >= state.def.magSize || state.reserve <= 0) return false;
  state.reloading = state.def.reloadTime;
  return true;
}

/** Spend one trigger pull: returns false when nothing fired (dry fire / cooling). */
export function tryFire(state) {
  if (state.cooldown > 0 || state.reloading > 0) return false;
  if (state.mag <= 0) return false;
  state.mag -= 1;
  state.cooldown = state.def.fireInterval;
  state.recoil = Math.min(state.def.recoilMax, state.recoil + state.def.recoil);
  return true;
}
