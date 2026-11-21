import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SegmentedControl } from './SegmentedControl';

const OPTIONS = [
  { value: 10, label: '10 mi' },
  { value: 25, label: '25 mi' },
  { value: 50, label: '50 mi' },
] as const;

describe('SegmentedControl', () => {
  it('is a named radio group with the current value checked', () => {
    render(<SegmentedControl label="Checkpoint every" options={OPTIONS} value={25} onChange={() => {}} />);

    expect(screen.getByRole('group', { name: 'Checkpoint every' })).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(screen.getByRole('radio', { name: '25 mi' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '10 mi' })).not.toBeChecked();
  });

  it('reports the picked value with its original type', () => {
    const onChange = vi.fn();
    render(<SegmentedControl label="Checkpoint every" options={OPTIONS} value={25} onChange={onChange} />);

    fireEvent.click(screen.getByRole('radio', { name: '10 mi' }));

    expect(onChange).toHaveBeenCalledWith(10);
  });

  it('describes the radios with the error', () => {
    render(
      <SegmentedControl label="Checkpoint every" options={OPTIONS} value={25} onChange={() => {}} error="Pick one." />,
    );

    expect(screen.getByRole('radio', { name: '50 mi' })).toHaveAccessibleDescription('Pick one.');
  });
});
