import { useEffect, useRef, useState } from 'preact/hooks';
import { CANVAS, initCrop, keyCrop, pan, setZoom, wheelZoom, ERR_UNREADABLE, type Crop } from '../../core/logo';
import { Icon } from '../../ui/Icon';
import { decodeImage, drawCrop, renderPng, type Decoded } from './render';

/**
 * Square cropper: drag to pan, wheel or slider to zoom (1x–5x), arrow keys pan and +/- zoom. The image always covers
 * the crop square. "Use this crop" gives a 192x192 PNG data URL.
 */
export function LogoCropper({ src, onUse, onCancel, onError }: { src: string; onUse: (dataUrl: string) => void; onCancel: () => void; onError: (message: string) => void }) {
  const [decoded, setDecoded] = useState<Decoded | null>(null);
  const [crop, setCrop] = useState<Crop | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; tx: number; ty: number; k: number } | null>(null);
  const cropRef = useRef<Crop | null>(null);
  cropRef.current = crop;

  useEffect(() => {
    let live = true;
    decodeImage(src).then(
      (d) => {
        if (!live) return;
        setDecoded(d);
        setCrop(initCrop(d.w, d.h));
      },
      () => live && onError(ERR_UNREADABLE),
    );
    return () => {
      live = false;
    };
  }, [src]);

  useEffect(() => {
    if (decoded && crop && canvas.current) drawCrop(canvas.current, decoded, crop);
  }, [decoded, crop]);

  useEffect(() => {
    if (decoded) canvas.current?.focus();
  }, [decoded]);

  const set = (c: Crop | null) => c && setCrop(c);
  const scale = () => CANVAS / (canvas.current?.getBoundingClientRect().width || CANVAS);

  const onDown = (e: PointerEvent) => {
    if (!crop) return;
    drag.current = { x: e.clientX, y: e.clientY, tx: crop.tx, ty: crop.ty, k: scale() };
    canvas.current?.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    const c = cropRef.current;
    if (!d || !c) return;
    // pan from where the drag started, so the clamp never makes the image drift
    set(pan({ ...c, tx: d.tx, ty: d.ty }, (e.clientX - d.x) * d.k, (e.clientY - d.y) * d.k));
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      return onCancel();
    }
    const next = crop && keyCrop(crop, e.key, e.shiftKey);
    if (!next) return;
    e.preventDefault();
    set(next);
  };

  const use = () => {
    if (!decoded || !crop) return;
    try {
      onUse(renderPng(decoded, crop));
    } catch {
      onError('That image could not be converted. Try another file.');
    }
  };

  const zoom = crop?.zoom ?? 1;
  return (
    <div class="rg-cropper">
      <canvas
        ref={canvas}
        width={CANVAS}
        height={CANVAS}
        tabIndex={0}
        aria-label="Logo crop. Drag or use the arrow keys to move, plus and minus to zoom."
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onWheel={(e) => {
          e.preventDefault();
          if (crop) set(wheelZoom(crop, e.deltaY));
        }}
        onKeyDown={onKey}
      />
      <div class="rg-zoom-row">
        <Icon name="zoomout" />
        <input type="range" min="1" max="5" step="0.01" value={zoom} aria-label="Zoom" disabled={!crop} onInput={(e) => crop && set(setZoom(crop, parseFloat((e.target as HTMLInputElement).value)))} />
        <output>{zoom.toFixed(1)}×</output>
        <Icon name="plus" />
      </div>
      <div class="rg-y-tools">
        <span class="rg-grow rg-hint">Drag to reposition. Scroll or use the slider to zoom. The square is what shows on the group.</span>
        <button type="button" class="rg-btn" onClick={onCancel}>Cancel</button>
        <button type="button" class="rg-btn rg-btn-primary" disabled={!crop} onClick={use}><Icon name="check" />Use this crop</button>
      </div>
    </div>
  );
}
