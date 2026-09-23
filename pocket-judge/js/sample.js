// Demo data so the progress views have something to show on first launch.

import { DEDUCTIONS, eventsForLevel, levelById, SKILLS } from './codes.js';
import { finalize } from './analyze.js';
import { uid, saveAthlete, saveSession } from './store.js';

const COMMON = {
  vault: ['bentArms', 'bentKnees', 'landingStep', 'flexedFeet', 'deepLanding'],
  bars: ['bentArms', 'flexedFeet', 'legSeparation', 'bentKnees', 'landingStep'],
  beam: ['balanceCheck', 'splitShort', 'flexedFeet', 'bentKnees', 'fall'],
  floor: ['splitShort', 'landingStep', 'bentKnees', 'flexedFeet', 'bentArms'],
  pommel: ['bentArms', 'flexedFeet', 'bentKnees', 'fall'],
  rings: ['bentArms', 'landingStep', 'bentKnees'],
  pbars: ['bentArms', 'legSeparation', 'landingStep'],
  highbar: ['bentArms', 'bentKnees', 'landingStep', 'flexedFeet'],
};

export async function loadSample({ name = 'Sample Gymnast', levelId = 'L6' } = {}) {
  const athlete = { id: uid(), name, levelId, sample: true, createdAt: Date.now() };
  await saveAthlete(athlete);
  const level = levelById(levelId);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const now = Date.now();
  const DAY = 86400000;
  for (const ev of eventsForLevel(levelId)) {
    for (let k = 0; k < 9; k++) {
      const progress = k / 8; // improvement over ~3 months
      const deductions = [];
      for (const key of COMMON[ev.id]) {
        const chance = (key === 'fall' ? 0.25 : 0.75) * (1 - progress * 0.6);
        if (rnd() < chance) {
          const n = key === 'fall' ? 1 : 1 + Math.floor(rnd() * (3 - progress * 2));
          for (let j = 0; j < n; j++) {
            const sev = 1 + Math.floor(rnd() * (3 - progress * 1.5));
            deductions.push({
              id: uid(), key, label: DEDUCTIONS[key].label, severity: sev,
              amount: +DEDUCTIONS[key].amount(sev, level.scale, level).toFixed(2),
              t: +(rnd() * 20).toFixed(2), detail: 'Sample data', active: true,
            });
          }
        }
      }
      const skills = [SKILLS[ev.id][Math.floor(rnd() * SKILLS[ev.id].length)]];
      const result = finalize({ startValue: 10, deductions, event: ev.id, skills, levelId });
      await saveSession({
        id: uid(), athleteId: athlete.id, event: ev.id, skills, levelId,
        date: now - (90 - k * 11 - Math.floor(rnd() * 3)) * DAY,
        uploadedBy: rnd() < 0.3 ? 'coach' : 'athlete',
        result, sample: true, notes: '', coachNotes: '',
      });
    }
  }
  return athlete;
}
