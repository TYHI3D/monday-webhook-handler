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
  markWebFormItemProcessed,
  linkProjectToContact,
  extractWebFormData
} = require('../lib/monday');
const { BOARD_IDS } = require('../lib/config');
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
    // ✅ Process Web Form board items
    if (boardId === BOARD_IDS.WEB_FORM_INTAKE) {
      console.log(`📝 Processing new web form submission: ${itemId}`);
      
      try {
        // Extract all data from the web form
        const formData = await extractWebFormData(itemId);
        if (!formData) {
          return res.status(500).json({ 
            message: 'Failed to extract web form data.' 
          });
        }
        
        // Try to find a matching contact
        let contactId = await findMatchingContact(formData.email, formData.clientName);
        console.log("🔗 Matching Contact ID:", contactId || '(none found)');

        // Create a new contact if no match found
        if (!contactId) {
          contactId = await createContact(
            formData.clientName, 
            formData.email, 
            formData.phone, 
            formData.company
          );
          console.log("✨ Created new Contact ID:", contactId);
        }

        // Create a new project intake item
        const projectId = await createProjectIntakeItem(formData, contactId, itemId);
        console.log("📝 Created Project Intake Item:", projectId);
        
        // Link the project back to the contact
        await linkProjectToContact(contactId, projectId);
        console.log("🔗 Linked project back to contact.");

        // Mark the web form item as processed
        await markWebFormItemProcessed(itemId);
        console.log("✅ Marked Web Form item as processed.");
        
        return res.status(200).json({ 
          message: 'Successfully processed web form submission.',
          contactId,
          projectId
        });
      } catch (error) {
        console.error("❌ Error processing web form:", error);
        return res.status(500).json({ 
          message: 'Error processing web form submission.',
          error: error.message
        });
      }
    }

    // Only run Work Types logic on the Projects board
    if (boardId === BOARD_IDS.PROJECTS) {
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

    return res.status(200).json({ message: 'Processed new item creation.' });
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