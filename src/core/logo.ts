/** Pure logo logic (F7): crop math, storage path and file validation. No DOM. */

export const CANVAS = 280; // logical px of the crop canvas
export const CROP = 240; // side of the crop square
export const MARGIN = (CANVAS - CROP) / 2;
export const OUT = 192; // side of the PNG we store
export const RADIUS = 0.18; // corner radius of the crop square, as a fraction of its side
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 5;
export const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Crop state. The image is drawn at (tx, ty) with scale `s` = `minS * zoom`; `minS` is the scale at which the image
 * just covers the crop square, so zoom 1 never shows empty space.
 */
export interface Crop {
  w: number;
  h: number;
  minS: number;
  s: number;
  zoom: number;
  tx: number;
  ty: number;
}

/** Image centered at zoom 1. Images with no intrinsic size (some SVGs) count as 512 px. */
export function initCrop(w: number, h: number): Crop {
  w = w || 512;
  h = h || 512;
  const minS = Math.max(CROP / w, CROP / h);
  return { w, h, minS, s: minS, zoom: 1, tx: MARGIN + (CROP - w * minS) / 2, ty: MARGIN + (CROP - h * minS) / 2 };
}

/** Keeps the image covering the crop square. */
export function clampCrop(c: Crop): Crop {
  return {
    ...c,
    tx: Math.min(MARGIN, Math.max(MARGIN + CROP - c.w * c.s, c.tx)),
    ty: Math.min(MARGIN, Math.max(MARGIN + CROP - c.h * c.s, c.ty)),
  };
}

export const clampZoom = (z: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number.isFinite(z) ? z : MIN_ZOOM));

/** Zoom 1x–5x around the center of the canvas. */
export function setZoom(c: Crop, z: number): Crop {
  z = clampZoom(z);
  const ns = c.minS * z;
  const mid = CANVAS / 2;
  const px = (mid - c.tx) / c.s;
  const py = (mid - c.ty) / c.s;
  return clampCrop({ ...c, zoom: z, s: ns, tx: mid - px * ns, ty: mid - py * ns });
}

export const pan = (c: Crop, dx: number, dy: number): Crop => clampCrop({ ...c, tx: c.tx + dx, ty: c.ty + dy });

/** Mouse wheel: deltaY > 0 zooms out. */
export const wheelZoom = (c: Crop, deltaY: number): Crop => setZoom(c, c.zoom * Math.exp(-deltaY * 0.0015));

/** Keyboard: arrows pan (Shift = faster), + and - zoom. Returns null for keys we do not handle. */
export function keyCrop(c: Crop, key: string, shift = false): Crop | null {
  const step = shift ? 24 : 8;
  switch (key) {
    case 'ArrowLeft': return pan(c, step, 0);
    case 'ArrowRight': return pan(c, -step, 0);
    case 'ArrowUp': return pan(c, 0, step);
    case 'ArrowDown': return pan(c, 0, -step);
    case '+':
    case '=': return setZoom(c, c.zoom + 0.1);
    case '-':
    case '_': return setZoom(c, c.zoom - 0.1);
    default: return null;
  }
}

/** The part of the source image inside the crop square, in source pixels. */
export function sourceRect(c: Crop): { sx: number; sy: number; side: number } {
  return { sx: (MARGIN - c.tx) / c.s, sy: (MARGIN - c.ty) / c.s, side: CROP / c.s };
}

/** `logos/infra-dagsrv.png` for the group `infra/dagsrv` (§7). */
export const logoPath = (groupPath: string[]): string => `logos/${groupPath.join('-')}.png`;

const TYPES = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'];

/** Plain-language error for a picked file, or null when it can be used. */
export function validateLogoFile(f: { type: string; size: number }): string | null {
  if (!/^image\//.test(f.type)) return 'That file is not an image. Choose a PNG, JPG, SVG or WebP.';
  if (!TYPES.includes(f.type)) return 'That image type is not supported. Choose a PNG, JPG, SVG or WebP.';
  if (f.size > MAX_BYTES) return 'That image is larger than 5 MB. Choose a smaller file.';
  return null;
}

export const ERR_UNREADABLE = 'That file could not be read as an image. Try a PNG, JPG, SVG or WebP.';
export const ERR_LINK = 'That link did not load as an image. Use a direct link to the file (ending in .png, .jpg, .svg or .webp).';

/** A link must be an https URL. */
export function parseLogoUrl(v: string): { url: URL } | { error: string } {
  try {
    const url = new URL(v.trim());
    if (url.protocol === 'https:') return { url };
  } catch {
    /* fall through */
  }
  return { error: 'Enter a direct link that starts with https://.' };
}

export const declinedMessage = (host: string): string => `Allow access to ${host} to load this image, or download it and upload the file.`;

/** A logo in repo-groups.yml is a path inside <org>/.github or an https URL. */
export const isExternalLogo = (logo: string): boolean => /^https:\/\//i.test(logo);

export const dataUrlToBase64 = (d: string): string => d.slice(d.indexOf(',') + 1);

/** Mime type from a file name, for logos fetched from the repository. */
export function mimeOf(name: string): string | null {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  return ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'svg' ? 'image/svg+xml' : ext === 'webp' ? 'image/webp' : null;
}
