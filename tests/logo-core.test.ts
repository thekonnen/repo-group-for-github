import { describe, expect, it } from 'vitest';
import { applyEdit, commitMessage, editLogoPath } from '../src/core/edit';
import { clampCrop, CROP, initCrop, keyCrop, logoPath, MARGIN, mimeOf, pan, parseLogoUrl, setZoom, sourceRect, validateLogoFile, wheelZoom } from '../src/core/logo';
import { findGroup } from '../src/core/placement';
import { example } from './fixtures';

const covers = (c: ReturnType<typeof initCrop>) => c.tx <= MARGIN + 1e-9 && c.ty <= MARGIN + 1e-9 && c.tx + c.w * c.s >= MARGIN + CROP - 1e-9 && c.ty + c.h * c.s >= MARGIN + CROP - 1e-9;

describe('crop math (F7)', () => {
  it('starts centered and covering the crop square, for wide, tall and tiny images', () => {
    for (const [w, h] of [[800, 400], [300, 900], [100, 100], [0, 0]]) {
      const c = initCrop(w, h);
      expect(covers(c)).toBe(true);
      expect(c.zoom).toBe(1);
    }
    const wide = initCrop(800, 400);
    expect(wide.s).toBeCloseTo(0.6); // the short side fills the square
    expect(wide.tx + (800 * wide.s) / 2).toBeCloseTo(140); // centered on the 280 canvas
  });
  it('clamps panning so the image always covers the crop square', () => {
    let c = initCrop(800, 400);
    c = pan(c, 5000, 5000);
    expect(c.tx).toBe(MARGIN);
    expect(c.ty).toBe(MARGIN);
    c = pan(c, -5000, -5000);
    expect(covers(c)).toBe(true);
    expect(clampCrop({ ...c, tx: 999 }).tx).toBe(MARGIN);
  });
  it('zooms between 1x and 5x around the center and stays covering', () => {
    const c0 = initCrop(500, 500);
    expect(setZoom(c0, 0.2).zoom).toBe(1);
    expect(setZoom(c0, 99).zoom).toBe(5);
    expect(setZoom(c0, NaN).zoom).toBe(1);
    const z = setZoom(c0, 2);
    expect(z.s).toBeCloseTo(c0.minS * 2);
    expect(covers(z)).toBe(true);
    // the canvas center keeps showing the same source pixel
    expect((140 - z.tx) / z.s).toBeCloseTo((140 - c0.tx) / c0.s);
    const back = setZoom(z, 1);
    expect(back.tx).toBeCloseTo(c0.tx);
  });
  it('wheel up zooms in, wheel down zooms out', () => {
    const c = setZoom(initCrop(500, 500), 2);
    expect(wheelZoom(c, -100).zoom).toBeGreaterThan(2);
    expect(wheelZoom(c, 100).zoom).toBeLessThan(2);
  });
  it('arrow keys pan, + and - zoom, other keys are left alone', () => {
    const c = setZoom(initCrop(500, 500), 2);
    expect(keyCrop(c, 'ArrowLeft')!.tx).toBe(c.tx + 8);
    expect(keyCrop(c, 'ArrowRight', true)!.tx).toBe(c.tx - 24);
    expect(keyCrop(c, 'ArrowUp')!.ty).toBe(c.ty + 8);
    expect(keyCrop(c, 'ArrowDown')!.ty).toBe(c.ty - 8);
    expect(keyCrop(c, '+')!.zoom).toBeCloseTo(2.1);
    expect(keyCrop(c, '-')!.zoom).toBeCloseTo(1.9);
    expect(keyCrop(c, 'a')).toBeNull();
  });
  it('maps the crop square back to source pixels', () => {
    const c = initCrop(480, 240); // s = 1, shifted so the middle 240 px show
    const r = sourceRect(c);
    expect(r.side).toBeCloseTo(240);
    expect(r.sx).toBeCloseTo(120);
    expect(r.sy).toBeCloseTo(0);
    const z = setZoom(c, 2);
    expect(sourceRect(z).side).toBeCloseTo(120);
  });
});

