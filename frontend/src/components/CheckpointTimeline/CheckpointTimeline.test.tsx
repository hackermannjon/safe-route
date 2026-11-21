import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CheckpointTimeline, type TimelineItem } from './CheckpointTimeline';

const ITEMS: TimelineItem[] = [
  { index: 0, place: 'Start · Mile 0', eta: 'Sat 8:00 AM', kind: 'origin' },
  { index: 1, place: 'Mile 25', eta: 'Sat 8:27 AM', kind: 'stop' },
  { index: 2, place: 'Arrive · Mile 41', eta: 'Sat 8:45 AM', kind: 'destination' },
];

describe('CheckpointTimeline', () => {
  it('lists every checkpoint in order with its mile and ETA', () => {
    render(<CheckpointTimeline items={ITEMS} selectedIndex={null} onSelect={() => {}} />);

    const list = screen.getByRole('list', { name: 'Checkpoints' });
    const rows = within(list).getAllByRole('button');
    expect(rows.map((row) => row.textContent)).toEqual([
      'Start · Mile 0Sat 8:00 AM',
      'Mile 25Sat 8:27 AM',
      'Arrive · Mile 41Sat 8:45 AM',
    ]);
    expect(rows.every((row) => row.getAttribute('aria-pressed') === 'false')).toBe(true);
  });

  it('marks the selected checkpoint and brings it into view', () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const { rerender } = render(<CheckpointTimeline items={ITEMS} selectedIndex={null} onSelect={() => {}} />);
    expect(scrollIntoView).not.toHaveBeenCalled();

    rerender(<CheckpointTimeline items={ITEMS} selectedIndex={2} onSelect={() => {}} />);

    expect(screen.getByRole('button', { name: /Arrive/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Mile 25/ })).toHaveAttribute('aria-pressed', 'false');
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' });
  });

  it('reports the pressed checkpoint', () => {
    const onSelect = vi.fn();
    render(<CheckpointTimeline items={ITEMS} selectedIndex={null} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('button', { name: /Mile 25/ }));

    expect(onSelect).toHaveBeenCalledWith(1);
  });
});
