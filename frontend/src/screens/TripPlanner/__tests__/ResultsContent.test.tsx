import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../../../components/CheckpointTimeline';
import type { RouteListItem } from '../../../components/RouteList';
import { ResultsContent, type ResultsContentProps } from '../ResultsContent';

const route = (id: string): RouteListItem => ({
  id,
  label: `Route ${id}`,
  distance: '130 mi',
  duration: '2 h 10 min',
  arrival: 'Arrives Sun 7:10 AM',
  via: 'via I-40',
});

const TIMELINE: TimelineItem[] = Array.from({ length: 40 }, (_, index) => ({
  index,
  place: `Mile ${index * 10}`,
  eta: 'Sun 5:00 AM',
  weather: 'Clear · Wind 8 mph · 50°F',
  kind: index === 0 ? 'origin' : 'stop',
}));

const props = (selectedRouteId: string): ResultsContentProps => ({
  status: 'ready',
  error: null,
  onRetry: () => {},
  onDismissError: () => {},
  heading: '3 routes',
  notices: [],
  routes: [route('A'), route('B'), route('C')],
  selectedRouteId,
  onSelectRoute: () => {},
  timeline: TIMELINE,
  selectedCheckpoint: null,
  onSelectCheckpoint: () => {},
});

describe('ResultsContent', () => {
  it('keeps every route card ahead of the long checkpoint list', () => {
    render(<ResultsContent {...props('A')} />);

    const cards = screen.getAllByRole('button', { name: /^Route [ABC]/ });
    const timeline = screen.getByRole('list', { name: 'Checkpoints' });
    expect(cards).toHaveLength(3);
    for (const card of cards) {
      expect(card.compareDocumentPosition(timeline) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('names the route whose checkpoints are listed', () => {
    render(<ResultsContent {...props('B')} />);

    expect(screen.getByRole('heading', { name: 'Checkpoints · Route B' })).toBeInTheDocument();
  });
});
