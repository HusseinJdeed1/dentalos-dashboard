export type ImportedPatientRow = {
  full_name: string;
  phone: string;
  address?: string | null;
  medical_notes?: string | null;
};

export type PatientImportPreviewRow = ImportedPatientRow & {
  row_number: number;
  normalized_phone: string;
  duplicate_in_file: boolean;
  duplicate_in_clinic: boolean;
  errors: string[];
  can_import: boolean;
};

export function normalizePhoneForImport(value: string) {
  return String(value || '').replace(/[^0-9+]/g, '').trim();
}

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, '_');
}

function mapHeader(header: string) {
  const h = normalizeHeader(header);
  if (['full_name','name','patient_name','الاسم','اسم','اسم_المريض'].includes(h)) return 'full_name';
  if (['phone','mobile','tel','telephone','الهاتف','الجوال','الموبايل','رقم_الهاتف'].includes(h)) return 'phone';
  if (['address','العنوان'].includes(h)) return 'address';
  if (['medical_notes','notes','ملاحظات','ملاحظات_طبية'].includes(h)) return 'medical_notes';
  return h;
}

function parseDelimited(text: string) {
  const delimiter = text.includes('\t') ? '\t' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        value += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        value += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(value.trim());
      value = '';
    } else if (ch === '\n') {
      row.push(value.trim());
      rows.push(row);
      row = [];
      value = '';
    } else if (ch !== '\r') {
      value += ch;
    }
  }
  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

async function unzipXlsxEntries(buffer: ArrayBuffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('تعذر قراءة ملف Excel. جرّب حفظه بصيغة .xlsx حديثة أو CSV.');
  const centralCount = view.getUint16(eocd + 10, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const entries = new Map<string, Uint8Array>();
  let ptr = centralOffset;
  for (let i = 0; i < centralCount; i += 1) {
    if (view.getUint32(ptr, true) !== 0x02014b50) break;
    const method = view.getUint16(ptr + 10, true);
    const compressedSize = view.getUint32(ptr + 20, true);
    const fileNameLength = view.getUint16(ptr + 28, true);
    const extraLength = view.getUint16(ptr + 30, true);
    const commentLength = view.getUint16(ptr + 32, true);
    const localOffset = view.getUint32(ptr + 42, true);
    const name = decoder.decode(bytes.slice(ptr + 46, ptr + 46 + fileNameLength));
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.slice(dataStart, dataStart + compressedSize);
    let data: Uint8Array;
    if (method === 0) {
      data = compressed;
    } else if (method === 8 && typeof DecompressionStream !== 'undefined') {
      const ds = new DecompressionStream('deflate-raw');
      const stream = new Blob([compressed]).stream().pipeThrough(ds);
      data = new Uint8Array(await new Response(stream).arrayBuffer());
    } else {
      throw new Error('المتصفح لا يدعم فك ضغط هذا النوع من ملفات Excel. استخدم CSV كبديل.');
    }
    entries.set(name, data);
    ptr += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries;
}

function xmlText(value: string) {
  return value.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

async function parseXlsx(buffer: ArrayBuffer) {
  const decoder = new TextDecoder();
  const entries = await unzipXlsxEntries(buffer);
  const sharedXml = entries.get('xl/sharedStrings.xml');
  const sharedStrings = sharedXml ? Array.from(decoder.decode(sharedXml).matchAll(/<si[\s\S]*?<\/si>/g)).map((m) => xmlText(m[0])) : [];
  const sheetEntry = entries.get('xl/worksheets/sheet1.xml') || Array.from(entries.entries()).find(([name]) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))?.[1];
  if (!sheetEntry) throw new Error('لا توجد ورقة بيانات داخل ملف Excel.');
  const sheet = decoder.decode(sheetEntry);
  const rowMatches = Array.from(sheet.matchAll(/<row[^>]*>[\s\S]*?<\/row>/g));
  const rows: string[][] = [];
  for (const rowMatch of rowMatches) {
    const cells = Array.from(rowMatch[0].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g));
    const row: string[] = [];
    for (const cell of cells) {
      const attrs = cell[1];
      const body = cell[2];
      const ref = attrs.match(/r="([A-Z]+)\d+"/)?.[1] || '';
      const colIndex = ref ? ref.split('').reduce((acc, ch) => acc * 26 + ch.charCodeAt(0) - 64, 0) - 1 : row.length;
      const raw = body.match(/<v[^>]*>([\s\S]*?)<\/v>/)?.[1] || body.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] || '';
      const isShared = /t="s"/.test(attrs);
      row[colIndex] = isShared ? (sharedStrings[Number(raw)] || '') : xmlText(raw);
    }
    if (row.some(Boolean)) rows.push(row.map((cell) => String(cell || '').trim()));
  }
  return rows;
}

