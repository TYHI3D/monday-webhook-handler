import { json } from 'micro';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    // Monday.com challenge verification
    const { challenge } = req.query;

    if (challenge) {
      return res.status(200).send(challenge);
    } else {
      return res.status(400).json({ error: 'Missing challenge query parameter' });
    }
  }

  if (req.method === 'POST') {
    const payload = await json(req);
    console.log('🔔 Monday Webhook Received:', JSON.stringify(payload, null, 2));

    // Handle event
    const event = payload.event;
    const itemId = event?.pulseId;
    const columnId = event?.columnId;
    const value = event?.value;

    return res.status(200).json({ message: 'OK', itemId, columnId, value });
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
}
