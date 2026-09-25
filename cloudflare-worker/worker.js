export default {
  async fetch(request, env) {
    const reqUrl = new URL(request.url);
    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));
    const raw = reqUrl.searchParams.get('url');
    if (!raw) return cors(new Response('Missing ?url=', { status: 400 }));
    let target;
    try { target = new URL(raw); } catch { return cors(new Response('Invalid URL', { status: 400 })); }
    if (!['http:','https:'].includes(target.protocol)) return cors(new Response('Protocol blocked', { status: 403 }));
    const allowed = (env.ALLOWED_HOST || '').trim().toLowerCase();
    if (!allowed) return cors(new Response('Set ALLOWED_HOST in Worker variables', { status: 500 }));
    if (target.hostname.toLowerCase() !== allowed) return cors(new Response('Host blocked', { status: 403 }));
    if (!target.pathname.endsWith('/player_api.php')) return cors(new Response('Only player_api.php is allowed', { status: 403 }));
    const upstream = await fetch(target.toString(), { headers: { 'Accept': 'application/json,text/plain,*/*' } });
    const headers = new Headers(upstream.headers);headers.set('Access-Control-Allow-Origin','*');headers.set('Cache-Control','no-store');headers.delete('set-cookie');
    return new Response(upstream.body,{status:upstream.status,headers});
  }
};
function cors(r){const h=new Headers(r.headers);h.set('Access-Control-Allow-Origin','*');h.set('Access-Control-Allow-Methods','GET,OPTIONS');h.set('Access-Control-Allow-Headers','Content-Type');return new Response(r.body,{status:r.status,headers:h})}
