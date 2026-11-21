import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RouteList, type RouteListItem } from './RouteList';

const ROUTES: RouteListItem[] = [
  {
    id: 'A',
    label: 'Route A',
    distance: '1,016 mi',
    duration: '15 h 41 min',
    via: 'via I-88, I-80, I-76',
  },
  {
    id: 'B',
    label: 'Route B',
    distance: '1,059 mi',
    duration: '16 h 36 min',
    via: '',
  },
];

describe('RouteList', () => {
  it('shows each route with its figures', () => {
    render(<RouteList routes={ROUTES} selectedId="A" onSelect={() => {}} />);

    const first = screen.getByRole('button', { name: /^Route A/ });
    expect(first).toHaveTextContent('1,016 mi');
    expect(first).toHaveTextContent('15 h 41 min');
    expect(first).toHaveTextContent('via I-88, I-80, I-76');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('marks only the selected route as pressed', () => {
    render(<RouteList routes={ROUTES} selectedId="B" onSelect={() => {}} />);

    expect(screen.getByRole('button', { name: /^Route A/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /^Route B/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('reports the clicked route', () => {
    const onSelect = vi.fn();
    render(<RouteList routes={ROUTES} selectedId="A" onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('button', { name: /^Route B/ }));

    expect(onSelect).toHaveBeenCalledWith('B');
  });
});
