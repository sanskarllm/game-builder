import { buildHumanoid, defaultCharacter, type CharacterParams } from './humanoid';
import type { InstanceSpec, MaterialSpec, ModelSpec, PartSpec, Vec3 } from './modelSpec';
import { hashString, mulberry32 } from './random';
import type { RigFit } from './skeletons';

/**
 * Offline text-to-3D: the prompt is parsed for an object, colours, materials,
 * size and count, then a matching procedural template is assembled. The
 * `generateModel` signature is the seam for plugging in an AI 3D provider.
 */
export interface GenerationResult {
  name: string;
  spec: ModelSpec;
  fit?: RigFit;
  interpretation: { label: string; value: string }[];
}

const COLORS: Record<string, string> = {
  red: '#d64545', crimson: '#a3162f', scarlet: '#e0312b', orange: '#ec7a2d', amber: '#f0a020',
  yellow: '#ecc94b', gold: '#d4af37', golden: '#d4af37', green: '#3f9b4a', emerald: '#1f9d6b',
  lime: '#8bd346', olive: '#7a7f2d', blue: '#3b6fd8', navy: '#22306b', azure: '#3fa7ff',
  cyan: '#2ccbe0', teal: '#1f8f8a', turquoise: '#33c9b5', purple: '#7d4bd6', violet: '#8f5cf0',
  magenta: '#d63ba8', pink: '#f07fb0', brown: '#7a4a24', tan: '#c8a06e', beige: '#d8c8a8',
  black: '#1e1e22', white: '#f2f2f2', gray: '#8a8f98', grey: '#8a8f98', silver: '#c0c6cf',
  bronze: '#b07a3b', copper: '#b8673a', ruby: '#c3123b', sapphire: '#1f4fbf', ivory: '#f4ecd8',
};

const MATERIAL_WORDS: { words: string[]; label: string; mat: Partial<MaterialSpec> }[] = [
  { words: ['metal', 'metallic', 'steel', 'iron', 'chrome'], label: 'metal', mat: { metalness: 0.9, roughness: 0.28, color: '#b9c0cb' } },
  { words: ['gold', 'golden'], label: 'gold', mat: { metalness: 0.95, roughness: 0.25, color: '#d4af37' } },
  { words: ['wood', 'wooden', 'oak'], label: 'wood', mat: { metalness: 0, roughness: 0.85, color: '#8a5a2b' } },
  { words: ['stone', 'rocky', 'marble'], label: 'stone', mat: { metalness: 0, roughness: 0.95, color: '#8d8d8d' } },
  { words: ['glass', 'crystal', 'ice', 'icy', 'frozen'], label: 'glass', mat: { metalness: 0.1, roughness: 0.05, opacity: 0.75, color: '#a8e4ff' } },
  { words: ['glowing', 'glow', 'magic', 'magical', 'neon', 'enchanted', 'radiant'], label: 'glowing', mat: { emissiveIntensity: 0.9 } },
  { words: ['plastic', 'toy'], label: 'plastic', mat: { metalness: 0, roughness: 0.35 } },
];

const SIZE_WORDS: Record<string, number> = {
  tiny: 0.4, mini: 0.5, small: 0.7, little: 0.7, big: 1.4, large: 1.4, tall: 1.3, huge: 2, giant: 2.2, massive: 2.4, colossal: 3,
};

const COUNT_WORDS: Record<string, number> = {
  two: 2, pair: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, few: 3, several: 4, many: 6, some: 3,
};

interface Ctx {
  color?: string;
  mat: Partial<MaterialSpec>;
  rand: () => number;
  words: string[];
}

type Template = (ctx: Ctx) => { parts: PartSpec[]; fit?: RigFit };

const base = (color: string, extra: Partial<MaterialSpec> = {}): MaterialSpec => ({ color, metalness: 0.05, roughness: 0.75, ...extra });

/** Material for the "main" parts of a template: prompt colour/material override defaults. */
function prim(ctx: Ctx, color: string, extra: Partial<MaterialSpec> = {}): MaterialSpec {
  const m: MaterialSpec = { ...base(color, extra), ...ctx.mat };
  if (ctx.color) m.color = ctx.color;
  if (m.emissiveIntensity && !m.emissive) m.emissive = m.color;
  return m;
}

const WOOD = base('#7a4a24', { roughness: 0.9 });
const DARK_WOOD = base('#4e2f17', { roughness: 0.9 });
const METAL = base('#b9c0cb', { metalness: 0.9, roughness: 0.3 });
const DARK_METAL = base('#3a3f47', { metalness: 0.8, roughness: 0.4 });
const GOLD = base('#d4af37', { metalness: 0.95, roughness: 0.25 });
const STONE = base('#8d8d8d', { roughness: 0.95 });
const FLAME = base('#ff8a2a', { emissive: '#ff7a1a', emissiveIntensity: 2.2, roughness: 1 });

