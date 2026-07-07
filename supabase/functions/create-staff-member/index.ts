import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.86.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

type Role = 'admin' | 'doctor' | 'secretary';

type StaffPayload = {
  email?: string;
  password?: string;
  full_name?: string;
  phone?: string | null;
  role?: Role;
  is_active?: boolean;
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' }
  });
}

function normalizeEmail(value?: string) {
  return String(value || '').trim().toLowerCase();
}

function validatePayload(payload: StaffPayload) {
  const email = normalizeEmail(payload.email);
  const password = String(payload.password || '').trim();
  const fullName = String(payload.full_name || '').trim();
  const role = payload.role || 'secretary';

  if (!email || !email.includes('@')) throw new Error('أدخل بريدًا إلكترونيًا صحيحًا للموظف.');
  if (password.length < 8) throw new Error('كلمة المرور المؤقتة يجب أن تكون 8 أحرف على الأقل.');
  if (!fullName) throw new Error('أدخل الاسم الكامل للموظف.');
  if (!['admin', 'doctor', 'secretary'].includes(role)) throw new Error('الدور المحدد غير صحيح.');

  return {
    email,
    password,
    full_name: fullName,
    phone: payload.phone ? String(payload.phone).trim() : null,
    role,
    is_active: payload.is_active !== false
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Supabase Edge Function environment variables are missing.' }, 500);
  }

  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) return jsonResponse({ error: 'يجب تسجيل الدخول أولاً.' }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  try {
    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData.user) return jsonResponse({ error: 'جلسة المستخدم غير صالحة.' }, 401);

    const { data: callerStaff, error: callerError } = await admin
      .from('staff_users')
      .select('id, clinic_id, role, full_name, is_active')
      .eq('user_id', userData.user.id)
      .single();

    if (callerError || !callerStaff) return jsonResponse({ error: 'لم يتم العثور على حساب الموظف الحالي.' }, 403);
    if (callerStaff.is_active === false) return jsonResponse({ error: 'هذا الحساب معطّل.' }, 403);
    if (!['admin', 'doctor'].includes(callerStaff.role)) return jsonResponse({ error: 'إضافة الموظفين متاحة للطبيب أو المدير فقط.' }, 403);

    const payload = validatePayload(await req.json());
    if (payload.role === 'admin' && callerStaff.role !== 'admin') {
      return jsonResponse({ error: 'إضافة مدير متاحة للمدير فقط.' }, 403);
    }

    const { data: duplicateStaff } = await admin
      .from('staff_users')
      .select('id')
      .eq('clinic_id', callerStaff.clinic_id)
      .ilike('email', payload.email)
      .maybeSingle();

    if (duplicateStaff) return jsonResponse({ error: 'يوجد موظف بهذا البريد داخل نفس العيادة.' }, 409);

    const { data: createdUser, error: createUserError } = await admin.auth.admin.createUser({
      email: payload.email,
      password: payload.password,
      email_confirm: true,
      user_metadata: {
        full_name: payload.full_name,
        clinic_id: callerStaff.clinic_id,
        role: payload.role
      }
    });

    if (createUserError || !createdUser.user) {
      const message = createUserError?.message || 'تعذر إنشاء حساب الدخول للموظف.';
      return jsonResponse({ error: message.includes('already') ? 'هذا البريد مستخدم بالفعل في حساب آخر.' : message }, 400);
    }

    const { data: staffRow, error: insertError } = await admin
      .from('staff_users')
      .insert({
        clinic_id: callerStaff.clinic_id,
        user_id: createdUser.user.id,
        email: payload.email,
        full_name: payload.full_name,
        phone: payload.phone,
        role: payload.role,
        is_active: payload.is_active
      })
      .select('*')
      .single();

    if (insertError) {
      await admin.auth.admin.deleteUser(createdUser.user.id);
      return jsonResponse({ error: insertError.message || 'تم إلغاء إنشاء الحساب بسبب تعذر ربطه بالعيادة.' }, 400);
    }

    await admin.from('activity_logs').insert({
      clinic_id: callerStaff.clinic_id,
      staff_id: callerStaff.id,
      action: 'staff_created',
      entity_type: 'staff_user',
      entity_id: staffRow.id,
      new_value: {
        email: payload.email,
        full_name: payload.full_name,
        role: payload.role,
        is_active: payload.is_active
      }
    });

    return jsonResponse({ staff: staffRow });
  } catch (error) {
    return jsonResponse({ error: String((error as { message?: string })?.message || 'حدث خطأ غير متوقع.') }, 400);
  }
});
