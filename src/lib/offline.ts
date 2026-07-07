import { supabase } from './supabase';
import { completeAppointmentWithVisit, type AppointmentCompletionInput } from './appointmentCompletion';
import type { Appointment, Clinic, Patient, Service, StaffUser, WorkingHour } from './types';

export type OfflineOperationType = 'create_patient' | 'create_appointment' | 'update_patient_medical_notes' | 'complete_appointment';
export type OfflineOperationStatus = 'pending' | 'syncing' | 'failed' | 'done';

export type OfflineOperation<T = any> = {
  id: string;
  clinic_id: string;
  type: OfflineOperationType;
  payload: T;
  status: OfflineOperationStatus;
  error?: string | null;
  created_at: string;
  updated_at?: string | null;
};

type CacheRecord<T = any> = {
  key: string;
  value: T;
  updated_at: string;
};

const DB_NAME = 'dentalos-offline-v1';
const DB_VERSION = 1;
const CACHE_STORE = 'cache';
const OPERATIONS_STORE = 'pending_operations';
const LOCAL_PREFIX = 'local_';

let dbPromise: Promise<IDBDatabase> | null = null;

function isBrowser() {
  return typeof window !== 'undefined' && 'indexedDB' in window;
}

function openDb() {
  if (!isBrowser()) return Promise.reject(new Error('IndexedDB is not available'));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CACHE_STORE)) {
        db.createObjectStore(CACHE_STORE, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(OPERATIONS_STORE)) {
        const store = db.createObjectStore(OPERATIONS_STORE, { keyPath: 'id' });
        store.createIndex('status', 'status', { unique: false });
        store.createIndex('clinic_id', 'clinic_id', { unique: false });
        store.createIndex('created_at', 'created_at', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Failed to open offline database'));
  });
  return dbPromise;
}

async function tx<T>(storeName: string, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    const request = run(store);
    let result: T | void;
    if (request) {
      request.onsuccess = () => { result = request.result; };
      request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
    }
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed'));
  });
}

