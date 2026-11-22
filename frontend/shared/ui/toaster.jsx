import { createContext, useContext, useMemo } from 'react';
import { AnimatedToastStack, useAnimatedToastStack } from '@/shared/vendor/spectrumui/animated-toast-stack';

const ToastContext = createContext({ toast: () => {} });

/** Powiadomienia (Toast Stack ze Spectrum UI): na dole ekranu, przesunięcie palcem zamyka. */
export function ToastProvider({ children }) {
  const { toasts, showToast, dismissToast } = useAnimatedToastStack({ defaultDuration: 4200, limit: 3 });
  const value = useMemo(() => ({ toast: showToast }), [showToast]);
  return <ToastContext.Provider value={value}>
    {children}
    <AnimatedToastStack toasts={toasts} onDismiss={dismissToast} position="bottom-right" fixed className="no-print"/>
  </ToastContext.Provider>;
}

/** `const { toast } = useToast(); toast({ title, description, status: 'success' | 'error' | 'info' })` */
export function useToast() {
  return useContext(ToastContext);
}
