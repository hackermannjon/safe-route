import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePresence } from './usePresence';

describe('usePresence', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('stays mounted and leaving for the exit, then unmounts', () => {
    const { result, rerender } = renderHook(({ open }) => usePresence(open, 200), { initialProps: { open: true } });
    expect(result.current).toEqual({ mounted: true, leaving: false });

    rerender({ open: false });
    expect(result.current).toEqual({ mounted: true, leaving: true });

    act(() => vi.advanceTimersByTime(200));
    expect(result.current).toEqual({ mounted: false, leaving: false });
  });

  it('comes straight back when reopened during the exit', () => {
    const { result, rerender } = renderHook(({ open }) => usePresence(open, 200), { initialProps: { open: true } });
    rerender({ open: false });
    rerender({ open: true });
    expect(result.current).toEqual({ mounted: true, leaving: false });

    act(() => vi.advanceTimersByTime(200));
    expect(result.current.mounted).toBe(true);
  });

  it('is never mounted when it starts closed', () => {
    const { result } = renderHook(() => usePresence(false, 200));
    expect(result.current).toEqual({ mounted: false, leaving: false });
  });
});