const P = (shape: PartSpec['shape'], args: number[], position: Vec3, material: MaterialSpec, rotation?: Vec3, scale?: Vec3): PartSpec => ({
  shape,
  args,
  position,
  material,
  rotation,
  scale,
});

const T: Record<string, Template> = {
  tree: (c) => {
    const leaf = prim(c, '#3f8f3a', { roughness: 0.8, flatShading: true });
    const j = () => (c.rand() - 0.5) * 0.12;
    return {
      parts: [
        P('cylinder', [0.08, 0.13, 1.0, 10], [0, 0.5, 0], WOOD),
        P('ico', [0.45, 1], [j(), 1.25, j()], leaf),
        P('ico', [0.32, 1], [0.27 + j(), 1.02, 0.1 + j()], leaf),
        P('ico', [0.34, 1], [-0.24 + j(), 1.06, -0.1 + j()], leaf),
      ],
    };
  },
  pine: (c) => {
    const leaf = prim(c, '#2f6f45', { flatShading: true });
    return {
      parts: [
        P('cylinder', [0.07, 0.1, 0.6, 8], [0, 0.3, 0], WOOD),
        P('cone', [0.55, 0.8, 9], [0, 0.85, 0], leaf),
        P('cone', [0.42, 0.65, 9], [0, 1.2, 0], leaf),
        P('cone', [0.28, 0.5, 9], [0, 1.52, 0], leaf),
      ],
    };
  },
  house: (c) => ({
    parts: [
      P('box', [1.4, 1, 1.2], [0, 0.5, 0], prim(c, '#e8d9b5')),
      P('cone', [1.15, 0.7, 4], [0, 1.35, 0], base('#a0412d'), [0, Math.PI / 4, 0]),
      P('box', [0.3, 0.55, 0.05], [0, 0.275, 0.61], DARK_WOOD),
      P('box', [0.25, 0.25, 0.05], [-0.42, 0.62, 0.61], base('#9fd3ff', { emissive: '#ffd27a', emissiveIntensity: 0.4 })),
      P('box', [0.25, 0.25, 0.05], [0.42, 0.62, 0.61], base('#9fd3ff', { emissive: '#ffd27a', emissiveIntensity: 0.4 })),
      P('box', [0.15, 0.45, 0.15], [0.38, 1.5, -0.15], base('#8a4a3a')),
    ],
  }),
  tower: (c) => ({
    parts: [
      P('cylinder', [0.45, 0.52, 2.4, 16], [0, 1.2, 0], prim(c, '#9a9a9a', { roughness: 0.95 })),
      P('cone', [0.62, 0.9, 16], [0, 2.85, 0], base('#5b3a8c')),
      P('box', [0.16, 0.28, 0.06], [0, 1.7, 0.47], base('#1b1b22')),
      P('box', [0.22, 0.4, 0.06], [0, 0.2, 0.51], DARK_WOOD),
    ],
  }),
  castle: (c) => {
    const wall = prim(c, '#a3a3a3', { roughness: 0.95 });
    const parts: PartSpec[] = [
      P('box', [3, 1.2, 0.3], [0, 0.6, 1.5], wall),
      P('box', [3, 1.2, 0.3], [0, 0.6, -1.5], wall),
      P('box', [0.3, 1.2, 3], [1.5, 0.6, 0], wall),
      P('box', [0.3, 1.2, 3], [-1.5, 0.6, 0], wall),
      P('box', [0.7, 0.85, 0.34], [0, 0.42, 1.5], DARK_WOOD),
      P('box', [1.2, 1.9, 1.2], [0, 0.95, 0], wall),
      P('cone', [0.9, 0.8, 4], [0, 2.3, 0], base('#3a4f8c'), [0, Math.PI / 4, 0]),
    ];
    for (const [x, z] of [[1.5, 1.5], [-1.5, 1.5], [1.5, -1.5], [-1.5, -1.5]]) {
      parts.push(P('cylinder', [0.4, 0.45, 2, 12], [x, 1, z], wall));
      parts.push(P('cone', [0.5, 0.7, 12], [x, 2.35, z], base('#8c2f2f')));
    }
    return { parts };
  },
  sword: (c) => ({
    parts: [
      P('box', [0.08, 0.9, 0.02], [0, 0.8, 0], prim(c, '#c8d0db', { metalness: 0.9, roughness: 0.25 })),
      P('cone', [0.057, 0.14, 4], [0, 1.32, 0], prim(c, '#c8d0db', { metalness: 0.9, roughness: 0.25 }), [0, Math.PI / 4, 0], [1, 1, 0.3]),
      P('box', [0.36, 0.05, 0.06], [0, 0.35, 0], GOLD),
      P('cylinder', [0.025, 0.025, 0.25, 10], [0, 0.2, 0], base('#4a2f1d')),
      P('sphere', [0.045], [0, 0.05, 0], GOLD),
    ],
  }),
  axe: (c) => ({
    parts: [
      P('cylinder', [0.03, 0.035, 1.0, 10], [0, 0.5, 0], WOOD),
      P('box', [0.32, 0.24, 0.04], [0.15, 0.88, 0], prim(c, '#b9c0cb', { metalness: 0.9, roughness: 0.3 })),
      P('cylinder', [0.13, 0.13, 0.045, 20, Math.PI], [0.3, 0.88, 0], prim(c, '#b9c0cb', { metalness: 0.9, roughness: 0.3 }), [Math.PI / 2, 0, 0]),
    ],
  }),
  hammer: (c) => ({
    parts: [
      P('cylinder', [0.03, 0.035, 0.9, 10], [0, 0.45, 0], WOOD),
      P('box', [0.36, 0.2, 0.2], [0, 0.95, 0], prim(c, '#7d838c', { metalness: 0.85, roughness: 0.35 })),
    ],
  }),
  shield: (c) => ({
    parts: [
      P('cylinder', [0.5, 0.5, 0.06, 32], [0, 0.55, 0], prim(c, '#2f5fa8'), [Math.PI / 2, 0, 0]),
      P('torus', [0.5, 0.035], [0, 0.55, 0], METAL),
      P('sphere', [0.1], [0, 0.55, 0.04], METAL),
    ],
  }),
  chest: (c) => {
    const wood = prim(c, '#8a5a2b', { roughness: 0.85 });
    return {
      parts: [
        P('box', [0.9, 0.5, 0.6], [0, 0.25, 0], wood),
        P('cylinder', [0.3, 0.3, 0.9, 16, Math.PI], [0, 0.5, 0], wood, [0, 0, Math.PI / 2]),
        P('box', [0.06, 0.52, 0.62], [0.3, 0.26, 0], GOLD),
        P('box', [0.06, 0.52, 0.62], [-0.3, 0.26, 0], GOLD),
        P('box', [0.1, 0.12, 0.04], [0, 0.45, 0.31], GOLD),
      ],
    };
  },
  barrel: (c) => {
    const wood = prim(c, '#8a5a2b', { roughness: 0.85 });
    return {
      parts: [
        P('cylinder', [0.36, 0.3, 0.42, 20], [0, 0.21, 0], wood),
        P('cylinder', [0.3, 0.36, 0.42, 20], [0, 0.63, 0], wood),
        P('torus', [0.335, 0.02], [0, 0.14, 0], DARK_METAL, [Math.PI / 2, 0, 0]),
        P('torus', [0.335, 0.02], [0, 0.7, 0], DARK_METAL, [Math.PI / 2, 0, 0]),
      ],
    };
  },
  crate: (c) => {
    const parts = [P('box', [0.8, 0.8, 0.8], [0, 0.4, 0], prim(c, '#b0803f', { roughness: 0.9 }))];
    for (const [x, z] of [[0.36, 0.36], [-0.36, 0.36], [0.36, -0.36], [-0.36, -0.36]]) {
      parts.push(P('box', [0.1, 0.82, 0.1], [x, 0.4, z], DARK_WOOD));
    }
    return { parts };
  },
  rock: (c) => ({
    parts: [
      { ...P('blob', [0.5, 0.3], [0, 0.32, 0], prim(c, '#8d8d8d', { roughness: 0.95, flatShading: true }), undefined, [1.2, 0.75, 1]), seed: Math.floor(c.rand() * 1e6) },
      { ...P('blob', [0.25, 0.35], [0.5, 0.14, 0.25], prim(c, '#7d7d7d', { roughness: 0.95, flatShading: true })), seed: Math.floor(c.rand() * 1e6) },
    ],
  }),
  crystal: (c) => {
    const m = prim(c, '#7fd8ff', { metalness: 0.1, roughness: 0.08, opacity: 0.85, emissive: c.color ?? '#3fb8ff', emissiveIntensity: 0.45, flatShading: true });
    const parts: PartSpec[] = [P('octa', [0.25], [0, 0.55, 0], m, [0, 0, 0], [0.7, 2.2, 0.7])];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + c.rand();
      const r = 0.22 + c.rand() * 0.1;
      parts.push(P('octa', [0.12 + c.rand() * 0.06], [Math.cos(a) * r, 0.22, Math.sin(a) * r], m, [Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5], [0.7, 2, 0.7]));
    }
    parts.push({ ...P('blob', [0.35, 0.3], [0, 0.05, 0], STONE, undefined, [1.3, 0.35, 1.3]), seed: 7 });
    return { parts };
  },
  gem: (c) => ({
    parts: [P('octa', [0.3], [0, 0.45, 0], prim(c, '#e0315a', { metalness: 0.2, roughness: 0.05, opacity: 0.9, flatShading: true, emissive: c.color ?? '#e0315a', emissiveIntensity: 0.25 }), undefined, [1, 1.35, 1])],
  }),
  mushroom: (c) => {
    const parts: PartSpec[] = [
      P('cylinder', [0.12, 0.16, 0.5, 14], [0, 0.25, 0], base('#efe6d2')),
      P('sphere', [0.42, Math.PI * 0.5], [0, 0.45, 0], prim(c, '#d23b3b'), undefined, [1, 0.8, 1]),
    ];
    for (let i = 0; i < 6; i++) {
      const az = (i / 6) * Math.PI * 2 + c.rand() * 0.5;
      const el = 0.5 + c.rand() * 0.5;
      parts.push(P('sphere', [0.05], [Math.cos(el) * Math.cos(az) * 0.41, 0.45 + Math.sin(el) * 0.33, Math.cos(el) * Math.sin(az) * 0.41], base('#ffffff')));
    }
    return { parts };
  },
  torch: (c) => ({
    parts: [
      P('cylinder', [0.035, 0.05, 1.0, 10], [0, 0.5, 0], WOOD),
      P('cylinder', [0.1, 0.06, 0.15, 12], [0, 1.05, 0], DARK_METAL),
      P('cone', [0.08, 0.28, 10], [0, 1.26, 0], c.color ? prim(c, c.color, { emissive: c.color, emissiveIntensity: 2 }) : FLAME),
    ],
  }),
  lantern: (c) => ({
    parts: [
      P('box', [0.3, 0.05, 0.3], [0, 0.03, 0], DARK_METAL),
      P('box', [0.24, 0.35, 0.24], [0, 0.23, 0], prim(c, '#ffd27a', { emissive: c.color ?? '#ffb347', emissiveIntensity: 1.5, opacity: 0.85 })),
      P('cone', [0.22, 0.15, 4], [0, 0.48, 0], DARK_METAL, [0, Math.PI / 4, 0]),
      P('torus', [0.06, 0.012], [0, 0.6, 0], DARK_METAL),
    ],
  }),
  table: (c) => {
    const wood = prim(c, '#8a5a2b', { roughness: 0.85 });
    const parts = [P('box', [1.2, 0.08, 0.7], [0, 0.75, 0], wood)];
    for (const [x, z] of [[0.53, 0.28], [-0.53, 0.28], [0.53, -0.28], [-0.53, -0.28]]) parts.push(P('box', [0.07, 0.72, 0.07], [x, 0.36, z], wood));
    return { parts };
  },
  chair: (c) => {
    const wood = prim(c, '#8a5a2b', { roughness: 0.85 });
    const parts = [P('box', [0.5, 0.06, 0.5], [0, 0.45, 0], wood), P('box', [0.5, 0.55, 0.05], [0, 0.75, -0.225], wood)];
    for (const [x, z] of [[0.22, 0.22], [-0.22, 0.22], [0.22, -0.22], [-0.22, -0.22]]) parts.push(P('box', [0.05, 0.45, 0.05], [x, 0.225, z], wood));
    return { parts };
  },
  potion: (c) => {
    const glass = prim(c, '#c03bd6', { metalness: 0.1, roughness: 0.05, opacity: 0.8, emissive: c.color ?? '#c03bd6', emissiveIntensity: 0.5 });
    return {
      parts: [
        P('sphere', [0.2], [0, 0.2, 0], glass),
        P('cylinder', [0.06, 0.07, 0.15, 14], [0, 0.43, 0], glass),
        P('cylinder', [0.065, 0.055, 0.06, 12], [0, 0.53, 0], base('#a07a4a')),
      ],
    };
  },
  coin: (c) => ({
    parts: [
      P('cylinder', [0.25, 0.25, 0.04, 32], [0, 0.25, 0], prim(c, '#d4af37', { metalness: 0.95, roughness: 0.25 }), [Math.PI / 2, 0, 0]),
      P('torus', [0.2, 0.012], [0, 0.25, 0.02], prim(c, '#d4af37', { metalness: 0.95, roughness: 0.25 })),
    ],
  }),
  key: (c) => {
    const m = prim(c, '#d4af37', { metalness: 0.95, roughness: 0.25 });
    return {
      parts: [
        P('torus', [0.12, 0.03], [0, 0.64, 0], m),
        P('box', [0.04, 0.5, 0.04], [0, 0.27, 0], m),
        P('box', [0.1, 0.04, 0.04], [0.05, 0.06, 0], m),
        P('box', [0.08, 0.04, 0.04], [0.04, 0.14, 0], m),
      ],
    };
  },
  car: (c) => {
    const parts: PartSpec[] = [
      P('box', [1.8, 0.4, 0.9], [0, 0.45, 0], prim(c, '#c23030', { metalness: 0.5, roughness: 0.35 })),
      P('box', [1.0, 0.35, 0.8], [-0.1, 0.82, 0], base('#2a3646', { metalness: 0.3, roughness: 0.15 })),
    ];
    for (const [x, z] of [[0.6, 0.45], [-0.6, 0.45], [0.6, -0.45], [-0.6, -0.45]]) parts.push(P('cylinder', [0.22, 0.22, 0.15, 20], [x, 0.22, z], base('#1d1d22'), [Math.PI / 2, 0, 0]));
    for (const z of [0.3, -0.3]) parts.push(P('sphere', [0.07], [0.9, 0.5, z], base('#fff7d6', { emissive: '#fff2b0', emissiveIntensity: 1.2 })));
    return { parts };
  },
  rocket: (c) => {
    const parts: PartSpec[] = [
      P('cylinder', [0.3, 0.3, 1.6, 24], [0, 1.0, 0], prim(c, '#eeeeee', { metalness: 0.4, roughness: 0.35 })),
      P('cone', [0.3, 0.6, 24], [0, 2.1, 0], base('#d64545')),
      P('cylinder', [0.18, 0.26, 0.3, 16], [0, 0.1, 0], DARK_METAL),
      P('sphere', [0.1], [0, 1.35, 0.27], base('#5fc8ff', { emissive: '#3fa7ff', emissiveIntensity: 0.6 })),
    ];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      parts.push(P('box', [0.4, 0.5, 0.05], [Math.cos(a) * 0.38, 0.45, Math.sin(a) * 0.38], base('#d64545'), [0, -a, 0]));
    }
    return { parts };
  },
  ufo: (c) => {
    const parts: PartSpec[] = [
      P('sphere', [0.8], [0, 0.6, 0], prim(c, '#b9c0cb', { metalness: 0.85, roughness: 0.25 }), undefined, [1, 0.22, 1]),
      P('sphere', [0.35, Math.PI / 2], [0, 0.72, 0], base('#7fe0ff', { opacity: 0.7, roughness: 0.05, emissive: '#3fc8ff', emissiveIntensity: 0.3 })),
    ];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      parts.push(P('sphere', [0.05], [Math.cos(a) * 0.72, 0.58, Math.sin(a) * 0.72], base('#9dff7a', { emissive: '#9dff7a', emissiveIntensity: 1.5 })));
    }
    return { parts };
  },
  fence: (c) => {
    const wood = prim(c, '#9a6a3a', { roughness: 0.9 });
    const parts: PartSpec[] = [];
    for (let i = 0; i < 5; i++) parts.push(P('box', [0.1, 0.8, 0.1], [-1 + i * 0.5, 0.4, 0], wood));
    parts.push(P('box', [2.1, 0.08, 0.05], [0, 0.6, 0.06], wood), P('box', [2.1, 0.08, 0.05], [0, 0.3, 0.06], wood));
    return { parts };
  },
  well: (c) => ({
    parts: [
      P('cylinder', [0.55, 0.55, 0.6, 16], [0, 0.3, 0], prim(c, '#8d8d8d', { roughness: 0.95 })),
      P('cylinder', [0.47, 0.47, 0.02, 16], [0, 0.55, 0], base('#2f6fb0', { roughness: 0.1 })),
      P('box', [0.08, 1.0, 0.08], [0.5, 1.0, 0], WOOD),
      P('box', [0.08, 1.0, 0.08], [-0.5, 1.0, 0], WOOD),
      P('cone', [0.85, 0.5, 4], [0, 1.7, 0], base('#a0412d'), [0, Math.PI / 4, 0]),
    ],
  }),
  tent: (c) => ({
    parts: [
      P('cone', [0.9, 1.2, 4], [0, 0.6, 0], prim(c, '#c9a86a', { roughness: 0.95 }), [0, Math.PI / 4, 0]),
      P('box', [0.3, 0.6, 0.02], [0, 0.3, 0.64], base('#3a2a1a')),
    ],
  }),
  cactus: (c) => {
    const g = prim(c, '#4f9a45', { roughness: 0.8 });
    return {
      parts: [
        P('capsule', [0.15, 1.0], [0, 0.65, 0], g),
        P('capsule', [0.09, 0.18], [0.2, 0.6, 0], g, [0, 0, Math.PI / 2]),
        P('capsule', [0.09, 0.35], [0.32, 0.8, 0], g),
        P('capsule', [0.08, 0.15], [-0.18, 0.85, 0], g, [0, 0, Math.PI / 2]),
        P('capsule', [0.08, 0.25], [-0.28, 1.0, 0], g),
      ],
    };
  },
  flower: (c) => {
    const petal = prim(c, '#f07fb0');
    const parts: PartSpec[] = [
      P('cylinder', [0.015, 0.02, 0.5, 8], [0, 0.25, 0], base('#3f8f3a')),
      P('sphere', [0.06], [0, 0.52, 0], base('#ecc94b')),
    ];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      parts.push(P('sphere', [0.06], [Math.cos(a) * 0.1, 0.52, Math.sin(a) * 0.1], petal, [0, -a, 0], [1.6, 0.4, 1]));
    }
    return { parts };
  },
  campfire: (c) => {
    const parts: PartSpec[] = [];
    for (let i = 0; i < 4; i++) parts.push(P('cylinder', [0.05, 0.05, 0.6, 8], [0, 0.08, 0], DARK_WOOD, [Math.PI / 2 - 0.25, (i * Math.PI) / 4, 0]));
    parts.push(P('cone', [0.18, 0.5, 8], [0, 0.32, 0], c.color ? prim(c, c.color, { emissive: c.color, emissiveIntensity: 2 }) : FLAME));
    parts.push(P('cone', [0.1, 0.3, 8], [0.08, 0.25, 0.05], base('#ffd23f', { emissive: '#ffcc33', emissiveIntensity: 2 })));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      parts.push({ ...P('blob', [0.08, 0.3], [Math.cos(a) * 0.38, 0.05, Math.sin(a) * 0.38], STONE), seed: i + 1 });
    }
    return { parts };
  },
  sign: (c) => ({
    parts: [
      P('box', [0.08, 1.1, 0.08], [0, 0.55, 0], WOOD),
      P('box', [0.7, 0.35, 0.05], [0, 0.95, 0.05], prim(c, '#b0803f', { roughness: 0.9 })),
    ],
  }),
};

