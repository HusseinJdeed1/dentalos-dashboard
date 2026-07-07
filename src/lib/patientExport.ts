import { supabase } from '@/lib/supabase';
import { logActivity } from '@/lib/audit';
import { showToast } from '@/lib/toast';
import { createXlsxBlob, createZipBlob, rowsToCsv } from '@/lib/zipWorkbook';
import type { Clinic, StaffUser } from '@/lib/types';
import { todayISO } from '@/lib/utils';

type ExportMode = 'excel' | 'json' | 'zip';
type ExportRow = Record<string, unknown>;

type ExportDataset = {
  clinic: ExportRow | null;
  exported_at: string;
  exported_by: ExportRow;
  patients: ExportRow[];
  appointments: ExportRow[];
  visits: ExportRow[];
  treatment_plans: ExportRow[];
  installments: ExportRow[];
  payments: ExportRow[];
  expenses: ExportRow[];
  patient_files: ExportRow[];
  services: ExportRow[];
};

const BATCH_SIZE = 1000;
const patientExportRoles = new Set(['admin', 'doctor']);

function assertExportPermission(staff: StaffUser | null | undefined) {
  if (!staff || !patientExportRoles.has(staff.role)) {
    throw new Error('تصدير بيانات المرضى متاح للطبيب أو المدير فقط.');
  }
}

async function fetchAllRows(table: string, clinicId: string, select = '*') {
  const rows: ExportRow[] = [];
  let from = 0;

  while (true) {
    const to = from + BATCH_SIZE - 1;
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .eq('clinic_id', clinicId)
      .range(from, to);

    if (error) {
      const message = String(error.message || '');
      if (message.includes('does not exist') || message.includes('schema cache')) return rows;
      throw error;
    }

    const batch = (data || []) as unknown as ExportRow[];
    rows.push(...batch);

    if (batch.length < BATCH_SIZE) break;
    from += BATCH_SIZE;
  }

  return rows;
}

function downloadBlob(fileName: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function downloadText(fileName: string, content: string, mimeType: string) {
  downloadBlob(fileName, new Blob([content], { type: mimeType }));
}

function simplifyPatientFiles(rows: ExportRow[]) {
  return rows.map((row) => {
    const imageData = typeof row.image_data === 'string' ? row.image_data : '';
    const isEmbedded = imageData.startsWith('data:');
    return {
      ...row,
      image_data: isEmbedded ? '[بيانات Base64 قديمة - استخدم ZIP للاحتفاظ بالملفات الفعلية]' : imageData,
      has_embedded_data: isEmbedded,
      embedded_data_size: isEmbedded ? imageData.length : 0
    };
  });
}

function exportSheets(dataset: ExportDataset) {
  return [
    ['بيانات التصدير', [{
      exported_at: dataset.exported_at,
      clinic_name: dataset.clinic?.name || '',
      exported_by: dataset.exported_by.full_name || '',
      exported_by_role: dataset.exported_by.role || '',
      patients_count: dataset.patients.length,
      files_count: dataset.patient_files.length
    }]],
    ['المرضى', dataset.patients],
    ['المواعيد', dataset.appointments],
    ['الجلسات الطبية', dataset.visits],
    ['خطط العلاج', dataset.treatment_plans],
    ['الأقساط', dataset.installments],
    ['الدفعات', dataset.payments],
    ['المصروفات', dataset.expenses],
    ['الملفات والمرفقات', simplifyPatientFiles(dataset.patient_files)],
    ['الخدمات المرجعية', dataset.services]
  ] as Array<[string, ExportRow[]]>;
}

async function loadDataset(staff: StaffUser, clinic: Clinic | null): Promise<ExportDataset> {
  const clinicId = staff.clinic_id;

  const [patients, appointments, visits, treatmentPlans, installments, payments, expenses, patientFiles, services] = await Promise.all([
    fetchAllRows('patients', clinicId),
    fetchAllRows('appointments', clinicId),
    fetchAllRows('visits', clinicId),
    fetchAllRows('treatment_plans', clinicId),
    fetchAllRows('installments', clinicId),
    fetchAllRows('payments', clinicId),
    fetchAllRows('expenses', clinicId),
    fetchAllRows('patient_images', clinicId),
    fetchAllRows('services', clinicId)
  ]);

  return {
    clinic: clinic ? { ...clinic } as ExportRow : null,
    exported_at: new Date().toISOString(),
    exported_by: {
      id: staff.id,
      full_name: staff.full_name,
      role: staff.role
    },
    patients,
    appointments,
    visits,
    treatment_plans: treatmentPlans,
    installments,
    payments,
    expenses,
    patient_files: patientFiles,
    services
  };
}

function safeFilePart(value: unknown, fallback = 'file') {
  return String(value || fallback).replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120) || fallback;
}

