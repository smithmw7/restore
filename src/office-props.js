// Physical dimensions are in meters. These homes leave the desk's clue and
// briefcase clear, and keep the central locker reserved for the gauntlets.
export const OFFICE_PROPS = [
  { id: 'chair', model: 'Chair', size: [.56, 1.18, .56], home: [9.02, .602, 8.63], mass: 6.5, soundId: 'cube', pickup: 'chair-pickup', navigation: true,
    parts: [
      { size: [.53, .12, .49], position: [0, -.10, 0] },
      { size: [.53, .58, .16], position: [0, .285, .22] },
      ...[-.21, .21].flatMap(x => [-.21, .21].map(z => ({ size: [.048, .47, .048], position: [x, -.355, z] }))),
    ] },
  { id: 'pen-brass', model: 'Pen', size: [.17, .016, .018], home: [7.73, .98, 8.42], mass: .035, soundId: 'ring', pickup: 'small-pickup' },
  { id: 'pen-ink', model: 'Pen', size: [.17, .016, .018], home: [7.73, .98, 8.29], mass: .035, soundId: 'ring', pickup: 'small-pickup' },
  { id: 'pencil', model: 'Pencil', size: [.18, .012, .012], home: [7.73, .98, 8.14], mass: .008, soundId: 'cube', pickup: 'small-pickup' },
  { id: 'logbook-0', model: 'Logbook', size: [.30, .055, .22], home: [8.01, .992, 8.31], mass: .42, soundId: 'cube', pickup: 'paper-pickup' },
  { id: 'logbook-1', model: 'Logbook', size: [.30, .055, .22], home: [8.01, 1.05, 8.31], mass: .42, soundId: 'cube', pickup: 'paper-pickup' },
  { id: 'locker-logbook', model: 'Logbook', size: [.30, .055, .22], home: [9.28, 1.172, 10.94], mass: .42, soundId: 'cube', pickup: 'paper-pickup', locker: 'left' },
  { id: 'locker-pencil', model: 'Pencil', size: [.18, .012, .012], home: [11.65, 1.151, 10.95], mass: .008, soundId: 'cube', pickup: 'small-pickup', locker: 'right' },
];

export const OFFICE_LOCKERS = [
  { id: 'left', targetId: 'locker-left', x: 9.28, width: .76 },
  { id: 'center', targetId: 'locker', x: 10.6, width: 1.3 },
  { id: 'right', targetId: 'locker-right', x: 11.65, width: .61 },
];
