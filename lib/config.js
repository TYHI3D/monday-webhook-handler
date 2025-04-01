// lib/config.js

const BOARD_IDS = {
  CONTACTS: 7108984740,
  PROJECT_INTAKE: 7108984722,
  PROJECTS: 7108984735,
  WEB_FORM_INTAKE: 8826296878,
};

const COLUMN_IDS = {
  TEAM: "person",
  TIMELINE: "timerange_mkp86nae",
  DEADLINE: "date_mkpb5r4t",
  JOB_NUMBER: "text_mkpd32rc",
  WORK_TYPES: "dropdown_mkp8c97w",
  SHOW: "dropdown_mkp87fs0",
  CONTACTS_TO_PROJECT_INTAKE: 'board_relation_mkpk9fry',
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
  TEAM_IDS,
  WORK_TYPE_TEAM_MAP
};
