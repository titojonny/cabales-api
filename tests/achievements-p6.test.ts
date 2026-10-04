import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS } from '../src/modules/achievements/achievements.service.js';

describe('catalogo de logros P6', () => {
  it('conserva los existentes y documenta tres umbrales crecientes', () => {
    const codes = new Set(ACHIEVEMENTS.map((achievement) => achievement.code));
    for (const code of ['FIRST_GROUP', 'FIRST_EVENT', 'GOOD_PAYER', 'CONNECTOR'])
      expect(codes.has(code)).toBe(true);
    for (const code of [
      'ALWAYS_PAYS',
      'MOST_PUNCTUAL',
      'FUND_KING',
      'PRO_ORGANIZER',
      'EXEMPLARY_COMPANION',
      'JUST_FOR_FUN',
    ]) {
      const achievement = ACHIEVEMENTS.find((item) => item.code === code);
      expect(achievement).toBeDefined();
      expect(achievement!.thresholds.BRONZE).toBeLessThan(achievement!.thresholds.SILVER);
      expect(achievement!.thresholds.SILVER).toBeLessThan(achievement!.thresholds.GOLD);
    }
  });
});
