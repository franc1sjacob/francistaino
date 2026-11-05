// Olex: a voxel teddy-bear-cut toy poodle rendered as pixel art.
// Model space: x forward (nose at +x), y up, z to the dog's left.

export type Params = {
  size: number;    // model units -> pixels
  length: number;  // body stretch front to back
  height: number;  // whole-dog vertical stretch
  legs: number;    // leg length in model units
  head: number;    // head scale
  fluff: number;   // lumpiness of the silhouette
  eyeSize: number;
  eyeGap: number;  // half the distance between the eyes
  eyeY: number;    // eye height above head centre
};

export const DEFAULTS: Params = {
  size: 0.65, length: 1.7, height: 1.15, legs: 5.25, head: 1.15,
  fluff: 2.2, eyeSize: 0.6, eyeGap: 2, eyeY: 1,
};

export type Pose = "stand" | "sit" | "lie" | "curl";

export type RenderOpts = {
  yaw: number;              // 0 = facing right, PI/2 = facing the viewer
  pitch?: number;
  walk?: number | null;     // walk cycle phase 0..1, null = legs still
  tongue?: boolean;
  pose?: Pose;
  poseT?: number;           // 0..1 blend into the pose
  hang?: number | null;     // screen-plane tilt around the scruff while carried
  hangY?: number;           // buffer row the scruff is drawn at while carried
  tailWag?: number | null;  // wag phase in radians
  scratch?: number | null;  // back-leg scratch phase while sitting
  ball?: boolean;           // ball held in the mouth
};

export const BUFFER = { W: 64, H: 56, HANG_Y: 18, GROUND: 2 };

type Mat = "fur" | "ear" | "muzzle" | "collar" | "eye" | "shine" | "tongue";
type Group = "mid" | "front" | "back" | "head";
type Part = {
  c: [number, number, number];
  r: [number, number, number];
  mat: Mat;
  g: Group;
  kind?: "cyl";
  fluff?: number;
  bias?: number;
  tongue?: boolean;
  tail?: boolean;
  leg?: number;
  phase?: number;
};
type Voxel = { x: number; y: number; z: number; n: [number, number, number]; p: Part; curl: number };

const sph = (cx: number, cy: number, cz: number, r: number) =>
  ({ c: [cx, cy, cz] as [number, number, number], r: [r, r, r] as [number, number, number] });
const ell = (cx: number, cy: number, cz: number, rx: number, ry: number, rz: number) =>
  ({ c: [cx, cy, cz] as [number, number, number], r: [rx, ry, rz] as [number, number, number] });

const HEAD_C: [number, number, number] = [5.6, 15.2, 0];
const HEAD_R = 5.0;
const NECK = [6, 12, 0];

