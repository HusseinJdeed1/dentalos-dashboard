'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Icon } from '@/components/Icons';

export default function LoginPage(){
  const router = useRouter();
  const [email,setEmail] = useState('');
  const [password,setPassword] = useState('');
  const [error,setError] = useState('');
  const [loading,setLoading] = useState(false);
  async function submit(e: React.FormEvent){
    e.preventDefault(); setLoading(true); setError('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if(error){ setError(error.message); return; }
    router.replace('/dashboard');
  }
  return <div data-theme="dental-clean" className="grid min-h-screen place-items-center p-5">
    <form onSubmit={submit} className="premium-card w-full max-w-md">
      <div className="mb-7 text-center">
        <div className="mx-auto mb-4 grid h-20 w-20 place-items-center rounded-[28px] bg-primary/10 text-primary"><Icon name="tooth" className="h-12 w-12"/></div>
        <h1 className="text-3xl font-black text-primary">DentalOS</h1>
        <p className="mt-2 text-sm text-slate-500">لوحة تحكم احترافية لعيادات الأسنان</p>
      </div>
      <label className="mb-2 block text-sm font-bold">البريد الإلكتروني</label>
      <input className="soft-input mb-4" type="email" required value={email} onChange={(e)=>setEmail(e.target.value)} />
      <label className="mb-2 block text-sm font-bold">كلمة المرور</label>
      <input className="soft-input mb-4" type="password" required value={password} onChange={(e)=>setPassword(e.target.value)} />
      {error ? <p className="mb-4 rounded-2xl bg-danger/10 p-3 text-sm font-bold text-danger">{error}</p> : null}
      <button className="premium-btn w-full" disabled={loading}>{loading ? 'جاري الدخول...' : 'دخول إلى اللوحة'}</button>
    </form>
  </div>;
}
