import { useId } from 'react';
import { outlinePath } from '@/shared/geo/outline';

/** Sylwetka działki z geometrii raportu, wypełniona bruzdami. Bez geometrii (wskazany punkt) nic nie rysuje. */
export function ParcelOutline({ geometry, className }) {
  const furrows = useId();
  const d = outlinePath(geometry);
  if (!d) return null;
  return <svg viewBox="0 0 100 100" aria-hidden className={className}>
    <defs><pattern id={furrows} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(-35)">
      <path d="M0 4H8" stroke="var(--color-brand-400)" strokeWidth="2.5"/></pattern></defs>
    <path d={d} fillRule="evenodd" fill="var(--color-brand-200)"/>
    <path d={d} fillRule="evenodd" fill={`url(#${furrows})`} stroke="var(--color-brand-700)" strokeWidth="2"
      strokeLinejoin="round" vectorEffect="non-scaling-stroke"/>
  </svg>;
}
