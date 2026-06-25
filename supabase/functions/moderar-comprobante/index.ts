import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { encodeBase64 } from 'https://deno.land/std@0.224.0/encoding/base64.ts';

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const FLAGGED_LEVELS = new Set(['LIKELY', 'VERY_LIKELY']);

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
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
  const userId = record.resident_id as string | null;
  const voucherUrl = record.voucher_url as string;

  let safe: Record<string, string> = {};
  let isFlagged = false;

  // Intentar descargar y analizar la imagen
  const imgResponse = await fetch(voucherUrl);
  if (imgResponse.ok) {
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
      result: { safeSearch: safe, flagged: isFlagged, downloadOk: imgResponse.ok },
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
