import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RouteList, type RouteListItem } from './RouteList';

const ROUTES: RouteListItem[] = [
  {
    id: 'A',
    label: 'Route A',
    distance: '1,016 mi',
    duration: '15 h 41 min',
    arrival: 'Arrives Sat 11:41 PM',
    via: 'via I-88, I-80, I-76',
    risk: { level: 'HIGH', miles: { LOW: 900, MODERATE: 80, HIGH: 36, SEVERE: 0, NO_TRAVEL: 0 } },
    recommended: false,
    reason: '36 more miles in High risk than Route B.',
  },
  {
    id: 'B',
    label: 'Route B',
    distance: '1,059 mi',
    duration: '16 h 36 min',
    arrival: 'Arrives Sun 12:36 AM',
    via: '',
    risk: { level: 'LOW', miles: { LOW: 1059, MODERATE: 0, HIGH: 0, SEVERE: 0, NO_TRAVEL: 0 } },
    recommended: true,
    reason: 'The only route with no miles at High risk or worse.',
  },
];

describe('RouteList', () => {
  it('shows each route with its figures', () => {
    render(<RouteList routes={ROUTES} selectedId="A" onSelect={() => {}} />);

    const first = screen.getByRole('button', { name: /^Route A/ });
    expect(first).toHaveTextContent('1,016 mi');
    expect(first).toHaveTextContent('15 h 41 min');
    expect(first).toHaveTextContent('Arrives Sat 11:41 PM');
    expect(first).toHaveTextContent('via I-88, I-80, I-76');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('shows the peak level and the miles at each level on every card', () => {
    render(<RouteList routes={ROUTES} selectedId="A" onSelect={() => {}} />);

    const first = screen.getByRole('button', { name: /^Route A/ });
    expect(first).toHaveTextContent('Peak riskHigh');
    expect(within(first).getByRole('img', { name: /Miles by risk/ })).toHaveAccessibleName(
      'Miles by risk: Low 900 mi, Moderate 80 mi, High 36 mi',
    );
    expect(screen.getByRole('button', { name: /^Route B/ })).toHaveTextContent('Peak riskLow');
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

  it('previews a card pointed at with a mouse, but not one touched', () => {
    const onPreview = vi.fn();
    render(<RouteList routes={ROUTES} selectedId="A" onSelect={() => {}} onPreview={onPreview} />);
    const card = screen.getByRole('button', { name: /^Route B/ });

    fireEvent.pointerEnter(card, { pointerType: 'touch' });
    expect(onPreview).not.toHaveBeenCalled();
    fireEvent.pointerEnter(card, { pointerType: 'mouse' });
    expect(onPreview).toHaveBeenLastCalledWith('B');
    fireEvent.pointerLeave(card, { pointerType: 'mouse' });
    expect(onPreview).toHaveBeenLastCalledWith(null);
  });

  it('keeps the order it is given', () => {
    render(<RouteList routes={[ROUTES[1], ROUTES[0]]} selectedId="A" onSelect={() => {}} />);

    const [first, second] = screen.getAllByRole('listitem');
    expect(first).toHaveTextContent('Route B');
    expect(second).toHaveTextContent('Route A');
  });

  it('marks the recommended card only, whichever card is pressed', () => {
    render(<RouteList routes={ROUTES} selectedId="A" onSelect={() => {}} />);

    expect(screen.getByRole('button', { name: /^Route B/ })).toHaveTextContent(/^Route BRecommended/);
    expect(screen.getByRole('button', { name: /^Route A/ })).not.toHaveTextContent('Recommended');
    expect(screen.getAllByText('Recommended')).toHaveLength(1);
  });

  it('shows why each route ranks where it does', () => {
    render(<RouteList routes={ROUTES} selectedId="B" onSelect={() => {}} />);

    expect(screen.getByRole('button', { name: /^Route A/ })).toHaveTextContent(
      '36 more miles in High risk than Route B.',
    );
    expect(screen.getByRole('button', { name: /^Route B/ })).toHaveTextContent(
      'The only route with no miles at High risk or worse.',
    );
  });
});
