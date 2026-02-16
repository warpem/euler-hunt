export interface LevelConfig {
  name: string;
  symmetry: string;
  defocus: number | null;      // μm, null = no CTF
  snr: number | null;          // null = no noise
  fadeHalfLife: number | null;  // seconds, null = no memory fade
  mapUrl: string;
}

/** HEALPix-based subdivision steps. Each level progresses through all of these. */
export const SUBDIVISION_STEPS = [
  { angularSpacingDeg: 30,    lpCutoffNyquist: 0.0625 },
  { angularSpacingDeg: 15,    lpCutoffNyquist: 0.125  },
  { angularSpacingDeg: 7.5,   lpCutoffNyquist: 0.25   },
  { angularSpacingDeg: 3.75,  lpCutoffNyquist: 0.5    },
  { angularSpacingDeg: 1.875, lpCutoffNyquist: 1.0    },
] as const;

export type SubdivisionStep = (typeof SUBDIVISION_STEPS)[number];

const base = import.meta.env.BASE_URL;

export const campaignLevels: LevelConfig[] = [
  {
    name: 'Apoferritin',
    symmetry: 'O',
    defocus: null,
    snr: null,
    fadeHalfLife: null,
    mapUrl: `${base}emd_51612_apoferritin_128.mrc`,
  },
  {
    name: 'GroEL',
    symmetry: 'D7',
    defocus: 4.0,
    snr: null,
    fadeHalfLife: null,
    mapUrl: `${base}emd_31310_groel_128.mrc`,
  },
  {
    name: 'beta-galactosidase',
    symmetry: 'D2',
    defocus: 3.0,
    snr: 0.8,
    fadeHalfLife: null,
    mapUrl: `${base}emd_72471_galactosidase_128.mrc`,
  },
  {
    name: '80S Ribosome',
    symmetry: 'C1',
    defocus: 2.0,
    snr: 0.3,
    fadeHalfLife: null,
    mapUrl: `${base}80S_128.mrc`,
  },
  {
    name: 'TRPV3',
    symmetry: 'C4',
    defocus: 1.0,
    snr: 0.1,
    fadeHalfLife: 1.0,
    mapUrl: `${base}emd_44645_trpv3_128.mrc`,
  },
];
