import { CANVAS, CROP, MARGIN, OUT, RADIUS, sourceRect, type Crop } from '../../core/logo';

/** The canvas and image work of the cropper, kept apart so tests can replace it (happy-dom has no canvas). */
export interface Decoded {
  img: HTMLImageElement;
  w: number;
  h: number;
}

export function decodeImage(src: string): Promise<Decoded> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ img, w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => reject(new Error('decode'));
    img.src = src;
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/** Image under a dimmed frame with the crop square (18% corner radius) cut out. Colors come from the --rg-* tokens. */
export function drawCrop(cv: HTMLCanvasElement, d: Decoded, c: Crop): void {
  const ctx = cv.getContext('2d');
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const css = getComputedStyle(cv);
  if (cv.width !== CANVAS * dpr) {
    cv.width = CANVAS * dpr;
    cv.height = CANVAS * dpr;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = css.getPropertyValue('--rg-bg').trim() || '#ffffff';
  ctx.fillRect(0, 0, CANVAS, CANVAS);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(d.img, c.tx, c.ty, c.w * c.s, c.h * c.s);
  const r = CROP * RADIUS;
  ctx.beginPath();
  ctx.rect(0, 0, CANVAS, CANVAS);
  roundRect(ctx, MARGIN, MARGIN, CROP, CROP, r);
  ctx.fillStyle = css.getPropertyValue('--rg-crop-dim').trim() || 'rgba(1,4,9,.6)';
  ctx.fill('evenodd');
  ctx.beginPath();
  roundRect(ctx, MARGIN + 0.75, MARGIN + 0.75, CROP - 1.5, CROP - 1.5, r);
  ctx.strokeStyle = css.getPropertyValue('--rg-crop-line').trim() || 'rgba(255,255,255,.95)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

/** The crop square as a 192x192 PNG data URL. */
export function renderPng(d: Decoded, c: Crop): string {
  const out = document.createElement('canvas');
  out.width = OUT;
  out.height = OUT;
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  const { sx, sy, side } = sourceRect(c);
  ctx.drawImage(d.img, sx, sy, side, side, 0, 0, OUT, OUT);
  return out.toDataURL('image/png');
}
