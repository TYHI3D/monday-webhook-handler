# Monday.com Webhook Integration

This project receives and processes webhook events from Monday.com and performs automated logic using the Monday GraphQL API.

It is built to support:
- Multiple Monday boards (extensible design)
- Dynamic item assignment based on dropdown columns like **Show** and **Work Types**
- Subitem generation
- Team assignments
- Job number tracking
- Group creation and ordering

---

## 📦 Directory Structure

```
/api/
├── monday-webhook.js     # The webhook endpoint used by Vercel

/lib/
├── config.js             # Column IDs, Team IDs, and work type mapping
├── graphql.js            # Generic GraphQL request wrapper for Monday.com API
├── monday.js             # Monday-specific API helpers
├── logic.js              # Main business logic and workflows
```

---

## 🔄 Handled Webhook Events

| Event Type                  | Column     | Action                                          |
|----------------------------|------------|-------------------------------------------------|
| `update_column_value`      | Work Types | Adds subitems and assigns teams                |
| `create_pulse`             | —          | Creates subitems and assigns show & job number |
| `update_column_value`      | Show       | Moves item to group and assigns job number     |

---

## ⚙️ Environment Variables

Make sure the following is set in your environment:

```
MONDAY_API_KEY=your_monday_api_key
```

---

## 🧠 Logic Overview

### Subitems

- New values in the "Work Types" column trigger subitem creation.
- Each subitem is named after the selected work type.
- Associated teams (based on work type) are auto-assigned.
- Timelines are set based on the item's deadline.

### Show & Group Logic

- The "Show" dropdown controls what group the item belongs to.
- Groups are auto-created and ordered numerically by show number.
- Items are assigned job numbers using the format `SHOW:JOB` (e.g., `19:5`).

---

## 🚀 Deployment Notes (Vercel)

- Only `/api/monday-webhook.js` is a serverless function.
- All logic is modularized in `/lib` to stay under Vercel's free-tier function limits.

---

## 🧩 Future Extensions

- Multi-board support using board ID mapping (via a config or database)
- Slack or email notifications
- Error logging or retries
- Caching with Upstash Redis (currently unused, but supported in your stack)

---

## 🧑‍💻 Author

Maintained by the team at **There You Have It 3D**.