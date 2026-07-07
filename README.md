# DentalOS Premium Dashboard

لوحة تحكم Premium كاملة لعيادات الأسنان، عربية RTL، مبنية على Next.js وSupabase وTailwind، ومجهزة للنشر على Cloudflare Pages.

## الميزات الموجودة

- تسجيل دخول عبر Supabase Auth.
- تصميم Premium قريب من الصورة المرجعية:
  - Sidebar يمين.
  - Topbar فيه بحث وتنبيهات وحساب المستخدم.
  - بطاقات إحصائية بتصميم ناعم.
  - جدول مواعيد اليوم.
  - كارد تنبيهات.
  - كارد ملف مريض مختصر.
  - ملخص مالي للطبيب والمدير فقط.
- صلاحيات حسب الدور:
  - `admin`: كل شيء.
  - `doctor`: المواعيد، المرضى، خطط العلاج، المالية، التقارير، أوقات الدوام.
  - `secretary`: المرضى، المواعيد، الخدمات للقراءة، أوقات الدوام، بدون ملخص مالي كامل.
- منع السكرتيرة من رؤية:
  - الدفعات والأقساط.
  - المصروفات.
  - التقارير المالية.
  - الملخص المالي الكامل.
- أوقات دوام قابلة للتعديل من الطبيب أو السكرتيرة:
  - فتح/إغلاق كل يوم.
  - وقت البداية والنهاية.
  - وقت الاستراحة.
  - مدة الموعد.
  - منع إضافة موعد خارج الدوام أو داخل الاستراحة.
- إدارة المرضى.
- إدارة المواعيد.
- إدارة الخدمات.
- إدارة خطط العلاج.
- إدارة الدفعات والمصروفات والتقارير للطبيب والمدير.
- ثيمات:
  - Dental Clean
  - Soft Rose Dental
  - Navy Dental Pro
  - Luxury Beige
  - Emerald Dental

## 1. تشغيل المشروع محلياً

افتح Terminal داخل مجلد المشروع ثم شغّل:

```bash
npm install
cp .env.example .env.local
npm run dev
```

ثم افتح:

```text
http://localhost:3000
```

## 2. إعداد Supabase من الصفر

### الخطوة 1: إنشاء مشروع Supabase

ادخل إلى Supabase وأنشئ Project جديد.

### الخطوة 2: إنشاء الجداول

افتح:

```text
SQL Editor → New query
```

ثم شغّل الملف:

```text
supabase/schema.sql
```

هذا الملف ينشئ:

- clinics
- staff_users
- patients
- services
- appointments
- treatment_plans
- payments
- expenses
- visits
- clinic_working_hours
- دوال الحساب المالي
- RLS Policies

### الخطوة 3: إنشاء مستخدم دخول

من Supabase:

```text
Authentication → Users → Add user
```

مثال:

```text
email: doctor@test.com
password: 12345678
```

بعد إنشاء المستخدم، انسخ قيمة:

```text
User UID
```

### الخطوة 4: تشغيل بيانات تجريبية

افتح الملف:

```text
supabase/seed.sql
```

استبدل:

```text
USER_ID_HERE
```

بقيمة `User UID` التي نسختها.

ثم شغّل الملف في SQL Editor.

### الخطوة 5: ربط المشروع مع Supabase

افتح ملف:

```text
.env.local
```

وضع القيم:

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

تجدها في Supabase من:

```text
Project Settings → API
```

## 3. تسجيل الدخول

بعد التشغيل ادخل إلى:

```text
http://localhost:3000/login
```

وسجّل الدخول بنفس بيانات المستخدم الذي أنشأته.

## 4. أوقات الدوام

الصفحة موجودة في القائمة الجانبية باسم:

```text
أوقات الدوام
```

يمكن للطبيب أو السكرتيرة تعديل:

- الأيام المفتوحة والمغلقة.
- وقت بداية الدوام.
- وقت نهاية الدوام.
- الاستراحة.
- مدة الموعد.

عند إضافة موعد، يتم التحقق تلقائياً من:

