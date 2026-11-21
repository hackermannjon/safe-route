import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TripSummary } from './TripSummary';

describe('TripSummary', () => {
  it('names the recommended route with its figures and worst level', () => {
    render(
      <TripSummary
        route="Route B"
        distance="292 mi"
        duration="4 h 46 min"
        arrival="Arrives Sat 5:46 AM"
        level="MODERATE"
      />,
    );

    const summary = screen.getByRole('region', { name: 'Recommended route' });
    expect(summary).toHaveTextContent('RecommendedRoute B');
    expect(summary).toHaveTextContent('292 mi');
    expect(summary).toHaveTextContent('4 h 46 min');
    expect(summary).toHaveTextContent('Arrives Sat 5:46 AM');
    expect(summary).toHaveTextContent('Peak riskModerate');
  });
});