describe('logo files and links (F7)', () => {
  it('builds the storage path from the group path', () => {
    expect(logoPath(['infra'])).toBe('logos/infra.png');
    expect(logoPath(['infra', 'dagsrv'])).toBe('logos/infra-dagsrv.png');
  });
  it('accepts PNG, JPG, SVG and WebP up to 5 MB with plain errors otherwise', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp']) expect(validateLogoFile({ type, size: 1000 })).toBeNull();
    expect(validateLogoFile({ type: 'image/png', size: 5 * 1024 * 1024 })).toBeNull();
    expect(validateLogoFile({ type: 'image/png', size: 5 * 1024 * 1024 + 1 })).toBe('That image is larger than 5 MB. Choose a smaller file.');
    expect(validateLogoFile({ type: 'application/pdf', size: 1 })).toBe('That file is not an image. Choose a PNG, JPG, SVG or WebP.');
    expect(validateLogoFile({ type: 'image/gif', size: 1 })).toBe('That image type is not supported. Choose a PNG, JPG, SVG or WebP.');
  });
  it('links must be https', () => {
    expect('url' in parseLogoUrl(' https://a.org/x.png ')).toBe(true);
    for (const bad of ['http://a.org/x.png', 'a.org/x.png', '', 'javascript:alert(1)']) expect(parseLogoUrl(bad)).toEqual({ error: 'Enter a direct link that starts with https://.' });
  });
  it('knows the mime type of a logo file', () => {
    expect(mimeOf('logos/a.PNG')).toBe('image/png');
    expect(mimeOf('a.jpeg')).toBe('image/jpeg');
    expect(mimeOf('a.svg')).toBe('image/svg+xml');
    expect(mimeOf('a.webp')).toBe('image/webp');
    expect(mimeOf('a.txt')).toBeNull();
  });
});

describe('edits with a logo', () => {
  const base = { description: 'Jobs', match: ['dagsrv'] };
  it('a new PNG sets logo: to the path of the final slug; remove drops it; no change keeps it', () => {
    const g = example().groups;
    const set = applyEdit(g, { kind: 'edit', path: ['infra', 'dagsrv'], name: 'dagsrv2', ...base, logo: { png: 'AA' } });
    expect(findGroup((set as any).groups, ['infra', 'dagsrv2'])!.logo).toBe('logos/infra-dagsrv2.png');
    const rm = applyEdit(g, { kind: 'edit', path: ['infra', 'dagsrv'], name: 'dagsrv', ...base, logo: { remove: true } });
    expect(findGroup((rm as any).groups, ['infra', 'dagsrv'])!.logo).toBeNull();
    const keep = applyEdit(g, { kind: 'edit', path: ['infra', 'dagsrv'], name: 'dagsrv', ...base });
    expect(findGroup((keep as any).groups, ['infra', 'dagsrv'])!.logo).toBe('logos/infra-dagsrv.png');
    const fresh = applyEdit(g, { kind: 'new', parent: ['ai'], name: 'Vision', description: '', match: [], logo: { png: 'AA' } });
    expect(findGroup((fresh as any).groups, ['ai', 'vision'])!.logo).toBe('logos/ai-vision.png');
  });
  it('names the commit after the logo and exposes the file path', () => {
    const e = { kind: 'edit' as const, path: ['infra', 'dagsrv'], name: 'dagsrv', ...base, logo: { png: 'AA' } };
    expect(commitMessage(e)).toBe('chore(repo-groups): add logo for infra/dagsrv');
    expect(editLogoPath(e)).toBe('logos/infra-dagsrv.png');
    expect(editLogoPath({ ...e, logo: { remove: true } })).toBeNull();
    expect(commitMessage({ ...e, logo: { remove: true } })).toBe('chore(repo-groups): edit group infra/dagsrv');
  });
});