export function getOnlineStatus() {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

export function makeLocalId(prefix = 'local') {
  const random = Math.random().toString(36).slice(2, 9);
  return `${LOCAL_PREFIX}${prefix}_${Date.now()}_${random}`;
}

export function isLocalId(value?: string | null) {
  return Boolean(value && value.startsWith(LOCAL_PREFIX));
}

export async function getCache<T>(key: string): Promise<T | null> {
  if (!isBrowser()) return null;
  try {
    const record = await tx<CacheRecord<T>>(CACHE_STORE, 'readonly', (store) => store.get(key) as IDBRequest<CacheRecord<T>>);
    return record?.value ?? null;
  } catch (error) {
    console.warn('Offline cache read failed', key, error);
    return null;
  }
}

export async function setCache<T>(key: string, value: T) {
  if (!isBrowser()) return;
  try {
    await tx(CACHE_STORE, 'readwrite', (store) => store.put({ key, value, updated_at: new Date().toISOString() } satisfies CacheRecord<T>));
  } catch (error) {
    console.warn('Offline cache write failed', key, error);
  }
}

export async function appendToCachedList<T extends { id?: string }>(key: string, item: T) {
  const current = (await getCache<T[]>(key)) || [];
  const next = [item, ...current.filter((row) => !row.id || row.id !== item.id)];
  await setCache(key, next);
}

export async function updateCachedList<T extends { id?: string }>(key: string, updater: (rows: T[]) => T[]) {
  const current = (await getCache<T[]>(key)) || [];
  await setCache(key, updater(current));
}

export const offlineKeys = {
  staff: () => 'staff:current',
  clinic: () => 'clinic:current',
  appointments: (clinicId: string) => `appointments:${clinicId}`,
  patients: (clinicId: string) => `patients:${clinicId}`,
  recentPatients: (clinicId: string) => `patients:${clinicId}:recent`,
  services: (clinicId: string) => `services:${clinicId}`,
  workingHours: (clinicId: string) => `working-hours:${clinicId}`,
  patientProfile: (clinicId: string, patientId: string) => `patient-profile:${clinicId}:${patientId}`,
  pendingCount: (clinicId: string) => `pending-count:${clinicId}`
};

export async function cacheCoreContext(staff?: StaffUser | null, clinic?: Clinic | null) {
  if (staff) await setCache(offlineKeys.staff(), staff);
  if (clinic) await setCache(offlineKeys.clinic(), clinic);
}

export async function queueOperation<T>(clinicId: string, type: OfflineOperationType, payload: T) {
  const operation: OfflineOperation<T> = {
    id: makeLocalId('op'),
    clinic_id: clinicId,
    type,
    payload,
    status: 'pending',
    error: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  await tx(OPERATIONS_STORE, 'readwrite', (store) => store.put(operation));
  window.dispatchEvent(new CustomEvent('dentalos-offline-queue-changed'));
  return operation;
}

export async function getPendingOperations(clinicId?: string | null) {
  if (!isBrowser()) return [] as OfflineOperation[];
  try {
    const all = await tx<OfflineOperation[]>(OPERATIONS_STORE, 'readonly', (store) => store.getAll() as IDBRequest<OfflineOperation[]>);
    return (all || [])
      .filter((op) => (!clinicId || op.clinic_id === clinicId) && op.status !== 'done')
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  } catch (error) {
    console.warn('Pending operations read failed', error);
    return [];
  }
}

async function putOperation(operation: OfflineOperation) {
  await tx(OPERATIONS_STORE, 'readwrite', (store) => store.put({ ...operation, updated_at: new Date().toISOString() }));
}

async function deleteOperation(id: string) {
  await tx(OPERATIONS_STORE, 'readwrite', (store) => store.delete(id));
}

async function syncCreatePatient(operation: OfflineOperation) {
  const payload = operation.payload as any;
  const { local_id, ...insertPayload } = payload;
  const { data, error } = await supabase.from('patients').insert(insertPayload).select('*').single();
  if (error) throw error;
  if (data) {
    await updateCachedList<Patient>(offlineKeys.patients(operation.clinic_id), (rows) => [data as Patient, ...rows.filter((row) => row.id !== local_id && row.id !== data.id)]);
    await updateCachedList<Patient>(offlineKeys.recentPatients(operation.clinic_id), (rows) => [data as Patient, ...rows.filter((row) => row.id !== local_id && row.id !== data.id)].slice(0, 30));
  }
}

async function syncCreateAppointment(operation: OfflineOperation) {
  const payload = operation.payload as any;
  const { local_id, patients, services, ...insertPayload } = payload;
  const { data, error } = await supabase
    .from('appointments')
    .insert(insertPayload)
    .select('*, patients(*), services(*)')
    .single();
  if (error) throw error;
  if (data) {
    await updateCachedList<Appointment>(offlineKeys.appointments(operation.clinic_id), (rows) => [data as Appointment, ...rows.filter((row) => row.id !== local_id && row.id !== data.id)]);
  }
}

async function syncUpdateMedicalNotes(operation: OfflineOperation) {
  const payload = operation.payload as { patient_id: string; medical_notes: string | null; clinic_id: string };
  const { error } = await supabase
    .from('patients')
    .update({ medical_notes: payload.medical_notes })
    .eq('clinic_id', payload.clinic_id)
    .eq('id', payload.patient_id);
  if (error) throw error;
}

async function syncCompleteAppointment(operation: OfflineOperation) {
  const input = operation.payload as AppointmentCompletionInput;
  const result = await completeAppointmentWithVisit(input);
  if (result.error) throw new Error(result.error);
}

async function syncOne(operation: OfflineOperation) {
  if (operation.type === 'create_patient') return syncCreatePatient(operation);
  if (operation.type === 'create_appointment') return syncCreateAppointment(operation);
  if (operation.type === 'update_patient_medical_notes') return syncUpdateMedicalNotes(operation);
  if (operation.type === 'complete_appointment') return syncCompleteAppointment(operation);
}

let syncing = false;

export async function syncPendingOperations(clinicId?: string | null) {
  if (!getOnlineStatus() || syncing) return { synced: 0, failed: 0 };
  syncing = true;
  window.dispatchEvent(new CustomEvent('dentalos-offline-sync-started'));
  let synced = 0;
  let failed = 0;
  try {
    const operations = await getPendingOperations(clinicId);
    for (const operation of operations) {
      try {
        await putOperation({ ...operation, status: 'syncing', error: null });
        await syncOne(operation);
        await deleteOperation(operation.id);
        synced += 1;
      } catch (error) {
        failed += 1;
        await putOperation({
          ...operation,
          status: 'failed',
          error: String((error as { message?: string })?.message || error || 'تعذرت المزامنة')
        });
      }
    }
  } finally {
    syncing = false;
    window.dispatchEvent(new CustomEvent('dentalos-offline-sync-finished', { detail: { synced, failed } }));
    window.dispatchEvent(new CustomEvent('dentalos-offline-queue-changed'));
  }
  return { synced, failed };
}
