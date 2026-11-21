import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
    render(<RouteList routes={ROUTES} />);

    const [first, second] = screen.getAllByRole('listitem');
    expect(first).toHaveTextContent('Route A');
    expect(first).toHaveTextContent('1,016 mi');
    expect(first).toHaveTextContent('15 h 41 min');
    expect(first).toHaveTextContent('via I-88, I-80, I-76');
    expect(second).toHaveTextContent('Route B');
    expect(second).not.toHaveTextContent('via');
  });
});
