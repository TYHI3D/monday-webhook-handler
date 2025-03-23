import { json } from 'micro';

const MONDAY_API_URL = 'https://api.monday.com/v2';
const MONDAY_API_KEY = process.env.MONDAY_API_KEY; // Set this in Vercel env variables

// Map Work Types to one or more Team IDs (as arrays)
const WORK_TYPE_TEAM_MAP = {
  "Print Processing": [692112],
  "Operations": [692113],
  "Fabrication": [1164578],
  "Quoting": [1196913],
  "Art Department": [1220277],
  "Design": [1220547],
  "Mold Department": [1220552],
  "Electronics": [1220959]
  // Add more mappings here as needed
};

// Set your subitem "team" column ID here
const TEAM_COLUMN_ID = "person"; // Confirmed from subitem data as the Team column

async function fetchSubitems(parentItemId) {
  const query = `
    query {
      items(ids: ${parentItemId}) {
        subitems {
          id
          name
        }
      }
    }
  `;

  const response = await fetch(MONDAY_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': MONDAY_API_KEY,
    },
    body: JSON.stringify({ query })
  });

  const data = await response.json();
  return data?.data?.items?.[0]?.subitems || [];
}

export default async function handler(req, res) {
  const payload = await json(req);

  // Log full webhook payload from Monday
  console.log("📦 Full Payload from Monday:", JSON.stringify(payload, null, 2));

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

    const existingSubitems = await fetchSubitems(itemId);
    const existingNames = existingSubitems.map(sub => sub.name);

    for (const value of addedValues) {
      if (existingNames.includes(value.name)) {
        console.log(`⚠️ Skipping duplicate subitem "${value.name}"`);
        continue;
      }

      // Create the subitem
      const createQuery = `
        mutation {
          create_subitem(parent_item_id: ${itemId}, item_name: "${value.name}") {
            id
          }
        }
      `;

      const createResponse = await fetch(MONDAY_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': MONDAY_API_KEY
        },
        body: JSON.stringify({ query: createQuery })
      });

      const createData = await createResponse.json();
      const subitemId = createData?.data?.create_subitem?.id;
      console.log(`✅ Created subitem "${value.name}" → ID: ${subitemId}`);

      // Assign one or more teams if mapped
      const teamIds = WORK_TYPE_TEAM_MAP[value.name];
      if (Array.isArray(teamIds) && teamIds.length > 0 && subitemId) {
        const teamValueJson = JSON.stringify({ team_ids: teamIds }).replace(/"/g, '\"');
        const updateQuery = `
          mutation {
            change_column_value(item_id: ${subitemId}, column_id: "${TEAM_COLUMN_ID}", value: "${teamValueJson}") {
              id
            }
          }
        `;

        const updateResponse = await fetch(MONDAY_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': MONDAY_API_KEY
          },
          body: JSON.stringify({ query: updateQuery })
        });

        const updateData = await updateResponse.json();
        console.log(`👥 Assigned teams [${teamIds.join(', ')}] to subitem ${subitemId}`);
      } else {
        console.log(`⚠️ No team assignment for "${value.name}"`);
      }
    }

    return res.status(200).json({ message: 'Subitems created and teams assigned if matched' });
  }

  console.log(`🔕 Ignoring event: type=${event?.type}, column=${event?.columnTitle}`);
  return res.status(200).json({ message: 'Ignored: not Work Types column update' });
}
