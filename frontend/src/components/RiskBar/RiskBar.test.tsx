import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RiskBadge } from '../RiskBadge';
import { RiskLegend } from '../RiskLegend';
import { RiskBar } from './RiskBar';

const parts = (bar: HTMLElement) =>
  Array.from(bar.children).map((el) => ({
    level: el.getAttribute('data-level'),
    grow: Number((el as HTMLElement).style.flexGrow),
    color: (el as HTMLElement).style.background,
  }));

describe('RiskBar', () => {
  it('sizes each level by its miles, best to worst, and names them for screen readers', () => {
    render(<RiskBar miles={{ LOW: 900.1, MODERATE: 80, HIGH: 38.3, SEVERE: 0, NO_TRAVEL: 0 }} />);
    const bar = screen.getByRole('img');
    expect(bar).toHaveAccessibleName('Miles by risk: Low 900 mi, Moderate 80 mi, High 38 mi');
    expect(parts(bar)).toEqual([
      { level: 'LOW', grow: 900.1, color: 'var(--risk-low)' },
      { level: 'MODERATE', grow: 80, color: 'var(--risk-moderate)' },
      { level: 'HIGH', grow: 38.3, color: 'var(--risk-high)' },
    ]);
  });

  it('keeps the worst level last even when it is the longest', () => {
    render(<RiskBar miles={{ LOW: 10, MODERATE: 0, HIGH: 0, SEVERE: 5, NO_TRAVEL: 200 }} />);
    expect(parts(screen.getByRole('img')).map((p) => [p.level, p.grow])).toEqual([
      ['LOW', 10],
      ['SEVERE', 5],
      ['NO_TRAVEL', 200],
    ]);
  });

  it('says so when there are no miles to show', () => {
    render(<RiskBar miles={{ LOW: 0, MODERATE: 0, HIGH: 0, SEVERE: 0, NO_TRAVEL: 0 }} />);
    const bar = screen.getByRole('img');
    expect(bar).toHaveAccessibleName('Miles by risk: No risk data');
    expect(bar.children).toHaveLength(0);
  });
});

describe('RiskBadge', () => {
  it('always pairs the colour with the word and a glyph', () => {
    const { container } = render(<RiskBadge level="NO_TRAVEL" />);
    const badge = container.firstElementChild as HTMLElement;
    expect(badge).toHaveTextContent('No Travel');
    expect(badge.getAttribute('data-level')).toBe('NO_TRAVEL');
    expect(badge.style.getPropertyValue('--badge-risk')).toBe('var(--risk-notravel)');
    expect(container.querySelector('svg')?.getAttribute('data-glyph')).toBe('octagon');
  });

  it('names the level as the route peak and says what that means', () => {
    const { container } = render(<RiskBadge level="HIGH" peak />);
    expect(container.firstElementChild).toHaveTextContent('Peak riskHigh');
    expect(container.firstElementChild).toHaveAttribute('title', expect.stringMatching(/highest weather risk/));
  });
});

describe('RiskLegend', () => {
  it('lists all five levels, best to worst, each with its own glyph', () => {
    render(<RiskLegend compact />);
    const items = screen.getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual(['Low', 'Moderate', 'High', 'Severe', 'No Travel']);
    expect(items.map((li) => li.querySelector('svg')?.getAttribute('data-glyph'))).toEqual([
      'circle',
      'triangle',
      'diamond',
      'square',
      'octagon',
    ]);
  });
});
