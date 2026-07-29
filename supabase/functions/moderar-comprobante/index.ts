import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { encodeBase64 } from 'https://deno.land/std@0.224.0/encoding/base64.ts';

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const FLAGGED_LEVELS = new Set(['LIKELY', 'VERY_LIKELY']);
const STORAGE_PREFIX = `${Deno.env.get('SUPABASE_URL')}/storage/v1/object/public/comprobantes/`;

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // El secreto vive cifrado en Supabase Vault; solo service_role puede leerlo via esta RPC.
  const { data: expectedSecret, error: secretError } = await supabaseAdmin.rpc(
    'get_moderation_webhook_secret'
  );
  if (secretError || !expectedSecret || req.headers.get('x-webhook-secret') !== expectedSecret) {
    return new Response('Unauthorized', { status: 401 });
  }

  let payload: { record?: Record<string, unknown> };
  try {
    payload = await req.json();
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  const record = payload.record;
  if (!record || !record.has_voucher || !record.voucher_url) {
    return new Response('ok', { status: 200 });
  }

  const paymentId = record.id as string;

  // No confiar en el payload tal cual: releer la fila real y comparar.
  // Evita que alguien con el secreto fuerce el rechazo de un pago con un
  // voucher_url que no le corresponde en la base de datos.
  const { data: paymentRow } = await supabaseAdmin
    .from('payments')
    .select('id, resident_id, voucher_url')
    .eq('id', paymentId)
    .maybeSingle();

  if (!paymentRow || paymentRow.voucher_url !== record.voucher_url) {
    return new Response('ok', { status: 200 });
  }

  const voucherUrl = paymentRow.voucher_url as string;
  const userId = paymentRow.resident_id as string | null;

  // Evitar SSRF: solo se descargan imágenes del propio bucket de comprobantes.
  if (!voucherUrl.startsWith(STORAGE_PREFIX)) {
    return new Response('ok', { status: 200 });
  }

  let safe: Record<string, string> = {};
  let isFlagged = false;
  let downloadOk = false;

  let imgResponse: Response | null = null;
  try {
    imgResponse = await fetch(voucherUrl);
  } catch { /* error de red — tratar como descarga fallida */ }

  if (imgResponse?.ok) {
    downloadOk = true;
    const imgBuffer = await imgResponse.arrayBuffer();
    const base64 = encodeBase64(new Uint8Array(imgBuffer));

    const apiKey = Deno.env.get('CLOUD_VISION_API_KEY')!;
    const visionRes = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{
            image: { content: base64 },
            features: [{ type: 'SAFE_SEARCH_DETECTION', maxResults: 1 }],
          }],
        }),
      }
    );

    const visionData = await visionRes.json();
    safe = visionData.responses?.[0]?.safeSearchAnnotation ?? {};
    isFlagged =
      FLAGGED_LEVELS.has(safe.adult) ||
      FLAGGED_LEVELS.has(safe.violence) ||
      FLAGGED_LEVELS.has(safe.racy);
  }
  // If download failed: safe={}, isFlagged=false — still write audit_log below

  // Siempre registrar en audit_log (fire-and-forget)
  try {
    await supabaseAdmin.from('audit_log').insert({
      event_type: 'file_moderation',
      user_id: userId,
      file_path: voucherUrl,
      result: { safeSearch: safe, flagged: isFlagged, downloadOk },
    });
  } catch { /* fire-and-forget */ }

  if (isFlagged) {
    // Rechazar el pago (fire-and-forget)
    try {
      await supabaseAdmin
        .from('payments')
        .update({ status: 'rejected' })
        .eq('id', paymentId);
    } catch { /* fire-and-forget */ }

    // Notificar al residente (fire-and-forget)
    if (userId) {
      try {
        await supabaseAdmin.from('notifications').insert({
          user_id: userId,
          message: 'Tu comprobante fue rechazado automáticamente por contener contenido no permitido por nuestras políticas.',
        });
      } catch { /* fire-and-forget */ }
    }
  }

  return new Response('ok', { status: 200 });
});