function parts(P: Params): Part[] {
  // eyes sit on the head sphere surface wherever gap/height put them
  const er = 1.2 * P.eyeSize;
  const eyes: Part[] = [1, -1].flatMap((side) => {
    const y = HEAD_C[1] + P.eyeY, z = side * P.eyeGap;
    const x = HEAD_C[0] + Math.sqrt(Math.max(0, HEAD_R ** 2 - (y - HEAD_C[1]) ** 2 - z * z)) - 0.5 * er;
    return [
      { ...sph(x, y, z, er), mat: "eye", bias: 1.4, g: "head" } as Part,
      // catchlight just in front of the eye so it lands inside it at most angles
      { ...sph(x + 0.75 * er, y + 0.3 * er, z + 0.2 * er, 0.32 * er), mat: "shine", bias: 2.4, g: "head" } as Part,
    ];
  });

  const list: Part[] = [
    { ...ell(0, 8.6, 0, 5.4, 4.4, 4.2), mat: "fur", fluff: 0.14, g: "mid" },
    { ...sph(3.0, 9.4, 0, 4.1), mat: "fur", fluff: 0.14, g: "front" },
    { ...sph(-3.0, 9.0, 0, 4.0), mat: "fur", fluff: 0.14, g: "back" },
    { ...sph(...HEAD_C, HEAD_R), mat: "fur", fluff: 0.12, g: "head" },
    { ...sph(7.6, 13.9, 2.1, 2.8), mat: "fur", fluff: 0.12, g: "head" },
    { ...sph(7.6, 13.9, -2.1, 2.8), mat: "fur", fluff: 0.12, g: "head" },
    { ...ell(4.6, 13.8, 4.4, 2.4, 3.2, 1.9), mat: "ear", fluff: 0.16, g: "head" },
    { ...ell(4.6, 13.8, -4.4, 2.4, 3.2, 1.9), mat: "ear", fluff: 0.16, g: "head" },
    { ...ell(9.6, 13.9, 0, 1.9, 1.6, 1.9), mat: "muzzle", fluff: 0.06, g: "head" },
    { ...sph(11.3, 14.5, 0, 0.85), mat: "eye", bias: 1, g: "head" },
    { ...ell(10.4, 12.6, 0, 0.7, 0.7, 0.7), mat: "tongue", bias: 0.8, tongue: true, g: "head" },
    ...eyes,
    { ...sph(-6.2, 12.0, 0, 2.2), mat: "fur", fluff: 0.2, tail: true, g: "back" },
    { ...ell(5.0, 10.9, 0, 3.3, 0.55, 4.4), mat: "collar", g: "front" },
  ];
  const legs: [number, number, number][] = [[3.3, 2.2, 0], [3.3, -2.2, Math.PI], [-3.3, 2.2, Math.PI], [-3.3, -2.2, 0]];
  legs.forEach(([lx, lz, phase], leg) => {
    const g: Group = lx > 0 ? "front" : "back";
    list.push({ kind: "cyl", c: [lx, P.legs / 2, lz], r: [2.0, P.legs / 2, 2.0], mat: "fur", fluff: 0.1, leg, phase, g });
    list.push({ ...sph(lx + 0.3, 1.5, lz, 2.1), mat: "fur", fluff: 0.12, leg, phase, g });
  });

  const shift = 5.4 * (P.length - 1);
  for (const p of list) {
    // stretch the body: front half slides forward, back half slides back
    if (p.g === "front" || p.g === "head") p.c[0] += shift;
    if (p.g === "back") p.c[0] -= shift;
    if (p.g === "mid") p.r[0] *= P.length;
    // head scale around the neck
    if (p.g === "head") {
      const pv = [NECK[0] + shift, NECK[1], NECK[2]];
      p.c = p.c.map((v, k) => pv[k] + (v - pv[k]) * P.head) as [number, number, number];
      p.r = p.r.map((v) => v * P.head) as [number, number, number];
    }
    // longer or shorter legs lift everything above them
    if (p.leg === undefined) p.c[1] += P.legs - 6;
    p.c[1] *= P.height;
    p.r[1] *= P.height;
    if (p.fluff) p.fluff *= P.fluff;
  }
  return list;
}

