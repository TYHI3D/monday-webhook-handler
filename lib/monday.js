// lib/monday.js
const { 
    BOARD_IDS, 
    COLUMN_IDS, 
    WEB_FORM_COLUMNS, 
    CONTACT_COLUMNS, 
    PROJECT_INTAKE_COLUMNS 
  } = require('./config');
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
          column_id: "${WEB_FORM_COLUMNS.DATA_PROCESSED}", 
          value: ${JSON.stringify(value)}
        ) {
          id
        }
      }
    `;
    await runGraphQLQuery(mutation);
  }
  
  // Enhanced Redis key helpers
  function emailKey(email) {
    if (!email) return null;
    return `contact:email:${email.toLowerCase()}`;
  }
  
  function nameKey(name) {
    if (!name) return null;
    return `contact:name:${name.toLowerCase()}`;
  }
  
  async function findMatchingContact(email, name) {
    if (!email && !name) return null;
    
    // Try Redis cache first
    const emailCacheKey = emailKey(email);
    const nameCacheKey = nameKey(name);
  
    let contactId = null;
    
    if (emailCacheKey) {
      contactId = await redis.get(emailCacheKey);
      if (contactId) {
        console.log(`🔍 Found contact in Redis by email: ${email} -> ${contactId}`);
        return contactId;
      }
    }
    
    if (nameCacheKey) {
      contactId = await redis.get(nameCacheKey);
      if (contactId) {
        console.log(`🔍 Found contact in Redis by name: ${name} -> ${contactId}`);
        return contactId;
      }
    }
  
    console.log(`🔎 No Redis cache hit. Searching Monday.com for contacts matching email: ${email} or name: ${name}`);
    
    // Fallback to Monday.com API search
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
        const itemEmailCol = item.column_values.find(col => col.id === CONTACT_COLUMNS.EMAIL)?.text?.toLowerCase();
        const nameMatch = name && (item.name.toLowerCase() === name.toLowerCase());
        const emailMatch = email && itemEmailCol && (itemEmailCol === email.toLowerCase());
  
        if (emailMatch || nameMatch) {
          console.log(`🎯 Found matching contact: ${item.id}`);
          
          // Cache both email and name for future lookups
          if (email) await redis.set(emailKey(email), item.id);
          if (name) await redis.set(nameKey(name), item.id);
          
          return item.id;
        }
      }
      cursor = page.cursor;
    } while (cursor);
  
    console.log(`❌ No matching contact found for email: ${email} or name: ${name}`);
    return null;
  }
  
  async function createContact(name, email, phone, company) {
    console.log(`➕ Creating new contact: ${name}, ${email}, ${phone}, ${company}`);
    
    const values = {};
    
    // Only add non-empty values
    if (email) values[CONTACT_COLUMNS.EMAIL] = { email, text: email };
    if (phone) values[CONTACT_COLUMNS.PHONE] = { phone };
    if (company) values[CONTACT_COLUMNS.COMPANY] = company;
    
    // Add today's date as "Added On"
    const today = new Date().toISOString().split('T')[0];
    values[CONTACT_COLUMNS.ADDED_ON] = { date: today };
    
    const valueString = JSON.stringify(values);
    const mutation = `
      mutation {
        create_item(
          board_id: ${BOARD_IDS.CONTACTS},
          item_name: "${name.replace(/"/g, '\\"')}",
          column_values: ${JSON.stringify(valueString)}
        ) {
          id
        }
      }
    `;
    
    const data = await runGraphQLQuery(mutation);
    const contactId = data?.data?.create_item?.id;
    
    if (contactId) {
      console.log(`✅ Created new contact with ID: ${contactId}`);
      
      // Cache the new contact in Redis
      if (email) await redis.set(emailKey(email), contactId);
      if (name) await redis.set(nameKey(name), contactId);
    }
    
    return contactId;
  }
  
  /**
   * Helper function to update a single column value
   * @param {number} boardId - The board ID
   * @param {number} itemId - The item ID
   * @param {string} columnId - The column ID
   * @param {any} value - The value to set (object for JSON format, string for text columns)
   * @returns {Promise<boolean>} - Success status
   */
  async function updateColumnValue(boardId, itemId, columnId, value) {
    try {
      let mutation;
      
      if (typeof value === 'string' || typeof value === 'number') {
        // Simple text/number value
        mutation = `
          mutation {
            change_simple_column_value(
              board_id: ${boardId},
              item_id: ${itemId},
              column_id: "${columnId}",
              value: "${String(value).replace(/"/g, '\\"')}"
            ) {
              id
            }
          }
        `;
      } else {
        // Complex column value (JSON)
        mutation = `
          mutation {
            change_column_value(
              board_id: ${boardId},
              item_id: ${itemId},
              column_id: "${columnId}",
              value: ${JSON.stringify(JSON.stringify(value))}
            ) {
              id
            }
          }
        `;
      }
      
      console.log(`Updating column ${columnId} for item ${itemId}`);
      const response = await runGraphQLQuery(mutation);
      
      if (response.errors) {
        console.error(`Error updating column ${columnId}:`, JSON.stringify(response.errors, null, 2));
        return false;
      }
      
      return true;
    } catch (error) {
      console.error(`Failed to update column ${columnId}:`, error.message);
      return false;
    }
  }
  
  /**
   * Creates a project intake item using a two-step approach:
   * 1. Create the basic item
   * 2. Update each column value one by one
   */
  async function createProjectIntakeItem(formData, contactId, webFormItemId) {
    console.log(`➕ Creating project intake item linked to contact ${contactId}`);
    
    const { 
      name, 
      materials, 
      deadline, 
      usageInfo, 
      extraInfo,
      scanNeeds,
      canBringObject,
      partQuantity,
      partDimensions
    } = formData;
    
    // Combine all text information for the details field
    let detailsText = '';
    
    // Include usage info
    if (usageInfo) {
      detailsText += `HOW PARTS WILL BE USED:\n${usageInfo}\n\n`;
    }
    
    // Include scan needs information as text instead of dropdown 
    if (scanNeeds) {
      const scanNeedsText = Array.isArray(scanNeeds) 
        ? scanNeeds.join(", ")
        : scanNeeds;
      detailsText += `WHAT NEEDS TO BE SCANNED:\n${scanNeedsText}\n\n`;
    }
    
    // Include "can bring object" information as text
    if (canBringObject) {
      detailsText += `OBJECT TRANSPORT:\n${canBringObject}\n\n`;
    }
    
    // Include extra info
    if (extraInfo) {
      detailsText += `ADDITIONAL INFORMATION:\n${extraInfo}`;
    }
    
    detailsText = detailsText.trim();
    
    try {
      // Step 1: Create the basic item first
      const createMutation = `
        mutation {
          create_item(
            board_id: ${BOARD_IDS.PROJECT_INTAKE},
            group_id: "topics", 
            item_name: "${(name || "New Project").replace(/"/g, '\\"')}"
          ) {
            id
          }
        }
      `;
      
      console.log(`Creating base project item for "${name}"`);
      const createResponse = await runGraphQLQuery(createMutation);
      
      if (!createResponse?.data?.create_item?.id) {
        console.error("⚠️ Failed to create basic item:", JSON.stringify(createResponse, null, 2));
        throw new Error("Failed to create base project item");
      }
      
      const projectId = createResponse.data.create_item.id;
      console.log(`✅ Created basic project item with ID: ${projectId}`);
      
      // Step 2: Update each column value one by one
      const updates = [];
      
      // Update board relation (contacts)
      if (contactId) {
        updates.push(updateColumnValue(
          BOARD_IDS.PROJECT_INTAKE,
          projectId,
          PROJECT_INTAKE_COLUMNS.CONTACTS,
          { item_ids: [parseInt(contactId)] }
        ));
      }
      
      // Update date (deadline)
      if (deadline) {
        updates.push(updateColumnValue(
          BOARD_IDS.PROJECT_INTAKE,
          projectId,
          PROJECT_INTAKE_COLUMNS.DEADLINE,
          { date: deadline }
        ));
      }
      
      // Update status (material)
      if (materials) {
        updates.push(updateColumnValue(
          BOARD_IDS.PROJECT_INTAKE,
          projectId,
          PROJECT_INTAKE_COLUMNS.MATERIAL,
          { label: materials }
        ));
      }
      
      // Update long text (details) - now with all the combined information
      if (detailsText) {
        updates.push(updateColumnValue(
          BOARD_IDS.PROJECT_INTAKE,
          projectId,
          PROJECT_INTAKE_COLUMNS.DETAILS,
          { text: detailsText }
        ));
      }
      
      // Update text (part quantity)
      if (partQuantity) {
        updates.push(updateColumnValue(
          BOARD_IDS.PROJECT_INTAKE,
          projectId,
          PROJECT_INTAKE_COLUMNS.PART_QUANTITY,
          partQuantity
        ));
      }
      
      // Update text (part dimensions)
      if (partDimensions) {
        updates.push(updateColumnValue(
          BOARD_IDS.PROJECT_INTAKE,
          projectId,
          PROJECT_INTAKE_COLUMNS.PART_DIMENSIONS,
          partDimensions
        ));
      }
      
      // Update date (date received)
      const today = new Date().toISOString().split('T')[0];
      updates.push(updateColumnValue(
        BOARD_IDS.PROJECT_INTAKE,
        projectId,
        PROJECT_INTAKE_COLUMNS.DATE_RECEIVED,
        { date: today }
      ));
      
      // Update board relation (web form raw intake)
      if (webFormItemId) {
        updates.push(updateColumnValue(
          BOARD_IDS.PROJECT_INTAKE,
          projectId,
          PROJECT_INTAKE_COLUMNS.WEB_FORM_RAW_INTAKE,
          { item_ids: [parseInt(webFormItemId)] }
        ));
      }
      
      // Wait for all updates to complete
      await Promise.all(updates);
      console.log(`✅ Updated project item ${projectId} with all column values`);
      
      return projectId;
    } catch (error) {
      console.error(`❌ Error creating project intake item: ${error.message}`);
      throw error;
    }
  }
  
  async function linkProjectToContact(contactId, projectId) {
    console.log(`🔗 Linking project ${projectId} to contact ${contactId}`);
    
    if (!contactId || !projectId) {
      console.error("❌ Missing contactId or projectId for linking");
      return;
    }
    
    try {
      // First, fetch existing linked projects
      const query = `
        query {
          items(ids: ${contactId}) {
            column_values(ids: "${CONTACT_COLUMNS.PROJECT_INTAKE}") {
              value
            }
          }
        }
      `;
      const data = await runGraphQLQuery(query);
      const existingRaw = data?.data?.items?.[0]?.column_values?.[0]?.value;
      
      // Initialize with empty array in case of no existing links
      let existingIds = [];
      
      // Parse existing project IDs if available
      try {
        if (existingRaw) {
          const parsed = JSON.parse(existingRaw);
          if (parsed && parsed.item_ids) {
            existingIds = parsed.item_ids;
            console.log(`📋 Found ${existingIds.length} existing linked projects: ${existingIds.join(', ')}`);
          }
        }
      } catch (parseError) {
        console.error("⚠️ Error parsing existing project links:", parseError.message);
      }
      
      // Convert projectId to number and check if it already exists in the list
      const projectIdNum = parseInt(projectId, 10);
      
      // Only add the new project if it's not already in the list
      if (!existingIds.includes(projectIdNum)) {
        existingIds.push(projectIdNum);
        console.log(`➕ Adding project ${projectId} to existing list (now ${existingIds.length} projects)`);
      } else {
        console.log(`ℹ️ Project ${projectId} already linked to contact ${contactId}`);
        return; // No need to update if already linked
      }
      
      // Update the contact with all projects (existing + new)
      const mutation = `
        mutation {
          change_column_value(
            board_id: ${BOARD_IDS.CONTACTS},
            item_id: ${contactId},
            column_id: "${CONTACT_COLUMNS.PROJECT_INTAKE}",
            value: ${JSON.stringify(JSON.stringify({ item_ids: existingIds }))}
          ) {
            id
          }
        }
      `;
      
      const result = await runGraphQLQuery(mutation);
      
      if (result.errors) {
        console.error("❌ Error linking project to contact:", JSON.stringify(result.errors, null, 2));
      } else {
        console.log(`✅ Successfully linked project to contact (total projects: ${existingIds.length})`);
      }
    } catch (error) {
      console.error(`❌ Error in linkProjectToContact: ${error.message}`);
    }
  }
  
  async function extractWebFormData(itemId) {
    console.log(`📊 Extracting data from web form item ${itemId}`);
    
    const query = `
      query {
        items(ids: ${itemId}) {
          name
          column_values {
            id
            text
            value
          }
        }
      }
    `;
    
    const data = await runGraphQLQuery(query);
    const item = data?.data?.items?.[0];
    
    if (!item) {
      console.error(`❌ Could not find web form item with ID ${itemId}`);
      return null;
    }
    
    // Extract all the needed fields
    const formData = {
      name: item.name,
      clientName: getColumnValue(item, WEB_FORM_COLUMNS.CLIENT_NAME),
      email: getColumnValue(item, WEB_FORM_COLUMNS.EMAIL),
      phone: getColumnValue(item, WEB_FORM_COLUMNS.PHONE),
      company: getColumnValue(item, WEB_FORM_COLUMNS.COMPANY),
      projectType: getDropdownValues(item, WEB_FORM_COLUMNS.PROJECT_TYPE),
      deadline: getDateValue(item, WEB_FORM_COLUMNS.DEADLINE),
      materials: getColumnValue(item, WEB_FORM_COLUMNS.MATERIALS),
      usageInfo: getColumnValue(item, WEB_FORM_COLUMNS.USAGE_INFO),
      extraInfo: getColumnValue(item, WEB_FORM_COLUMNS.EXTRA_INFO),
      scanNeeds: getColumnValue(item, WEB_FORM_COLUMNS.SCAN_NEEDS),
      canBringObject: getColumnValue(item, WEB_FORM_COLUMNS.CAN_BRING_OBJECT),
      projectFiles: getColumnValue(item, WEB_FORM_COLUMNS.PROJECT_FILES, true),
      partQuantity: getColumnValue(item, WEB_FORM_COLUMNS.PART_QUANTITY),
      partDimensions: getColumnValue(item, WEB_FORM_COLUMNS.PART_DIMENSIONS)
    };
    
    console.log(`✅ Successfully extracted web form data for item ${itemId}`);
    return formData;
  }
  
  // Helper function to get column value
  function getColumnValue(item, columnId, isRaw = false) {
    const column = item.column_values.find(col => col.id === columnId);
    if (!column) return null;
    
    return isRaw ? column.value : column.text;
  }
  
  // Helper function to get dropdown values as array
  function getDropdownValues(item, columnId) {
    const column = item.column_values.find(col => col.id === columnId);
    if (!column || !column.value) return [];
    
    try {
      const parsed = JSON.parse(column.value);
      return parsed?.chosenValues?.map(v => v.name) || [];
    } catch {
      return [];
    }
  }
  
  // Helper function to get date value
  function getDateValue(item, columnId) {
    const column = item.column_values.find(col => col.id === columnId);
    if (!column || !column.value) return null;
    
    try {
      const parsed = JSON.parse(column.value);
      return parsed?.date;
    } catch {
      return null;
    }
  }
  
  /**
   * Debug utility to trace column value formats for a specific board
   * @param {number} boardId The board ID to examine
   * @param {string} itemId Optional item ID to fetch values from
   */
  async function debugColumnFormats(boardId, itemId = null) {
    console.log(`🔍 Examining column formats for board ${boardId}`);
    
    // First, get the column definitions
    const columnsQuery = `
      query {
        boards(ids: ${boardId}) {
          columns {
            id
            title
            type
            settings_str
          }
        }
      }
    `;
    
    try {
      const columnsData = await runGraphQLQuery(columnsQuery);
      const columns = columnsData?.data?.boards?.[0]?.columns || [];
      
      console.log(`Found ${columns.length} columns on board ${boardId}:`);
      columns.forEach(col => {
        console.log(`- ${col.id} (${col.title}): ${col.type}`);
        if (col.settings_str) {
          try {
            const settings = JSON.parse(col.settings_str);
            if (col.type === 'status' || col.type === 'dropdown') {
              console.log(`  Labels: ${JSON.stringify(settings.labels)}`);
            }
          } catch (e) {
            console.log(`  Could not parse settings: ${col.settings_str}`);
          }
        }
      });
      
      // If an item ID was provided, fetch its values as examples
      if (itemId) {
        const itemQuery = `
          query {
            items(ids: ${itemId}) {
              name
              column_values {
                id
                title
                type
                text
                value
              }
            }
          }
        `;
        
        const itemData = await runGraphQLQuery(itemQuery);
        const item = itemData?.data?.items?.[0];
        
        if (item) {
          console.log(`\nExample values from item "${item.name}" (${itemId}):`);
          item.column_values.forEach(cv => {
            if (cv.value) {
              console.log(`- ${cv.id} (${cv.title}): ${cv.type}`);
              console.log(`  Text: ${cv.text}`);
              console.log(`  Value: ${cv.value}`);
              
              try {
                const parsed = JSON.parse(cv.value);
                console.log(`  Parsed: ${JSON.stringify(parsed, null, 2)}`);
              } catch (e) {
                // Not JSON parseable
              }
            }
          });
        }
      }
      
      return columns;
    } catch (error) {
      console.error(`Error debugging column formats: ${error.message}`);
      return [];
    }
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
    updateColumnValue,
    debugColumnFormats,
    markWebFormItemProcessed,
    linkProjectToContact,
    extractWebFormData
  };