function humanoidTemplate(overrides: Partial<CharacterParams>): Template {
  return (c) => {
    const params = { ...defaultCharacter(), ...overrides };
    if (c.color) params.shirt = c.color;
    if (c.mat.metalness && c.mat.metalness > 0.5) params.outfit = 'armor';
    const { spec, fit } = buildHumanoid(params);
    return { parts: spec.parts, fit };
  };
}

const HUMANOIDS: Record<string, Partial<CharacterParams>> = {
  knight: { outfit: 'armor', shirt: '#b9c0cb', pants: '#4a4f58', hairStyle: 'short', build: 1.2 },
  warrior: { outfit: 'armor', shirt: '#8c2f2f', build: 1.3, hairStyle: 'mohawk' },
  soldier: { outfit: 'armor', shirt: '#4f5d3a', pants: '#3a4230', build: 1.15 },
  wizard: { outfit: 'robe', shirt: '#5b3a8c', hair: '#d8d8d8', hairStyle: 'long', build: 0.9 },
  mage: { outfit: 'robe', shirt: '#2f5fa8', hairStyle: 'long' },
  robot: { outfit: 'armor', shirt: '#9aa3ad', pants: '#5a626b', skin: '#c0c6cf', hairStyle: 'none', shoes: '#3a3f47' },
  zombie: { skin: '#7fa866', shirt: '#5a4a3a', pants: '#3a3a4a', hairStyle: 'none' },
  alien: { skin: '#8fd46a', headScale: 1.5, hairStyle: 'none', shirt: '#3a3f47', build: 0.85 },
  ninja: { shirt: '#1e1e22', pants: '#1e1e22', hair: '#1e1e22', shoes: '#1e1e22', hairStyle: 'short', build: 0.95 },
  pirate: { shirt: '#f2f2f2', pants: '#3a2a1a', hairStyle: 'long', hair: '#1e1e22' },
  person: {},
  human: {},
  hero: { build: 1.2, headScale: 0.9 },
  villager: { shirt: '#7a6a4a', pants: '#5a4a3a' },
  character: {},
  man: {},
  woman: { hairStyle: 'long', build: 0.9 },
  child: { height: 1.2, headScale: 1.3 },
  kid: { height: 1.2, headScale: 1.3 },
};

