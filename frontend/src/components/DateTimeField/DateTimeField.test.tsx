import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DateTimeField } from './DateTimeField';

describe('DateTimeField', () => {
  it('is a labelled datetime-local input with its bounds and hint', () => {
    render(
      <DateTimeField
        label="Departure"
        value="2026-11-21T08:00"
        min="2026-11-21T06:30"
        max="2026-11-28T07:30"
        hint="Your local time (CST)"
        onChange={() => {}}
      />,
    );

    const input = screen.getByLabelText('Departure');
    expect(input).toHaveAttribute('type', 'datetime-local');
    expect(input).toHaveValue('2026-11-21T08:00');
    expect(input).toHaveAttribute('min', '2026-11-21T06:30');
    expect(input).toHaveAttribute('max', '2026-11-28T07:30');
    expect(input).toHaveAccessibleDescription('Your local time (CST)');
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  it('shows an error in place of the hint and marks the input invalid', () => {
    render(
      <DateTimeField
        label="Departure"
        value="2026-12-21T08:00"
        hint="Your local time (CST)"
        error="Departure must be within the next 7 days."
        onChange={() => {}}
      />,
    );

    const input = screen.getByLabelText('Departure');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Departure must be within the next 7 days.');
    expect(screen.queryByText('Your local time (CST)')).not.toBeInTheDocument();
  });

  it('reports edits', () => {
    const onChange = vi.fn();
    render(<DateTimeField label="Departure" value="2026-11-21T08:00" onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Departure'), { target: { value: '2026-11-21T09:30' } });

    expect(onChange).toHaveBeenCalledWith('2026-11-21T09:30');
  });
});
