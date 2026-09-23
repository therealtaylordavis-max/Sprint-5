// Scoring-code reference data for Pocket Judge.
//
// Values are simplified approximations of the USA Gymnastics Development
// Program / Xcel and FIG (elite / NCAA-style) execution tables. They are meant
// for training feedback, not official scoring — always defer to the current
// published code and a certified judge.

export const EVENTS = [
  { id: 'vault', name: 'Vault', short: 'VT', disciplines: ['WAG', 'MAG'], kind: 'landing' },
  { id: 'bars', name: 'Uneven Bars', short: 'UB', disciplines: ['WAG'], kind: 'apparatus' },
  { id: 'beam', name: 'Balance Beam', short: 'BB', disciplines: ['WAG'], kind: 'beam' },
  { id: 'floor', name: 'Floor Exercise', short: 'FX', disciplines: ['WAG', 'MAG'], kind: 'floor' },
  { id: 'pommel', name: 'Pommel Horse', short: 'PH', disciplines: ['MAG'], kind: 'apparatus' },
  { id: 'rings', name: 'Still Rings', short: 'SR', disciplines: ['MAG'], kind: 'apparatus' },
  { id: 'pbars', name: 'Parallel Bars', short: 'PB', disciplines: ['MAG'], kind: 'apparatus' },
  { id: 'highbar', name: 'High Bar', short: 'HB', disciplines: ['MAG'], kind: 'apparatus' },
];

export const eventById = (id) => EVENTS.find((e) => e.id === id);

// scale: 'usag' uses Development Program / Xcel sized deductions,
// 'fig' uses FIG-sized deductions (elite, NCAA, upper men's levels).
// split: minimum leg separation (degrees) expected on leaps & jumps.
export const LEVELS = [
  { id: 'L1', name: 'Level 1', group: 'USAG Development (Women)', discipline: 'WAG', scale: 'usag', split: 90, fall: 0.5 },
  { id: 'L2', name: 'Level 2', group: 'USAG Development (Women)', discipline: 'WAG', scale: 'usag', split: 90, fall: 0.5 },
  { id: 'L3', name: 'Level 3', group: 'USAG Development (Women)', discipline: 'WAG', scale: 'usag', split: 120, fall: 0.5 },
  { id: 'L4', name: 'Level 4', group: 'USAG Development (Women)', discipline: 'WAG', scale: 'usag', split: 150, fall: 0.5 },
  { id: 'L5', name: 'Level 5', group: 'USAG Development (Women)', discipline: 'WAG', scale: 'usag', split: 180, fall: 0.5 },
  { id: 'L6', name: 'Level 6', group: 'USAG Development (Women)', discipline: 'WAG', scale: 'usag', split: 180, fall: 0.5 },
  { id: 'L7', name: 'Level 7', group: 'USAG Development (Women)', discipline: 'WAG', scale: 'usag', split: 180, fall: 0.5 },
  { id: 'L8', name: 'Level 8', group: 'USAG Development (Women)', discipline: 'WAG', scale: 'usag', split: 180, fall: 0.5 },
  { id: 'L9', name: 'Level 9', group: 'USAG Development (Women)', discipline: 'WAG', scale: 'usag', split: 180, fall: 0.5 },
  { id: 'L10', name: 'Level 10', group: 'USAG Development (Women)', discipline: 'WAG', scale: 'usag', split: 180, fall: 0.5 },
  { id: 'XB', name: 'Xcel Bronze', group: 'USAG Xcel', discipline: 'WAG', scale: 'usag', split: 90, fall: 0.5 },
  { id: 'XS', name: 'Xcel Silver', group: 'USAG Xcel', discipline: 'WAG', scale: 'usag', split: 120, fall: 0.5 },
  { id: 'XG', name: 'Xcel Gold', group: 'USAG Xcel', discipline: 'WAG', scale: 'usag', split: 150, fall: 0.5 },
  { id: 'XP', name: 'Xcel Platinum', group: 'USAG Xcel', discipline: 'WAG', scale: 'usag', split: 180, fall: 0.5 },
  { id: 'XD', name: 'Xcel Diamond', group: 'USAG Xcel', discipline: 'WAG', scale: 'usag', split: 180, fall: 0.5 },
  { id: 'XSa', name: 'Xcel Sapphire', group: 'USAG Xcel', discipline: 'WAG', scale: 'usag', split: 180, fall: 0.5 },
  { id: 'NCAA', name: 'NCAA Women', group: 'Collegiate / Elite', discipline: 'WAG', scale: 'usag', split: 180, fall: 0.5 },
  { id: 'EW', name: 'Elite / FIG Women', group: 'Collegiate / Elite', discipline: 'WAG', scale: 'fig', split: 180, fall: 1.0 },
  { id: 'M4', name: "Men's Level 4", group: 'USAG Development (Men)', discipline: 'MAG', scale: 'usag', split: 150, fall: 0.5 },
  { id: 'M5', name: "Men's Level 5", group: 'USAG Development (Men)', discipline: 'MAG', scale: 'usag', split: 150, fall: 0.5 },
  { id: 'M6', name: "Men's Level 6", group: 'USAG Development (Men)', discipline: 'MAG', scale: 'usag', split: 180, fall: 0.5 },
  { id: 'M7', name: "Men's Level 7", group: 'USAG Development (Men)', discipline: 'MAG', scale: 'usag', split: 180, fall: 0.5 },
  { id: 'M8', name: "Men's Level 8", group: 'USAG Development (Men)', discipline: 'MAG', scale: 'fig', split: 180, fall: 1.0 },
  { id: 'M9', name: "Men's Level 9", group: 'USAG Development (Men)', discipline: 'MAG', scale: 'fig', split: 180, fall: 1.0 },
  { id: 'M10', name: "Men's Level 10", group: 'USAG Development (Men)', discipline: 'MAG', scale: 'fig', split: 180, fall: 1.0 },
  { id: 'EM', name: 'Elite / FIG Men', group: 'Collegiate / Elite', discipline: 'MAG', scale: 'fig', split: 180, fall: 1.0 },
];

