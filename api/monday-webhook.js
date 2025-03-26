const { json } = require('micro');

const MONDAY_API_URL = 'https://api.monday.com/v2';
const MONDAY_API_KEY = process.env.MONDAY_API_KEY;

// Define team IDs as constants
const TEAM_IDS = {
  PRINT_PROCESSING: 692112,
  OPERATIONS: 692113,
  FABRICATION: 1164578,
  QUOTING: 1196913,
  ART_DEPARTMENT: 1220277,
  DESIGN: 1220547,
  MOLD_DEPARTMENT: 1220552,
  ELECTRONICS: 1220959,
};

// Map Work Type dropdown labels to one or more team IDs
const WORK_TYPE_TEAM_MAP = {
  "3D Printing": [TEAM_IDS.PRINT_PROCESSING],
  "Design": [TEAM_IDS.DESIGN],
  "Electronics": [TEAM_IDS.ELECTRONICS],
  "Painting & Finishing": [TEAM_IDS.ART_DEPARTMENT],
  "Graphics / Transfers": [TEAM_IDS.ART_DEPARTMENT, TEAM_IDS.DESIGN],
  "Molding & Casting": [TEAM_IDS.MOLD_DEPARTMENT],
  "Rendering": [TEAM_IDS.DESIGN],
  "Repair / Refinishing": [TEAM_IDS.ART_DEPARTMENT],
};

const TEAM_COLUMN_ID = "person";
const TIMELINE_COLUMN_ID = "timerange_mkp86nae";
const DEADLINE_COLUMN_ID = "date_mkpb5r4t"; // ✅ Fixed incorrect ID
const JOB_NUMBER_COLUMN_ID = "numbers"; // Update with actual ID if different
const GENERAL_PROJECTS_GROUP_ID = "new_group29179"; // Replace with your actual General Projects group ID

async function runGraphQLQuery(query) {
  const response = await fetch(MONDAY_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: MONDAY_API_KEY,
    },
    body: JSON.stringify({ query })
  });
  return await response.json();
}

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
  const data = await runGraphQLQuery(query);
  return data?.data?.items?.[0]?.subitems || [];
}

async function fetchWorkTypes(itemId) {
  const query = `
    query {
      items(ids: ${itemId}) {
        column_values(ids: "dropdown_mkp8c97w") {
          value
        }
      }
    }
  `;
  const data = await runGraphQLQuery(query);
  const rawValue = data?.data?.items?.[0]?.column_values?.[0]?.value;
  try {
    const parsed = JSON.parse(rawValue);
    return parsed?.chosenValues || [];
  } catch {
    return [];
  }
}

async function fetchDeadline(itemId) {
  const query = `
    query {
      items(ids: ${itemId}) {
        column_values(ids: "${DEADLINE_COLUMN_ID}") {
          text
        }
      }
    }
  `;
  const data = await runGraphQLQuery(query);
  return data?.data?.items?.[0]?.column_values?.[0]?.text || null;
}

async function assignJobNumber(itemId, groupId, boardId) {
  // Avoid assigning job number if returning to General Projects
  if (groupId === GENERAL_PROJECTS_GROUP_ID) {
    console.log(`🔁 Skipping job number assignment for General Projects group`);
    return;
  }

  const query = `
    query {
      boards(ids: ${boardId}) {
        groups(ids: "${groupId}") {
          items {
            column_values(ids: "${JOB_NUMBER_COLUMN_ID}") {
              text
            }
          }
        }
      }
    }
  `;
  const data = await runGraphQLQuery(query);
  const items = data?.data?.boards?.[0]?.groups?.[0]?.items || [];
  const jobNumbers = items.map(i => parseInt(i.column_values?.[0]?.text)).filter(n => !isNaN(n));
  const newJobNumber = jobNumbers.length ? Math.max(...jobNumbers) + 1 : 1;

  const mutation = `
    mutation {
      change_column_value(
        board_id: ${boardId},
        item_id: ${itemId},
        column_id: "${JOB_NUMBER_COLUMN_ID}",
        value: "${newJobNumber}"
      ) {
        id
      }
    }
  `;
  console.log(`🔢 Assigning Job Number ${newJobNumber} to item ${itemId}`);
  await runGraphQLQuery(mutation);
}

async function createSubitemsAndAssignTeams(itemId, workTypes) {
  const existingSubitems = await fetchSubitems(itemId);
  const existingNames = existingSubitems.map(sub => sub.name);
  const deadlineText = await fetchDeadline(itemId);

  for (const value of workTypes) {
    if (existingNames.includes(value.name)) {
      console.log(`⚠️ Skipping duplicate subitem "${value.name}"`);
      continue;
    }

    const createQuery = `
      mutation {
        create_subitem(parent_item_id: ${itemId}, item_name: "${value.name}") {
          id
        }
      }
    `;
    const createData = await runGraphQLQuery(createQuery);
    const subitemId = createData?.data?.create_subitem?.id;
    console.log(`✅ Subitem created: ${subitemId} for "${value.name}"`);

    const boardIdQuery = `
      query {
        items(ids: ${subitemId}) {
          board {
            id
          }
        }
      }
    `;
    const boardIdData = await runGraphQLQuery(boardIdQuery);
    const subitemBoardId = boardIdData?.data?.items?.[0]?.board?.id;
    console.log("🧭 Subitem board ID:", subitemBoardId);

    console.log("📋 Timeline Pre-check:", { subitemId, deadlineText, subitemBoardId });
    if (subitemId && deadlineText && subitemBoardId) {
      const now = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }).split(',')[0].trim().split('/');
      const formattedNow = `${now[2]}-${now[0].padStart(2, '0')}-${now[1].padStart(2, '0')}`;
      const timelineValue = { from: formattedNow, to: deadlineText };
      const escapedTimeline = JSON.stringify(JSON.stringify(timelineValue));
      const timelineMutation = `
        mutation {
          change_column_value(
            board_id: ${subitemBoardId},
            item_id: ${subitemId},
            column_id: "${TIMELINE_COLUMN_ID}",
            value: ${escapedTimeline}
          ) {
            id
          }
        }
      `;
      console.log("🕓 Setting timeline:", timelineMutation);
      await runGraphQLQuery(timelineMutation);
    }

    const teamIds = WORK_TYPE_TEAM_MAP[value.name];
    if (!Array.isArray(teamIds) || teamIds.length === 0 || !subitemId) {
      console.log(`⚠️ No team mapping found for "${value.name}"`);
      continue;
    }

    const teamValueJson = JSON.stringify({
      personsAndTeams: teamIds.map(id => ({ id, kind: "team" }))
    });
    const escapedTeamValue = JSON.stringify(teamValueJson);

    const teamMutation = `
      mutation {
        change_column_value(
          board_id: ${subitemBoardId},
          item_id: ${subitemId},
          column_id: "${TEAM_COLUMN_ID}",
          value: ${escapedTeamValue}
        ) {
          id
        }
      }
    `;

    console.log("📤 Assigning team(s):", teamMutation);
    const updateData = await runGraphQLQuery(teamMutation);
    console.log("📥 Update Response:", JSON.stringify(updateData, null, 2));
  }
}

// Remaining export default handler block remains unchanged
// Add assignJobNumber call just after item move and before return
