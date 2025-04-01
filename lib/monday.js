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
  
  async function createProjectIntakeItem(formData, contactId, webFormItemId) {
    console.log(`➕ Creating project intake item linked to contact ${contactId}`);
    
    const { 
      name, 
      projectType, 
      materials, 
      deadline, 
      usageInfo, 
      extraInfo,
      scanNeeds,
      canBringObject,
      projectFiles,
      partQuantity,
      partDimensions
    } = formData;
    
    // Combine the usage and extra info with a divider for the details field
    let detailsText = '';
    if (usageInfo) {
      detailsText += `HOW PARTS WILL BE USED:\n${usageInfo}\n\n`;
    }
    if (extraInfo) {
      detailsText += `ADDITIONAL INFORMATION:\n${extraInfo}`;
    }
    
    // Create properly formatted column values
    const columnValues = {};
    
    // Link to Contact - must be the only column formatted this way
    if (contactId) {
      columnValues[PROJECT_INTAKE_COLUMNS.CONTACTS] = JSON.stringify({ item_ids: [parseInt(contactId)] });
    }
    
    // Add optional fields with proper formatting for each type
    if (deadline) {
      columnValues[PROJECT_INTAKE_COLUMNS.DEADLINE] = JSON.stringify({ date: deadline });
    }
    
    if (projectType && projectType.length > 0) {
      // Dropdown values need special formatting
      columnValues[PROJECT_INTAKE_COLUMNS.PROJECT_TYPE] = JSON.stringify({ 
        labels: Array.isArray(projectType) ? projectType : [projectType] 
      });
    }
    
    if (materials) {
      // Status/Label columns need special formatting
      columnValues[PROJECT_INTAKE_COLUMNS.MATERIAL] = JSON.stringify({ label: materials });
    }
    
    if (detailsText) {
      columnValues[PROJECT_INTAKE_COLUMNS.DETAILS] = JSON.stringify({ text: detailsText });
    }
    
    if (scanNeeds) {
      // Format dropdown for single selection
      const scanValue = Array.isArray(scanNeeds) ? scanNeeds[0] : scanNeeds;
      columnValues[PROJECT_INTAKE_COLUMNS.SCAN_NEEDS] = JSON.stringify({ 
        labels: [scanValue]
      });
    }
    
    if (canBringObject) {
      // Status/Label columns need special formatting
      columnValues[PROJECT_INTAKE_COLUMNS.CAN_BRING_OBJECT] = JSON.stringify({ 
        label: canBringObject 
      });
    }
    
    if (partQuantity) {
      columnValues[PROJECT_INTAKE_COLUMNS.PART_QUANTITY] = partQuantity;
    }
    
    if (partDimensions) {
      columnValues[PROJECT_INTAKE_COLUMNS.PART_DIMENSIONS] = partDimensions;
    }
    
    if (projectFiles) {
      // Handle file column 
      columnValues[PROJECT_INTAKE_COLUMNS.FILES] = projectFiles;
    }
    
    // Set intake source to Web Form
    columnValues[PROJECT_INTAKE_COLUMNS.INTAKE_SOURCE] = JSON.stringify({ 
      label: "Web Form" 
    });
    
    // Add today's date as received date
    const today = new Date().toISOString().split('T')[0];
    columnValues[PROJECT_INTAKE_COLUMNS.DATE_RECEIVED] = JSON.stringify({ 
      date: today 
    });
    
    // Link back to the web form item if provided
    if (webFormItemId) {
      columnValues[PROJECT_INTAKE_COLUMNS.WEB_FORM_RAW_INTAKE] = JSON.stringify({ 
        item_ids: [parseInt(webFormItemId)] 
      });
    }
    
    // Create the mutation with proper error handling
    const mutation = `
      mutation {
        create_item(
          board_id: ${BOARD_IDS.PROJECT_INTAKE},
          group_id: "topics", 
          item_name: "${(name || "New Project").replace(/"/g, '\\"')}",
          column_values: ${JSON.stringify(JSON.stringify(columnValues))}
        ) {
          id
        }
      }
    `;
    
    try {
      console.log(`Sending project creation mutation with payload length: ${mutation.length}`);
      const response = await runGraphQLQuery(mutation);
      
      // Log full response for debugging
      console.log("Project creation response:", JSON.stringify(response, null, 2));
      
      // Properly extract the ID
      const projectId = response?.data?.create_item?.id;
      
      if (!projectId) {
        console.error("⚠️ No project ID returned from creation. Response:", response);
        if (response.errors) {
          console.error("GraphQL errors:", response.errors);
        }
        throw new Error("Failed to create project intake item");
      }
      
      console.log(`✅ Created new project intake item with ID: ${projectId}`);
      return projectId;
    } catch (error) {
      console.error(`❌ Error creating project intake item: ${error.message}`);
      throw error;
    }
  }
  
  async function linkProjectToContact(contactId, projectId) {
    console.log(`🔗 Linking project ${projectId} to contact ${contactId}`);
    
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
          column_id: "${CONTACT_COLUMNS.PROJECT_INTAKE}",
          value: ${JSON.stringify(JSON.stringify({ item_ids: existingIds }))}
        ) {
          id
        }
      }
    `;
    await runGraphQLQuery(mutation);
    console.log(`✅ Successfully linked project to contact`);
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
    linkProjectToContact,
    extractWebFormData
  };