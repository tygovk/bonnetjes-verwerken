const MAX_FILE_BYTES = 3 * 1024 * 1024;
const TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'application/pdf']);

export function createHandler(settings) {
return async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Gebruik POST.' });
  const webhook = settings.webhook;
  if (!webhook) return res.status(503).json({ error: 'De Drive-koppeling is nog niet ingesteld.' });
  try {
    const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!payload || !TYPES.has(payload.mimeType) ||
        typeof payload.fileBase64 !== 'string' || !payload.fileBase64.length ||
        payload.fileBase64.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload.fileBase64) ||
        typeof payload.fileName !== 'string' || !payload.fileName.trim() ||
        typeof payload.amount !== 'number' || !Number.isFinite(payload.amount) || payload.amount <= 0 ||
        typeof payload.potje !== 'string' || !payload.potje) {
      return res.status(400).json({ error: 'Ongeldig bonnetje. Gebruik PNG, JPG, WEBP of PDF van maximaal 3 MB.' });
    }
    const clean = {
      fileName: payload.fileName.replace(/[\\/\x00-\x1f]/g, '_').slice(0, 200),
      fileBase64: payload.fileBase64, mimeType: payload.mimeType,
      amount: payload.amount, potje: payload.potje.slice(0, 100),
      potjeLabel: String(payload.potjeLabel || '').slice(0, 100),
      merchant: String(payload.merchant || '').slice(0, 200),
      date: String(payload.date || '').slice(0, 10),
      description: String(payload.description || '').slice(0, 2000),
      id: String(payload.id || '').slice(0, 100), processedAt: new Date().toISOString()
    };
    const upstream = await fetch(webhook, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(clean), signal: AbortSignal.timeout(45000)
    });
    const text = await upstream.text();
    if (!upstream.ok) return res.status(502).json({ error: 'Make kon het bonnetje niet verwerken. Je invoer is behouden.' });
    // A default Make "Accepted" response only confirms receipt, never Drive storage.
    if (settings.learning && text.trim() === 'Accepted') {
      return res.status(202).json({ learning: true });
    }
    let result;
    try { result = JSON.parse(text); } catch { result = null; }
    if (!result || typeof result.fileId !== 'string' || !result.fileId) {
      return res.status(502).json({ error: 'Nog geen opslagbevestiging van Google Drive ontvangen. Controleer Make voordat je opnieuw verzendt.' });
    }
    return res.status(200).json({ fileId: result.fileId });
  } catch (error) {
    return res.status(error instanceof SyntaxError ? 400 : 502).json({
      error: error instanceof SyntaxError ? 'Ongeldige aanvraag.' : 'De upload is niet bevestigd. Je invoer is behouden; controleer Make voordat je opnieuw verzendt.'
    });
  }
};
}

export default function handler(req, res) {
  return createHandler({ webhook: process.env.MAKE_RECEIPTS_WEBHOOK_URL, learning: false })(req, res);
}
