// Function to fetch items in a group using the items_page field on groups
async function fetchItemsInGroup(boardId, groupId) {
  console.log(`🔍 Fetching items for boardId: ${boardId}, groupId: ${groupId}`);
  
  // The group ID needs to be passed as a string with proper escaping
  const query = `
    query {
      boards(ids: ${boardId}) {
        groups(ids: "${groupId}") {
          items_page {
            items {
              id
              name
              column_values {
                id
                text
                value
              }
            }
          }
        }
      }
    }
  `;
  
  const data = await runGraphQLQuery(query);
  const items = data?.data?.boards?.[0]?.groups?.[0]?.items_page?.items || [];
  
  console.log(`🔍 Found ${items.length} items in group ${groupId}`);
  if (items.length > 0) {
    console.log(`🔍 First item in group:`, JSON.stringify(items[0], null, 2));
  }
  
  return items;
}const { json } = require('micro');

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
const JOB_NUMBER_COLUMN_ID = "numeric_mkpd82ef"; // Column ID for Job Number

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

// Function to check if an item already has a job number
async function itemHasJobNumber(itemId) {
  const query = `
    query {
      items(ids: ${itemId}) {
        column_values(ids: "${JOB_NUMBER_COLUMN_ID}") {
          text
          value
        }
      }
    }
  `;
  
  const data = await runGraphQLQuery(query);
  const jobNumberText = data?.data?.items?.[0]?.column_values?.[0]?.text;
  
  // If the job number exists and is not empty or zero
  const hasJobNumber = jobNumberText && jobNumberText.trim() !== '' && jobNumberText !== '0';
  console.log(`🔍 Checking if item ${itemId} has a Job Number: ${hasJobNumber ? 'Yes - ' + jobNumberText : 'No'}`);
  
  return hasJobNumber;
}

// Function to get the next job number for a group
async function getNextJobNumber(boardId, groupId) {
  // Get all items in the group
  const items = await fetchItemsInGroup(boardId, groupId);
  
  // If no items exist in the group, start with 1
  if (!items || items.length === 0) {
    console.log("📊 No existing items in group - starting with Job Number 1");
    return 1;
  }
  
  console.log(`📊 Found ${items.length} items in the group`);
  
  // Extract job numbers from all items in the group
  const jobNumbers = items.map(item => {
    // Find the job number column among all columns
    const jobNumberColumn = item.column_values.find(col => col.id === JOB_NUMBER_COLUMN_ID);
    const jobNumberText = jobNumberColumn?.text;
    
    // Parse the job number as an integer, default to 0 if not a valid number
    const parsedNumber = jobNumberText ? parseInt(jobNumberText, 10) || 0 : 0;
    console.log(`📊 Item ${item.id}: Job Number = ${parsedNumber}`);
    return parsedNumber;
  });
  
  // Find the highest job number
  const highestJobNumber = Math.max(...jobNumbers, 0);
  console.log(`📊 Highest existing Job Number: ${highestJobNumber}`);
  
  // Return the next job number
  const nextJobNumber = highestJobNumber + 1;
  console.log(`📊 Next Job Number will be: ${nextJobNumber}`);
  return nextJobNumber;
}

// New function to set the job number for an item
async function setJobNumber(boardId, itemId, jobNumber) {
  // For number columns, we need to format it correctly
  const jobNumberValue = JSON.stringify(jobNumber.toString());
  
  const mutation = `
    mutation {
      change_column_value(
        board_id: ${boardId},
        item_id: ${itemId},
        column_id: "${JOB_NUMBER_COLUMN_ID}",
        value: ${jobNumberValue}
      ) {
        id
      }
    }
  `;
  
  console.log(`🔢 Setting Job Number to ${jobNumber} for item ${itemId}`);
  const result = await runGraphQLQuery(mutation);
  console.log(`🔢 Job Number update result:`, JSON.stringify(result, null, 2));
  return result;
}

