// lib/logic.js
const { COLUMN_IDS, WORK_TYPE_TEAM_MAP } = require('./config');
const { runGraphQLQuery } = require('./graphql');
const {
  fetchSubitems,
  fetchDeadline,
  fetchItemsInGroup,
  moveItemToGroup,
  itemHasJobNumber,
  setJobNumber
} = require('./monday');

// 🔧 Subitems & Teams

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

    const boardQuery = `
      query {
        items(ids: ${subitemId}) {
          board {
            id
          }
        }
      }
    `;
    const boardData = await runGraphQLQuery(boardQuery);
    const subitemBoardId = boardData?.data?.items?.[0]?.board?.id;

    if (subitemId && deadlineText && subitemBoardId) {
      await setSubitemTimeline(subitemId, subitemBoardId, deadlineText);
    }

    await assignTeamsToSubitem(subitemId, subitemBoardId, value.name);
  }
}

async function setSubitemTimeline(subitemId, boardId, deadlineText) {
  const now = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }).split(',')[0].trim().split('/');
  const formattedNow = `${now[2]}-${now[0].padStart(2, '0')}-${now[1].padStart(2, '0')}`;
  const timelineValue = { from: formattedNow, to: deadlineText };
  const escapedTimeline = JSON.stringify(JSON.stringify(timelineValue));

  const mutation = `
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
  await runGraphQLQuery(mutation);
}

async function assignTeamsToSubitem(subitemId, boardId, workTypeName) {
  const teamIds = WORK_TYPE_TEAM_MAP[workTypeName];
  if (!Array.isArray(teamIds) || teamIds.length === 0) {
    console.log(`⚠️ No team mapping found for "${workTypeName}"`);
    return;
  }

  const teamValueJson = JSON.stringify({
    personsAndTeams: teamIds.map(id => ({ id, kind: "team" }))
  });
  const escapedValue = JSON.stringify(teamValueJson);

  const mutation = `
    mutation {
      change_column_value(
        board_id: ${boardId},
        item_id: ${subitemId},
        column_id: "${COLUMN_IDS.TEAM}",
        value: ${escapedValue}
      ) {
        id
      }
    }
  `;
  await runGraphQLQuery(mutation);
}

// 🔢 Job Number Utilities

function extractShowNumber(showName) {
  if (!showName) return null;
  const match = showName.match(/^(\d+)\s*-/);
  return match ? match[1] : null;
}

function parseShowNumber(showName) {
  if (!showName) return null;
  if (showName === "General Projects") return -1;
  const match = showName.match(/^(\d+)\s*-/);
  return match ? parseInt(match[1], 10) : null;
}

function formatJobNumber(showNumber, jobNumber) {
  return `${showNumber}:${jobNumber}`;
}

function extractJobNumber(formattedJobNumber) {
  if (!formattedJobNumber) return 0;
  const parts = formattedJobNumber.split(':');
  const num = parseInt(parts?.[1], 10);
  return isNaN(num) ? 0 : num;
}

async function getNextJobNumber(boardId, groupId) {
  const items = await fetchItemsInGroup(boardId, groupId);
  const jobNumbers = items.map(item => {
    const col = item.column_values.find(c => c.id === COLUMN_IDS.JOB_NUMBER);
    return extractJobNumber(col?.text || '');
  }).filter(n => n > 0);

  return jobNumbers.length ? Math.max(...jobNumbers) + 1 : 1;
}

// 📂 Group & Show Assignment

async function createGroup(boardId, groupName, allGroups) {
  const showNumber = parseShowNumber(groupName);
  const sortedGroups = [...allGroups].sort((a, b) => {
    const aNum = parseShowNumber(a.title);
    const bNum = parseShowNumber(b.title);
    return (aNum ?? Infinity) - (bNum ?? Infinity);
  });

  const preceding = sortedGroups.findLast(g => {
    const num = parseShowNumber(g.title);
    return num !== null && num < showNumber;
  });

  const mutation = `
    mutation {
      create_group(
        board_id: ${boardId},
        group_name: "${groupName}"${
          preceding
            ? `, relative_to: "${preceding.id}", position_relative_method: after_at`
            : ''
        }
      ) {
        id
      }
    }
  `;

  const data = await runGraphQLQuery(mutation);
  return data?.data?.create_group?.id;
}

async function handleShowColumnChange(itemId, newShowValue, boardId, allGroups) {
  if (!newShowValue || newShowValue === 'N/A') {
    const fallback = allGroups.find(g => g.title === 'General Projects');
    if (fallback) await moveItemToGroup(itemId, fallback.id);
    return { success: true, message: 'Moved to General Projects' };
  }

  let group = allGroups.find(g => g.title === newShowValue);
  if (!group) {
    const groupId = await createGroup(boardId, newShowValue, allGroups);
    group = { id: groupId, title: newShowValue };
  }

  await moveItemToGroup(itemId, group.id);

  const showNumber = extractShowNumber(newShowValue);
  if (!showNumber) return { success: false, message: 'Invalid show number' };

  await new Promise(resolve => setTimeout(resolve, 1000));
  const hasNumber = await itemHasJobNumber(itemId);

  if (!hasNumber) {
    const nextJobNumber = await getNextJobNumber(boardId, group.id);
    const formatted = formatJobNumber(showNumber, nextJobNumber);
    await setJobNumber(boardId, itemId, formatted);
  }

  return { success: true, message: 'Show updated and Job Number handled' };
}

module.exports = {
  createSubitemsAndAssignTeams,
  handleShowColumnChange,
  extractShowNumber,
  formatJobNumber,
  getNextJobNumber
};
