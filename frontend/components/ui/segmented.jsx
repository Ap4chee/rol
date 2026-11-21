import { ModelSelector } from '@/components/spectrumui/model-selector';
import { cn } from '@/lib/utils';

/**
 * Przełącznik kilku widoków (Segmented ze Spectrum UI „Model Selector”): podświetlenie jedzie samym transform.
 * options: [{ value, label }].
 */
export function Segmented({ options, value, onChange, label, className }) {
  return <ModelSelector variant="Segmented" ariaLabel={label} className={cn('max-w-full', className)}
    models={options.map((option) => ({ id: option.value, name: option.label, disabled: option.disabled }))}
    value={value} onChange={onChange}/>;
}