export default async function handler(req, res) {
  const payload = await json(req);
  console.log("📦 Webhook Payload:", JSON.stringify(payload, null, 2));

  if (payload.challenge) {
    return res.status(200).json({ challenge: payload.challenge });
  }

  const event = payload.event;
  const itemId = event?.pulseId;

  if (event.type === 'update_column_value' && event.columnTitle === 'Work Types') {
    const newValues = event.value?.chosenValues || [];
    const previousValues = event.previousValue?.chosenValues || [];
    const prevNames = previousValues.map(v => v.name);
    const addedValues = newValues.filter(v => !prevNames.includes(v.name));

    console.log("🆕 Added Work Types:", addedValues.map(v => v.name));
    await createSubitemsAndAssignTeams(itemId, addedValues);
    return res.status(200).json({ message: 'Processed Work Type changes.' });
  }

  if (event.type === 'create_pulse') {
    const workTypes = await fetchWorkTypes(itemId);
    console.log("🆕 Work Types on new item:", workTypes.map(v => v.name));
    await createSubitemsAndAssignTeams(itemId, workTypes);
    return res.status(200).json({ message: 'Processed new item with Work Types.' });
  }

  if (event.type === 'update_column_value' && event.columnTitle === 'Show') {
    const newShowValue = event.value?.chosenValues?.[0]?.name;
    console.log(`🎭 Detected Show assignment for item ${itemId}:`, newShowValue);

    if (!newShowValue || newShowValue === 'N/A') {
      const boardQuery = `
        query {
          items(ids: ${itemId}) {
            board {
              id
              groups {
                id
                title
              }
            }
          }
        }
      `;
      const boardData = await runGraphQLQuery(boardQuery);
      const board = boardData?.data?.items?.[0]?.board;
      const allGroups = board?.groups || [];
      const generalGroup = allGroups.find(group => group.title === 'General Projects');
      if (!generalGroup) {
        console.warn("⚠️ 'General Projects' group not found.");
        return res.status(200).json({ message: "General Projects group missing." });
      }

      const moveItemMutation = `
        mutation {
          move_item_to_group (item_id: ${itemId}, group_id: "${generalGroup.id}") {
            id
          }
        }
      `;
      await runGraphQLQuery(moveItemMutation);
      console.log(`📦 Moved item ${itemId} to group ${generalGroup.id}`);
      return res.status(200).json({ message: 'Show column was empty or N/A. Moved to General Projects.' });
    }

    const boardQuery = `
      query {
        items(ids: ${itemId}) {
          board {
            id
            groups {
              id
              title
            }
          }
        }
      }
    `;
    const boardData = await runGraphQLQuery(boardQuery);
    const board = boardData?.data?.items?.[0]?.board;
    const boardId = board?.id;
    const allGroups = board?.groups || [];

    const matchingGroup = allGroups.find(group => group.title === newShowValue);
    let groupId;

    if (matchingGroup) {
      groupId = matchingGroup.id;
      console.log(`📁 Group '${newShowValue}' already exists with ID ${groupId}`);
    } else {
      const createGroupMutation = `
        mutation {
          create_group(board_id: ${boardId}, group_name: "${newShowValue}") {
            id
          }
        }
      `;
      const createGroupData = await runGraphQLQuery(createGroupMutation);
      groupId = createGroupData?.data?.create_group?.id;
      console.log(`📂 Created new group '${newShowValue}' with ID ${groupId}`);
    }

    const moveItemMutation = `
      mutation {
        move_item_to_group (item_id: ${itemId}, group_id: "${groupId}") {
          id
        }
      }
    `;
    await runGraphQLQuery(moveItemMutation);
    console.log(`📦 Moved item ${itemId} to group ${groupId}`);

    // Add a short delay to ensure the item is fully moved to the group before querying
    console.log(`⏱️ Brief wait for item move to complete before checking Job Number`);
    await new Promise(resolve => setTimeout(resolve, 1000)); // Reduced to 1 second
    
    // First check if the item already has a job number
    const hasExistingJobNumber = await itemHasJobNumber(itemId);
    
    if (hasExistingJobNumber) {
      console.log(`🔢 Item ${itemId} already has a Job Number - keeping existing value`);
    } else {
      // Get the next job number for this group and assign it to the item
      const nextJobNumber = await getNextJobNumber(boardId, groupId);
      await setJobNumber(boardId, itemId, nextJobNumber);
      console.log(`🔢 Assigned Job Number ${nextJobNumber} to item ${itemId}`);
    }

    return res.status(200).json({ message: 'Show column update detected and Job Number assigned.' });
  }

  console.log("🔕 Ignored event type or column.");
  return res.status(200).json({ message: 'Event ignored.' });
}