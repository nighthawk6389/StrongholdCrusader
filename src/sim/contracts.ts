import { UnitKind } from './unitTypes';

/**
 * PMC contracts: ready-made teams hired for cash at a Contracts Office. They arrive at once, need no
 * civilians or weapons from the armory, and cost roughly two to three times what training them would.
 */
export interface Contract {
  key: string;
  name: string;
  /** Who turns up: [unit kind, how many]. */
  units: [number, number][];
  funds: number;
  blurb: string;
}

export const CONTRACTS: Contract[] = [
  { key: 'fireteam', name: 'Fire team', units: [[UnitKind.Rifleman, 4]], funds: 280, blurb: '4 riflemen' },
  { key: 'guns', name: 'Gun team', units: [[UnitKind.Gunner, 2]], funds: 260, blurb: '2 machine gunners' },
  { key: 'snipers', name: 'Sniper pair', units: [[UnitKind.Marksman, 2]], funds: 250, blurb: '2 marksmen' },
  { key: 'sappers', name: 'Sapper team', units: [[UnitKind.Engineer, 2]], funds: 240, blurb: '2 engineers with charges' },
  { key: 'at', name: 'AT team', units: [[UnitKind.AT, 2]], funds: 270, blurb: '2 AT specialists' },
  { key: 'car', name: 'Armored car', units: [[UnitKind.ArmoredCar, 1]], funds: 360, blurb: 'armored car with crew' },
];

/** Seconds between contracts (per side). */
export const CONTRACT_COOLDOWN = 60;