/** keyword → template name, with an optional implied count ("forest" → many trees). */
const KEYWORDS: { words: string[]; template: string; count?: number; label?: string }[] = [
  { words: ['forest', 'woods', 'grove'], template: 'tree', count: 7, label: 'forest (trees)' },
  { words: ['village', 'town'], template: 'house', count: 4, label: 'village (houses)' },
  { words: ['pine', 'fir', 'spruce', 'evergreen'], template: 'pine' },
  { words: ['tree', 'trees', 'oak', 'bush'], template: 'tree' },
  { words: ['house', 'houses', 'home', 'cottage', 'hut', 'cabin'], template: 'house' },
  { words: ['castle', 'fortress', 'fort', 'citadel'], template: 'castle' },
  { words: ['tower', 'towers', 'lighthouse'], template: 'tower' },
  { words: ['sword', 'swords', 'blade', 'katana', 'dagger'], template: 'sword' },
  { words: ['axe', 'axes'], template: 'axe' },
  { words: ['hammer', 'mallet', 'warhammer'], template: 'hammer' },
  { words: ['shield', 'shields'], template: 'shield' },
  { words: ['chest', 'treasure', 'coffer'], template: 'chest' },
  { words: ['barrel', 'barrels', 'keg'], template: 'barrel' },
  { words: ['crate', 'crates', 'box', 'boxes'], template: 'crate' },
  { words: ['rock', 'rocks', 'boulder', 'boulders', 'stones'], template: 'rock' },
  { words: ['crystal', 'crystals', 'shard'], template: 'crystal' },
  { words: ['gem', 'gems', 'diamond', 'jewel', 'ruby', 'sapphire', 'emerald'], template: 'gem' },
  { words: ['mushroom', 'mushrooms', 'toadstool'], template: 'mushroom' },
  { words: ['torch', 'torches'], template: 'torch' },
  { words: ['lantern', 'lamp', 'lanterns'], template: 'lantern' },
  { words: ['table', 'desk'], template: 'table' },
  { words: ['chair', 'stool', 'seat'], template: 'chair' },
  { words: ['potion', 'potions', 'bottle', 'flask', 'elixir'], template: 'potion' },
  { words: ['coin', 'coins'], template: 'coin' },
  { words: ['key', 'keys'], template: 'key' },
  { words: ['car', 'cars', 'truck', 'vehicle', 'jeep'], template: 'car' },
  { words: ['rocket', 'missile'], template: 'rocket' },
  { words: ['ufo', 'saucer', 'spaceship', 'starship'], template: 'ufo' },
  { words: ['fence', 'fences'], template: 'fence' },
  { words: ['well'], template: 'well' },
  { words: ['tent', 'tents'], template: 'tent' },
  { words: ['cactus', 'cacti'], template: 'cactus' },
  { words: ['flower', 'flowers', 'rose', 'tulip'], template: 'flower' },
  { words: ['campfire', 'bonfire', 'fire'], template: 'campfire' },
  { words: ['sign', 'signpost'], template: 'sign' },
  ...Object.keys(HUMANOIDS).map((w) => ({ words: [w, `${w}s`], template: `humanoid:${w}` })),
];

