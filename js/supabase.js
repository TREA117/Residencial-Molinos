/* js/supabase.js
   Helpers mínimos para conectar a Supabase REST desde el cliente
   - Define `window.SUPABASE_CONFIG = { url, key }` en el HTML antes de cargar este script
   - Si `key` está vacío el módulo solo ofrece una interfaz de fallback (no autenticada)

   Uso básico:
     window.SUPABASE.init();
     const users = await window.SUPABASE.list('users');
*/

(function () {
  const DEFAULT_URL = (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.url) || 'https://qxjuztctbpwymmskdyqw.supabase.co/rest/v1/';
  let SUPABASE_URL = (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.url) || DEFAULT_URL;
  let SUPABASE_KEY = (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.key) || null;
  // Prefer using the official supabase-js client when available (UMD global exposes `supabase`)
  function baseUrlFromRest(url) {
    return url.replace(/\/rest\/?v?1\/?$/i, '').replace(/\/$/, '');
  }

  let SUPABASE_CLIENT = null;
  try {
    const base = baseUrlFromRest(SUPABASE_URL);
    if (window.supabase && typeof window.supabase.createClient === 'function') {
      SUPABASE_CLIENT = window.supabase.createClient(base, SUPABASE_KEY);
      console.info('Supabase client initialized via supabase-js', { base, hasKey: !!SUPABASE_KEY });
    }
  } catch (e) {
    console.warn('Could not initialize supabase-js client', e);
  }

  function headers() {
    const h = { 'Content-Type': 'application/json' };
    if (SUPABASE_KEY) {
      h['apikey'] = SUPABASE_KEY;
      h['Authorization'] = 'Bearer ' + SUPABASE_KEY;
    }
    return h;
  }

  async function apiFetch(path, opts = {}) {
    const url = SUPABASE_URL.replace(/\/$/, '') + '/' + path.replace(/^\//, '');
    const fetchOpts = Object.assign({ headers: headers() }, opts);
    const res = await fetch(url, fetchOpts);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Supabase REST error ${res.status}: ${text}`);
    }
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) return res.json();
    return res.text();
  }

  // CRUD helpers for a table (Supabase REST v1)
  async function list(table, query = '') {
    // If supabase-js client is initialized, use it (gives better debugging and respects policies)
    if (SUPABASE_CLIENT) {
      try {
        const selectStr = query ? query : '*';
        const { data, error } = await SUPABASE_CLIENT.from(table).select(selectStr);
        if (error) throw error;
        return data || [];
      } catch (err) {
        console.warn('supabase-js list failed, falling back to REST', err);
      }
    }
    const q = query ? `?${query}` : '';
    return apiFetch(`${table}${q}`, { method: 'GET' });
  }

  async function get(table, id) {
    // Assumes primary key column is `id` and uses eq.id
    if (SUPABASE_CLIENT) {
      const { data, error } = await SUPABASE_CLIENT.from(table).select('*').eq('id', id).limit(1);
      if (error) throw error;
      return data || [];
    }
    return list(table, `id=eq.${encodeURIComponent(id)}`);
  }

  async function insert(table, obj) {
    if (SUPABASE_CLIENT) {
      const { data, error } = await SUPABASE_CLIENT.from(table).insert(obj).select();
      if (error) throw error;
      return data;
    }
    return apiFetch(`${table}`, { method: 'POST', body: JSON.stringify(obj) });
  }

  async function update(table, id, obj) {
    if (SUPABASE_CLIENT) {
      const { data, error } = await SUPABASE_CLIENT.from(table).update(obj).eq('id', id).select();
      if (error) throw error;
      return data;
    }
    return apiFetch(`${table}?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(obj) });
  }

  async function remove(table, id) {
    if (SUPABASE_CLIENT) {
      const { data, error } = await SUPABASE_CLIENT.from(table).delete().eq('id', id).select();
      if (error) throw error;
      return data;
    }
    return apiFetch(`${table}?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  // Public API
  window.SUPABASE = {
    init(config = {}) {
      SUPABASE_URL = config.url || SUPABASE_URL;
      SUPABASE_KEY = config.key || SUPABASE_KEY;
      // try to (re)create supabase-js client if available
      try {
        const base = baseUrlFromRest(SUPABASE_URL);
        if (window.supabase && typeof window.supabase.createClient === 'function') {
          SUPABASE_CLIENT = window.supabase.createClient(base, SUPABASE_KEY);
          console.info('SUPABASE init (client)', { base, hasKey: !!SUPABASE_KEY });
        }
      } catch (e) {
        console.info('SUPABASE init (rest)', { SUPABASE_URL, hasKey: !!SUPABASE_KEY });
      }
    },
    list,
    get,
    insert,
    update,
    remove,
    rawFetch: apiFetch,
    config: () => ({ url: SUPABASE_URL, hasKey: !!SUPABASE_KEY, hasClient: !!SUPABASE_CLIENT }),
    client: () => SUPABASE_CLIENT
  };
})();
