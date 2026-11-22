import { ArrowLeft, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { Callout } from '@/shared/ui/callout';
import { MoreMenu } from '@/shared/ui/menu';
import { GenerationSteps } from './GenerationSteps.jsx';
import { JobBadge } from './JobBadge.jsx';

/** Pole zapisane, ale jego pierwszy raport jeszcze się liczy na serwerze (albo liczenie się nie udało). */
export function FieldPending({ field, onEdit, onDelete, onBack }) {
  return <div className="flex flex-col gap-6">
    <Button variant="ghost" size="sm" icon={<ArrowLeft/>} onClick={onBack} className="-ml-2 self-start">Wstecz</Button>
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="font-display text-[28px] font-semibold leading-[1.05] tracking-tight md:text-[34px]">{field.name}</h1>
        <div role="status" className="mt-3"><JobBadge field={field}/></div>
      </div>
      <MoreMenu items={[{ label: 'Edytuj pole', icon: Pencil, onSelect: onEdit },
        { label: 'Usuń pole', icon: Trash2, onSelect: onDelete, danger: true }]}/>
    </header>
    {field.job === 'error'
      ? <Callout tone="danger" title="Raport się nie policzył">{field.error} Serwer spróbuje ponownie sam.</Callout>
      : <GenerationSteps field={field}/>}
  </div>;
}
