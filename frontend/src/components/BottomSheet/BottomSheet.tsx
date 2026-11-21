import { useEffect, useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import styles from './BottomSheet.module.css';

export type SheetSnap = 'peek' | 'half' | 'full';

const ORDER: SheetSnap[] = ['peek', 'half', 'full'];
const DRAG_SLOP_PX = 6;
const FLICK_PX_PER_MS = 0.5;

const SNAP_WORDS: Record<SheetSnap, string> = {
  peek: 'collapsed',
  half: 'half open',
  full: 'fully open',
};

export interface BottomSheetProps {
  label: string;
  snap: SheetSnap;
  onSnapChange: (snap: SheetSnap) => void;
  /** Always visible, including in the peek state (--sheet-peek). */
  header: ReactNode;
  /** At peek, sinks to the grip alone (--sheet-grip) until it is moved or this turns false. */
  minimized?: boolean;
  children: ReactNode;
  className?: string;
}

interface DragState {
  pointerId: number;
  startY: number;
  startOffset: number;
  lastY: number;
  lastT: number;
  velocity: number;
  moved: boolean;
}

/**
 * Snap positions are pure CSS (transform keyed on data-snap). JS only writes an
 * inline transform while a finger is down, then hands control back to CSS, so
 * the release animation is a compositor-only transition and no React state
 * changes per pointer move.
 */
export function BottomSheet({
  label,
  snap,
  onSnapChange,
  header,
  minimized = false,
  children,
  className,
}: BottomSheetProps) {
  const sheetRef = useRef<HTMLElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const safeProbeRef = useRef<HTMLSpanElement>(null);
  const drag = useRef<DragState | null>(null);
  const suppressClick = useRef(false);
  const detachWindow = useRef<(() => void) | null>(null);

  useEffect(() => () => detachWindow.current?.(), []);

  const offsetFor = (target: SheetSnap): number => {
    const sheet = sheetRef.current;
    if (!sheet) return 0;
    const height = sheet.offsetHeight;
    if (target === 'full') return 0;
    if (target === 'half') {
      const viewport = window.visualViewport?.height ?? window.innerHeight;
      return Math.max(0, height - viewport * 0.5);
    }
    const peek = (headerRef.current?.offsetHeight ?? 0) + (safeProbeRef.current?.offsetHeight ?? 0);
    return Math.max(0, height - peek);
  };

  const currentOffset = (): number => {
    const sheet = sheetRef.current;
    if (!sheet || typeof DOMMatrixReadOnly === 'undefined') return offsetFor(snap);
    return new DOMMatrixReadOnly(getComputedStyle(sheet).transform).m42;
  };

  const step = (direction: 1 | -1) => {
    const next = ORDER[Math.min(ORDER.length - 1, Math.max(0, ORDER.indexOf(snap) + direction))];
    if (next !== snap) onSnapChange(next);
  };

  // Move and up are tracked on window, not the header: a fast mouse flick leaves the
  // header before the slop is crossed, and capturing at pointerdown instead would
  // retarget the click away from buttons inside the header.
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    detachWindow.current?.();
    drag.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startOffset: currentOffset(),
      lastY: event.clientY,
      lastT: event.timeStamp,
      velocity: 0,
      moved: false,
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    detachWindow.current = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
      detachWindow.current = null;
    };
  };

  const onPointerMove = (event: PointerEvent) => {
    const d = drag.current;
    const sheet = sheetRef.current;
    if (!d || !sheet || event.pointerId !== d.pointerId) return;
    const dy = event.clientY - d.startY;
    if (!d.moved) {
      if (Math.abs(dy) < DRAG_SLOP_PX) return;
      d.moved = true;
      sheet.dataset.dragging = '';
    }
    // A minimized sheet starts below peek; it may be pulled up from there, not snapped to peek.
    const lowest = Math.max(offsetFor('peek'), d.startOffset);
    const offset = Math.min(lowest, Math.max(0, d.startOffset + dy));
    sheet.style.transform = `translate3d(0, ${offset}px, 0)`;
    const dt = event.timeStamp - d.lastT;
    if (dt > 0) d.velocity = (event.clientY - d.lastY) / dt;
    d.lastY = event.clientY;
    d.lastT = event.timeStamp;
  };

  const endDrag = (event: PointerEvent) => {
    const d = drag.current;
    if (d && event.pointerId !== d.pointerId) return;
    const sheet = sheetRef.current;
    drag.current = null;
    detachWindow.current?.();
    if (!d || !sheet || !d.moved) return;

    suppressClick.current = true;
    // If the pointer lifted outside the header no click follows; don't eat the next real tap.
    window.setTimeout(() => {
      suppressClick.current = false;
    }, 0);
    const offset = currentOffset();
    const offsets = ORDER.map((s) => ({ snap: s, offset: offsetFor(s) }));
    let target: SheetSnap;
    if (Math.abs(d.velocity) > FLICK_PX_PER_MS) {
      // Flick: go to the next snap in the direction of travel from where the finger let go.
      const down = d.velocity > 0;
      const candidates = offsets.filter((o) => (down ? o.offset > offset : o.offset < offset));
      const pick = down
        ? candidates.sort((a, b) => a.offset - b.offset)[0]
        : candidates.sort((a, b) => b.offset - a.offset)[0];
      target = pick?.snap ?? (down ? 'peek' : 'full');
    } else {
      target = offsets.reduce((best, o) =>
        Math.abs(o.offset - offset) < Math.abs(best.offset - offset) ? o : best,
      ).snap;
    }

    delete sheet.dataset.dragging;
    sheet.style.transform = '';
    if (target !== snap) onSnapChange(target);
  };

  const onHandleClick = () => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    onSnapChange(snap === 'peek' ? 'half' : snap === 'half' ? 'full' : 'peek');
  };

  const onHandleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      step(1);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      step(-1);
    } else if (event.key === 'Escape' && snap !== 'peek') {
      event.preventDefault();
      onSnapChange('peek');
    }
  };

  const nextWord = snap === 'full' ? 'collapse' : 'expand';

  return (
    <section
      ref={sheetRef}
      className={[styles.sheet, className].filter(Boolean).join(' ')}
      data-snap={snap}
      data-minimized={minimized && snap === 'peek' ? '' : undefined}
      aria-label={label}
    >
      <span ref={safeProbeRef} className={styles.safeProbe} aria-hidden="true" />
      <div
        ref={headerRef}
        className={styles.header}
        onPointerDown={onPointerDown}
        onClickCapture={(e) => {
          // A drag that ends over a header button must not also press it.
          if (suppressClick.current && e.target !== e.currentTarget) {
            suppressClick.current = false;
            e.stopPropagation();
            e.preventDefault();
          }
        }}
      >
        <button
          type="button"
          className={styles.handle}
          aria-expanded={snap !== 'peek'}
          aria-label={`${label}, ${SNAP_WORDS[snap]}. Activate to ${nextWord}; use arrow keys to resize.`}
          onClick={onHandleClick}
          onKeyDown={onHandleKeyDown}
        >
          <span className={styles.grip} aria-hidden="true" />
        </button>
        <div className={styles.headerContent}>{header}</div>
      </div>
      <div className={styles.body} inert={snap === 'peek'}>
        {children}
      </div>
    </section>
  );
}