async function buildBackupZip(dataset: ExportDataset) {
  const entries: Array<{ name: string; data: string | Uint8Array }> = [
    { name: 'manifest.json', data: JSON.stringify({
      exported_at: dataset.exported_at,
      clinic: dataset.clinic,
      exported_by: dataset.exported_by,
      counts: {
        patients: dataset.patients.length,
        appointments: dataset.appointments.length,
        visits: dataset.visits.length,
        treatment_plans: dataset.treatment_plans.length,
        installments: dataset.installments.length,
        payments: dataset.payments.length,
        expenses: dataset.expenses.length,
        patient_files: dataset.patient_files.length,
        services: dataset.services.length
      }
    }, null, 2) },
    { name: 'data/full-backup.json', data: JSON.stringify(dataset, null, 2) },
    ...exportSheets(dataset).map(([title, rows]) => ({ name: `csv/${safeFilePart(title)}.csv`, data: rowsToCsv(rows) }))
  ];

  const failedFiles: ExportRow[] = [];
  for (const file of dataset.patient_files) {
    const storagePath = String(file.storage_path || '');
    const fileName = safeFilePart(file.file_name || file.id || 'attachment');
    const patientId = safeFilePart(file.patient_id || 'unknown-patient');

    if (storagePath) {
      const { data, error } = await supabase.storage.from('patient-files').download(storagePath);
      if (!error && data) {
        const buffer = new Uint8Array(await data.arrayBuffer());
        entries.push({ name: `attachments/${patientId}/${fileName}`, data: buffer });
        continue;
      }
      failedFiles.push({ id: file.id, storage_path: storagePath, file_name: file.file_name, error: error?.message || 'download_failed' });
      continue;
    }

    const imageData = String(file.image_data || '');
    if (imageData.startsWith('data:')) {
      const [meta, base64] = imageData.split(',');
      const extension = meta.includes('png') ? 'png' : meta.includes('webp') ? 'webp' : meta.includes('pdf') ? 'pdf' : 'jpg';
      const binary = Uint8Array.from(atob(base64 || ''), (char) => char.charCodeAt(0));
      entries.push({ name: `attachments/${patientId}/${fileName}.${extension}`, data: binary });
    }
  }

  if (failedFiles.length) entries.push({ name: 'attachments-download-errors.json', data: JSON.stringify(failedFiles, null, 2) });
  return createZipBlob(entries);
}

export async function exportPatientData(staff: StaffUser | null | undefined, clinic: Clinic | null, mode: ExportMode = 'excel') {
  assertExportPermission(staff);
  const activeStaff = staff as StaffUser;
  const dataset = await loadDataset(activeStaff, clinic);
  const date = todayISO();
  const baseName = `dentalos-patients-export-${date}`;

  if (mode === 'json') {
    downloadText(`${baseName}.json`, JSON.stringify(dataset, null, 2), 'application/json;charset=utf-8');
  } else if (mode === 'zip') {
    const blob = await buildBackupZip(dataset);
    downloadBlob(`${baseName}.zip`, blob);
  } else {
    const blob = createXlsxBlob(exportSheets(dataset).map(([name, rows]) => ({ name, rows })));
    downloadBlob(`${baseName}.xlsx`, blob);
  }

  await logActivity(activeStaff, mode === 'json' ? 'patients_backup_json_exported' : mode === 'zip' ? 'patients_backup_zip_exported' : 'patients_excel_xlsx_exported', 'patients', null, null, {
    mode,
    patients_count: dataset.patients.length,
    appointments_count: dataset.appointments.length,
    visits_count: dataset.visits.length,
    treatment_plans_count: dataset.treatment_plans.length,
    installments_count: dataset.installments.length,
    payments_count: dataset.payments.length,
    expenses_count: dataset.expenses.length,
    patient_files_count: dataset.patient_files.length,
    exported_at: dataset.exported_at
  });

  showToast('تم تجهيز ملف التصدير', mode === 'json' ? 'تم تحميل نسخة JSON كاملة.' : mode === 'zip' ? 'تم تحميل ZIP يحتوي CSV ونسخة JSON والملفات الممكن تنزيلها.' : 'تم تحميل ملف Excel حقيقي بصيغة XLSX.', 'success');
}
