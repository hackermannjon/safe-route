import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Checkpoint } from '../../types/api';
import { CheckpointPopup } from './CheckpointPopup';

// Tests run in America/Chicago: 20:00 UTC is 2:00 PM CST.
const CHECKPOINT: Checkpoint = {
  index: 10,
  mile: 250,
  lat: 41.2,
  lon: -95.9,
  eta: '2026-11-21T20:00:00Z',
  weather: { wind_mph: 24.8, gust_mph: 38.2, rain_in_h: 0, snow_in_h: 0.37, temp_f: 28.6, weather_code: 73 },
};

function readings(): Record<string, string> {
  const terms = within(screen.getByRole('region')).getAllByRole('term');
  return Object.fromEntries(terms.map((dt) => [dt.textContent, dt.nextElementSibling?.textContent ?? '']));
}

describe('CheckpointPopup', () => {
  it('shows where, when and the full forecast at that hour', () => {
    render(<CheckpointPopup checkpoint={CHECKPOINT} routeLabel="Route B" />);

    const card = screen.getByRole('region', { name: 'Mile 250 details' });
    expect(card).toHaveTextContent('Mile 250Sat 2:00 PM');
    expect(card).toHaveTextContent('Route B');
    expect(card).toHaveTextContent('Snow');
    expect(readings()).toEqual({
      Wind: '24 mph',
      Gusts: '38 mph',
      Temp: '29°F',
      Rain: '0 in/h',
      Snow: '0.37 in/h',
    });
  });

  it('leaves the condition out when the code is unknown', () => {
    const quiet = { ...CHECKPOINT, weather: { ...CHECKPOINT.weather, weather_code: null, temp_f: null } };
    render(<CheckpointPopup checkpoint={quiet} routeLabel="Route A" />);

    expect(screen.getByText('Route A').parentElement?.children).toHaveLength(1);
    expect(readings().Temp).toBe('—');
  });

  it('closes from its button', () => {
    const onClose = vi.fn();
    render(<CheckpointPopup checkpoint={CHECKPOINT} routeLabel="Route B" onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Close checkpoint details' }));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('has no close button without a handler', () => {
    render(<CheckpointPopup checkpoint={CHECKPOINT} routeLabel="Route B" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
