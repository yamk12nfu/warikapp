"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

type Toast = { id: number; message: string };
type ToastContextValue = { show: (message: string) => void };

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const nextId = useRef(0);
  const toastId = toast?.id;

  const show = useCallback((message: string) => {
    setToast({ id: nextId.current++, message });
  }, []);

  const value = useMemo(() => ({ show }), [show]);

  useEffect(() => {
    if (toastId === undefined) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setToast((current) => (current?.id === toastId ? null : current));
    }, 3000);

    return () => window.clearTimeout(timeoutId);
  }, [toastId]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
      >
        {toast !== null && (
          <div className="rounded-full bg-surface px-4 py-3 text-sm font-bold text-foreground shadow-card">
            {toast.message}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (context === null) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}
