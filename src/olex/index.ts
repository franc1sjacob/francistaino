import { build, render, paint, BUFFER } from './model';

const SCALE = 2;

// draws a single standing frame on the first heading; the loop arrives in task 4
export function start(): void {
  const canvas = document.getElementById('olex') as HTMLCanvasElement | null;
  if (!canvas) return;
  build();
  const { W, H } = BUFFER;
  const buf = document.createElement('canvas');
  buf.width = W;
  buf.height = H;
  paint(buf.getContext('2d')!, render(W, H, { yaw: 0 }), W, H);
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(buf, 0, 0, W * SCALE, H * SCALE);

  const place = () => {
    const h1 = document.querySelector('main h1');
    if (!h1) return;
    const r = h1.getBoundingClientRect();
    const x = r.left + scrollX + 40;
    const y = r.top + scrollY;
    canvas.style.transform = `translate(${x - (W * SCALE) / 2}px, ${y - (H - BUFFER.GROUND) * SCALE}px)`;
  };
  place();
  document.addEventListener('astro:page-load', place);
}
