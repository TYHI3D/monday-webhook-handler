// /api/monday-webhook.js
const { json } = require('micro');
const {
  createSubitemsAndAssignTeams,
  handleShowColumnChange,
  extractShowNumber,
  formatJobNumber,
  getNextJobNumber
} = require('../lib/logic');
const {
  itemHasJobNumber,
  setJobNumber,
  fetchItemsInGroup,
  findMatchingContact,
  createContact,
  createProjectIntakeItem,
  markWebFormItemProcessed
} = require('../lib/monday');
const { runGraphQLQuery } = require('../lib/graphql');

module.exports = async function handler(req, res) {
  const payload = await json(req);
  console.log("📦 Webhook Payload:", JSON.stringify(payload, null, 2));

  if (payload.challenge) {
    return res.status(200).json({ challenge: payload.challenge });
  }

  const event = payload.event;
  const itemId = event?.pulseId;
  const boardId = event?.boardId;

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
    // ✅ Only process Web Form board items
    if (boardId === 8826296878) {
      const email = event.columnValues?.email_mkpkkkje?.text || '';
      const name = event.columnValues?.text_mkpkzg16?.value || '';
      console.log("📧 Extracted Email:", email);
      console.log("🙋 Extracted Name:", name);

      let contactId = await findMatchingContact(email, name);
      console.log("🔗 Matched Contact ID:", contactId || '(none found)');

      if (!contactId) {
        const phone = event.columnValues?.phone_mkpkcdr8?.phone || '';
        const company = event.columnValues?.text7?.text || '';
        contactId = await createContact(name, email, phone, company);
        console.log("✨ Created new Contact ID:", contactId);
      }

      const workTypes = event.columnValues?.dropdown_mkpkpc18?.chosenValues?.map(v => v.name) || [];
      const materials = event.columnValues?.color_mkpk6mvd?.label?.text || '';
      const deadline = event.columnValues?.date_mkpkmcjn?.date || '';
      const extraInfo = event.columnValues?.long_text_mkpkz47?.text || '';

      const projectId = await createProjectIntakeItem({
        name: event.pulseName,
        workTypes,
        materials,
        deadline,
        extraInfo
      }, contactId);

      console.log("📝 Created Project Intake Item:", projectId);

      await markWebFormItemProcessed(itemId);
      console.log("✅ Marked Web Form item as processed.");
    }

    // Only run Work Types logic on the Projects board
    if (boardId === 7108984735) {
      const workTypeValues = event.columnValues?.dropdown_mkp8c97w?.chosenValues || [];
      console.log("🆕 Work Types on new item:", workTypeValues.map(v => v.name));
      await createSubitemsAndAssignTeams(itemId, workTypeValues);
    }

    const showValue = event.columnValues?.dropdown_mkp87fs0?.chosenValues?.[0];
    if (showValue) {
      console.log(`🎭 New item has Show assignment:`, showValue.name);

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
      const fullBoardId = board?.id;
      const allGroups = board?.groups || [];

      await handleShowColumnChange(itemId, showValue.name, fullBoardId, allGroups);
    }

    return res.status(200).json({ message: 'Processed new item with contact, intake, and optional show assignment.' });
  }

  // Handle Show column changes
  if (event.type === 'update_column_value' && event.columnTitle === 'Show') {
    const newShowValue = event.value?.chosenValues?.[0]?.name;
    console.log(`🎭 Detected Show assignment for item ${itemId}:`, newShowValue);

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
    const fullBoardId = board?.id;
    const allGroups = board?.groups || [];

    const result = await handleShowColumnChange(itemId, newShowValue, fullBoardId, allGroups);
    return res.status(200).json({ message: result.message });
  }

  console.log("🔕 Ignored event type or column.");
  return res.status(200).json({ message: 'Event ignored.' });
};
