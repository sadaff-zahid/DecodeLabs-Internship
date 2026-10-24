# StudyPlanner API

DecodeLabs Full Stack Development, Project 2: Backend API Development.

## Description
StudyPlanner is a study task planner. Project 1 built the responsive frontend. Project 2 adds the **backend API** that stores the tasks and checks the data.

The server is built with Node.js and Express. It:
- exposes REST endpoints (GET, POST, PUT, DELETE) for tasks,
- handles user input and sends clear JSON responses,
- validates every request (never trust the client) and replies with the right HTTP status code,
- serves the StudyPlanner page, which uses the API with `fetch()`.

Tasks are saved in `data/tasks.json` (no database yet).

## How to Run
You need **Node.js 18 or newer** (download from https://nodejs.org). Check with `node -v`.

Open a terminal in this project folder (the one that contains `package.json`) and run:

```bash
npm install
npm start
```

Then open **http://localhost:3000** in your browser.

To run the automatic tests:

```bash
npm test
```

## API Reference
Base path: `/api`. All data is sent and received as JSON.

| Method | Endpoint | What it does | Success |
|---|---|---|---|
| GET | `/api/health` | Checks the server is alive | 200 |
| GET | `/api/tasks` | List all tasks (optional `?status=pending` or `?status=done`) | 200 |
| GET | `/api/tasks/:id` | Get one task | 200 |
| POST | `/api/tasks` | Create a task | 201 |
| PUT | `/api/tasks/:id` | Replace a task's details | 200 |
| DELETE | `/api/tasks/:id` | Delete a task | 204 |

### Task fields
| Field | Type | Rules |
|---|---|---|
| `title` | text | **Required**, 3 to 80 characters |
| `subject` | text | Optional, up to 30 characters |
| `dueDate` | text | Optional, a real date in the format `YYYY-MM-DD` |
| `done` | true / false | Optional, default `false` |

The server adds `id`, `createdAt` and `updatedAt`.

### Status codes used
| Code | Meaning | When |
|---|---|---|
| 200 | OK | Successful GET or PUT |
| 201 | Created | A task was created (POST) |
| 204 | No Content | A task was deleted |
| 400 | Bad Request | Invalid data or broken JSON |
| 404 | Not Found | Task or route does not exist |
| 413 | Payload Too Large | Request body bigger than 10 KB |
| 429 | Too Many Requests | More than 100 requests per minute from one visitor |
| 500 | Internal Error | Unexpected server problem |

### Examples
Create a task:

```bash
curl -X POST http://localhost:3000/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"Revise chapter 3","subject":"Maths","dueDate":"2026-12-31"}'
```

Response (201 Created):

```json
{
  "data": {
    "id": "3b1f0c52-6f0a-4a5e-9f55-2f0d8c0a7e11",
    "title": "Revise chapter 3",
    "subject": "Maths",
    "dueDate": "2026-12-31",
    "done": false,
    "createdAt": "2026-10-24T10:00:00.000Z",
    "updatedAt": "2026-10-24T10:00:00.000Z"
  }
}
```

List pending tasks:

```bash
curl http://localhost:3000/api/tasks?status=pending
```

Mark a task as done (use the real `id`):

```bash
curl -X PUT http://localhost:3000/api/tasks/YOUR_TASK_ID \
  -H "Content-Type: application/json" \
  -d '{"title":"Revise chapter 3","subject":"Maths","dueDate":"2026-12-31","done":true}'
```

Delete a task:

```bash
curl -X DELETE http://localhost:3000/api/tasks/YOUR_TASK_ID
```

Example of a validation error (400 Bad Request):

```json
{
  "error": {
    "status": 400,
    "message": "Please fix the highlighted problems.",
    "details": [
      { "field": "title", "message": "Title must be between 3 and 80 characters." }
    ]
  }
}
```

**Windows PowerShell tip:** `curl` is a different command there. Use `curl.exe`, Git Bash, or Postman. In PowerShell you can also use:

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/tasks -ContentType "application/json" -Body '{"title":"Revise chapter 3"}'
```

## Project Structure
```
studyplanner-api/
  server.js        the API (routes, validation, error handling)
  test.js          automatic tests
  package.json     project info and commands
  data/tasks.json  saved tasks
  public/          the StudyPlanner page (index.html, style.css, script.js)
```

## Design Notes
- **RESTful naming:** resources are nouns (`/api/tasks`), methods are verbs (GET, POST, PUT, DELETE).
- **Input, Process, Output:** every route reads the input, validates and processes it, then returns a predictable JSON output.
- **Validation:** type and format are checked first, then the logic (for example, a due date like 2026-02-30 is rejected).
- **Stateless:** each request carries everything the server needs.
- **Errors:** the server always answers with a clear status code and a JSON error message.

## Deploy (Render)
1. Push this folder to GitHub.
2. On https://render.com create a **New Web Service** from the repository.
3. Build command: `npm install`. Start command: `npm start`.
4. Open the Render link. The page and the API run together.

Note: on free hosting the saved file may reset when the server restarts. A real database is the next step.

## Limitations
- No login (authentication) yet.
- Tasks are stored in a JSON file, not a database.