function rowsToPatients(rows: string[][]) {
  const nonEmpty = rows.filter((row) => row.some((cell) => String(cell || '').trim()));
  if (nonEmpty.length < 2) return [];
  const headers = nonEmpty[0].map((cell) => mapHeader(String(cell || '')));
  const patients: ImportedPatientRow[] = [];
  for (const row of nonEmpty.slice(1)) {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => { record[header] = String(row[index] || '').trim(); });
    const fullName = record.full_name || record.name || row[0] || '';
    const phone = record.phone || row[1] || '';
    patients.push({
      full_name: String(fullName || '').trim(),
      phone: String(phone || '').trim(),
      address: record.address || null,
      medical_notes: record.medical_notes || null
    });
  }
  return patients;
}

export async function parsePatientImportFile(file: File): Promise<ImportedPatientRow[]> {
  if (file.size > 2 * 1024 * 1024) throw new Error('حجم ملف الاستيراد كبير. استخدم ملفاً أصغر من 2MB أو قسّم البيانات إلى دفعات.');
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx')) return rowsToPatients(await parseXlsx(await file.arrayBuffer()));
  if (name.endsWith('.csv') || name.endsWith('.txt') || name.endsWith('.tsv')) return rowsToPatients(parseDelimited(await file.text()));
  throw new Error('الملف غير مدعوم. استخدم CSV أو XLSX.');
}

export function buildPatientImportPreview(rows: ImportedPatientRow[], existingPhones: string[] = []): PatientImportPreviewRow[] {
  const existingSet = new Set(existingPhones.map(normalizePhoneForImport).filter(Boolean));
  const fileCounts = new Map<string, number>();
  rows.forEach((row) => {
    const phone = normalizePhoneForImport(row.phone);
    if (phone) fileCounts.set(phone, (fileCounts.get(phone) || 0) + 1);
  });

  return rows.map((row, index) => {
    const normalizedPhone = normalizePhoneForImport(row.phone);
    const errors: string[] = [];
    if (!row.full_name.trim()) errors.push('اسم المريض مطلوب');
    if (!normalizedPhone) errors.push('رقم الهاتف مطلوب');
    if (normalizedPhone && normalizedPhone.length < 6) errors.push('رقم الهاتف قصير جداً');
    const duplicateInFile = Boolean(normalizedPhone && (fileCounts.get(normalizedPhone) || 0) > 1);
    const duplicateInClinic = Boolean(normalizedPhone && existingSet.has(normalizedPhone));
    if (duplicateInFile) errors.push('مكرر داخل الملف');
    if (duplicateInClinic) errors.push('موجود مسبقاً في العيادة');
    return {
      ...row,
      row_number: index + 2,
      normalized_phone: normalizedPhone,
      duplicate_in_file: duplicateInFile,
      duplicate_in_clinic: duplicateInClinic,
      errors,
      can_import: errors.length === 0
    };
  });
}

export function buildPatientImportTemplateCsv() {
  return 'full_name,phone,address,medical_notes\n"أحمد محمد","0999999999","دمشق","لا توجد"\n';
}
