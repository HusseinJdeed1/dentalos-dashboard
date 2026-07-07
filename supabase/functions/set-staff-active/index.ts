import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.86.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: 'Supabase Edge Function environment variables are missing.' }, 500);

  const token = (req.headers.get('Authorization') || '').replace('Bearer ', '').trim();
  if (!token) return jsonResponse({ error: 'يجب تسجيل الدخول أولاً.' }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  try {
    const body = await req.json();
    const staffId = String(body.staff_id || '').trim();
    const isActive = body.is_active === true;
    if (!staffId) throw new Error('لم يتم تحديد الموظف.');

    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData.user) return jsonResponse({ error: 'جلسة المستخدم غير صالحة.' }, 401);

    const { data: callerStaff, error: callerError } = await admin
      .from('staff_users')
      .select('id, clinic_id, role, is_active')
      .eq('user_id', userData.user.id)
      .single();

    if (callerError || !callerStaff) return jsonResponse({ error: 'لم يتم العثور على حساب الموظف الحالي.' }, 403);
    if (callerStaff.is_active === false) return jsonResponse({ error: 'هذا الحساب معطّل.' }, 403);
    if (!['admin', 'doctor'].includes(callerStaff.role)) return jsonResponse({ error: 'تغيير حالة الموظف متاح للطبيب أو المدير فقط.' }, 403);
    if (staffId === callerStaff.id) return jsonResponse({ error: 'لا يمكنك تعطيل حسابك الحالي.' }, 403);

    const { data: target, error: targetError } = await admin
      .from('staff_users')
      .select('id, clinic_id, role, is_active')
      .eq('id', staffId)
      .single();

    if (targetError || !target) return jsonResponse({ error: 'الموظف غير موجود.' }, 404);
    if (target.clinic_id !== callerStaff.clinic_id) return jsonResponse({ error: 'لا يمكن تعديل موظف من عيادة أخرى.' }, 403);
    if (target.role === 'admin' && callerStaff.role !== 'admin') return jsonResponse({ error: 'تغيير حالة المدير متاح للمدير فقط.' }, 403);

    const { data: updated, error: updateError } = await admin
      .from('staff_users')
      .update({ is_active: isActive })
      .eq('id', target.id)
      .eq('clinic_id', callerStaff.clinic_id)
      .select('*')
      .single();

    if (updateError) return jsonResponse({ error: updateError.message }, 400);

    await admin.from('activity_logs').insert({
      clinic_id: callerStaff.clinic_id,
      staff_id: callerStaff.id,
      action: isActive ? 'staff_enabled' : 'staff_disabled',
      entity_type: 'staff_user',
      entity_id: target.id,
      old_value: { is_active: target.is_active },
      new_value: { is_active: isActive }
    });

    return jsonResponse({ staff: updated });
  } catch (error) {
    return jsonResponse({ error: String((error as { message?: string })?.message || 'حدث خطأ غير متوقع.') }, 400);
  }
});
