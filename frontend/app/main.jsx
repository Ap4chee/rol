import { createRoot } from 'react-dom/client';
import { ToastProvider } from '@/shared/ui/toaster';
import { TooltipProvider } from '@/shared/ui/tooltip';
import { App } from './App.jsx';

createRoot(document.getElementById('root')).render(<TooltipProvider><ToastProvider><App/></ToastProvider></TooltipProvider>);
