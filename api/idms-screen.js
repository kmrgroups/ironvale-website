export default async function handler(req, res) {
  try {
    const source = 'https://raw.githubusercontent.com/kmrgroups/ironvale-website/main/idms.html';
    const upstream = await fetch(source, { cache: 'no-store' });
    const html = await upstream.text();
    if (!upstream.ok) {
      res.status(502).setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.end('Unable to load IDMS screen source.');
    }
    const bridge = '<script src="/agentic-ai-v2/ui/agentic-executive-bootstrap.js?v=20260915"></script>';
    const output = html.includes('agentic-executive-bootstrap.js')
      ? html
      : html.replace(/<\/body>/i, bridge + '</body>');
    res.status(200);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    return res.end(output);
  } catch (err) {
    res.status(500).setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.end('IDMS screen proxy error: ' + (err && err.message ? err.message : 'Unknown error'));
  }
}
