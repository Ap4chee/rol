import { useId, useState } from 'react';
import { ParcelMap } from './ParcelMap.jsx';
import { Icon } from './ui.jsx';
import { dateText, number } from './model.js';

function outline(geometry, bbox) {
  const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];
  if (!bbox || bbox.length !== 4 || !polygons.length) return '';
  const [minX, minY, maxX, maxY] = bbox;
  if (!(maxX > minX && maxY > minY)) return '';
  return polygons.flatMap((polygon) => polygon.map((ring) => ring.map(([x, y], i) => {
    const u = (x - minX) / (maxX - minX), v = (maxY - y) / (maxY - minY);
    return `${i ? 'L' : 'M'}${(40 + 435 * u + 170 * v).toFixed(2)} ${(110 - 70 * u + 81 * v).toFixed(2)}`;
  }).join(' ') + 'Z')).join(' ');
}

const layerDesign = [
  ['Teren', 'teren.jpg', '#b5ca77', 'NMT · Geoportal'],
  ['Gleba', 'gleba.jpg', '#dab07e', 'SoilGrids'],
  ['Woda', 'woda.jpg', '#75c7e3', 'Sieć cieków i NMT'],
  ['Satelita', 'zielonosc.jpg', '#f2cf73', 'Sentinel-2'],
  ['Działania', null, '#d9f39b', 'Raport działki'],
];

export function FieldLayers({ report, terrain, satellite, actions }) {
  const [mode, setMode] = useState('stack');
  const [active, setActive] = useState(null);
  const id = useId();
  const path = outline(report.parcel?.geometry, report.parcel?.bbox);
  const point = report.parcel ? null : report.request.point;
  const descriptions = [
    terrain?.status === 'ok' ? `Średni spadek · ${number(terrain.slope_mean_pct, 1)}%`
      : terrain?.status === 'pending' ? 'Pobieram ukształtowanie terenu.' : 'Brak danych wysokościowych.',
    report.soil.layers?.[0]?.texture_label ?? 'Brak profilu gleby.',
    report.hydrology.nearest_watercourse_distance_m != null
      ? `Najbliższy ciek · ${number(report.hydrology.nearest_watercourse_distance_m)} m`
      : 'Brak danych o cieku.',
    satellite.latest?.date ? `Ostatnia obserwacja · ${dateText(satellite.latest.date)}`
      : satellite.status === 'pending' ? 'Pobieram obserwacje.' : 'Brak dostępnych obserwacji.',
    actions ? `Propozycje dla działki · ${actions}` : 'Brak propozycji dla tej analizy.',
  ];
  return <section className="layer-panel" aria-labelledby="layer-title">
    <div className="layer-head">
      <h2 id="layer-title">Warstwy działki <Icon name="layers" size={25}/></h2>
      <div className="segments dark-segments no-print" role="group" aria-label="Perspektywa działki">
        <button aria-pressed={mode === 'stack'} disabled={!path} onClick={() => setMode('stack')}>3D</button>
        <button aria-pressed={mode === 'map' || !path} onClick={() => setMode('map')}>Widok z góry</button>
      </div>
    </div>
    <div className="layer-grid">
      <div className="layer-art">
        {mode === 'stack' && path ? <>
          <svg className="layer-diagram" viewBox="0 0 685 409" role="img" aria-label="Przekrój pięciu poglądowych warstw w granicach działki">
            <defs><clipPath id={id}><path d={path} clipRule="evenodd"/></clipPath></defs>
            {layerDesign.map(([name, asset, color], i) => (
              <g key={name} className="plate" opacity={active == null || active === i ? 1 : .32}
                transform={`translate(0 ${(4 - i) * 46 + (active === i ? -8 : 0)})`}>
                <path d={path} transform="translate(0 8)" fill={color} opacity=".47" fillRule="evenodd"/>
                {asset ? <image href={`/design/${asset}`} x="36" y="38" width="612" height="156" preserveAspectRatio="xMidYMid slice" clipPath={`url(#${id})`}/>
                  : <path d={path} fill="#436647" fillOpacity=".85" fillRule="evenodd"/>}
                <path d={path} stroke={color} strokeWidth="2" fill="none" strokeLinejoin="round"/>
              </g>
            ))}
          </svg>
          <p className="art-caption">Obrys z ewidencji · tekstury poglądowe</p>
        </> : <ParcelMap parcel={report.parcel} point={point} terrain={terrain}/>}
      </div>
      <div className="layer-legend">
        {[...layerDesign].reverse().map(([name, asset, color, source], reversed) => {
          const i = layerDesign.length - 1 - reversed;
          return <button className="layer-option" key={name} type="button" aria-pressed={active === i}
            disabled={mode !== 'stack' || !path} onClick={() => setActive(active === i ? null : i)}>
            {asset ? <img src={`/design/${asset}`} alt="" width="38" height="38"/> : <Icon name="pin" size={28}/>}
            <span><strong>{name}</strong><small>{descriptions[i]}</small><small className="layer-source" style={{ color }}>{source}</small></span>
          </button>;
        })}
      </div>
    </div>
  </section>;
}
