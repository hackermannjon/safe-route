import { useId, type ReactNode, type SVGProps } from 'react';
import type { WeatherSky } from '../../lib/weatherCodes';

export type WeatherIconName =
  WeatherSky | 'clear-night' | 'partly-night' | 'wind' | 'gust' | 'temp' | 'drop' | 'flake' | 'risk' | 'weight';

const CLOUD = 'M7 19a4 4 0 0 1-.55-7.96 5.5 5.5 0 0 1 10.66-1.62A4.75 4.75 0 0 1 16.75 19H7Z';
/** The cloud raised and shrunk to leave room for what falls from it. */
const CLOUD_HIGH = 'translate(1.2 -2.6) scale(0.9)';
/** The cloud lowered to the right, in front of a sun or moon. */
const CLOUD_FRONT = 'translate(3.2 3.4) scale(0.82)';
const MOON = 'M20 14.6A8 8 0 1 1 9.4 4a6.2 6.2 0 0 0 10.6 10.6Z';

function rays(cx: number, cy: number, from: number, to: number): string {
  return Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4;
    const [c, s] = [Math.cos(a), Math.sin(a)];
    return `M${(cx + c * from).toFixed(2)} ${(cy + s * from).toFixed(2)}L${(cx + c * to).toFixed(2)} ${(cy + s * to).toFixed(2)}`;
  }).join('');
}

function flake(cx: number, cy: number, r: number): string {
  return [0, 60, 120]
    .map((deg) => {
      const a = (deg * Math.PI) / 180;
      const [dx, dy] = [Math.sin(a) * r, Math.cos(a) * r];
      return `M${(cx - dx).toFixed(2)} ${(cy - dy).toFixed(2)}L${(cx + dx).toFixed(2)} ${(cy + dy).toFixed(2)}`;
    })
    .join('');
}

const SUN = <path d={`M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z${rays(12, 12, 6.6, 9)}`} />;
const SMALL_SUN = <path d={`M8.5 5.8a2.7 2.7 0 1 0 0 5.4 2.7 2.7 0 0 0 0-5.4Z${rays(8.5, 8.5, 4.4, 6.1)}`} />;
const SMALL_MOON = <path d={MOON} transform="translate(1.4 1.4) scale(0.6)" />;
const HIGH_CLOUD = <path d={CLOUD} transform={CLOUD_HIGH} />;

const BELOW: Partial<Record<WeatherIconName, string>> = {
  drizzle: 'M8.4 17.4l-.7 1.8M12.4 19.4l-.7 1.8M16.4 17.4l-.7 1.8',
  rain: 'M8.6 16.8l-1.6 4.4M12.6 16.8l-1.6 4.4M16.6 16.8l-1.6 4.4',
  snow: `${flake(8, 18.6, 1.7)}${flake(12.6, 20.8, 1.7)}${flake(17, 18.6, 1.7)}`,
  freezing: `M8.4 16.8l-1.6 4.4${flake(12.6, 19.8, 1.7)}M17.2 16.8l-1.6 4.4`,
  thunder: 'M13.2 15.4l-2.6 3.9h3.1l-2.3 3.3',
  fog: 'M5 18.2h14M7.5 21.4h10',
};

const READINGS: Partial<Record<WeatherIconName, ReactNode>> = {
  wind: <path d="M3 8.5h10a2.5 2.5 0 1 0-2.5-2.5M3 12.5h15a3 3 0 1 1-3 3M3 16.5h6" />,
  gust: <path d="M3 7h8a2.5 2.5 0 1 0-2.5-2.5M3 11h17M3 15h12a2.5 2.5 0 1 1-2.5 2.5M3 19h5" />,
  temp: <path d="M10 14V5.5a2 2 0 1 1 4 0V14a4 4 0 1 1-4 0ZM12 9v8" />,
  drop: <path d="M12 3.5S6.5 9.6 6.5 14a5.5 5.5 0 0 0 11 0c0-4.4-5.5-10.5-5.5-10.5Z" />,
  flake: <path d={`${flake(12, 12, 9)}M9.6 4.2 12 6l2.4-1.8M9.6 19.8 12 18l2.4 1.8`} />,
  risk: <path d="M12 3 5 6v5.2c0 4.4 3 8.3 7 9.8 4-1.5 7-5.4 7-9.8V6l-7-3ZM12 8.5v4.5M12 16.2v.1" />,
  weight: <path d="M9.5 7.5a2.5 2.5 0 1 1 5 0M6.8 7.5h10.4L20 20H4L6.8 7.5Z" />,
  clear: SUN,
  'clear-night': <path d={MOON} />,
  cloudy: <path d={CLOUD} />,
};

interface WeatherIconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: WeatherIconName;
  size?: number;
}

/** Line icons for weather and its readings. Decorative: the text beside them says the same. */
export function WeatherIcon({ name, size = 20, ...rest }: WeatherIconProps) {
  const maskId = useId();
  let body = READINGS[name];
  if (!body && (name === 'partly' || name === 'partly-night')) {
    // The cloud is cut out of the sun or moon behind it, with a gap, as a filled icon would show it.
    body = (
      <>
        <mask id={maskId}>
          <rect width="24" height="24" fill="white" stroke="none" />
          <path d={CLOUD} transform={CLOUD_FRONT} fill="black" stroke="black" strokeWidth="4" />
        </mask>
        <g mask={`url(#${maskId})`}>{name === 'partly' ? SMALL_SUN : SMALL_MOON}</g>
        <path d={CLOUD} transform={CLOUD_FRONT} />
      </>
    );
  }
  if (!body) {
    body = (
      <>
        {HIGH_CLOUD}
        <path d={BELOW[name]} />
      </>
    );
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-icon={name}
      {...rest}
    >
      {body}
    </svg>
  );
}
