import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

/* ------------------------------------------------------------ icônes */

const PATHS: Record<string, string> = {
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4',
  share: 'M12 3v12M7 8l5-5 5 5M5 13v7h14v-7',
  dots: 'M5 12h.01M12 12h.01M19 12h.01',
  trophy: 'M8 4h8v5a4 4 0 0 1-8 0V4zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 20h8M10 17h4',
  bracket: 'M4 5h5v6h5M4 19h5v-6M14 11v2h6',
  list: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
  chart: 'M5 20V10M12 20V4M19 20v-7',
  check: 'M5 12l5 5 9-10',
  x: 'M6 6l12 12M18 6L6 18',
  shuffle: 'M4 7h3c4 0 6 10 10 10h3M4 17h3c1.5 0 2.6-1.4 3.6-3M14 7h6M17 4l3 3-3 3M17 14l3 3-3 3',
  back: 'M15 5l-7 7 7 7',
  play: 'M8 5l11 7-11 7V5z',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 12 0v1M16 3.5a4 4 0 0 1 0 7.5M18 14a6 6 0 0 1 4 6v1',
  reset: 'M4 4v6h6M20 12A8 8 0 0 0 5.6 7.2L4 10M4 12a8 8 0 0 0 14.4 4.8',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 1.2 14H1a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 2.6 7a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 7 2.6 1.7 1.7 0 0 0 8 1.1V1a2 2 0 1 1 4 0v.1A1.7 1.7 0 0 0 15 2.6a1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 19.4 7c.3.6.9 1 1.5 1h.1a2 2 0 1 1 0 4h-.1c-.6 0-1.2.4-1.5 1z',
};

export function Icon({ name, size = 20 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <span className="logo" style={{ fontSize: size }}>
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="var(--accent)" />
        <path d="M7 8h6v6h6M7 24h6v-6M19 14v4h6" stroke="var(--accent-ink)" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>FC<b>TOURNAMENT</b></span>
    </span>
  );
}

/* ------------------------------------------------------------ bottom sheet */

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        {title && (
          <div className="sheet-head">
            <h2>{title}</h2>
            <button className="icon-btn" onClick={onClose} aria-label="Fermer"><Icon name="x" /></button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ confirmation */

interface ConfirmOpts { title: string; message?: string; confirm?: string; danger?: boolean }
type ConfirmFn = (o: ConfirmOpts) => Promise<boolean>;
const ConfirmCtx = createContext<ConfirmFn>(async () => false);
export const useConfirm = () => useContext(ConfirmCtx);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const ask = useCallback<ConfirmFn>((o) => new Promise((resolve) => setState({ ...o, resolve })), []);
  const close = (v: boolean) => { state?.resolve(v); setState(null); };
  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      {state && (
        <div className="sheet-backdrop center" onClick={() => close(false)}>
          <div className="dialog" role="alertdialog" aria-modal="true" aria-label={state.title} onClick={(e) => e.stopPropagation()}>
            <h2>{state.title}</h2>
            {state.message && <p>{state.message}</p>}
            <div className="dialog-actions">
              <button className="btn ghost" onClick={() => close(false)}>Annuler</button>
              <button className={`btn ${state.danger ? 'danger' : 'primary'}`} onClick={() => close(true)} autoFocus>
                {state.confirm ?? 'Confirmer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmCtx.Provider>
  );
}

/* ------------------------------------------------------------ toast */

const ToastCtx = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<number>();
  const show = useCallback((m: string) => {
    setMsg(m);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(null), 2600);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {msg && <div className="toast" role="status">{msg}</div>}
    </ToastCtx.Provider>
  );
}

/* ------------------------------------------------------------ segmented / stepper */

export function Stepper({ value, min, max, onChange, label }: { value: number; min: number; max: number; onChange: (v: number) => void; label: string }) {
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button type="button" className="step-btn" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label="Moins"><Icon name="minus" /></button>
      <output aria-live="polite">{value}</output>
      <button type="button" className="step-btn" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label="Plus"><Icon name="plus" /></button>
    </div>
  );
}
