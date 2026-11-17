// EMBERLINE — input: keyboard, mouse, pointer lock, kept as plain state.
// The game loop reads this object; menus and the test driver poke it the same way
// a player does (real DOM events where possible, synthetic deltas where not).
export const input = {
  forward: false,
  back: false,
  left: false,
  right: false,
  sprint: false,
  jump: false,
  fire: false, // held
  ads: false, // held (right button)
  reload: false,
  interact: false,
  // arrow-key look fallback: held arrows turn/pitch the view, so the game is
  // playable without pointer lock. WASD moves; arrows never move.
  arrowLeft: false,
  arrowRight: false,
  arrowUp: false,
  arrowDown: false,
  slots: [false, false, false, false], // 1..4 pressed this frame
  lookDX: 0,
  lookDY: 0,
  locked: false,
  lockFailed: false,
  pressed: new Set(),
};

const KEYS = new Set();

function keyName(event) {
  return event.key.length === 1 ? event.key.toLowerCase() : event.key;
}

function refresh() {
  input.forward = KEYS.has('w');
  input.back = KEYS.has('s');
  input.left = KEYS.has('a');
  input.right = KEYS.has('d');
  input.sprint = KEYS.has('shift');
  input.jump = KEYS.has(' ');
  input.reload = KEYS.has('r');
  input.interact = KEYS.has('e');
  input.arrowLeft = KEYS.has('arrowleft');
  input.arrowRight = KEYS.has('arrowright');
  input.arrowUp = KEYS.has('arrowup');
  input.arrowDown = KEYS.has('arrowdown');
}

export function bindInput(canvas) {
  window.addEventListener('keydown', (event) => {
    const name = keyName(event);
    if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(name)) event.preventDefault();
    if (!event.repeat) input.pressed.add(name);
    KEYS.add(name);
    if (name === '1' || name === '2' || name === '3' || name === '4') {
      input.slots[Number(name) - 1] = true;
    }
    refresh();
  });
  window.addEventListener('keyup', (event) => {
    KEYS.delete(keyName(event));
    refresh();
  });
  window.addEventListener('blur', () => {
    KEYS.clear();
    input.fire = false;
    input.ads = false;
    refresh();
  });
  canvas.addEventListener('mousedown', (event) => {
    if (event.button === 0) input.fire = true;
    if (event.button === 2) input.ads = true;
  });
  window.addEventListener('mouseup', (event) => {
    if (event.button === 0) input.fire = false;
    if (event.button === 2) input.ads = false;
  });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  document.addEventListener('mousemove', (event) => {
    if (document.pointerLockElement === canvas) {
      input.lookDX += event.movementX || 0;
      input.lookDY += event.movementY || 0;
    }
  });
  document.addEventListener('pointerlockchange', () => {
    input.locked = document.pointerLockElement === canvas;
    if (input.locked) input.lockFailed = false;
  });
  document.addEventListener('pointerlockerror', () => {
    input.lockFailed = true;
  });
}

/** Ask the browser for pointer lock; resolves true when it holds. */
export function requestLock(canvas) {
  return new Promise((resolve) => {
    try {
      const p = canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => canvas.requestPointerLock());
    } catch {
      try {
        canvas.requestPointerLock();
      } catch {
        /* headless or denied: the game still runs */
      }
    }
    setTimeout(() => resolve(document.pointerLockElement === canvas), 120);
  });
}

export function releaseLock() {
  if (document.pointerLockElement) document.exitPointerLock();
}

/** True once for the key pressed since the last frame; menus consume it here. */
export function wasPressed(name) {
  if (input.pressed.has(name)) {
    input.pressed.delete(name);
    return true;
  }
  return false;
}

export function endFrame() {
  input.pressed.clear();
  input.slots = [false, false, false, false];
  input.lookDX = 0;
  input.lookDY = 0;
}
