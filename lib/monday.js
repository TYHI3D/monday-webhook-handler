// lib/monday.js
const { COLUMN_IDS, BOARD_IDS } = require('./config');
const { runGraphQLQuery } = require('./graphql');
const { redis } = require('./redis');

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

async function fetchItemsInGroup(boardId, groupId) {
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
  return data?.data?.boards?.[0]?.groups?.[0]?.items_page?.items || [];
}

async function itemHasJobNumber(itemId) {
  const query = `
    query {
      items(ids: ${itemId}) {
        column_values(ids: "${COLUMN_IDS.JOB_NUMBER}") {
          text
        }
      }
    }
  `;
  const data = await runGraphQLQuery(query);
  const text = data?.data?.items?.[0]?.column_values?.[0]?.text;
  return Boolean(text && text.trim() !== '');
}

async function setJobNumber(boardId, itemId, formattedJobNumber) {
  const value = JSON.stringify(JSON.stringify(formattedJobNumber));
  const mutation = `
    mutation {
      change_column_value(
        board_id: ${boardId},
        item_id: ${itemId},
        column_id: "${COLUMN_IDS.JOB_NUMBER}",
        value: ${value}
      ) {
        id
      }
    }
  `;
  return await runGraphQLQuery(mutation);
}

async function moveItemToGroup(itemId, groupId) {
  const mutation = `
    mutation {
      move_item_to_group(item_id: ${itemId}, group_id: "${groupId}") {
        id
      }
    }
  `;
  await runGraphQLQuery(mutation);
}

async function markWebFormItemProcessed(itemId) {
  const value = JSON.stringify({ checked: true });
  const mutation = `
    mutation {
      change_column_value(
        board_id: ${BOARD_IDS.WEB_FORM_INTAKE},
        item_id: ${itemId},
        column_id: "boolean_mkpk2nk9", 
        value: ${JSON.stringify(value)}
      ) {
        id
      }
    }
  `;
  await runGraphQLQuery(mutation);
}

async function linkProjectToContact(contactId, projectId) {
  // First, fetch existing linked projects
  const query = `
    query {
      items(ids: ${contactId}) {
        column_values(ids: "${COLUMN_IDS.CONTACTS_TO_PROJECT_INTAKE}") {
          value
        }
      }
    }
  `;
  const data = await runGraphQLQuery(query);
  const existingRaw = data?.data?.items?.[0]?.column_values?.[0]?.value;
  let existingIds = [];
  try {
    const parsed = JSON.parse(existingRaw);
    existingIds = parsed?.item_ids || [];
  } catch {}

  if (!existingIds.includes(projectId)) {
    existingIds.push(projectId);
  }

  const mutation = `
    mutation {
      change_column_value(
        board_id: ${BOARD_IDS.CONTACTS},
        item_id: ${contactId},
        column_id: "${COLUMN_IDS.CONTACTS_TO_PROJECT_INTAKE}",
        value: ${JSON.stringify(JSON.stringify({ item_ids: existingIds }))}
      ) {
        id
      }
    }
  `;
  await runGraphQLQuery(mutation);
}

// Redis key helpers
function emailKey(email) {
  return `contact:email:${email.toLowerCase()}`;
}

function nameKey(name) {
  return `contact:name:${name.toLowerCase()}`;
}

async function findMatchingContact(email, name) {
  const emailCacheKey = emailKey(email);
  const nameCacheKey = nameKey(name);

  let contactId = await redis.get(emailCacheKey);
  if (contactId) return contactId;
  contactId = await redis.get(nameCacheKey);
  if (contactId) return contactId;

  let cursor = null;
  do {
    const query = `
      query {
        boards(ids: ${BOARD_IDS.CONTACTS}) {
          items_page(limit: 100${cursor ? `, cursor: \"${cursor}\"` : ''}) {
            cursor
            items {
              id
              name
              column_values {
                id
                text
              }
            }
          }
        }
      }
    `;
    const data = await runGraphQLQuery(query);
    const page = data?.data?.boards?.[0]?.items_page;
    if (!page) break;

    for (const item of page.items) {
      const emailCol = item.column_values.find(col => col.id === 'email')?.text?.toLowerCase();
      const nameMatch = item.name.toLowerCase() === name.toLowerCase();
      const emailMatch = emailCol === email.toLowerCase();

      if (emailMatch || nameMatch) {
        await redis.set(emailKey(email), item.id);
        await redis.set(nameKey(name), item.id);
        return item.id;
      }
    }
    cursor = page.cursor;
  } while (cursor);

  return null;
}

async function createContact(name, email, phone, company) {
  const values = {
    email: { email, text: email },
    phone: { phone },
    ...(company ? { text7: company } : {})
  };
  const valueString = JSON.stringify(values);
  const mutation = `
    mutation {
      create_item(
        board_id: ${BOARD_IDS.CONTACTS},
        item_name: "${name}",
        column_values: ${JSON.stringify(valueString)}
      ) {
        id
      }
    }
  `;
  const data = await runGraphQLQuery(mutation);
  const contactId = data?.data?.create_item?.id;
  if (contactId) {
    await redis.set(emailKey(email), contactId);
    await redis.set(nameKey(name), contactId);
  }
  return contactId;
}

async function createProjectIntakeItem(formData, contactId) {
  const { name, workTypes, materials, deadline, extraInfo } = formData;
  const values = {
    board_relation_mkpkv3rk: { item_ids: [parseInt(contactId)] },
    ...(deadline && { date4: { date: deadline } }),
    ...(workTypes && workTypes.length && {
      dropdown_mkp8c97w: { labels: workTypes }
    }),
    ...(materials && { color_mkpk6mvd: materials }),
    ...(extraInfo && { long_text_mkpkz47: { text: extraInfo } })
  };
  const valueString = JSON.stringify(values);
  const mutation = `
    mutation {
      create_item(
        board_id: ${BOARD_IDS.PROJECT_INTAKE},
        group_id: "topics",
        item_name: "${name}",
        column_values: ${JSON.stringify(valueString)}
      ) {
        id
      }
    }
  `;
  const data = await runGraphQLQuery(mutation);
  return data?.data?.create_item?.id;
}

module.exports = {
  fetchSubitems,
  fetchWorkTypes,
  fetchDeadline,
  fetchItemsInGroup,
  itemHasJobNumber,
  setJobNumber,
  moveItemToGroup,
  findMatchingContact,
  createContact,
  createProjectIntakeItem,
  markWebFormItemProcessed,
  linkProjectToContact
};
