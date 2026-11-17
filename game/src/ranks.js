// EMBERLINE — ranks: the Ember rank progression layer.
// Pure and deterministic: rank r (1-based) always grants RANK_BONUSES[(r-1)%5],
// so a replay or a test can predict every bonus. Only the player earns ranks:
// one per elimination, one per zone phase survived.
import { RANK_BONUSES } from './config.js';

/** The bonus granted by reaching `rank` (1-based). */
export function rankBonus(rank) {
  return RANK_BONUSES[(rank - 1) % RANK_BONUSES.length];
}

/** The bonus the next rank-up will grant, for the HUD. */
export function nextRankBonus(rank) {
  return rankBonus(rank + 1);
}

/**
 * Apply the bonus for `rank` to a fighter in place. Returns the bonus.
 * Fighter fields used: maxHealth, health, reloadMult, speedMult, armor,
 * damageMult. Missing fields default to their base values.
 */
export function applyRankBonus(fighter, rank) {
  const bonus = rankBonus(rank);
  fighter.maxHealth = fighter.maxHealth ?? 100;
  fighter.reloadMult = fighter.reloadMult ?? 1;
  fighter.speedMult = fighter.speedMult ?? 1;
  fighter.damageMult = fighter.damageMult ?? 1;
  if (bonus.id === 'vitality') {
    fighter.maxHealth += 15;
    fighter.health = Math.min(fighter.maxHealth, fighter.health + 15);
  } else if (bonus.id === 'reload') {
    fighter.reloadMult *= 0.88;
  } else if (bonus.id === 'swift') {
    fighter.speedMult *= 1.1;
  } else if (bonus.id === 'plating') {
    fighter.armor = Math.min(100, (fighter.armor ?? 0) + 25);
  } else if (bonus.id === 'fury') {
    fighter.damageMult *= 1.15;
  }
  return bonus;
}
