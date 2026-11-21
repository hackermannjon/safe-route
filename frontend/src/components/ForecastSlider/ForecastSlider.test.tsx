import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ForecastSlider, type ForecastSliderProps } from './ForecastSlider';

const BASE: ForecastSliderProps = {
  value: 6,
  max: 48,
  onChange: () => {},
  time: 'Sat 2:00 PM',
  offset: '+6 h',
  status: 'Mile 380',
  valueText: 'Sat 2:00 PM, 6 hours after departure. Truck near mile 380.',
  playing: false,
  onTogglePlay: () => {},
};

function Controlled({ start = 6, onChange }: { start?: number; onChange?: (v: number) => void }) {
  const [value, setValue] = useState(start);
  return (
    <ForecastSlider
      {...BASE}
      value={value}
      onChange={(v) => {
        onChange?.(v);
        setValue(v);
      }}
    />
  );
}

describe('ForecastSlider', () => {
  it('is a named slider from 0 to 48 h with a spoken value', () => {
    render(<ForecastSlider {...BASE} />);
    const slider = screen.getByRole('slider', { name: 'Forecast time' });
    expect(slider).toHaveAttribute('min', '0');
    expect(slider).toHaveAttribute('max', '48');
    expect(slider).toHaveAttribute('step', '1');
    expect(slider).toHaveValue('6');
    expect(slider).toHaveAttribute('aria-valuetext', BASE.valueText);
    expect(screen.getByText('Sat 2:00 PM')).toBeInTheDocument();
    expect(screen.getByText('+6 h')).toBeInTheDocument();
  });

  it.each([
    ['ArrowRight', 7],
    ['ArrowUp', 7],
    ['ArrowLeft', 5],
    ['ArrowDown', 5],
    ['PageUp', 12],
    ['PageDown', 0],
    ['Home', 0],
    ['End', 48],
  ])('%s moves to %i h', (key, expected) => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole('slider'), { key });
    expect(onChange).toHaveBeenCalledWith(expected);
    expect(screen.getByRole('slider')).toHaveValue(String(expected));
  });

  it('stops at the ends instead of reporting a change', () => {
    const onChange = vi.fn();
    render(<Controlled start={48} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowRight' });
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'PageUp' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('reports dragged values as numbers', () => {
    const onChange = vi.fn();
    render(<ForecastSlider {...BASE} onChange={onChange} />);
    fireEvent.change(screen.getByRole('slider'), { target: { value: '18' } });
    expect(onChange).toHaveBeenCalledWith(18);
  });

  it('has a play button that becomes pause while playing', () => {
    const onTogglePlay = vi.fn();
    const { rerender } = render(<ForecastSlider {...BASE} onTogglePlay={onTogglePlay} />);
    fireEvent.click(screen.getByRole('button', { name: 'Play forecast' }));
    expect(onTogglePlay).toHaveBeenCalledTimes(1);
    rerender(<ForecastSlider {...BASE} playing onTogglePlay={onTogglePlay} />);
    expect(screen.getByRole('button', { name: 'Pause forecast' })).toBeInTheDocument();
  });

  it('marks the arrived state', () => {
    render(<ForecastSlider {...BASE} status="Arrived" arrived />);
    expect(screen.getByText('Arrived')).toHaveAttribute('data-arrived', 'true');
  });

  it('names each new day on the scale, leaving off one too close to an end', () => {
    const { container } = render(
      <ForecastSlider
        {...BASE}
        days={[
          { at: 10, label: 'Sun' },
          { at: 34, label: 'Mon' },
          { at: 46, label: 'Tue' },
        ]}
        nights={[{ from: 2.5, to: 17 }]}
      />,
    );
    const scale = container.querySelector('.ticks');
    expect(scale).toHaveTextContent('DepartSunMon+48 h');
    expect(container.querySelectorAll('.midnight')).toHaveLength(3);
    expect(container.querySelectorAll('.night')).toHaveLength(1);
  });
});