const PREPOSITIONS = new Set(['with', 'of', 'on', 'in', 'holding', 'and', 'near', 'by', 'under', 'beside', 'made']);

/**
 * Pick the subject: the last known noun before the first preposition
 * ("a knight with a sword" → knight, "fire sword" → sword), else the first one after.
 */
function findSubject(words: string[]) {
  const cut = words.findIndex((w) => PREPOSITIONS.has(w));
  const head = cut === -1 ? words : words.slice(0, cut);
  const tail = cut === -1 ? [] : words.slice(cut);
  const lookup = (w: string) => KEYWORDS.find((k) => k.words.includes(w));
  let match: (typeof KEYWORDS)[number] | undefined;
  for (const w of head) match = lookup(w) ?? match;
  if (!match) for (const w of tail) if ((match = lookup(w))) break;
  if (match?.template === 'tree' && words.some((w) => ['pine', 'fir', 'spruce', 'evergreen'].includes(w))) {
    match = KEYWORDS.find((k) => k.template === 'pine');
  }
  return match;
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function generateModel(prompt: string, variation = 0): GenerationResult {
  const text = prompt.toLowerCase();
  const words = text.match(/[a-z]+(?:-[a-z]+)?/g) ?? [];
  const rand = mulberry32(hashString(text) + variation * 7919);
  const interpretation: GenerationResult['interpretation'] = [];

  let color: string | undefined;
  let colorWord: string | undefined;
  const mat: Partial<MaterialSpec> = {};
  const matLabels: string[] = [];
  let size = 1;
  let count = 0;
  let flat = false;

  for (const w of words) {
    if (!color && COLORS[w] && w !== 'gold' && w !== 'golden') {
      color = COLORS[w];
      colorWord = w;
    }
    for (const entry of MATERIAL_WORDS) {
      if (entry.words.includes(w) && !matLabels.includes(entry.label)) {
        matLabels.push(entry.label);
        const { color: matColor, ...rest } = entry.mat;
        Object.assign(mat, rest);
        if (matColor && !mat.color) mat.color = matColor;
      }
    }
    if (SIZE_WORDS[w]) size = SIZE_WORDS[w];
    if (COUNT_WORDS[w] && !count) count = COUNT_WORDS[w];
    if (w === 'lowpoly' || w === 'low-poly' || w === 'voxel' || w === 'blocky') flat = true;
  }
  const numeric = text.match(/\b(\d{1,2})\b/);
  if (numeric && !count) count = Math.min(12, parseInt(numeric[1], 10));
  if (text.includes('low poly')) flat = true;

  // Material colour only applies when no explicit colour was given.
  const matColor = mat.color;
  delete mat.color;
  if (!color && matColor) color = matColor;
  if (flat) mat.flatShading = true;

  let match = findSubject(words);
  let templateName = match?.template;
  let objectLabel = match?.label ?? (match ? match.words[0] : undefined);

  const ctx: Ctx = { color, mat, rand, words };
  let parts: PartSpec[];
  let fit: RigFit | undefined;

  if (templateName?.startsWith('humanoid:')) {
    const kind = templateName.split(':')[1];
    ({ parts, fit } = humanoidTemplate(HUMANOIDS[kind])(ctx));
  } else if (templateName && T[templateName]) {
    ({ parts, fit } = T[templateName](ctx));
  } else {
    // Unknown object: a sculpted blob seeded from the prompt, so every prompt yields something.
    const hue = hashString(text) % 360;
    parts = [
      {
        ...P('blob', [0.55, 0.45], [0, 0.6, 0], prim(ctx, `hsl(${hue}, 55%, 55%)`, { flatShading: flat })),
        seed: hashString(text) + variation,
      },
    ];
    objectLabel = 'abstract form (no template matched)';
    match = undefined;
  }

  if (!count) count = match?.count ?? 1;
  if (count > 1) fit = undefined; // rig landmarks only make sense for a single figure

  const instances: InstanceSpec[] = [];
  if (count === 1) {
    instances.push({ position: [0, 0, 0], scale: size });
  } else {
    const spacing = 1.6 * size;
    for (let i = 0; i < count; i++) {
      const ring = Math.ceil(Math.sqrt(count));
      const gx = (i % ring) - (ring - 1) / 2;
      const gz = Math.floor(i / ring) - (Math.ceil(count / ring) - 1) / 2;
      instances.push({
        position: [gx * spacing + (rand() - 0.5) * 0.5 * size, 0, gz * spacing + (rand() - 0.5) * 0.5 * size],
        rotationY: rand() * Math.PI * 2,
        scale: size * (0.8 + rand() * 0.4),
      });
    }
  }
  if (fit && size !== 1) {
    fit = Object.fromEntries(Object.entries(fit).map(([k, v]) => [k, k === 'armAngle' ? v : v * size])) as unknown as RigFit;
  }

  interpretation.push({ label: 'Object', value: objectLabel ?? 'unknown' });
  if (colorWord) interpretation.push({ label: 'Colour', value: colorWord });
  if (matLabels.length) interpretation.push({ label: 'Material', value: matLabels.join(', ') });
  if (size !== 1) interpretation.push({ label: 'Scale', value: `×${size}` });
  if (count > 1) interpretation.push({ label: 'Count', value: String(count) });
  if (flat) interpretation.push({ label: 'Style', value: 'low poly' });
  if (fit) interpretation.push({ label: 'Rig-ready', value: 'humanoid T-pose' });

  const name = titleCase(prompt.trim().replace(/^(a|an|the)\s+/i, '').slice(0, 40)) || 'Untitled Asset';
  return { name, spec: { parts, instances }, fit, interpretation };
}

export const PROMPT_EXAMPLES = [
  'a glowing blue crystal',
  'golden sword',
  'three pine trees',
  'wooden treasure chest',
  'red mushroom',
  'low poly castle',
  'a knight',
  'metal robot',
  'small purple potion',
  'a forest',
  'campfire',
  'giant rock',
];
