import { AnimatedSwitch } from '@/shared/vendor/spectrumui/animated-switch';
import { cn } from '@/shared/lib/cn';

/** Przełącznik z etykietą (Animated Switch ze Spectrum UI: knob rozciąga się przy nacisku, można przeciągać). */
export function Switch({ checked, onCheckedChange, label, description, disabled, size = 'sm', className }) {
  return <div className={cn('flex items-center gap-2.5', disabled && 'opacity-50', className)}>
    <AnimatedSwitch checked={checked} onCheckedChange={onCheckedChange} size={size} disabled={disabled} label={label}/>
    <span aria-hidden className="select-none text-[13px] text-neutral-700" onClick={() => !disabled && onCheckedChange?.(!checked)}>
      {label}{description && <span className="block text-[12px] text-neutral-500">{description}</span>}
    </span>
  </div>;
}
