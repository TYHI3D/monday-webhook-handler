// api/monday-webhook.js

import { json } from 'micro';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const payload = await json(req);

  console.log('🔔 Monday Webhook Received:', JSON.stringify(payload, null, 2));

  const event = payload.event;
  const itemId = event?.pulseId;
  const columnId = event?.columnId;
  const value = event?.value;

  return res.status(200).json({ message: 'OK', itemId, columnId, value });
}