import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NumberField } from './NumberField';
import { parseWholeNumber } from './parseWholeNumber';

describe('parseWholeNumber', () => {
  it.each([
    ['42000', 42_000],
    ['42,000', 42_000],
    ['42,000 lb', 42_000],
    ['007', 7],
    ['0', 0],
    ['', null],
    ['lb', null],
    ['-5', 5],
    ['1234567890123', 123_456_789],
  ])('reads %j as %j', (text, expected) => {
    expect(parseWholeNumber(text)).toBe(expected);
  });
});

describe('NumberField', () => {
  it('shows the value with thousands separators and hands back a number', () => {
    const onChange = vi.fn();
    render(<NumberField label="Cargo weight" unit="lb" value={42_000} hint="0 to 80,000 lb" onChange={onChange} />);
    const input = screen.getByLabelText('Cargo weight');
    expect(input).toHaveValue('42,000');
    expect(input).toHaveAttribute('inputmode', 'numeric');
    expect(input).toHaveAccessibleDescription('0 to 80,000 lb');

    fireEvent.change(input, { target: { value: '42,0005' } });
    expect(onChange).toHaveBeenLastCalledWith(420_005);
    fireEvent.change(input, { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('shows an error in place of the hint and marks the input invalid', () => {
    render(
      <NumberField
        label="Cargo weight"
        value={90_000}
        hint="0 to 80,000 lb"
        error="Cargo weight cannot exceed 80,000 lb."
        onChange={() => {}}
      />,
    );
    const input = screen.getByLabelText('Cargo weight');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Cargo weight cannot exceed 80,000 lb.');
  });
});