// cheap deterministic hash
function hash(x: number, y: number, z: number): number {
  let h = (Math.floor(x) * 73856093) ^ (Math.floor(y) * 19349663) ^ (Math.floor(z) * 83492791);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function inside(p: Part, x: number, y: number, z: number): boolean {
  const dx = (x - p.c[0]) / p.r[0], dy = (y - p.c[1]) / p.r[1], dz = (z - p.c[2]) / p.r[2];
  // lumpy radius: bumps keyed on direction so each part gets soft curly tufts
  let lim = 1;
  if (p.fluff) {
    const l = Math.hypot(dx, dy, dz) || 1;
    lim = 1 + p.fluff * (hash((dx / l) * 3 + 7, (dy / l) * 3 + 7, (dz / l) * 3 + 7) - 0.3);
  }
  if (p.kind === "cyl") return Math.hypot(dx, dz) <= lim && Math.abs(dy) <= 1;
  return dx * dx + dy * dy + dz * dz <= lim * lim;
}

// surface voxels per part, sampled finely so rotation never leaves holes
const STEP = 0.4;
let VOX: Voxel[] = [];
let legTop = 6;
let scruff: [number, number, number] = [0, 0, 0];
// pose pivots in model units, set by build()
let shoulder: [number, number] = [0, 0];  // sit pivot: top of the front legs
let bodyY = 0, bodyR = 0, bodyLen = 0;
let tailC: [number, number] = [0, 0];
let params: Params = { ...DEFAULTS };

export function build(next: Partial<Params> = {}): void {
  params = { ...DEFAULTS, ...next };
  legTop = params.legs * params.height;
  // back of the neck, where olex is held when carried
  scruff = [3.5 + 5.4 * (params.length - 1), (12.5 + params.legs - 6) * params.height, 0];
  const shift = 5.4 * (params.length - 1);
  shoulder = [3.3 + shift, legTop];
  bodyY = (8.6 + params.legs - 6) * params.height;
  bodyR = 4.4 * params.height;
  bodyLen = 5.4 * params.length + 4;
  tailC = [-6.2 - shift, (12 + params.legs - 6) * params.height];
  VOX = [];
  for (const p of parts(params)) {
    const [cx, cy, cz] = p.c;
    const [rx, ry, rz] = p.r.map((r) => r * (1 + (p.fluff ?? 0)));
    for (let x = cx - rx; x <= cx + rx; x += STEP)
      for (let y = cy - ry; y <= cy + ry; y += STEP)
        for (let z = cz - rz; z <= cz + rz; z += STEP) {
          if (!inside(p, x, y, z)) continue;
          const surface = !inside(p, x + STEP, y, z) || !inside(p, x - STEP, y, z) ||
            !inside(p, x, y + STEP, z) || !inside(p, x, y - STEP, z) ||
            !inside(p, x, y, z + STEP) || !inside(p, x, y, z - STEP);
          if (!surface) continue;
          const [ax, ay, az] = p.r;
          const n: [number, number, number] = p.kind === "cyl"
            ? [(x - cx) / ax, 0, (z - cz) / az]
            : [(x - cx) / (ax * ax), (y - cy) / (ay * ay), (z - cz) / (az * az)];
          const l = Math.hypot(...n) || 1;
          VOX.push({ x, y, z, n: [n[0] / l, n[1] / l, n[2] / l], p, curl: hash(x * 1.6, y * 1.6, z * 1.6) });
        }
  }
}

const PAL: Record<Mat, string[]> = {
  fur: ["#5a321e", "#7a4529", "#9a5f3a", "#b97b4f", "#d09766"],
  ear: ["#4e2b19", "#6c3c23", "#8a5332", "#a76d46", "#bf875a"],
  muzzle: ["#7a4a2e", "#9a6440", "#b88058", "#cf9c72", "#e0b58c"],
  collar: ["#1f4f8f", "#2f6fc4", "#58a6ff", "#8cc4ff", "#8cc4ff"],
  eye: ["#120a07", "#120a07", "#1a0f0a", "#1a0f0a", "#1a0f0a"],
  shine: ["#ffffff", "#ffffff", "#ffffff", "#ffffff", "#ffffff"],
  tongue: ["#c25a64", "#d66b75", "#e8848d", "#f3a3aa", "#f3a3aa"],
};
const OUTLINE = "#3a2114";
const LIGHT = (() => {
  const l = [-0.45, 0.75, 0.5];
  const m = Math.hypot(...l);
  return l.map((v) => v / m);
})();

// where the scruff lands in buffer pixels relative to the dog's centre and ground, for a given yaw
export function scruffOffset(yaw: number, pitch = 0.3): [number, number] {
  const s = params.size, cy = Math.cos(yaw), sy = Math.sin(yaw);
  const x = (scruff[0] - 2) * s, y = scruff[1] * s, z = scruff[2] * s;
  const xr = x * cy - z * sy, zr = x * sy + z * cy;
  return [xr, y * Math.cos(pitch) - zr * Math.sin(pitch)];
}

// renders one frame into a W*H array of colors (null = transparent)
export function render(W: number, H: number, o: RenderOpts): (string | null)[] {
  const { yaw, pitch = 0.3, walk = null, tongue = true, hang = null, hangY = BUFFER.HANG_Y } = o;
  const pose = o.pose ?? "stand", t = pose === "stand" ? 0 : Math.max(0, Math.min(1, o.poseT ?? 1));
  const size = params.size;
  const groundY = H - BUFFER.GROUND;
  const ox = W / 2;
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const [pvx, pvy] = scruffOffset(yaw, pitch);
  const ca = Math.cos(hang ?? 0), sa = Math.sin(hang ?? 0);

  const depth = new Float32Array(W * H).fill(-1e9);
  const col: (string | null)[] = new Array(W * H).fill(null);

  for (const v of VOX) {
    const p = v.p;
    if (p.tongue && !tongue) continue;
    let { x, y, z } = v;
    if (p.leg !== undefined && walk !== null) {
      const s = Math.sin(walk * Math.PI * 2 + (p.phase ?? 0));
      const k = Math.max(0, 1 - y / legTop);
      x += s * 1.4 * k;
      y += Math.max(0, s) * 0.8 * k;
    }
    if (p.tail && o.tailWag != null) {
      z += Math.sin(o.tailWag) * 1.6;
      y += Math.abs(Math.sin(o.tailWag)) * 0.6;
    }
    if (t > 0) [x, y, z] = posed(p, x, y, z, pose, t, o.scratch ?? null);
    x = (x - 2) * size; y *= size; z *= size; // centre on the body, not the nose
    const xr = x * cy - z * sy, zr = x * sy + z * cy;
    const yUp = y * cp - zr * sp;
    const d = zr * cp + y * sp + (p.bias ?? 0) * size;
    let px: number, py: number;
    if (hang === null) {
      px = Math.round(ox + xr);
      py = Math.round(groundY - yUp);
    } else {
      const dx = xr - pvx, dy = yUp - pvy;
      px = Math.round(ox + dx * ca - dy * sa);
      py = Math.round(hangY - (dx * sa + dy * ca));
    }
    if (px < 0 || py < 0 || px >= W || py >= H) continue;
    const i = py * W + px;
    if (d <= depth[i]) continue;
    const [nx, ny, nz] = v.n;
    const nxr = nx * cy - nz * sy, nzr = nx * sy + nz * cy;
    const nyc = ny * cp - nzr * sp, nzc = nzr * cp + ny * sp;
    let lum = 0.4 + 0.6 * Math.max(0, nxr * LIGHT[0] + nyc * LIGHT[1] + nzc * LIGHT[2]);
    if (p.mat === "fur" || p.mat === "ear" || p.mat === "muzzle") lum += (v.curl - 0.5) * 0.35;
    const pal = PAL[p.mat];
    depth[i] = d;
    col[i] = pal[Math.max(0, Math.min(pal.length - 1, Math.floor(lum * pal.length)))];
  }

  const out = col.slice();
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (col[i]) continue;
      if ((x > 0 && col[i - 1]) || (x < W - 1 && col[i + 1]) || (y > 0 && col[i - W]) || (y < H - 1 && col[i + W]))
        out[i] = OUTLINE;
    }
  return out;
}

