// `service_role` is read only in this server-side function and is never sent to the browser.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

/* global Deno */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function respond(status: number, body: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond(405, { error: 'Método não permitido.' });

  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return respond(401, { error: 'Sessão não autenticada.' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return respond(500, { error: 'A função de exclusão não está configurada no servidor.' });
  }

  const callerClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user: caller }, error: authError } = await callerClient.auth.getUser(authorization.slice(7));
  if (authError || !caller) return respond(401, { error: 'Sessão inválida ou expirada.' });

  let userId: unknown;
  try {
    const body: unknown = await request.json();
    userId = typeof body === 'object' && body !== null && 'user_id' in body
      ? (body as { user_id?: unknown }).user_id
      : undefined;
  } catch {
    return respond(400, { error: 'Requisição inválida.' });
  }
  if (typeof userId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
    return respond(400, { error: 'Usuário inválido.' });
  }
  if (userId === caller.id) return respond(400, { error: 'Você não pode excluir sua própria conta.' });

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: callerProfile, error: profileError } = await adminClient
    .from('profiles').select('role,is_active').eq('id', caller.id).maybeSingle();
  if (profileError) return respond(500, { error: 'Não foi possível validar as permissões do solicitante.' });
  if (callerProfile?.role !== 'admin' || !callerProfile.is_active) {
    return respond(403, { error: 'Apenas administradores ativos podem excluir usuários.' });
  }

  const { data: targetUser, error: targetError } = await adminClient.auth.admin.getUserById(userId);
  if (targetError || !targetUser.user) return respond(404, { error: 'Usuário não encontrado.' });
  const { data: targetProfile, error: targetProfileError } = await adminClient
    .from('profiles').select('id').eq('id', userId).maybeSingle();
  if (targetProfileError) return respond(500, { error: 'Não foi possível validar o perfil do usuário.' });
  if (!targetProfile) return respond(409, { error: 'O perfil deste usuário não foi encontrado; a exclusão foi cancelada.' });

  const { error: deleteError } = await adminClient.auth.admin.deleteUser(userId, false);
  if (deleteError) return respond(409, { error: deleteError.message });

  return respond(200, { message: 'Usuário excluído com sucesso.' });
});
