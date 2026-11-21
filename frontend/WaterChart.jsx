import { useEffect, useRef, useState } from 'react';
import { Group, Text } from '@mantine/core';
import { dateText, number } from './model.js';

const MONTHS = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
const PAD = { top: 16, right: 16, bottom: 46, left: 40 };

/** Zapas wody w strefie korzeni (% TAW) w ostatnich miesiącach na tle tych samych dni w 10 latach, z prognozą. */
export function WaterChart({ series, forecast = [], color, height = 300 }) {
  const box = useRef(null);
  const [width, setWidth] = useState(800);
  const [hover, setHover] = useState(null);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(320, entry.contentRect.width)));
    observer.observe(box.current);
    return () => observer.disconnect();
  }, []);
  const points = [...series.map((p) => ({ ...p, kind: 'past' })), ...forecast.map((p) => ({ ...p, kind: 'forecast' }))];
  if (points.length < 2) return <div ref={box}><Text c="dimmed">Za mało dni, żeby narysować przebieg zapasu.</Text></div>;

  const w = width - PAD.left - PAD.right, h = height - PAD.top - PAD.bottom;
  const x = (i) => PAD.left + w * i / (points.length - 1);
  const y = (pct) => PAD.top + h * (1 - Math.min(100, Math.max(0, pct)) / 100);
  const line = (key, from = 0, to = points.length) => points.slice(from, to)
    .map((p, j) => (p[key] == null ? null : `${x(from + j).toFixed(1)},${y(p[key]).toFixed(1)}`)).filter(Boolean).join(' ');
  const band = series.map((p, i) => (p.typical_p90_pct == null ? null : [i, p])).filter(Boolean);
  const bandPath = band.length > 1
    ? `M${band.map(([i, p]) => `${x(i)},${y(p.typical_p90_pct)}`).join('L')}L${[...band].reverse().map(([i, p]) => `${x(i)},${y(p.typical_p10_pct)}`).join('L')}Z`
    : null;
  const today = series.length - 1;
  const maxRain = Math.max(10, ...points.map((p) => p.rain_mm ?? 0));
  const rainH = 26;
  const months = points.map((p, i) => [i, p.date]).filter(([, d]) => d.slice(8) === '01');
  const active = hover == null ? null : points[hover];

  function move(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    const i = Math.round((event.clientX - rect.left - PAD.left) / w * (points.length - 1));
    setHover(i >= 0 && i < points.length ? i : null);
  }

  return <div ref={box} className="water-chart">
    <svg width={width} height={height} onPointerMove={move} onPointerLeave={() => setHover(null)} role="img"
      aria-label="Zapas wody w strefie korzeni w ostatnich miesiącach na tle 10 lat">
      {[0, 25, 50, 75, 100].map((v) => <g key={v}>
        <line x1={PAD.left} x2={PAD.left + w} y1={y(v)} y2={y(v)} className="grid"/>
        <text x={PAD.left - 8} y={y(v) + 4} textAnchor="end" className="axis">{v}%</text>
      </g>)}
      {months.map(([i, d]) => <text key={d} x={x(i)} y={height - 8} textAnchor="middle" className="axis">{MONTHS[Number(d.slice(5, 7)) - 1]}</text>)}
      {points.map((p, i) => p.rain_mm > 0.5 && <rect key={p.date} x={x(i) - Math.max(1, w / points.length / 2.5)} width={Math.max(2, w / points.length / 1.25)}
        y={PAD.top + h - rainH * p.rain_mm / maxRain} height={rainH * p.rain_mm / maxRain} className={`rain ${p.kind}`}/>)}
      {bandPath && <path d={bandPath} className="band"/>}
      <polyline points={line('typical_median_pct', 0, series.length)} className="median"/>
      <polyline points={line('stress_threshold_pct')} className="threshold"/>
      {forecast.length > 0 && <rect x={x(today)} y={PAD.top} width={x(points.length - 1) - x(today)} height={h} className="forecast-zone"/>}
      <polyline points={line('available_pct', 0, series.length)} pathLength={1} className="actual past" style={{ stroke: color }}/>
      {forecast.length > 0 && <polyline points={line('available_pct', today, points.length)} className="actual forecast" style={{ stroke: color }}/>}
      <line x1={x(today)} x2={x(today)} y1={PAD.top} y2={PAD.top + h} className="today"/>
      <circle cx={x(today)} cy={y(series[today].available_pct)} r={6} style={{ fill: color }} className="today-dot"/>
      <text x={x(today) + (forecast.length ? 8 : -8)} y={PAD.top + 12} textAnchor={forecast.length ? 'start' : 'end'} className="axis strong">
        {forecast.length ? 'prognoza →' : dateText(series[today].date)}</text>
      {active && <g>
        <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + h} className="cursor"/>
        <circle cx={x(hover)} cy={y(active.available_pct)} r={4} style={{ fill: color }}/>
      </g>}
    </svg>
    {active && <div className="chart-tip" style={{ left: Math.min(x(hover) + 12, width - 210) }}>
      <Text size="xs" c="dimmed">{dateText(active.date)}{active.kind === 'forecast' ? ' · prognoza' : ''}</Text>
      <Text size="sm" fw={700}>Zapas {number(active.available_pct)}%</Text>
      {active.typical_median_pct != null && <Text size="xs">typowo {number(active.typical_median_pct)}% (zwykle {number(active.typical_p10_pct)}–{number(active.typical_p90_pct)}%)</Text>}
      <Text size="xs">opad {number(active.rain_mm, 1)} mm · próg stresu {number(active.stress_threshold_pct)}%</Text>
    </div>}
    <Group gap="lg" mt={4} className="chart-legend">
      <span><i className="key actual" style={{ background: color }}/>zapas na tym polu</span>
      <span><i className="key band"/>zwykle w tych dniach (10 lat, 10–90%)</span>
      <span><i className="key median"/>mediana 10 lat</span>
      <span><i className="key threshold"/>próg stresu uprawy</span>
      <span><i className="key rain"/>opad</span>
    </Group>
  </div>;
}
