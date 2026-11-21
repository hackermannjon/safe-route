import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MapViewProps } from '../../../components/MapView/MapView';
import { THEME_STORAGE_KEY, useThemeStore } from '../../../stores/useThemeStore';
import TripPlanner from '../index';

// WebGL is not available here; record what the map is given instead.
const mapProps = vi.hoisted(() => ({ current: null as MapViewProps | null }));
vi.mock('../LazyMapView', () => ({
  LazyMapView: (props: MapViewProps) => {
    mapProps.current = props;
    return <div data-testid="map" />;
  },
}));

/** matchMedia with a width and colour scheme the test can change. */
function fakeMedia(initial: { width: number; light?: boolean }) {
  const state = { ...initial };
  const listeners = new Set<() => void>();
  const matches = (query: string) => {
    const min = /min-width:\s*(\d+)px/.exec(query);
    if (min) return state.width >= Number(min[1]);
    if (query.includes('prefers-color-scheme: light')) return Boolean(state.light);
    return false;
  };
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return matches(query);
    },
    media: query,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  }));
  return (next: Partial<typeof state>) =>
    act(() => {
      Object.assign(state, next);
      listeners.forEach((listener) => listener());
    });
}

beforeEach(() => {
  mapProps.current = null;
});

afterEach(() => {
  vi.unstubAllGlobals();
  useThemeStore.setState({ choice: null });
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe('TripPlanner', () => {
  it('shows the side panel from 768px up, so a narrow desktop window keeps it', () => {
    fakeMedia({ width: 800 });
    render(<TripPlanner />);
    expect(screen.getByRole('complementary', { name: 'Trip planner' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'From' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Where are you headed?' })).not.toBeInTheDocument();
  });

  it('shows the full map with a search pill below 768px', () => {
    fakeMedia({ width: 390 });
    render(<TripPlanner />);
    expect(screen.queryByRole('complementary', { name: 'Trip planner' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Where are you headed?' }));
    expect(screen.getByRole('dialog', { name: 'Plan a trip' })).toBeInTheDocument();
    expect(mapProps.current?.zoomControls).toBe(false);
  });

  it('keeps what was typed when the window crosses the breakpoint', () => {
    const resize = fakeMedia({ width: 1280 });
    render(<TripPlanner />);
    fireEvent.change(screen.getByRole('combobox', { name: 'From' }), { target: { value: 'Orlan' } });

    resize({ width: 600 });
    fireEvent.click(screen.getByRole('button', { name: 'Where are you headed?' }));
    const dialog = screen.getByRole('dialog', { name: 'Plan a trip' });
    expect(within(dialog).getByRole('combobox', { name: 'From' })).toHaveValue('Orlan');

    resize({ width: 1100 });
    expect(screen.getByRole('combobox', { name: 'From' })).toHaveValue('Orlan');
  });

  it('hands the map the colour scheme', () => {
    const change = fakeMedia({ width: 1280 });
    render(<TripPlanner />);
    expect(mapProps.current?.theme).toBe('dark');
    change({ light: true });
    expect(mapProps.current?.theme).toBe('light');
  });

  it('lets the driver switch the theme without touching the system setting, and remembers it', () => {
    const change = fakeMedia({ width: 390 });
    render(<TripPlanner />);
    fireEvent.click(screen.getByRole('button', { name: 'Switch to light theme' }));
    expect(mapProps.current?.theme).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');

    // The pick outlasts a change of the system scheme.
    change({ light: false });
    expect(mapProps.current?.theme).toBe('light');
    fireEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
    expect(mapProps.current?.theme).toBe('dark');
  });
});
