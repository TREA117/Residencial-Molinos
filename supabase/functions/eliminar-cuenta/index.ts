import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'No autorizado' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Verificar el JWT del usuario
  const supabaseUser = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
  if (userError || !user) {
    return new Response(JSON.stringify({ error: 'Token inválido' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const userId = user.id;

  // 1. Anonimizar PII en public.users
  const { data: updated, error: updateError } = await supabaseAdmin
    .from('users')
    .update({
      name: 'Usuario Eliminado',
      email: `deleted_${userId}@realmolinos3.anon`,
      phone: null,
      password_hash: null,
      is_deleted: true,
      deleted_at: new Date().toISOString(),
    })
    .eq('id', userId)
    .select('id');

  if (updateError) {
    return new Response(JSON.stringify({ error: 'Error al anonimizar datos: ' + updateError.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!updated || updated.length === 0) {
    return new Response(JSON.stringify({ error: 'Perfil de usuario no encontrado' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 2. Eliminar notificaciones del usuario
  await supabaseAdmin.from('notifications').delete().eq('user_id', userId);

  // 3. Registrar en audit_log
  await supabaseAdmin.from('audit_log').insert({
    event_type: 'account_deleted',
    user_id: userId,
    result: { reason: 'user_request', timestamp: new Date().toISOString() },
  });

  // 4. Eliminar de auth.users (irreversible)
  const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (deleteError) {
    return new Response(JSON.stringify({ error: 'Error al eliminar cuenta de auth: ' + deleteError.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
