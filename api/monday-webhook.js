import { json } from 'micro';

export default async function handler(req, res) {
  const payload = await json(req);

  // Handle the challenge POST
  if (payload.challenge) {
    console.log('🔐 Responding to Monday challenge:', payload.challenge);
    return res.status(200).json({ challenge: payload.challenge });
  }

  // Handle regular webhook events
  console.log('🔔 Monday Webhook Received:', JSON.stringify(payload, null, 2));

  const event = payload.event;
  const itemId = event?.pulseId;
  const columnId = event?.columnId;
  const value = event?.value;

  return res.status(200).json({ message: 'OK', itemId, columnId, value });
}
