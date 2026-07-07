'use client';

import { createPortal } from 'react-dom';

export function Modal({ open, title, children, onClose, className = '' }: { open: boolean; title: string; children: React.ReactNode; onClose: () => void; className?: string }) {
  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm">
      <div className={`modal-panel-scroll w-full max-w-2xl rounded-[28px] border border-border bg-white p-6 shadow-premium ${className}`}>
        <div className="mb-5 flex items-center justify-between gap-4">
          <h2 className="text-xl font-black">{title}</h2>
          <button className="ghost-btn" onClick={onClose}>إغلاق</button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}
