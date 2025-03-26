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
const DEADLINE_COLUMN_ID = "date_mkpb5r4t";
const JOB_NUMBER_COLUMN_ID = "numbers";
const GENERAL_PROJECTS_GROUP_ID = "new_group29179";
const SHOW_COLUMN_ID = "dropdown_mkp87fs0";

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

async function fetchItemBoardId(itemId) {
  const query = `
    query {
      items(ids: ${itemId}) {
        board { id }
      }
    }
  `;
  const data = await runGraphQLQuery(query);
  return data?.data?.items?.[0]?.board?.id;
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

async function fetchSubitems(itemId) {
  const query = `
    query {
      items(ids: ${itemId}) {
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
  const query = `
    query {
      boards(ids: ${boardId}) {
        groups(ids: "${groupId}") {
          items {
            id
            name
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
  const jobNumbers = items
    .map(item => parseInt(item.column_values?.[0]?.text))
    .filter(num => !isNaN(num));
  const nextJobNumber = jobNumbers.length ? Math.max(...jobNumbers) + 1 : 1;

  const mutation = `
    mutation {
      change_column_value(
        board_id: ${boardId},
        item_id: ${itemId},
        column_id: "${JOB_NUMBER_COLUMN_ID}",
        value: "${nextJobNumber}"
      ) {
        id
      }
    }
  `;

  console.log(`🔢 Assigning Job Number ${nextJobNumber} to item ${itemId}`);
  await runGraphQLQuery(mutation);
}

async function createSubitemsAndAssignTeams(itemId, workTypes) {
  const existingSubitems = await fetchSubitems(itemId);
  const existingNames = existingSubitems.map(sub => sub.name);
  const deadlineText = await fetchDeadline(itemId);

  for (const value of workTypes) {
    if (existingNames.includes(value.name)) continue;

    const createQuery = `
      mutation {
        create_subitem(parent_item_id: ${itemId}, item_name: "${value.name}") {
          id
        }
      }
    `;
    const createData = await runGraphQLQuery(createQuery);
    const subitemId = createData?.data?.create_subitem?.id;
    if (!subitemId) continue;

    const boardId = await fetchItemBoardId(subitemId);

    if (deadlineText) {
      const now = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }).split(',')[0].trim().split('/');
      const formattedNow = `${now[2]}-${now[0].padStart(2, '0')}-${now[1].padStart(2, '0')}`;
      const timelineValue = { from: formattedNow, to: deadlineText };
      const escapedTimeline = JSON.stringify(JSON.stringify(timelineValue));
      const timelineMutation = `
        mutation {
          change_column_value(
            board_id: ${boardId},
            item_id: ${subitemId},
            column_id: "${TIMELINE_COLUMN_ID}",
            value: ${escapedTimeline}
          ) { id }
        }
      `;
      await runGraphQLQuery(timelineMutation);
    }

    const teamIds = WORK_TYPE_TEAM_MAP[value.name];
    if (!teamIds?.length) continue;

    const teamValueJson = JSON.stringify({ personsAndTeams: teamIds.map(id => ({ id, kind: "team" })) });
    const escapedTeamValue = JSON.stringify(teamValueJson);
    const teamMutation = `
      mutation {
        change_column_value(
          board_id: ${boardId},
          item_id: ${subitemId},
          column_id: "${TEAM_COLUMN_ID}",
          value: ${escapedTeamValue}
        ) { id }
      }
    `;
    await runGraphQLQuery(teamMutation);
  }
}

async function handleWebhookLogic(event) {
  const itemId = event?.pulseId;
  let boardId = event?.boardId;
  if (!boardId && itemId) boardId = await fetchItemBoardId(itemId);
  if (!itemId || !boardId) return;

  if (event.type === 'update_column_value' && event.columnTitle === 'Work Types') {
    const newValues = event.value?.chosenValues || [];
    const previousValues = event.previousValue?.chosenValues || [];
    const prevNames = previousValues.map(v => v.name);
    const addedValues = newValues.filter(v => !prevNames.includes(v.name));
    await createSubitemsAndAssignTeams(itemId, addedValues);
    return;
  }

  if (event.type === 'create_pulse') {
    const workTypes = await fetchWorkTypes(itemId);
    await createSubitemsAndAssignTeams(itemId, workTypes);
    return;
  }

  if (event.type === 'update_column_value' && event.columnId === SHOW_COLUMN_ID) {
    const showValue = event.value?.chosenValues?.[0]?.name;

    if (!showValue || showValue === "N/A") {
      const moveBackQuery = `
        mutation {
          move_item_to_group (item_id: ${itemId}, group_id: "${GENERAL_PROJECTS_GROUP_ID}") { id }
        }
      `;
      await runGraphQLQuery(moveBackQuery);
      return;
    }

    const groupQuery = `
      query {
        boards(ids: ${boardId}) {
          groups { id title }
        }
      }
    `;
    const groupData = await runGraphQLQuery(groupQuery);
    const groups = groupData?.data?.boards?.[0]?.groups || [];
    let targetGroupId = groups.find(g => g.title === showValue)?.id;

    if (!targetGroupId) {
      const createGroupQuery = `
        mutation {
          create_group(board_id: ${boardId}, group_name: "${showValue}") { id }
        }
      `;
      const createData = await runGraphQLQuery(createGroupQuery);
      targetGroupId = createData?.data?.create_group?.id;
    }

    const moveItemQuery = `
      mutation {
        move_item_to_group (item_id: ${itemId}, group_id: "${targetGroupId}") { id }
      }
    `;
    await runGraphQLQuery(moveItemQuery);
    await assignJobNumber(itemId, targetGroupId, boardId);
  }
}

export default async function handler(req, res) {
  const payload = await json(req);
  console.log("📦 Webhook Payload:", JSON.stringify(payload, null, 2));
  if (payload.challenge) return res.status(200).json({ challenge: payload.challenge });
  res.status(200).json({ message: 'Webhook received. Processing async.' });
  handleWebhookLogic(payload.event).catch((err) => {
    console.error("❌ Error in async processing:", err);
  });
}
