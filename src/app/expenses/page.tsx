'use client';

import { useEffect, useMemo, useState } from 'react';
import { AccessDenied } from '@/components/AccessDenied';
import { AppShell, type AppContext } from '@/components/AppShell';
import { Icon } from '@/components/Icons';
import { Modal } from '@/components/Modal';
import { StatTile } from '@/components/StatTile';
import { canViewFullFinancials } from '@/lib/permissions';
import { requestActionConfirmation, requestPasswordConfirmation, showSecureMessage } from '@/lib/secureActions';
import { supabase } from '@/lib/supabase';
import type { Expense } from '@/lib/types';
import { formatDate, formatMoney, getCurrencySymbol, monthStartISO, todayISO } from '@/lib/utils';

const expenseCategories = [
  { value: 'medical_materials', label: 'مواد طبية' },
  { value: 'lab', label: 'مخبر' },
  { value: 'sterilization', label: 'تعقيم' },
  { value: 'rent', label: 'إيجار' },
  { value: 'salaries', label: 'رواتب' },
  { value: 'maintenance', label: 'صيانة' },
  { value: 'utilities', label: 'كهرباء ومياه' },
  { value: 'marketing', label: 'تسويق وإعلانات' },
  { value: 'software', label: 'برامج واشتراكات' },
  { value: 'other', label: 'أخرى' }
];

const categoryLabels = Object.fromEntries(expenseCategories.map((item) => [item.value, item.label])) as Record<string, string>;
const paymentMethodLabels: Record<string, string> = { cash: 'نقداً', card: 'بطاقة', transfer: 'تحويل', other: 'أخرى' };
const paymentMethods = [
  { value: 'cash', label: 'نقداً' },
  { value: 'card', label: 'بطاقة' },
  { value: 'transfer', label: 'تحويل' },
  { value: 'other', label: 'أخرى' }
];

type ExpenseForm = {
  category: string;
  amount: string;
  expense_date: string;
  payment_method: 'cash' | 'transfer' | 'card' | 'other';
  notes: string;
};

const createEmptyForm = (): ExpenseForm => ({
  category: 'medical_materials',
  amount: '',
  expense_date: todayISO(),
  payment_method: 'cash',
  notes: ''
});

function includesSearch(expense: Expense, query: string) {
  if (!query) return true;
  const q = query.trim().toLowerCase();
  const category = (categoryLabels[expense.category] || expense.category || '').toLowerCase();
  const notes = (expense.notes || '').toLowerCase();
  const amount = String(expense.amount || '');
  return category.includes(q) || notes.includes(q) || amount.includes(q);
}

