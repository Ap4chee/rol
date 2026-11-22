// Style OpenLayers mapy pól. Kolory i przenikanie liczy blendLook (logic.js); tu tylko zamiana na obiekty `ol.style`.
import { blendLook, lerp } from './logic.js';

/** Biała plakietka z liczbą pól w punkcie etykiety; przy wejściu rośnie razem z kryciem. */
function badge(ol, geometry, count, alpha) {
  const scale = .6 + .4 * alpha, radius = (count > 99 ? 15.5 : 12.5) * scale;
  return [
    new ol.style.Style({ geometry, zIndex: 10, image: new ol.style.Circle({ radius: radius + 3.5, fill: new ol.style.Fill({ color: [13, 35, 23, .1 * alpha] }) }) }),
    new ol.style.Style({ geometry, zIndex: 11,
      image: new ol.style.Circle({ radius, fill: new ol.style.Fill({ color: [255, 255, 255, alpha] }),
        stroke: new ol.style.Stroke({ color: [37, 92, 59, alpha], width: 1.5 }) }),
      text: new ol.style.Text({ text: String(count), font: '600 12.5px Inter, sans-serif', scale, offsetY: 1,
        fill: new ol.style.Fill({ color: [31, 75, 49, alpha] }) }) }),
  ];
}

/** Jednostka administracyjna w chwili przejścia `anim` ({ from, to, t, hover }). */
export function unitStyle(ol, unit, anim) {
  const count = unit.get('fields').length;
  const look = blendLook(unit.get('kod'), count, anim);
  if (!look) return null;
  const styles = [new ol.style.Style({ zIndex: look.zIndex,
    fill: new ol.style.Fill({ color: look.fill }),
    stroke: new ol.style.Stroke({ color: look.stroke, width: look.width, lineJoin: 'round' }),
  })];
  return count && look.badge > .01 ? styles.concat(badge(ol, unit.get('label'), count, look.badge)) : styles;
}

/** Pole: zarys działki i znacznik w środku (widać go także wtedy, gdy działka ma kilka pikseli). Tylko w widoku gminy. */
export function fieldStyle(ol, feature, byCode, { from, to, t, hover }) {
  const shown = (code) => (code.length === 7 && byCode.get(code)?.get('fields').includes(feature) ? 1 : 0);
  const alpha = lerp(shown(from), shown(to), t);
  if (alpha < .01) return null;
  const marker = feature.get('marker');
  const active = hover === feature.get('field').id;
  const styles = [new ol.style.Style({ geometry: marker, zIndex: 2, image: new ol.style.Circle({
    radius: (active ? 8.5 : 7) * (.6 + .4 * alpha), fill: new ol.style.Fill({ color: [37, 92, 59, alpha] }),
    stroke: new ol.style.Stroke({ color: [255, 255, 255, alpha], width: 2.5 }) }) })];
  if (feature.getGeometry() === marker) return styles;
  return [
    new ol.style.Style({ stroke: new ol.style.Stroke({ color: [255, 255, 255, .9 * alpha], width: 5 }) }),
    new ol.style.Style({ fill: new ol.style.Fill({ color: [62, 138, 89, (active ? .55 : .4) * alpha] }),
      stroke: new ol.style.Stroke({ color: [31, 75, 49, alpha], width: 2 }) }),
    ...styles,
  ];
}
