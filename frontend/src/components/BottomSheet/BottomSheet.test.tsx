import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { BottomSheet, type SheetSnap } from './BottomSheet';

function Sheet({
  initial = 'half',
  onChange,
  minimized,
}: {
  initial?: SheetSnap;
  onChange?: (snap: SheetSnap) => void;
  minimized?: boolean;
}) {
  const [snap, setSnap] = useState<SheetSnap>(initial);
  return (
    <BottomSheet
      label="Trip results"
      snap={snap}
      onSnapChange={(next) => {
        onChange?.(next);
        setSnap(next);
      }}
      header={<p>Route B</p>}
      minimized={minimized}
    >
      <button type="button">Route A</button>
    </BottomSheet>
  );
}

const sheet = () => screen.getByRole('region', { name: 'Trip results' });
const handle = () => screen.getByRole('button', { name: /^Trip results,/ });

describe('BottomSheet', () => {
  it('sinks to its grip only while minimized at peek, and rises from there when opened', () => {
    render(<Sheet initial="peek" minimized />);
    expect(sheet()).toHaveAttribute('data-minimized');
    fireEvent.click(handle());
    expect(sheet()).toHaveAttribute('data-snap', 'half');
    expect(sheet()).not.toHaveAttribute('data-minimized');
  });

  it('cycles peek, half and full from its handle', () => {
    render(<Sheet initial="peek" />);
    expect(sheet()).toHaveAttribute('data-snap', 'peek');
    expect(handle()).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(handle());
    expect(sheet()).toHaveAttribute('data-snap', 'half');
    expect(handle()).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(handle());
    expect(sheet()).toHaveAttribute('data-snap', 'full');
    fireEvent.click(handle());
    expect(sheet()).toHaveAttribute('data-snap', 'peek');
  });

  it('says its state and what the handle does', () => {
    render(<Sheet initial="full" />);
    expect(handle()).toHaveAccessibleName(/fully open\. Activate to collapse/);
  });

  it('steps with the arrow keys and stops at either end', () => {
    const onChange = vi.fn();
    render(<Sheet initial="half" onChange={onChange} />);
    fireEvent.keyDown(handle(), { key: 'ArrowUp' });
    expect(sheet()).toHaveAttribute('data-snap', 'full');
    fireEvent.keyDown(handle(), { key: 'ArrowUp' });
    expect(onChange).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(handle(), { key: 'ArrowDown' });
    fireEvent.keyDown(handle(), { key: 'ArrowDown' });
    expect(sheet()).toHaveAttribute('data-snap', 'peek');
    fireEvent.keyDown(handle(), { key: 'ArrowDown' });
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it('collapses on Escape', () => {
    render(<Sheet initial="full" />);
    fireEvent.keyDown(handle(), { key: 'Escape' });
    expect(sheet()).toHaveAttribute('data-snap', 'peek');
  });

  it('keeps the hidden body out of reach while collapsed', () => {
    render(<Sheet initial="peek" />);
    const body = screen.getByRole('button', { name: 'Route A', hidden: true }).parentElement;
    expect(body).toHaveAttribute('inert');
    fireEvent.click(handle());
    expect(body).not.toHaveAttribute('inert');
  });

  it('shows the header whatever the snap', () => {
    render(<Sheet initial="peek" />);
    expect(screen.getByText('Route B')).toBeVisible();
  });
});
