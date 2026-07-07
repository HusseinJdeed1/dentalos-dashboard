'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/Icons';
import { StatusBadge } from '@/components/StatusBadge';
import type { Patient } from '@/lib/types';


type Props = {
  patient: Patient;
  canViewFinance: boolean;
  onPrint: () => void;
  onAddAppointment: () => void;
  onEditPatient: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onCreatePlan: () => void;
  onDelete: () => void;
};

export function PatientHeader({ patient, canViewFinance, onPrint, onAddAppointment, onEditPatient, onArchive, onUnarchive, onCreatePlan, onDelete }: Props) {
  const archived = (patient.status || 'active') === 'archived';
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    function handleOutsidePointer(event: MouseEvent | TouchEvent) {
      const target = event.target as HTMLElement | null;
      if (target && !target.closest('[data-dropdown-root="patient-more"]')) setMoreOpen(false);
    }
    if (!moreOpen) return;
    document.addEventListener('mousedown', handleOutsidePointer);
    document.addEventListener('touchstart', handleOutsidePointer, { passive: true });
    return () => {
      document.removeEventListener('mousedown', handleOutsidePointer);
      document.removeEventListener('touchstart', handleOutsidePointer);
    };
  }, [moreOpen]);

  return (
    <div className="premium-card profile-hero-card patient-profile-header-card">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4 text-right patient-profile-identity">
          <div className="patient-person-avatar" aria-hidden="true"><Icon name="user" className="h-9 w-9" /></div>
          <div className="grid gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-black">{patient.full_name}</h1>
              <StatusBadge tone={archived ? 'warning' : 'primary'}>{archived ? 'ملف مؤرشف' : 'ملف نشط'}</StatusBadge>
            </div>
            <p className="text-slate-500"><span className="number-ltr">{patient.phone}</span> · {patient.address || 'لا يوجد عنوان'}</p>
          </div>
        </div>

        <div className="profile-header-actions compact" dir="rtl">
          <button className="premium-btn profile-action-btn" onClick={onAddAppointment}><Icon name="calendar" /> إضافة موعد</button>
          {canViewFinance ? <button className="outline-btn profile-action-btn" onClick={onCreatePlan}><Icon name="plus" /> خطة علاج</button> : null}

          <div className="relative" data-dropdown-root="patient-more">
            <button type="button" className="outline-btn profile-action-btn" onClick={() => setMoreOpen((value) => !value)} aria-haspopup="menu" aria-expanded={moreOpen}>
              المزيد
              <Icon name="chevronDown" className={`dropdown-chevron h-4 w-4 ${moreOpen ? 'is-open' : ''}`} />
            </button>
            {moreOpen ? (
              <div className="patient-header-more-menu" role="menu">
                <button type="button" className="patient-header-more-item" onClick={() => { setMoreOpen(false); onPrint(); }} role="menuitem">طباعة الملف</button>
                <button type="button" className="patient-header-more-item" onClick={() => { setMoreOpen(false); onEditPatient(); }} role="menuitem">تعديل بيانات المريض</button>
                {archived ? (
                  <button type="button" className="patient-header-more-item" onClick={() => { setMoreOpen(false); onUnarchive(); }} role="menuitem">إزالة الأرشفة</button>
                ) : (
                  <button type="button" className="patient-header-more-item" onClick={() => { setMoreOpen(false); onArchive(); }} role="menuitem">أرشفة الملف</button>
                )}
                <button type="button" className="patient-header-more-item is-danger" onClick={() => { setMoreOpen(false); onDelete(); }} role="menuitem">حذف المريض</button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <div className="patient-header-footer-link">
        <Link href="/patients" className="patient-back-link">← العودة إلى المرضى</Link>
      </div>
    </div>
  );
}
