// Spectrum UI (https://spectrumhq.in, github.com/arihantcodes/spectrum-ui), komponent „model-selector”.
// Licencja Apache-2.0 (plik LICENSE w tym katalogu). Zmodyfikowano na potrzeby Asystenta wody: zostawiono tylko typ opcji wyboru.

export interface ModelOption {
  id: string;
  name: string;
  description?: string;
  badge?: string;
  disabled?: boolean;
}
