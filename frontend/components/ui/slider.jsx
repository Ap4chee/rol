import { DualRangeSlider } from '@/components/spectrumui/dual-range-slider';
import { cn } from '@/lib/utils';

/** Suwak jednej wartości (Dual Range Slider ze Spectrum UI z jednym uchwytem). `valueText(value)`: wartość czytana przez czytnik ekranu. */
export function Slider({ value, onChange, min = 0, max = 100, step = 1, label, valueText, className }) {
  return <DualRangeSlider aria-label={label} valueText={valueText} className={cn('py-2', className)} min={min} max={max} step={step}
    value={[value]} onValueChange={([next]) => onChange(next)}/>;
}
