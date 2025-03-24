import { json } from 'micro';

const MONDAY_API_URL = 'https://api.monday.com/v2';
const MONDAY_API_KEY = process.env.MONDAY_API_KEY; // Set this in Vercel env variables

// Define team IDs as constants
const TEAM_PRINT_PROCESSING = 692112;
const TEAM_OPERATIONS = 692113;
const TEAM_FABRICATION = 1164578;
const TEAM_QUOTING = 1196913;
const TEAM_ART_DEPARTMENT = 1220277;
const TEAM_DESIGN = 1220547;
const TEAM_MOLD_DEPARTMENT = 1220552;
const TEAM_ELECTRONICS = 1220959;

// Map Work Type dropdown labels to one or more team constants
const WORK_TYPE_TEAM_MAP = {
  "3D Printing": [TEAM_PRINT_PROCESSING],
  "Design": [TEAM_DESIGN],
  "Electronics": [TEAM_ELECTRONICS],
  "Painting & Finishing": [TEAM_ART_DEPARTMENT],
  "Graphics / Transfers": [TEAM_ART_DEPARTMENT, TEAM_DESIGN],
  "Molding & Casting": [TEAM_MOLD_DEPARTMENT],
  "Rendering": [TEAM_DESIGN],
  "Repair / Refinishing": [TEAM_ART_DEPARTMENT],
  // Add more Work Type labels and corresponding teams as needed
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
        // 🔍 Fetch the board ID of the newly created subitem
        const boardIdQuery = `
          query {
            items(ids: ${subitemId}) {
              board {
                id
              }
            }
          }
        `;

        const boardIdResponse = await fetch(MONDAY_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': MONDAY_API_KEY
          },
          body: JSON.stringify({ query: boardIdQuery })
        });

        const boardIdData = await boardIdResponse.json();
        const subitemBoardId = boardIdData?.data?.items?.[0]?.board?.id;
        console.log("🧭 Subitem board ID:", subitemBoardId);

        const teamValueJson = JSON.stringify({
          personsAndTeams: teamIds.map(id => ({ id, kind: "team" }))
        }).replace(/"/g, '\\"');
        console.log("🛰️ Update Query Payload:", teamValueJson);

        const updateQuery = `
          mutation {
            change_column_value(
              board_id: ${subitemBoardId},
              item_id: ${subitemId},
              column_id: "${TEAM_COLUMN_ID}",
              value: "${teamValueJson}"
            ) {
              id
            }
          }
        `;
        console.log("📤 GraphQL Mutation:\n" + updateQuery);

        const updateResponse = await fetch(MONDAY_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': MONDAY_API_KEY
          },
          body: JSON.stringify({ query: updateQuery })
        });

        const updateData = await updateResponse.json();
        console.log("📥 Update Response:", JSON.stringify(updateData, null, 2));
        console.log(`👥 Assigned teams [${teamIds.join(', ')}] to subitem ${subitemId}`);
      } else {
        console.log(`⚠️ No team assignment for "${value.name}"`);
      }
      } else {
        console.log(`⚠️ No team assignment for "${value.name}"`);
      }
    }

    return res.status(200).json({ message: 'Subitems created and teams assigned if matched' });
  }

  console.log(`🔕 Ignoring event: type=${event?.type}, column=${event?.columnTitle}`);
  return res.status(200).json({ message: 'Ignored: not Work Types column update' });
}
