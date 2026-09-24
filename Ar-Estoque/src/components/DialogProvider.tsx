import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { Button } from '@/components/ui';

type DialogOptions = {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

type AlertRequest = {
  id: number;
  kind: 'alert';
  title: string;
  message: string;
  resolve: (value: void) => void;
};
type ConfirmRequest = {
  id: number;
  kind: 'confirm';
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  destructive: boolean;
  resolve: (value: boolean) => void;
};
type PromptRequest = {
  id: number;
  kind: 'prompt';
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  resolve: (value: string | null) => void;
};
type DialogRequest = AlertRequest | ConfirmRequest | PromptRequest;

type DialogContextValue = {
  showAlert: (message: string, options?: DialogOptions) => Promise<void>;
  showConfirm: (message: string, options?: DialogOptions) => Promise<boolean>;
  showPrompt: (message: string, options?: DialogOptions) => Promise<string | null>;
};

const DialogContext = createContext<DialogContextValue | null>(null);
let dispatchDialog: DialogContextValue | null = null;

export function dialogAlert(message: string, options?: DialogOptions) { void dispatchDialog?.showAlert(message, options); }
export function dialogConfirm(message: string, options?: DialogOptions) { return dispatchDialog?.showConfirm(message, options) ?? Promise.resolve(false); }
export function dialogPrompt(message: string, options?: DialogOptions) { return dispatchDialog?.showPrompt(message, options) ?? Promise.resolve(null); }

export function useDialog() {
  const context = useContext(DialogContext);
  if (!context) throw new Error('useDialog deve ser usado dentro de DialogProvider');
  return context;
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<DialogRequest | null>(null);
  const activeRef = useRef<DialogRequest | null>(null);
  const queue = useRef<DialogRequest[]>([]);
  const nextId = useRef(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLInputElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [promptValue, setPromptValue] = useState('');

  const enqueue = useCallback(<T,>(request: { kind: DialogRequest['kind']; title: string; message: string; confirmLabel?: string; cancelLabel?: string; destructive?: boolean }) => (
    new Promise<T>(resolve => {
      const entry = { ...request, id: ++nextId.current, resolve } as DialogRequest;
      if (activeRef.current) queue.current.push(entry);
      else {
        activeRef.current = entry;
        setActive(entry);
      }
    })
  ), []);

  const showAlert = useCallback((message: string, options: DialogOptions = {}) => enqueue<void>({
    kind: 'alert', title: options.title ?? 'Atenção', message,
  }), [enqueue]);

  const showConfirm = useCallback((message: string, options: DialogOptions = {}) => enqueue<boolean>({
    kind: 'confirm', title: options.title ?? 'Confirmar ação', message,
    confirmLabel: options.confirmLabel ?? 'Confirmar', cancelLabel: options.cancelLabel ?? 'Cancelar',
    destructive: options.destructive ?? false,
  }), [enqueue]);

  const showPrompt = useCallback((message: string, options: DialogOptions = {}) => enqueue<string | null>({
    kind: 'prompt', title: options.title ?? 'Informar', message,
    confirmLabel: options.confirmLabel ?? 'Confirmar', cancelLabel: options.cancelLabel ?? 'Cancelar',
  }), [enqueue]);

  const settle = useCallback((result: boolean | string | null) => {
    const current = activeRef.current;
    if (!current) return;

    if (current.kind === 'alert') current.resolve();
    else if (current.kind === 'confirm') current.resolve(result === true);
    else current.resolve(typeof result === 'string' ? result : null);

    const next = queue.current.shift() ?? null;
    activeRef.current = next;
    setActive(next);
  }, []);

  useEffect(() => {
    if (!active) return;
    if (!previousFocus.current) previousFocus.current = document.activeElement as HTMLElement | null;
    if (active.kind === 'prompt') {
      setPromptValue('');
      requestAnimationFrame(() => promptRef.current?.focus());
    } else {
      requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLButtonElement>('[data-dialog-primary]')?.focus());
    }

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        settle(active.kind === 'alert' ? null : active.kind === 'confirm' ? false : null);
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = originalOverflow;
      document.removeEventListener('keydown', handleKeyDown);
      if (!activeRef.current) {
        const target = previousFocus.current;
        previousFocus.current = null;
        requestAnimationFrame(() => target?.focus());
      }
    };
  }, [active, settle]);

  const value: DialogContextValue = { showAlert, showConfirm, showPrompt };
  useEffect(() => {
    const current = { showAlert, showConfirm, showPrompt };
    dispatchDialog = current;
    return () => { if (dispatchDialog === current) dispatchDialog = null; };
  }, [showAlert, showConfirm, showPrompt]);

  return (
    <DialogContext.Provider value={value}>
      {children}
      {active && (
        <div className="motion-backdrop fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-slate-950/55 p-4 backdrop-blur-sm" role="presentation">
          <div
            ref={dialogRef}
            role={active.kind === 'alert' ? 'alertdialog' : 'dialog'}
            aria-modal="true"
            aria-labelledby="app-dialog-title"
            aria-describedby="app-dialog-message"
            className="motion-modal my-auto w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900 sm:p-6"
          >
            <div className="mb-3 flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sky-700 dark:bg-sky-900/60 dark:text-sky-300">
                <AlertTriangle className="h-5 w-5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1 pt-1">
                <h2 id="app-dialog-title" className="text-lg font-semibold text-slate-900 dark:text-slate-100">{active.title}</h2>
              </div>
              <button type="button" onClick={() => settle(active.kind === 'alert' ? null : active.kind === 'confirm' ? false : null)} aria-label="Fechar diálogo" className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200">
                <X className="h-5 w-5" />
              </button>
            </div>

            <p id="app-dialog-message" className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-600 dark:text-slate-300">{active.message}</p>

            {active.kind === 'prompt' && (
              <input
                ref={promptRef}
                type="text"
                value={promptValue}
                onChange={event => setPromptValue(event.target.value)}
                onKeyDown={event => { if (event.key === 'Enter') settle(promptValue); }}
                aria-label={active.message}
                className="mt-4 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/25 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              />
            )}

            <div className="mt-6 flex flex-wrap justify-end gap-2">
              {active.kind !== 'alert' && (
                <Button type="button" variant="secondary" onClick={() => settle(active.kind === 'confirm' ? false : null)}>
                  {active.cancelLabel}
                </Button>
              )}
              <Button
                type="button"
                variant={active.kind === 'confirm' && active.destructive ? 'danger' : 'primary'}
                onClick={() => settle(active.kind === 'alert' ? null : active.kind === 'confirm' ? true : promptValue)}
                data-dialog-primary
              >
                {active.kind === 'alert' ? 'Entendi' : active.confirmLabel}
              </Button>
            </div>
          </div>
        </div>
      )}
    </DialogContext.Provider>
  );
}