export const levelById = (id) => LEVELS.find((l) => l.id === id) || LEVELS[5];

export const eventsForLevel = (levelId) => {
  const d = levelById(levelId).discipline;
  return EVENTS.filter((e) => e.disciplines.includes(d));
};

// Deduction catalog. amount(severity, scale) returns the deduction.
// severity: 1 = small, 2 = medium, 3 = large.
const tier = (usag, fig) => (sev, scale) => (scale === 'fig' ? fig : usag)[Math.min(sev, 3) - 1];

export const DEDUCTIONS = {
  bentArms: { label: 'Bent arms', amount: tier([0.1, 0.2, 0.3], [0.1, 0.3, 0.5]) },
  bentKnees: { label: 'Bent knees', amount: tier([0.1, 0.2, 0.3], [0.1, 0.3, 0.5]) },
  flexedFeet: { label: 'Flexed / sickled feet', amount: tier([0.05, 0.05, 0.1], [0.1, 0.1, 0.1]) },
  legSeparation: { label: 'Leg separation', amount: tier([0.1, 0.1, 0.2], [0.1, 0.1, 0.3]) },
  splitShort: { label: 'Insufficient split', amount: tier([0.05, 0.1, 0.2], [0.1, 0.1, 0.3]) },
  handstandShape: { label: 'Piked / arched handstand', amount: tier([0.05, 0.1, 0.2], [0.1, 0.1, 0.3]) },
  closedShoulders: { label: 'Closed shoulder angle', amount: tier([0.05, 0.1, 0.2], [0.1, 0.1, 0.3]) },
  balanceCheck: { label: 'Balance check / wobble', amount: tier([0.1, 0.2, 0.3], [0.1, 0.3, 0.5]) },
  landingStep: { label: 'Step on landing', amount: tier([0.1, 0.1, 0.2], [0.1, 0.1, 0.3]) },
  deepLanding: { label: 'Deep squat on landing', amount: tier([0.1, 0.1, 0.2], [0.1, 0.1, 0.3]) },
  handDown: { label: 'Hand(s) touch on landing', amount: tier([0.3, 0.3, 0.3], [0.5, 0.5, 0.5]) },
  fall: { label: 'Fall', amount: (_s, scale, level) => level?.fall ?? (scale === 'fig' ? 1.0 : 0.5) },
};

export const SKILLS = {
  vault: ['Handspring vault', 'Front handspring', 'Yurchenko', 'Tsukahara', 'Squat on / jump off', 'Round-off entry'],
  bars: ['Kip', 'Cast', 'Cast handstand', 'Back hip circle', 'Clear hip circle', 'Giant', 'Squat on', 'Flyaway dismount'],
  beam: ['Split leap', 'Split jump', 'Handstand', 'Cartwheel', 'Back walkover', 'Back handspring', 'Full turn', 'Dismount'],
  floor: ['Round-off', 'Back handspring', 'Front handspring', 'Back tuck', 'Layout', 'Split leap', 'Switch leap', 'Full turn', 'Handstand'],
  pommel: ['Circles', 'Scissors', 'Travels', 'Flairs', 'Dismount'],
  rings: ['Support hold', 'Muscle-up', 'Back lever', 'Front lever', 'L-sit', 'Inlocate / dislocate', 'Dismount'],
  pbars: ['Support swing', 'Handstand', 'Front uprise', 'Back uprise', 'Peach', 'Dismount'],
  highbar: ['Kip', 'Cast', 'Tap swing', 'Giant', 'Release', 'Flyaway dismount'],
};

