import { json } from 'micro';

const MONDAY_API_URL = 'https://api.monday.com/v2';
const MONDAY_API_KEY = process.env.MONDAY_API_KEY; // We'll set this in Vercel later

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

  if(event.type === 'update_column_value' && event.columnTitle === 'Work Types')
  {
    console.log(`🔕 I DONE HEARD an event: type=${event.type}, column=${event.columnTitle}`);
    return res.status(200).json({ message: 'Correct Event Type in Work Types COlumn' });
  } else {
    console.log(`🔕 Ignoring event: type=${event.type}, column=${event.columnTitle}`);
    return res.status(200).json({ message: 'Ignored: not Work Types column update' });
  }

  return res.status(200).json({ message: 'OK', itemId, columnId, value });
}
