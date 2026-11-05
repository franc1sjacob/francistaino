// Whether a page point lands on one of olex's drawn pixels (not the empty corners of his canvas).

export type Frame = { out: (string | null)[]; W: number; H: number; origin: { x: number; y: number }; scale: number };

export function opaqueAt(f: Frame, pageX: number, pageY: number): boolean {
  const px = Math.floor((pageX - f.origin.x) / f.scale);
  const py = Math.floor((pageY - f.origin.y) / f.scale);
  return px >= 0 && py >= 0 && px < f.W && py < f.H && !!f.out[py * f.W + px];
}
