// lib/config.js

const BOARD_IDS = {
  CONTACTS: 7108984740,
  PROJECT_INTAKE: 7108984722,
  PROJECTS: 7108984735,
  WEB_FORM_INTAKE: 8826296878,
};

// Project Board Column IDs
const COLUMN_IDS = {
  TEAM: "person",
  TIMELINE: "timerange_mkp86nae",
  DEADLINE: "date_mkpb5r4t",
  JOB_NUMBER: "text_mkpd32rc",
  WORK_TYPES: "dropdown_mkp8c97w",
  SHOW: "dropdown_mkp87fs0",
};

// Web Form Column IDs
const WEB_FORM_COLUMNS = {
  CLIENT_NAME: "text_mkpkzg16",
  EMAIL: "email_mkpkkkje",
  PHONE: "phone_mkpkcdr8",
  COMPANY: "text_mkpkpdw2",
  PROJECT_TYPE: "dropdown_mkpkpc18",
  DEADLINE: "date_mkpkmcjn",
  MATERIALS: "color_mkpk6mvd",
  USAGE_INFO: "long_text_mkpkvtrs",
  EXTRA_INFO: "long_text_mkpkz47",
  SCAN_NEEDS: "dropdown_mkpk7y4g",
  CAN_BRING_OBJECT: "color_mkpkfjs6",
  PROJECT_FILES: "file_mkpkpyg2",
  PART_QUANTITY: "text_mkpkhtx4",
  PART_DIMENSIONS: "text_mkpkm0g5",
  DATA_PROCESSED: "boolean_mkpk2nk9"
};

// Contacts Column IDs
const CONTACT_COLUMNS = {
  STATUS: "color_mkpjxjvv",
  PHONE: "contact_phone",
  EMAIL: "contact_email",
  COMPANY: "text8",
  PROJECT_INTAKE: "board_relation_mkpk9fry",
  ACTIVATED_PROJECTS: "board_relation_mkp8wg34",
  BILLING_ADDRESS: "long_text_mkpb159q",
  SHIPPING_ADDRESS: "long_text_mkpbw42y",
  PAYMENT_TERMS: "color_mkpaqfjv",
  RESALE_LICENSE: "text_mkpa4kd",
  ADDED_ON: "date_mkpjc54z",
  QUICKBOOKS_ID: "text_mkpjwz6j"
};

// Project Intake Column IDs
const PROJECT_INTAKE_COLUMNS = {
  CLIENT_NAME: "text_mkp787zp",
  CONTACTS: "board_relation_mkpkv3rk",
  EMAIL: "lookup_mkpkdfmt",
  PHONE: "lookup_mkpk8aex",
  COMPANY: "lookup_mkpk6hv0",
  DEADLINE: "date_mkp76ch1",
  PROJECT_TYPE: "dropdown_mkp7j1nm",
  FILES: "file_mkp7cmg0",
  PART_QUANTITY: "text_mkp76d8g",
  PART_DIMENSIONS: "text_mkp7ypxr",
  MATERIAL: "color_mkp7qz7s",
  DETAILS: "long_text_mkp72zke",
  SCAN_NEEDS: "dropdown_mkp770d0",
  CAN_BRING_OBJECT: "color_mkp721h0",
  DATE_RECEIVED: "date_mkp7ts6v",
  INTAKE_SOURCE: "lead_status",
  WEB_FORM_RAW_INTAKE: "board_relation_mkpk495a"
};

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

module.exports = {
  BOARD_IDS,
  COLUMN_IDS,
  WEB_FORM_COLUMNS,
  CONTACT_COLUMNS,
  PROJECT_INTAKE_COLUMNS,
  TEAM_IDS,
  WORK_TYPE_TEAM_MAP
};