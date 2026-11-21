import { useEffect, useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { releaseTarget, rubberBand, smoothVelocity } from './sheetPhysics';
import styles from './BottomSheet.module.css';

export type SheetSnap = 'peek' | 'half' | 'full';

const ORDER: SheetSnap[] = ['peek', 'half', 'full'];
const DRAG_SLOP_PX = 6;

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
 *
 * The header drags the sheet with any pointer. The body drags it with a finger the way a native
 * sheet does: at half height any vertical swipe moves the sheet, and when full a pull down from
 * the top of the list does, while other swipes scroll the list.
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
  const bodyRef = useRef<HTMLDivElement>(null);
  const safeProbeRef = useRef<HTMLSpanElement>(null);
  const drag = useRef<DragState | null>(null);
  const suppressClick = useRef(false);
  const detachWindow = useRef<(() => void) | null>(null);
  // Read by the body's touch listeners, which are bound once.
  const latest = useRef({ snap, onSnapChange });
  useEffect(() => {
    latest.current = { snap, onSnapChange };
  });

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
    if (!sheet || typeof DOMMatrixReadOnly === 'undefined') return offsetFor(latest.current.snap);
    return new DOMMatrixReadOnly(getComputedStyle(sheet).transform).m42;
  };

  const step = (direction: 1 | -1) => {
    const next = ORDER[Math.min(ORDER.length - 1, Math.max(0, ORDER.indexOf(snap) + direction))];
    if (next !== snap) onSnapChange(next);
  };

  const beginDrag = (y: number, t: number) => {
    drag.current = { startY: y, startOffset: currentOffset(), lastY: y, lastT: t, velocity: 0, moved: false };
  };

  /** Moves the sheet under the finger once it has moved past the slop; true while it is dragging. */
  const moveDrag = (y: number, t: number): boolean => {
    const d = drag.current;
    const sheet = sheetRef.current;
    if (!d || !sheet) return false;
    const dy = y - d.startY;
    if (!d.moved) {
      if (Math.abs(dy) < DRAG_SLOP_PX) return false;
      d.moved = true;
      sheet.dataset.dragging = '';
    }
    // A minimized sheet starts below peek; it may be pulled up from there, not snapped to peek.
    const lowest = Math.max(offsetFor('peek'), d.startOffset);
    const offset = rubberBand(d.startOffset + dy, 0, lowest);
    sheet.style.transform = `translate3d(0, ${offset}px, 0)`;
    const dt = t - d.lastT;
    if (dt > 0) d.velocity = smoothVelocity(d.velocity, (y - d.lastY) / dt);
    d.lastY = y;
    d.lastT = t;
    return true;
  };

  /** Lets go: CSS takes the sheet from where it is to the snap the release picks. */
  const finishDrag = (): boolean => {
    const d = drag.current;
    const sheet = sheetRef.current;
    drag.current = null;
    if (!d || !sheet || !d.moved) return false;
    const offset = currentOffset();
    // A finger held still before lifting has no momentum left.
    const velocity = performance.now() - d.lastT > 80 ? 0 : d.velocity;
    const target = releaseTarget(
      offset,
      velocity,
      ORDER.map((s) => ({ snap: s, offset: offsetFor(s) })),
    );
    delete sheet.dataset.dragging;
    sheet.style.transform = '';
    const { snap: current, onSnapChange: change } = latest.current;
    if (target !== current) change(target);
    return true;
  };

  // Move and up are tracked on window, not the header: a fast mouse flick leaves the
  // header before the slop is crossed, and capturing at pointerdown instead would
  // retarget the click away from buttons inside the header.
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    detachWindow.current?.();
    const pointerId = event.pointerId;
    beginDrag(event.clientY, event.timeStamp);
    const onMove = (e: PointerEvent) => {
      if (e.pointerId === pointerId) moveDrag(e.clientY, e.timeStamp);
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      detachWindow.current?.();
      if (!finishDrag()) return;
      suppressClick.current = true;
      // If the pointer lifted outside the header no click follows; don't eat the next real tap.
      window.setTimeout(() => {
        suppressClick.current = false;
      }, 0);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    detachWindow.current = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      detachWindow.current = null;
    };
  };

  // Touch events rather than pointer events: only they can stop the list from scrolling once a
  // swipe turns out to be meant for the sheet.
  const dragRef = useRef({ beginDrag, moveDrag, finishDrag });
  useEffect(() => {
    dragRef.current = { beginDrag, moveDrag, finishDrag };
  });
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    let start: { x: number; y: number } | null = null;
    let owned = false;
    const onStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      owned = false;
      start = event.touches.length === 1 && touch ? { x: touch.clientX, y: touch.clientY } : null;
    };
    const onMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!start || !touch) return;
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      const { snap: current } = latest.current;
      if (!owned) {
        const pullingDownAtTop = current === 'full' && dy > 0 && body.scrollTop <= 0;
        // Claimed before the slop is crossed, or the list starts scrolling and the swipe is lost.
        if (pullingDownAtTop && event.cancelable) event.preventDefault();
        if (Math.abs(dx) < DRAG_SLOP_PX && Math.abs(dy) < DRAG_SLOP_PX) return;
        const vertical = Math.abs(dy) > Math.abs(dx);
        if (!vertical || (current === 'full' && !pullingDownAtTop)) {
          start = null;
          return;
        }
        owned = true;
        dragRef.current.beginDrag(start.y, event.timeStamp);
      }
      if (event.cancelable) event.preventDefault();
      dragRef.current.moveDrag(touch.clientY, event.timeStamp);
    };
    const onEnd = () => {
      if (owned) dragRef.current.finishDrag();
      start = null;
      owned = false;
    };
    body.addEventListener('touchstart', onStart, { passive: true });
    body.addEventListener('touchmove', onMove, { passive: false });
    body.addEventListener('touchend', onEnd);
    body.addEventListener('touchcancel', onEnd);
    return () => {
      body.removeEventListener('touchstart', onStart);
      body.removeEventListener('touchmove', onMove);
      body.removeEventListener('touchend', onEnd);
      body.removeEventListener('touchcancel', onEnd);
    };
  }, []);

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
      <div ref={bodyRef} className={styles.body} inert={snap === 'peek'}>
        {children}
      </div>
    </section>
  );
}