export function paint(ctx: CanvasRenderingContext2D, out: (string | null)[], W: number, H: number): void {
  ctx.clearRect(0, 0, W, H);
  for (let i = 0; i < W * H; i++) {
    const c = out[i];
    if (!c) continue;
    ctx.fillStyle = c;
    ctx.fillRect(i % W, (i / W) | 0, 1, 1);
  }
}

const rot = (x: number, y: number, cx: number, cy: number, a: number): [number, number] => {
  const c = Math.cos(a), s = Math.sin(a);
  return [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c];
};

// moves one voxel into a pose, blended by t
function posed(p: Part, x: number, y: number, z: number, pose: Pose, t: number, scratch: number | null): [number, number, number] {
  const frontLeg = p.leg === 0 || p.leg === 1;
  if (pose === "sit") {
    // tip the body back around the shoulders; the head stays level and follows the neck
    const a = 0.6 * t;
    if (p.g === "head") {
      const [nx, ny] = rot(shoulder[0] + 2, shoulder[1] + 4, shoulder[0], shoulder[1], a);
      return [x + nx - (shoulder[0] + 2), y + ny - (shoulder[1] + 4), z];
    }
    if (frontLeg) return [x, y, z];
    let [rx, ry] = rot(x, y, shoulder[0], shoulder[1], a);
    if (p.leg !== undefined) {
      // hind legs fold flat under the rump
      ry = Math.max(ry, 0.6);
      if (scratch !== null && p.leg === 2) {
        rx += Math.sin(scratch) * 1.2;
        ry += 1.5 + Math.abs(Math.sin(scratch));
      }
    }
    return [rx, Math.max(ry, 0), z];
  }
  if (pose === "lie") {
    // roll over around the length axis, settling onto his back
    const a = Math.PI * t;
    const c = Math.cos(a), sn = Math.sin(a);
    const ny = bodyY + (y - bodyY) * c - z * sn;
    const nz = (y - bodyY) * sn + z * c;
    return [x, ny - (bodyY - bodyR) * (1 - c) / 2, nz];
  }
  // curl: tuck the legs, lower the body, bend nose toward tail
  let ny = y;
  if (p.leg !== undefined) ny = y * (1 - 0.7 * t);
  else ny = y - legTop * 0.7 * t - (p.g === "head" ? 2 * t : 0);
  const k = (0.9 / bodyLen) * t;
  if (k === 0) return [x, ny, z];
  return [Math.sin(k * x) / k, ny, z + (1 - Math.cos(k * x)) / k];
}
