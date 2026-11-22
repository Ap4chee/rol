import { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { DayPicker } from 'react-day-picker';
import { pl } from 'react-day-picker/locale';
import { Button } from './button.jsx';
import { dateText, today } from '../../model.js';

const localDate = (iso) => iso ? new Date(`${iso}T12:00:00`) : undefined;

function isoDate(day) {
  return [String(day.getFullYear()).padStart(4, '0'), day.getMonth() + 1, day.getDate()]
    .map((part) => String(part).padStart(2, '0')).join('-');
}

export function DatePicker({ label, id, describedBy, value, onChange, disabled, invalid, min, max,
  referenceDate, triggerRef, variant, className, icon }) {
  const [open, setOpen] = useState(false);
  const selected = localDate(value);
  const firstDay = localDate(min);
  const lastDay = localDate(max);
  const currentDay = localDate(today());

  function select(day) {
    if (!day) return;
    onChange(isoDate(day));
    setOpen(false);
  }

  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger asChild>
      <Button ref={triggerRef} id={id} variant={variant} className={className} icon={icon} disabled={disabled}
        aria-label={`${label}: ${value ? dateText(value) : 'ustaw datę'}`}
        aria-invalid={invalid || undefined} aria-describedby={describedBy}>
        {value ? dateText(value) : 'Ustaw datę'}
      </Button>
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content aria-label={`Kalendarz: ${label}`} sideOffset={8} collisionPadding={8}
        onOpenAutoFocus={(event) => {
          const day = event.target.querySelector('.rdp-day_button[tabindex="0"]');
          if (!day) return;
          event.preventDefault();
          requestAnimationFrame(() => { if (day.isConnected) day.focus({ preventScroll: true }); });
        }}
        className="z-[60] max-h-[var(--radix-popover-content-available-height)] overflow-auto rounded-xl border border-border bg-background p-3 shadow-overlay outline-none">
        <DayPicker mode="single" required selected={selected} onSelect={select} locale={pl} today={currentDay}
          defaultMonth={selected ?? localDate(referenceDate) ?? currentDay} startMonth={firstDay} endMonth={lastDay}
          captionLayout={firstDay && lastDay ? 'dropdown' : 'label'}
          disabled={[...(firstDay ? [{ before: firstDay }] : []), ...(lastDay ? [{ after: lastDay }] : [])]}
          labels={{ labelPrevious: () => 'Poprzedni miesiąc', labelNext: () => 'Następny miesiąc',
            labelMonthDropdown: () => 'Miesiąc', labelYearDropdown: () => 'Rok' }}
          fixedWeeks showOutsideDays className="crop-date-calendar"/>
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>;
}
