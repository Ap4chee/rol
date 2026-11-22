import { Button } from '@/shared/ui/button';
import { Dialog } from '@/shared/ui/dialog';
import { AddFieldForm } from '@/features/add-field/AddFieldForm';
import { FieldsMap } from '@/features/map/FieldsMap';
import { ParcelMap } from '@/features/map/ParcelMap';

/** Mapa w formularzu: po znalezieniu adresu zdjęcie lotnicze z działkami, wcześniej mapa jednostek z polami. */
function pickerMap({ location, parcel, point, fields, onPick }) {
  return location ? <ParcelMap parcel={parcel} point={point} location={location} onPick={onPick}/>
    : <FieldsMap fields={fields} parcel={parcel} point={point} onPick={onPick}/>;
}

/** Okno dodawania albo edycji pola. Po zamknięciu `field` zostaje, żeby tytuł nie znikał w trakcie animacji wyjścia;
 *  `seq` daje świeży formularz przy każdym otwarciu. */
export function FieldFormDialog({ modal, fields, onClose, onSubmit }) {
  return <Dialog open={modal.open} onOpenChange={(open) => { if (!open) onClose(); }}
    title={modal.field ? 'Edytuj pole' : 'Dodaj pole'} width="lg:max-w-6xl">
    <AddFieldForm key={modal.seq} initial={modal.field} fields={fields} onCancel={onClose} onSubmit={onSubmit} renderMap={pickerMap}/>
  </Dialog>;
}

/** Potwierdzenie usunięcia pola. */
export function DeleteFieldDialog({ deleting, onClose, onConfirm }) {
  return <Dialog open={deleting.open} onOpenChange={(open) => { if (!open) onClose(); }}
    title="Usuń pole"
    description={deleting.field ? `Pole „${deleting.field.name}” i jego raport zostaną usunięte.` : undefined}
    width="lg:max-w-md">
    <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <Button variant="secondary" onClick={onClose} data-autofocus>Anuluj</Button>
      <Button variant="danger" onClick={onConfirm}>Usuń pole</Button>
    </div>
  </Dialog>;
}
