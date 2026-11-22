import { Sprout } from 'lucide-react';
import { cropImage } from '@/shared/assets';
import { cn } from '@/shared/lib/cn';

// wspólny wygląd kafelków uprawy i sylwetki działki (karta pola, nagłówek raportu)
export const TILE = 'size-11 shrink-0 rounded-xl bg-neutral-50 ring-1 ring-inset ring-black/[0.05]';

/** Kafelek uprawy: ilustracja z /design albo ikona, gdy uprawa jej nie ma. `className` zmienia rozmiar kafelka. */
export function CropTile({ crop, className }) {
  const image = cropImage(crop?.key);
  return <span className={cn('grid place-items-center', TILE, className)}>
    {image ? <img src={image} alt="" width="40" height="40" loading="lazy" decoding="async" className="size-[90%] object-contain"/>
      : <Sprout aria-hidden className="size-5 text-brand-600" strokeWidth={1.75}/>}
  </span>;
}
