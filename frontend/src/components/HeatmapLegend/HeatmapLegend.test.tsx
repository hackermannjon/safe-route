import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HeatmapLegend } from './HeatmapLegend';

describe('HeatmapLegend', () => {
  it('lists the five risk levels for the risk view', () => {
    render(<HeatmapLegend metric="risk" />);
    const list = screen.getByRole('list', { name: 'Heatmap risk levels' });
    expect(list.querySelectorAll('li')).toHaveLength(5);
    expect(screen.getByText('No Travel')).toBeInTheDocument();
  });

  it('shows a scale with ticks and the unit for a measured value', () => {
    render(<HeatmapLegend metric="rain" />);
    expect(screen.getByRole('figure', { name: 'Rain scale, in/h' })).toBeInTheDocument();
    expect(screen.getByText('0.25')).toBeInTheDocument();
    expect(screen.getByText('in/h')).toBeInTheDocument();
  });

  it('labels wind in mph', () => {
    render(<HeatmapLegend metric="wind" />);
    expect(screen.getByRole('figure', { name: 'Wind scale, mph' })).toBeInTheDocument();
    expect(screen.getByText('60')).toBeInTheDocument();
  });
});
