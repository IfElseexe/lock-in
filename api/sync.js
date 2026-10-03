import { put, get } from '@vercel/blob';
import { createHash } from 'node:crypto';

// Each sync passphrase maps to its own private JSON file. The passphrase itself is never stored,
// only its SHA-256 hash is used as the file name.
const pathFor = (key) =>
  'lockin/' + createHash('sha256').update('lockin:' + key).digest('hex') + '.json';

async function load(path) {
  let result;
  try {
    result = await get(path, { access: 'private' });
  } catch (e) {
    if (/not.?found|404/i.test(String((e && e.message) || e))) return {};
    throw e;
  }
  if (!result || !result.stream) return {};
  const text = await new Response(result.stream).text();
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const key = String(req.headers['x-sync-key'] || '');
  if (key.length < 8 || key.length > 200) {
    return res.status(401).json({ error: 'Missing or too-short sync passphrase' });
  }
  const path = pathFor(key);

  try {
    if (req.method === 'GET') {
      return res.status(200).json({ days: await load(path) });
    }

    if (req.method === 'PUT') {
      let body = req.body;
      if (typeof body === 'string') body = JSON.parse(body || '{}');
      const { day, done, t } = body || {};

      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(String(day || '')) ||
        !done ||
        typeof done !== 'object' ||
        !Number.isFinite(t)
      ) {
        return res.status(400).json({ error: 'Bad request' });
      }

      const d = {};
      for (const [id, v] of Object.entries(done).slice(0, 40)) {
        if (/^[a-z0-9]{1,20}$/.test(id)) d[id] = !!v;
      }

      const days = await load(path);
      if (!days[day] || t > (days[day].t || 0)) {
        days[day] = { d, t };
        await put(path, JSON.stringify(days), {
          access: 'private',
          allowOverwrite: true,
          contentType: 'application/json',
        });
      }
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('sync error', e);
    return res
      .status(500)
      .json({ error: 'Server error', message: String((e && e.message) || e).slice(0, 200) });
  }
}
