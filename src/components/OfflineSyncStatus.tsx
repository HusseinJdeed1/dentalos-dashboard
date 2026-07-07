'use client';

import { useEffect, useState } from 'react';
import { getOnlineStatus, getPendingOperations, syncPendingOperations } from '@/lib/offline';
import type { StaffUser } from '@/lib/types';
import { LoadingIndicator } from './LoadingIndicator';

export function OfflineSyncStatus({ staff }: { staff: StaffUser | null }) {
  const [online, setOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [lastMessage, setLastMessage] = useState('');

  async function refreshCounts() {
    if (!staff?.clinic_id) {
      setPendingCount(0);
      setFailedCount(0);
      return;
    }
    const ops = await getPendingOperations(staff.clinic_id);
    setPendingCount(ops.filter((op) => op.status === 'pending' || op.status === 'syncing').length);
    setFailedCount(ops.filter((op) => op.status === 'failed').length);
  }

  useEffect(() => {
    setOnline(getOnlineStatus());
    refreshCounts();

    async function handleOnline() {
      setOnline(true);
      setLastMessage('تمت استعادة الاتصال. جاري مزامنة العمليات...');
      setSyncing(true);
      await syncPendingOperations(staff?.clinic_id);
      setSyncing(false);
      refreshCounts();
      window.dispatchEvent(new CustomEvent('dentalos-offline-data-changed'));
    }

    function handleOffline() {
      setOnline(false);
      setLastMessage('أنت تعمل بدون اتصال. سيتم حفظ العمليات الآمنة ومزامنتها عند عودة الإنترنت.');
    }

    function handleQueueChange() {
      refreshCounts();
    }

    function handleSyncStarted() {
      setSyncing(true);
      refreshCounts();
    }

    function handleSyncFinished(event: Event) {
      setSyncing(false);
      refreshCounts();
      const detail = (event as CustomEvent<{ synced?: number; failed?: number }>).detail;
      if (detail?.synced) setLastMessage(`تمت مزامنة ${detail.synced} عملية بنجاح.`);
      if (detail?.failed) setLastMessage(`تعذرت مزامنة ${detail.failed} عملية. افتح مركز المزامنة للمراجعة.`);
      window.dispatchEvent(new CustomEvent('dentalos-offline-data-changed'));
    }

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('dentalos-offline-queue-changed', handleQueueChange);
    window.addEventListener('dentalos-offline-sync-started', handleSyncStarted);
    window.addEventListener('dentalos-offline-sync-finished', handleSyncFinished as EventListener);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('dentalos-offline-queue-changed', handleQueueChange);
      window.removeEventListener('dentalos-offline-sync-started', handleSyncStarted);
      window.removeEventListener('dentalos-offline-sync-finished', handleSyncFinished as EventListener);
    };
  }, [staff?.clinic_id]);

  if (online && pendingCount === 0 && failedCount === 0 && !syncing) return null;

  return (
    <div className={`offline-sync-banner ${online ? 'is-online' : 'is-offline'}`}>
      <div className="offline-sync-copy">
        <strong>{online ? 'الاتصال متاح' : 'وضع بدون اتصال'}</strong>
        <span>
          {syncing ? 'جاري مزامنة العمليات المحفوظة...' : lastMessage || (online ? 'كل شيء جاهز.' : 'يمكن متابعة العمليات الآمنة، وسيتم حفظها مؤقتًا.')}
        </span>
      </div>
      <div className="offline-sync-actions">
        {syncing ? <LoadingIndicator compact /> : null}
        {pendingCount || failedCount ? <span className="offline-sync-count">{pendingCount + failedCount} عملية بانتظار المزامنة</span> : null}
        {online && (pendingCount > 0 || failedCount > 0) ? (
          <button type="button" className="outline-btn px-3 py-2" onClick={() => syncPendingOperations(staff?.clinic_id)}>
            إعادة المزامنة
          </button>
        ) : null}
      </div>
    </div>
  );
}
