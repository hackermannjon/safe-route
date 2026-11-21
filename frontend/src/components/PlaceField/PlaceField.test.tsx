import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { GeocodeResult } from '../../types/api';
import { PlaceField, type PlaceFieldProps } from './PlaceField';

const RESULTS: GeocodeResult[] = [
  { label: 'Chicago, Illinois, United States', name: 'Chicago', lat: 41.88, lon: -87.63 },
  { label: 'Chicago Heights, Illinois, United States', name: 'Chicago Heights', lat: 41.51, lon: -87.64 },
];

function setup(props: Partial<PlaceFieldProps> = {}) {
  const onSelect = vi.fn();
  const onQueryChange = vi.fn();
  render(
    <PlaceField
      label="From"
      query="Chi"
      suggestions={RESULTS}
      resolved={false}
      onSelect={onSelect}
      onQueryChange={onQueryChange}
      {...props}
    />,
  );
  const input = screen.getByRole('combobox', { name: 'From' });
  fireEvent.focus(input);
  return { input, onSelect, onQueryChange };
}

describe('PlaceField', () => {
  it('lists suggestions and picks one with the keyboard', () => {
    const { input, onSelect } = setup();

    expect(screen.getAllByRole('option')).toHaveLength(2);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSelect).toHaveBeenCalledWith(RESULTS[1]);
  });

  it('picks a suggestion on click', () => {
    const { onSelect } = setup();

    fireEvent.click(screen.getByRole('option', { name: /Chicago, Illinois/ }));

    expect(onSelect).toHaveBeenCalledWith(RESULTS[0]);
  });

  it('says when nothing matches', () => {
    setup({ suggestions: [] });

    expect(screen.getByText('No places match “Chi”.')).toBeInTheDocument();
  });

  it('hides the list once a place is picked', () => {
    setup({ resolved: true });

    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });

  it('links the error to the input', () => {
    const { input } = setup({ error: 'Pick a starting point from the list.' });

    expect(input).toHaveAccessibleDescription('Pick a starting point from the list.');
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });
});
