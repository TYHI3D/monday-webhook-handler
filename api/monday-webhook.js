const { json } = require('micro');

// ====== CONFIGURATION ======
const MONDAY_API_URL = 'https://api.monday.com/v2';
const MONDAY_API_KEY = process.env.MONDAY_API_KEY;

// Column IDs
const COLUMN_IDS = {
  TEAM: "person",
  TIMELINE: "timerange_mkp86nae",
  DEADLINE: "date_mkpb5r4t",
  JOB_NUMBER: "text_mkpd32rc",
  WORK_TYPES: "dropdown_mkp8c97w"
};

// Team IDs
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

// Work Type to Team mapping
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

// ====== MONDAY.COM API FUNCTIONS ======

/**
 * Execute a GraphQL query against the Monday.com API
 */
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

/**
 * Fetch subitems for a parent item
 */
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

/**
 * Fetch work types selected for an item
 */
async function fetchWorkTypes(itemId) {
  const query = `
    query {
      items(ids: ${itemId}) {
        column_values(ids: "${COLUMN_IDS.WORK_TYPES}") {
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

/**
 * Fetch deadline date for an item
 */
async function fetchDeadline(itemId) {
  const query = `
    query {
      items(ids: ${itemId}) {
        column_values(ids: "${COLUMN_IDS.DEADLINE}") {
          text
        }
      }
    }
  `;
  const data = await runGraphQLQuery(query);
  return data?.data?.items?.[0]?.column_values?.[0]?.text || null;
}

/**
 * Fetch items in a specific group
 */
async function fetchItemsInGroup(boardId, groupId) {
  console.log(`🔍 Fetching items for boardId: ${boardId}, groupId: ${groupId}`);
  
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
  return items;
}

/**
 * Check if an item already has a job number
 */
async function itemHasJobNumber(itemId) {
  const query = `
    query {
      items(ids: ${itemId}) {
        column_values(ids: "${COLUMN_IDS.JOB_NUMBER}") {
          text
          value
        }
      }
    }
  `;
  
  const data = await runGraphQLQuery(query);
  const jobNumberText = data?.data?.items?.[0]?.column_values?.[0]?.text;
  
  // If the job number exists and is not empty
  const hasJobNumber = jobNumberText && jobNumberText.trim() !== '';
  console.log(`🔍 Checking if item ${itemId} has a Job Number: ${hasJobNumber ? 'Yes - ' + jobNumberText : 'No'}`);
  
  return hasJobNumber;
}

/**
 * Create subitems for work types and assign teams
 */
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

    // Set timeline if deadline exists
    if (subitemId && deadlineText && subitemBoardId) {
      await setSubitemTimeline(subitemId, subitemBoardId, deadlineText);
    }

    // Assign teams to the subitem
    await assignTeamsToSubitem(subitemId, subitemBoardId, value.name);
  }
}

/**
 * Set timeline for a subitem based on deadline
 */
async function setSubitemTimeline(subitemId, boardId, deadlineText) {
  const now = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }).split(',')[0].trim().split('/');
  const formattedNow = `${now[2]}-${now[0].padStart(2, '0')}-${now[1].padStart(2, '0')}`;
  const timelineValue = { from: formattedNow, to: deadlineText };
  const escapedTimeline = JSON.stringify(JSON.stringify(timelineValue));
  
  const timelineMutation = `
    mutation {
      change_column_value(
        board_id: ${boardId},
        item_id: ${subitemId},
        column_id: "${COLUMN_IDS.TIMELINE}",
        value: ${escapedTimeline}
      ) {
        id
      }
    }
  `;
  
  console.log("🕓 Setting timeline for subitem");
  await runGraphQLQuery(timelineMutation);
}

/**
 * Assign appropriate teams to a subitem based on work type
 */
async function assignTeamsToSubitem(subitemId, boardId, workTypeName) {
  const teamIds = WORK_TYPE_TEAM_MAP[workTypeName];
  if (!Array.isArray(teamIds) || teamIds.length === 0) {
    console.log(`⚠️ No team mapping found for "${workTypeName}"`);
    return;
  }

  const teamValueJson = JSON.stringify({
    personsAndTeams: teamIds.map(id => ({ id, kind: "team" }))
  });
  const escapedTeamValue = JSON.stringify(teamValueJson);

  const teamMutation = `
    mutation {
      change_column_value(
        board_id: ${boardId},
        item_id: ${subitemId},
        column_id: "${COLUMN_IDS.TEAM}",
        value: ${escapedTeamValue}
      ) {
        id
      }
    }
  `;

  console.log(`📤 Assigning team(s) to subitem ${subitemId}`);
  await runGraphQLQuery(teamMutation);
}

// ====== JOB NUMBER FUNCTIONS ======

/**
 * Extract show number from a show name (e.g., "19 - Dakota" -> "19")
 */
function extractShowNumber(showName) {
  if (!showName) return null;
  
  const match = showName.match(/^(\d+)\s*-/);
  if (match && match[1]) {
    return match[1];
  }
  return null;
}

/**
 * Format a job number with show prefix (e.g., 19, 2 -> "19:2")
 */
function formatJobNumber(showNumber, jobNumber) {
  return `${showNumber}:${jobNumber}`;
}

/**
 * Extract the numeric job number from a formatted job number text (e.g., "19:2" -> 2)
 */
function extractJobNumber(formattedJobNumber) {
  if (!formattedJobNumber) return 0;
  
  console.log(`🔍 Extracting from: "${formattedJobNumber}"`);
  
  const parts = formattedJobNumber.split(':');
  
  if (parts.length >= 2) {
    const afterColon = parts[1];
    const extracted = parseInt(afterColon, 10);
    
    if (!isNaN(extracted)) {
      console.log(`🔍 Successfully extracted: ${extracted}`);
      return extracted;
    }
  }
  
  console.log(`🔍 Extraction failed, returning 0`);
  return 0;
}

/**
 * Get the next sequential job number for a group
 */
async function getNextJobNumber(boardId, groupId) {
  const items = await fetchItemsInGroup(boardId, groupId);
  
  // If no items exist in the group, start with 1
  if (!items || items.length === 0) {
    console.log("📊 No existing items in group - starting with Job Number 1");
    return 1;
  }
  
  // Extract job numbers from all items in the group
  const jobNumbers = [];
  
  for (const item of items) {
    const jobNumberColumn = item.column_values.find(col => col.id === COLUMN_IDS.JOB_NUMBER);
    if (!jobNumberColumn) continue;
    
    const formattedJobNumber = jobNumberColumn.text || '';
    console.log(`📊 Item ${item.id}: Raw Job Number text = "${formattedJobNumber}"`);
    
    if (formattedJobNumber && formattedJobNumber.trim() !== '') {
      const jobNumber = extractJobNumber(formattedJobNumber);
      
      if (jobNumber > 0) {
        jobNumbers.push(jobNumber);
        console.log(`📊 Added job number ${jobNumber} to tracking`);
      }
    }
  }
  
  // Find the highest job number
  let highestJobNumber = 0;
  if (jobNumbers.length > 0) {
    highestJobNumber = Math.max(...jobNumbers);
  }
  
  // Return the next job number
  const nextJobNumber = highestJobNumber + 1;
  console.log(`📊 Next job number will be: ${nextJobNumber}`);
  
  return nextJobNumber;
}

/**
 * Set the job number for an item
 */
async function setJobNumber(boardId, itemId, formattedJobNumber) {
  // For text columns, we need to format the value correctly as a JSON string for Monday's API
  const jobNumberValue = JSON.stringify(JSON.stringify(formattedJobNumber));
  
  const mutation = `
    mutation {
      change_column_value(
        board_id: ${boardId},
        item_id: ${itemId},
        column_id: "${COLUMN_IDS.JOB_NUMBER}",
        value: ${jobNumberValue}
      ) {
        id
      }
    }
  `;
  
  console.log(`🔢 Setting formatted Job Number to "${formattedJobNumber}" for item ${itemId}`);
  const result = await runGraphQLQuery(mutation);
  console.log(`🔢 Job Number update result:`, JSON.stringify(result, null, 2));
  return result;
}

/**
 * Handle item movement based on Show column changes
 */
async function handleShowColumnChange(itemId, newShowValue, boardId, allGroups) {
  // Handle empty or N/A Show value
  if (!newShowValue || newShowValue === 'N/A') {
    const generalGroup = allGroups.find(group => group.title === 'General Projects');
    if (!generalGroup) {
      console.warn("⚠️ 'General Projects' group not found.");
      return { success: false, message: "General Projects group missing." };
    }

    await moveItemToGroup(itemId, generalGroup.id);
    return { success: true, message: 'Show column was empty or N/A. Moved to General Projects.' };
  }

  // Find or create group for the show
  let groupId;
  const matchingGroup = allGroups.find(group => group.title === newShowValue);

  if (matchingGroup) {
    groupId = matchingGroup.id;
    console.log(`📁 Group '${newShowValue}' already exists with ID ${groupId}`);
  } else {
    groupId = await createGroup(boardId, newShowValue);
    console.log(`📂 Created new group '${newShowValue}' with ID ${groupId}`);
  }

  // Move item to the group
  await moveItemToGroup(itemId, groupId);

  // Extract the show number and handle job numbering
  const showNumber = extractShowNumber(newShowValue);
  if (!showNumber) {
    console.warn(`⚠️ Could not extract show number from '${newShowValue}'`);
    return { success: false, message: 'Could not extract show number from show name.' };
  }
  
  // Wait for item move to complete
  console.log(`⏱️ Brief wait for item move to complete before checking Job Number`);
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Check if item already has a job number
  const hasExistingJobNumber = await itemHasJobNumber(itemId);
  
  if (hasExistingJobNumber) {
    console.log(`🔢 Item ${itemId} already has a Job Number - keeping existing value`);
  } else {
    // Get next job number and assign it
    const nextJobNumber = await getNextJobNumber(boardId, groupId);
    const formattedJobNumber = formatJobNumber(showNumber, nextJobNumber);
    await setJobNumber(boardId, itemId, formattedJobNumber);
  }

  return { success: true, message: 'Show column update detected and Job Number assigned.' };
}

/**
 * Move an item to a group
 */
async function moveItemToGroup(itemId, groupId) {
  const moveItemMutation = `
    mutation {
      move_item_to_group (item_id: ${itemId}, group_id: "${groupId}") {
        id
      }
    }
  `;
  await runGraphQLQuery(moveItemMutation);
  console.log(`📦 Moved item ${itemId} to group ${groupId}`);
}

/**
 * Create a new group
 */
async function createGroup(boardId, groupName) {
  const createGroupMutation = `
    mutation {
      create_group(board_id: ${boardId}, group_name: "${groupName}") {
        id
      }
    }
  `;
  const createGroupData = await runGraphQLQuery(createGroupMutation);
  return createGroupData?.data?.create_group?.id;
}

// ====== MAIN WEBHOOK HANDLER ======

module.exports = async function handler(req, res) {
  const payload = await json(req);
  console.log("📦 Webhook Payload:", JSON.stringify(payload, null, 2));

  // Handle Monday.com webhook challenge
  if (payload.challenge) {
    return res.status(200).json({ challenge: payload.challenge });
  }

  const event = payload.event;
  const itemId = event?.pulseId;

  // Handle Work Types column changes
  if (event.type === 'update_column_value' && event.columnTitle === 'Work Types') {
    const newValues = event.value?.chosenValues || [];
    const previousValues = event.previousValue?.chosenValues || [];
    const prevNames = previousValues.map(v => v.name);
    const addedValues = newValues.filter(v => !prevNames.includes(v.name));

    console.log("🆕 Added Work Types:", addedValues.map(v => v.name));
    await createSubitemsAndAssignTeams(itemId, addedValues);
    return res.status(200).json({ message: 'Processed Work Type changes.' });
  }

  // Handle new item creation
  if (event.type === 'create_pulse') {
    const workTypes = await fetchWorkTypes(itemId);
    console.log("🆕 Work Types on new item:", workTypes.map(v => v.name));
    await createSubitemsAndAssignTeams(itemId, workTypes);
    return res.status(200).json({ message: 'Processed new item with Work Types.' });
  }

  // Handle Show column changes
  if (event.type === 'update_column_value' && event.columnTitle === 'Show') {
    const newShowValue = event.value?.chosenValues?.[0]?.name;
    console.log(`🎭 Detected Show assignment for item ${itemId}:`, newShowValue);

    // Get board info for item
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

    // Handle the Show column change
    const result = await handleShowColumnChange(itemId, newShowValue, boardId, allGroups);
    return res.status(200).json({ message: result.message });
  }

  console.log("🔕 Ignored event type or column.");
  return res.status(200).json({ message: 'Event ignored.' });
};