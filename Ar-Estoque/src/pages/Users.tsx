import { dialogAlert, dialogConfirm } from '@/components/DialogProvider';
import { useEffect, useState } from 'react';
import { supabase, type Profile } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { allRows } from '@/lib/data';
import { errorMessage } from '@/lib/utils';
import { PageHeader, Button, Select, LoadingSpinner, ErrorState } from '@/components/ui';
import { Trash2 } from 'lucide-react';
export default function UsersPage() {
 const {profile}=useAuth(); const [users,setUsers]=useState<Profile[]>([]); const [loading,setLoading]=useState(true); const [error,setError]=useState(''); const [busy,setBusy]=useState(false); const [deletingId,setDeletingId]=useState<string|null>(null);
 async function load(){setLoading(true);setError('');try{setUsers(await allRows(()=>supabase.from('profiles').select('*').order('created_at').order('id')));}catch(e){setError(errorMessage(e));}finally{setLoading(false);}}
 useEffect(()=>{void load();},[]);
 async function save(u:Profile,role:string,active:boolean){if(busy)return;setBusy(true);try{const {error}=await supabase.rpc('set_user_access',{p_user_id:u.id,p_role:role,p_active:active});if(error)throw error;await load();}catch(e){dialogAlert(errorMessage(e));}finally{setBusy(false);}}
 async function removeUser(u:Profile){
  if(busy||deletingId)return;
  if(u.id===profile?.id){dialogAlert('Você não pode excluir sua própria conta.');return;}
  const confirmed=await dialogConfirm(`Tem certeza que deseja excluir o usuário ${u.name} (ID ${u.id})?\n\nA exclusão permanente remove o acesso dessa conta ao sistema. O histórico empresarial será preservado.`,{title:'Excluir usuário?',confirmLabel:'Excluir',cancelLabel:'Cancelar',destructive:true});
  if(!confirmed)return;
  setDeletingId(u.id);
  try{
   const {error}=await supabase.functions.invoke('delete-user',{body:{user_id:u.id}});
   if(error)throw error;
   setUsers(current=>current.filter(item=>item.id!==u.id));
   dialogAlert('Usuário excluído com sucesso.');
  }catch(e){dialogAlert(errorMessage(e));}
  finally{setDeletingId(null);}
 }
 if(profile?.role!=='admin')return <ErrorState message="Acesso restrito ao administrador"/>;
 if(loading)return <LoadingSpinner/>;if(error)return <ErrorState message={error} onRetry={load}/>;
 return <div><PageHeader title="Usuários" subtitle="Libere as contas da equipe e defina suas permissões."/>
 <div className="space-y-3">{users.map(u=><div key={u.id} className="p-4 bg-white rounded-xl border flex flex-wrap items-center gap-4">
  <div className="min-w-0 flex-1"><p className="break-words font-medium">{u.name}</p><p className="text-sm text-slate-500">{u.is_active?'Acesso liberado':'Aguardando liberação / bloqueado'}</p></div>
  <Select aria-label={'Perfil de '+u.name} value={u.role} disabled={busy||u.id===profile.id} onChange={e=>save(u,e.target.value,u.is_active)}><option value="operador">Operador</option><option value="admin">Administrador</option></Select>
  <Button disabled={busy||u.id===profile.id} variant={u.is_active?'secondary':'success'} onClick={()=>save(u,u.role,!u.is_active)}>{u.is_active?'Bloquear':'Liberar'}</Button>
  <button type="button" disabled={busy||deletingId!==null||u.id===profile.id} onClick={()=>void removeUser(u)} aria-label={`Excluir usuário ${u.name}`} title={u.id===profile.id?'Você não pode excluir sua própria conta':'Excluir usuário permanentemente'} className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-red-950/40 dark:hover:text-red-400">
   <Trash2 className="h-4 w-4" aria-hidden="true"/>
  </button>
 </div>)}</div></div>;
}
