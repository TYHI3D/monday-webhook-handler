import { json } from 'micro';

const MONDAY_API_URL = 'https://api.monday.com/v2';
const MONDAY_API_KEY = process.env.MONDAY_API_KEY; // Set this in Vercel env variables

export default async function handler(req, res) {
  const payload = await json(req);

  // Handle Monday webhook challenge
  if (payload.challenge) {
    return res.status(200).json({ challenge: payload.challenge });
  }

  const event = payload.event;
  const itemId = event?.pulseId;

  if (event.type === 'update_column_value' && event.columnTitle === 'Work Types') {
    console.log(`✅ Detected Work Types update on item ${itemId}`);

    const newValues = event.value?.chosenValues || [];
    const previousValues = event.previousValue?.chosenValues || [];

    const prevNames = previousValues.map(v => v.name);
    const addedValues = newValues.filter(v => !prevNames.includes(v.name));

    console.log(`🆕 New Work Types added:`, addedValues.map(v => v.name));

    for (const value of addedValues) {
      const query = `
        mutation {
          create_subitem(parent_item_id: ${itemId}, item_name: "${value.name}") {
            id
          }
        }
      `;

      const response = await fetch(MONDAY_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': MONDAY_API_KEY
        },
        body: JSON.stringify({ query })
      });

      const data = await response.json();
      console.log(`✅ Created subitem "${value.name}" → ID: ${data?.data?.create_subitem?.id}`);
    }

    return res.status(200).json({ message: 'Subitems created' });
  }

  console.log(`🔕 Ignoring event: type=${event?.type}, column=${event?.columnTitle}`);
  return res.status(200).json({ message: 'Ignored: not Work Types column update' });
}