// Default skills to name in a cue when the athlete didn't tag any.
const DEFAULT_CUE_SKILLS = {
  bentArms: {
    bars: ['kip', 'cast', 'cast handstand'],
    highbar: ['kip', 'cast', 'giants'],
    floor: ['round-off', 'back handspring', 'handstand'],
    beam: ['handstand', 'cartwheel', 'walkover'],
    vault: ['block off the table'],
    pbars: ['support swings', 'handstand'],
    rings: ['support', 'swing'],
    pommel: ['circles', 'support'],
  },
};

const listSkills = (skills) => {
  const s = skills.map((x) => x.toLowerCase());
  if (s.length <= 1) return s.join('');
  return `${s.slice(0, -1).join(', ')}, and ${s[s.length - 1]}`;
};

// Coaching cues keyed by deduction; `ev` is an event id, `skills` the tagged skills.
export const CUES = {
  bentArms: (ev, skills) => {
    const named = listSkills(skills.length ? skills : DEFAULT_CUE_SKILLS.bentArms[ev] || ['support skills']);
    const where = ['bars', 'highbar'].includes(ev) ? ' on the bar' : '';
    return {
      cue: `Make sure you're using straight arms on your ${named}${where}. Lock your elbows and push away through your shoulders.`,
      drills: ['Handstand holds against a wall with elbows locked (3 × 30s)', 'Push-up plank shoulder shrugs', ev === 'bars' || ev === 'highbar' ? 'Cast drills on a floor bar focusing on locked arms' : 'Handstand snap-downs off a panel mat'],
    };
  },
  bentKnees: (ev, skills) => ({
    cue: `Keep your knees locked ${skills.length ? `in your ${listSkills(skills)}` : 'through the skill'} — squeeze your quads and think "long legs" from hip to toe.`,
    drills: ['Seated quad squeezes with a pointed toe (hold 10s × 10)', 'Relevé walks with locked knees', 'Tight-body hollow holds'],
  }),
  flexedFeet: () => ({
    cue: 'Point your toes the whole time you are off the floor — reach through the top of the foot, not just the toes.',
    drills: ['Theraband point-and-flex (3 × 20)', 'Relevé raises on a step', 'Hollow rocks with a focus on toe point'],
  }),
  legSeparation: () => ({
    cue: 'Squeeze your legs together — imagine holding a piece of paper between your ankles.',
    drills: ['Hollow holds with a foam block between ankles', 'Handstands squeezing a yoga block'],
  }),
  splitShort: (ev, _s, extra) => ({
    cue: `Push for a bigger split on your leaps and jumps (${extra?.requirement ?? 180}° expected at this level) — lift the back leg from the glute and drive the front leg up early.`,
    drills: ['Oversplits off a panel mat (3 × 45s each leg)', 'Split leap drills over a low barrier', 'Active flexibility kicks'],
  }),
  handstandShape: () => ({
    cue: 'Stack your handstand — ribs in, hips over shoulders, squeeze your glutes so you are neither piked nor arched.',
    drills: ['Chest-to-wall handstand holds', 'Hollow body holds and rocks'],
  }),
  closedShoulders: () => ({
    cue: 'Open your shoulders fully — push tall through your hands and put your ears between your arms.',
    drills: ['Shoulder flexibility bridges / wall stretches', 'Handstand shrugs'],
  }),
  balanceCheck: () => ({
    cue: 'Hold your finishing positions — find a focus point at the end of the beam, keep your hips square, and tighten your core before you move on.',
    drills: ['Relevé holds on a low beam, eyes on a target', 'Skill + 2-second freeze drills'],
  }),
  landingStep: () => ({
    cue: 'Stick your landings — land with feet hip-width apart, knees soft, chest up, and arms up. Stay down for a beat before you stand.',
    drills: ['Stick drills off a panel mat (land and hold 3s)', 'Snap-down to stick', 'Rebound jumps to a controlled stick'],
  }),
  deepLanding: () => ({
    cue: 'Absorb your landing with slightly bent knees, not a deep squat — keep your chest up and hips over your heels.',
    drills: ['Drop landings off a block to a quarter squat', 'Squat-to-stand with chest up'],
  }),
  handDown: () => ({
    cue: 'Land with your weight over your feet so your hands never touch — lift your chest and arms as you land.',
    drills: ['Landing drills with arms extended forward', 'Controlled drop landings'],
  }),
  fall: () => ({
    cue: 'Rebuild consistency on this skill with spotting or progressions before full attempts — confidence first, then power.',
    drills: ['Progressions into a pit or onto a soft mat', 'Spotted repetitions', 'Break the skill into its component drills'],
  }),
};

export const POSITIVE = {
  bentArms: 'Arms stayed straight.',
  bentKnees: 'Knees were locked.',
  flexedFeet: 'Nice toe point.',
  landingStep: 'Stuck landing!',
  splitShort: 'Great split.',
  balanceCheck: 'Solid balance throughout.',
};
