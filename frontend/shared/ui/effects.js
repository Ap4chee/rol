// Komponenty Spectrum UI dostępne dla reszty aplikacji. Funkcje i ekrany biorą je stąd, nie z shared/vendor,
// żeby kod skopiowany z zewnątrz miał jedno wejście.
export { LoadingState } from '@/shared/vendor/spectrumui/loading-state';
export { NumberTicker } from '@/shared/vendor/spectrumui/number-ticker';
export { SkeletonReveal } from '@/shared/vendor/spectrumui/skeleton-reveal';
export { TextStates } from '@/shared/vendor/spectrumui/text-states';
export { StatCards } from '@/shared/vendor/spectrumui/charts/stat-cards';
export { ChartEmpty, useHoverIndexKeys } from '@/shared/vendor/spectrumui/charts/chart-engine';
export {
  ResponsiveModal, ResponsiveModalContent, ResponsiveModalTitle, ResponsiveModalTrigger,
} from '@/shared/vendor/spectrumui/responsive-modal';