function PageContent({ staff, clinic }: AppContext) {
  const canView = canViewFullFinancials(staff);
  const currencySymbol = getCurrencySymbol(clinic?.currency_code, clinic?.currency_symbol);
  const [rows, setRows] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<ExpenseForm>(createEmptyForm());
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState(monthStartISO());
  const [dateTo, setDateTo] = useState(todayISO());
  const [categoryFilter, setCategoryFilter] = useState('');
  const [methodFilter, setMethodFilter] = useState('');

  async function load() {
    if (!staff || !canView) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('expenses')
      .select('*')
      .eq('clinic_id', staff.clinic_id)
      .order('expense_date', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) {
      await showSecureMessage('تعذر تحميل المصروفات', error.message);
      setLoading(false);
      return;
    }

    setRows((data || []) as Expense[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, [staff?.clinic_id, canView]);

  const filteredRows = useMemo(() => {
    return rows.filter((expense) => {
      const inFrom = !dateFrom || expense.expense_date >= dateFrom;
      const inTo = !dateTo || expense.expense_date <= dateTo;
      const inCategory = !categoryFilter || expense.category === categoryFilter;
      const inMethod = !methodFilter || expense.payment_method === methodFilter;
      return inFrom && inTo && inCategory && inMethod && includesSearch(expense, search);
    });
  }, [rows, dateFrom, dateTo, categoryFilter, methodFilter, search]);

  const stats = useMemo(() => {
    const today = todayISO();
    const monthStart = monthStartISO();
    const total = filteredRows.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
    const todayTotal = rows
      .filter((expense) => expense.expense_date === today)
      .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
    const monthTotal = rows
      .filter((expense) => expense.expense_date >= monthStart)
      .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
    const maxCategory = Object.entries(
      filteredRows.reduce<Record<string, number>>((acc, expense) => {
        acc[expense.category] = (acc[expense.category] || 0) + Number(expense.amount || 0);
        return acc;
      }, {})
    ).sort((a, b) => b[1] - a[1])[0];

    return {
      total,
      todayTotal,
      monthTotal,
      count: filteredRows.length,
      topCategory: maxCategory ? `${categoryLabels[maxCategory[0]] || maxCategory[0]} · ${formatMoney(maxCategory[1], currencySymbol)}` : 'لا يوجد'
    };
  }, [rows, filteredRows, currencySymbol]);

  function resetFilters() {
    setSearch('');
    setDateFrom(monthStartISO());
    setDateTo(todayISO());
    setCategoryFilter('');
    setMethodFilter('');
  }

  function openCreate() {
    setEditing(null);
    setForm(createEmptyForm());
    setOpen(true);
  }

  function openEdit(expense: Expense) {
    setEditing(expense);
    setForm({
      category: expense.category || 'other',
      amount: String(expense.amount || ''),
      expense_date: expense.expense_date || todayISO(),
      payment_method: expense.payment_method || 'cash',
      notes: expense.notes || ''
    });
    setOpen(true);
  }

  function closeModal() {
    if (saving) return;
    setOpen(false);
    setEditing(null);
    setForm(createEmptyForm());
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!staff) return;
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      await showSecureMessage('بيانات غير مكتملة', 'أدخل مبلغ المصروف بشكل صحيح.');
      return;
    }
    if (!form.expense_date) {
      await showSecureMessage('بيانات غير مكتملة', 'اختر تاريخ المصروف.');
      return;
    }

    if (editing) {
      const ok = await requestPasswordConfirmation('تعديل مصروف');
      if (!ok) return;
    }

    setSaving(true);
    const payload = {
      clinic_id: staff.clinic_id,
      category: form.category,
      amount,
      expense_date: form.expense_date,
      payment_method: form.payment_method,
      notes: form.notes.trim() || null,
      created_by: staff.user_id
    };

    const request = editing
      ? supabase.from('expenses').update(payload).eq('clinic_id', staff.clinic_id).eq('id', editing.id)
      : supabase.from('expenses').insert(payload);

    const { error } = await request;
    setSaving(false);

    if (error) {
      await showSecureMessage('تعذر حفظ المصروف', error.message);
      return;
    }

    closeModal();
    load();
  }

  async function deleteExpense(expense: Expense) {
    if (!staff) return;
    const confirmed = await requestActionConfirmation(
      'تأكيد حذف المصروف',
      `سيتم حذف مصروف ${categoryLabels[expense.category] || expense.category} بقيمة ${formatMoney(expense.amount, currencySymbol)}. هل ترغب بالمتابعة؟`,
      'حذف المصروف'
    );
    if (!confirmed) return;

    const ok = await requestPasswordConfirmation('حذف مصروف');
    if (!ok) return;

    const { error } = await supabase.from('expenses').delete().eq('clinic_id', staff.clinic_id).eq('id', expense.id);
    if (error) {
      await showSecureMessage('تعذر حذف المصروف', error.message);
      return;
    }
    load();
  }

  if (!canView) {
    return (
      <AccessDenied
        title="المصروفات غير متاحة"
        description="حساب السكرتيرة لا يملك صلاحية رؤية أو إدارة مصروفات العيادة. هذه الصفحة مخصصة للطبيب أو المدير."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-right">
          <h1 className="text-3xl font-black">المصروفات</h1>
          <p className="mt-2 text-slate-500">إضافة ومتابعة مصروفات العيادة حسب التاريخ والتصنيف وطريقة الدفع.</p>
        </div>
        <button className="premium-btn" onClick={openCreate}>
          <Icon name="plus" className="h-4 w-4" /> إضافة مصروف
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatTile title="مصروفات اليوم" value={formatMoney(stats.todayTotal, currencySymbol)} icon="card" tone="orange" />
        <StatTile title="مصروفات هذا الشهر" value={formatMoney(stats.monthTotal, currencySymbol)} icon="wallet" tone="red" />
        <StatTile title="مصروفات الفترة" value={formatMoney(stats.total, currencySymbol)} icon="chart" tone="blue" />
        <StatTile title="عدد العمليات" value={stats.count} hint={stats.topCategory} icon="file" tone="purple" />
      </div>

      <div className="premium-card space-y-4">
        <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr_1fr_1fr_1fr_auto]">
          <label>
            <span className="mb-2 block text-sm font-bold text-slate-600">بحث</span>
            <input className="soft-input" placeholder="ابحث بالوصف أو التصنيف أو المبلغ" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <label>
            <span className="mb-2 block text-sm font-bold text-slate-600">من تاريخ</span>
            <input className="soft-input number-ltr" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </label>
          <label>
            <span className="mb-2 block text-sm font-bold text-slate-600">إلى تاريخ</span>
            <input className="soft-input number-ltr" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </label>
          <label>
            <span className="mb-2 block text-sm font-bold text-slate-600">التصنيف</span>
            <select className="soft-input" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="">كل التصنيفات</option>
              {expenseCategories.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}
            </select>
          </label>
          <label>
            <span className="mb-2 block text-sm font-bold text-slate-600">طريقة الدفع</span>
            <select className="soft-input" value={methodFilter} onChange={(e) => setMethodFilter(e.target.value)}>
              <option value="">كل الطرق</option>
              {paymentMethods.map((method) => <option key={method.value} value={method.value}>{method.label}</option>)}
            </select>
          </label>
          <div className="flex items-end">
            <button type="button" className="outline-btn h-12 w-full whitespace-nowrap px-4" onClick={resetFilters}>مسح الفلاتر</button>
          </div>
        </div>
      </div>

      <div className="premium-card overflow-x-auto">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 text-right">
          <div>
            <h2 className="text-xl font-black">سجل المصروفات</h2>
            <p className="mt-1 text-sm font-bold text-slate-500">يعتمد التقرير على تاريخ المصروف، وليس فقط تاريخ إدخاله.</p>
          </div>
          <span className="rounded-full border border-border bg-white px-4 py-2 text-sm font-black text-slate-600">
            {loading ? 'جاري التحميل...' : `${filteredRows.length} مصروف`}
          </span>
        </div>

        <table className="w-full min-w-[860px]">
          <thead>
            <tr>
              <th className="table-th">التاريخ</th>
              <th className="table-th">التصنيف</th>
              <th className="table-th">الوصف</th>
              <th className="table-th">طريقة الدفع</th>
              <th className="table-th">المبلغ</th>
              <th className="table-th">الإجراءات</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((expense) => (
              <tr key={expense.id}>
                <td className="table-td number-ltr">{formatDate(expense.expense_date)}</td>
                <td className="table-td font-black">{categoryLabels[expense.category] || expense.category}</td>
                <td className="table-td text-slate-600">{expense.notes || '—'}</td>
                <td className="table-td">{paymentMethodLabels[expense.payment_method] || expense.payment_method || '—'}</td>
                <td className="table-td number-ltr font-black text-danger">{formatMoney(expense.amount, currencySymbol)}</td>
                <td className="table-td">
                  <div className="service-row-actions mx-auto">
                    <button className="outline-btn table-action-btn" onClick={() => openEdit(expense)}>تعديل</button>
                    <button className="ghost-btn table-action-btn text-danger" onClick={() => deleteExpense(expense)}>حذف</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {!filteredRows.length ? <p className="py-8 text-center text-slate-500">لا توجد مصروفات مطابقة للفلاتر الحالية.</p> : null}
      </div>

      <Modal open={open} title={editing ? 'تعديل مصروف' : 'إضافة مصروف'} onClose={closeModal}>
        <form onSubmit={save} className="grid gap-4 md:grid-cols-2">
          <label>
            <span className="mb-2 block text-sm font-bold">التصنيف</span>
            <select className="soft-input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {expenseCategories.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}
            </select>
          </label>
          <label>
            <span className="mb-2 block text-sm font-bold">المبلغ</span>
            <input className="soft-input number-ltr" required type="number" min="1" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </label>
          <label>
            <span className="mb-2 block text-sm font-bold">تاريخ المصروف</span>
            <input className="soft-input number-ltr" required type="date" value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} />
          </label>
          <label>
            <span className="mb-2 block text-sm font-bold">طريقة الدفع</span>
            <select className="soft-input" value={form.payment_method} onChange={(e) => setForm({ ...form, payment_method: e.target.value as ExpenseForm['payment_method'] })}>
              {paymentMethods.map((method) => <option key={method.value} value={method.value}>{method.label}</option>)}
            </select>
          </label>
          <label className="md:col-span-2">
            <span className="mb-2 block text-sm font-bold">وصف أو ملاحظات</span>
            <textarea className="soft-input min-h-[110px]" placeholder="مثال: شراء مواد تعقيم، فاتورة مخبر، صيانة كرسي الأسنان..." value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </label>
          <div className="md:col-span-2 flex justify-end gap-3">
            <button type="button" className="outline-btn" onClick={closeModal} disabled={saving}>تراجع</button>
            <button className="premium-btn" disabled={saving}>{saving ? 'جاري الحفظ...' : editing ? 'حفظ التعديل' : 'حفظ المصروف'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

export default function ExpensesPage() {
  return <AppShell>{(ctx) => <PageContent {...ctx} />}</AppShell>;
}