- اليوم ليس مغلقاً.
- الوقت داخل الدوام.
- الوقت ليس داخل الاستراحة.
- لا يوجد موعد بنفس التاريخ والوقت.

## 5. تحديث قاعدة موجودة سابقاً

إذا كنت شغّلت نسخة قديمة من قاعدة البيانات، شغّل هذا الملف:

```text
supabase/role_permissions_update.sql
```

هذا يضيف/يحدث:

- صلاحيات السكرتيرة.
- جدول أوقات الدوام.
- سياسة الوصول لأوقات الدوام.

## 6. النشر على Cloudflare Pages

المشروع مضبوط كـ Static Export.

إعدادات Cloudflare Pages:

```text
Build command: npm run build
Build output directory: out
```

أضف Environment Variables:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
```

## 7. ملاحظات مهمة

- لا تضع `service_role_key` في الواجهة نهائياً.
- المفتاح المستخدم في `.env.local` هو `anon key` فقط.
- حماية البيانات تتم عبر Supabase RLS.
- السكرتيرة لا ترى الجداول المالية من الواجهة ولا من قاعدة البيانات حسب الصلاحيات.
- لم يتم تشغيل `npm install` أو `npm run build` داخل هذه البيئة لأن تنزيل الحزم يحتاج إنترنت. شغّلها على جهازك المحلي.

## تحديث تصميم الصفحة الرئيسية

تم ضبط صفحة Dashboard لتطابق التقسيم المعتمد في الصورة المرجعية:

- الشريط العلوي الكامل أعلى المحتوى.
- القائمة الجانبية اليمنى الثابتة.
- عمود أيسر يحتوي على تنبيهات مهمة وملف المريض.
- منطقة وسطى تحتوي على الترحيب، بطاقات الإحصائيات، جدول مواعيد اليوم، والملخص المالي.
- كل قسم رئيسي مفصول في كارد مستقل مثل الصورة.

الملفات المعدلة لهذا التصميم:

```text
src/components/AppShell.tsx
src/app/dashboard/page.tsx
src/app/globals.css
```

## 8. تحديث تصدير بيانات المرضى وإضافة الموظفين بدون user_id

هذه النسخة تضيف ميزتين جديدتين:

- زر تصدير بيانات المرضى من صفحة المرضى ومن الإعدادات:
  - Excel متوافق مع Microsoft Excel.
  - JSON كنسخة احتياطية تقنية كاملة.
- صفحة الفريق والصلاحيات أصبحت تسمح للطبيب بإضافة الموظف عبر:
  - الاسم الكامل.
  - البريد الإلكتروني.
  - كلمة مرور مؤقتة.
  - الدور.

لم يعد الطبيب بحاجة إلى الدخول إلى Supabase أو نسخ `user_id`.

### تحديث قاعدة البيانات

شغّل الملف التالي داخل Supabase SQL Editor:

```text
supabase/staff_export_upgrade.sql
```

### تفعيل إنشاء الموظفين من لوحة التحكم

لأن إنشاء مستخدم Auth يحتاج مفتاح `service_role`، تم وضعه داخل Supabase Edge Function وليس داخل الواجهة.

من Supabase CLI شغّل:

```bash
supabase functions deploy create-staff-member
```

ثم تأكد أن Secret التالي موجود داخل Supabase Functions:

```text
SUPABASE_SERVICE_ROLE_KEY
```

ملاحظة أمنية: لا تضع `SUPABASE_SERVICE_ROLE_KEY` داخل `.env.local` الخاص بالواجهة، ولا تضفه إلى Cloudflare Pages كمتغير عام.

## Pre-sale hardening SQL

قبل تجربة النظام مع عيادة حقيقية، شغّل الملف التالي داخل Supabase SQL Editor بعد كل ملفات SQL السابقة:

```sql
supabase/pre_sale_product_hardening.sql
```

ثم نفّذ:

```sql
select pg_notify('pgrst', 'reload schema');
```

هذا الملف يضيف فحص الحسابات المعطّلة، يقوّي RLS، يضبط صلاحيات الطبيب/السكرتيرة، يضيف دعم التراجع عن آخر استيراد، ويجعل الاستيراد أكثر أمانًا قبل البيع.
