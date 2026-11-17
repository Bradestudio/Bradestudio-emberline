// EMBERLINE — configuration: the map, the tuning numbers, the palette.
// One place for every magic number so balancing is a one-line change.
export const MAP = {
  size: 120, // metres, square; the playable yard runs -60..60 on x and z
  wallHeight: 3.2,
};

export const PALETTE = {
  sky: 0x2a3542,
  fog: 0x8a6f5c,
  ground: 0x5a5148,
  groundLine: 0x6e6258,
  containerA: 0xb5502a,
  containerB: 0x2a6e7a,
  containerC: 0x7a7a3a,
  containerD: 0x8a2f2f,
  containerE: 0x3a6e4a,
  containerF: 0x9a6a2a,
  concrete: 0x8d8578,
  crate: 0x9a7a4a,
  tower: 0x4a4440,
  pipe: 0x6e7a72,
  player: 0x39d0c4,
  bot: 0xff7a2f,
  botAlt: 0xffd166,
  tracer: 0xffe066,
  zone: 0xff7a2f,
  prism: 0x3ff2c8,
};

export const PLAYER = {
  radius: 0.45,
  height: 1.7,
  eye: 1.62,
  walkSpeed: 5.2,
  sprintSpeed: 7.6,
  accel: 42,
  drag: 9,
  jumpSpeed: 6.4,
  gravity: 17,
  health: 100,
  armorMax: 100,
  adsFov: 52,
  hipFov: 78,
};

export const ZONE = {
  // phases: { wait, shrink, radius, dps } — wait then shrink to radius, then hold
  phases: [
    { wait: 22, shrink: 22, radius: 46, dps: 4 },
    { wait: 18, shrink: 20, radius: 32, dps: 6 },
    { wait: 16, shrink: 18, radius: 20, dps: 9 },
    { wait: 14, shrink: 16, radius: 11, dps: 13 },
    { wait: 12, shrink: 14, radius: 5, dps: 18 },
  ],
  startRadius: 85,
};

export const COMBAT = {
  headshotMult: 1.8,
  armorAbsorb: 0.6, // share of damage armor eats while it lasts
  maxBots: 7,
  botReactMin: 0.35,
  botReactMax: 0.8,
  botAimError: 0.055, // radians of aim noise, shrinks as the bot fights
  botBurstMin: 3,
  botBurstMax: 6,
  botPauseMin: 0.5,
  botPauseMax: 1.1,
};

export const STEP = 1 / 60;

// Ember ranks: progression for the player. One rank per elimination and one
// per zone phase survived. Bonuses rotate deterministically by rank number,
// so the same rank always gives the same bonus (testable, no RNG).
export const RANK_BONUSES = [
  { id: 'vitality', label: 'MAX HP +15 · HEAL 15' },
  { id: 'reload', label: 'RELOAD +12%' },
  { id: 'swift', label: 'MOVE SPEED +10%' },
  { id: 'plating', label: 'ARMOR +25' },
  { id: 'fury', label: 'DAMAGE +15%' },
];

export const SUPPLY_DROP = {
  firstAt: 40, // seconds into the match
  every: 50, // seconds between drops after the first
};
