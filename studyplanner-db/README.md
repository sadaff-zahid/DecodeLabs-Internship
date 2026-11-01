# StudyPlanner (Database Integration)

DecodeLabs Full Stack Development, Project 3: Database Integration.

## Description
StudyPlanner is a study task planner. Project 1 built the responsive frontend and Project 2 built the backend API. In **Project 3 the tasks are saved in a real PostgreSQL database**, so they are still there after the server restarts (data longevity).

What this project does:
- **Designs a database schema** with two related tables (`subjects` and `tasks`).
- **Performs CRUD** (Create, Read, Update, Delete) from the API using SQL.
- **Handles data properly:** the API validates every request, the database enforces its own rules (constraints), and every query uses placeholders so SQL injection cannot work.

The server is built with Node.js, Express and the native `pg` driver. The frontend is plain HTML, CSS and JavaScript.

## How to Run
You need **Node.js 18 or newer** (https://nodejs.org) and a **PostgreSQL database**. The easiest way is a free cloud database from https://neon.com (sign up, create a project, then copy the connection string). Any PostgreSQL works.

1. Open a terminal in this folder (the one with `package.json`).
2. Create your settings file:

   ```bash
   cp .env.example .env
   ```
   (On Windows, copy the file `.env.example` and rename the copy to `.env`.)

3. Open `.env` and replace the example with your real connection string:

   ```
   DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require
   ```

4. Install and start:

   ```bash
   npm install
   npm start
   ```

5. Open **http://localhost:3000**. The tables are created automatically the first time.

Run the automatic tests (they use a small in-memory database, so no setup is needed):

```bash
npm test
```

`.env` is private and is not uploaded to GitHub (see `.gitignore`). Never share your connection string.

## Database Design
One subject has many tasks (one-to-many). A task may have no subject.

```mermaid
erDiagram
    SUBJECTS ||--o{ TASKS : has
    SUBJECTS {
        uuid id PK
        varchar name "UNIQUE, NOT NULL"
        timestamptz created_at
    }
    TASKS {
        uuid id PK
        varchar title "NOT NULL, CHECK length >= 3"
        uuid subject_id FK
        date due_date
        boolean done "NOT NULL, default false"
        timestamptz created_at
        timestamptz updated_at
    }
```

The full SQL is in `schema.sql`. It runs automatically when the server starts.

| Rule | Where | Why |
|---|---|---|
| **PRIMARY KEY** (`id`) | both tables | every row is unique |
| **FOREIGN KEY** (`tasks.subject_id`) | tasks | a task can only point to a subject that exists |
| **ON DELETE SET NULL** | tasks | if a subject is removed, its tasks stay |
| **UNIQUE** (`lower(name)`) | subjects | "Maths" and "maths" cannot both exist |
| **NOT NULL** | `title`, `done`, `name` | important data can never be empty |
| **CHECK** | `title`, `name` | the title needs at least 3 characters |

The database is the final source of truth: even if someone skips the API, it still rejects bad data.

## Design Choices
- **SQL (PostgreSQL), not NoSQL:** tasks and subjects have a clear structure and a relationship, which is what relational databases are good at.
- **Native driver (`pg`), not an ORM:** writing the SQL by hand shows exactly what happens in the database. The cost is a bit more code.
- **Transactions:** creating a task and a new subject happens together, or not at all.

## CRUD Mapping
| CRUD | HTTP | SQL |
|---|---|---|
| Create | POST | INSERT |
| Read | GET | SELECT |
| Update | PUT (replace) or PATCH (partial) | UPDATE |
| Delete | DELETE | DELETE |

## API Reference
Base path: `/api`. All data is sent and received as JSON.

| Method | Endpoint | What it does | Success |
|---|---|---|---|
| GET | `/api/health` | Checks the server and the database | 200 |
| GET | `/api/subjects` | List subjects with their task counts | 200 |
| GET | `/api/tasks` | List tasks (optional `?status=pending` or `done`, and `?subject=Maths`) | 200 |
| GET | `/api/tasks/:id` | Get one task | 200 |
| POST | `/api/tasks` | Create a task | 201 |
| PUT | `/api/tasks/:id` | Replace all of a task's details | 200 |
| PATCH | `/api/tasks/:id` | Change only the fields you send | 200 |
| DELETE | `/api/tasks/:id` | Delete a task | 204 |

### Task fields
| Field | Type | Rules |
|---|---|---|
| `title` | text | **Required**, 3 to 80 characters |
| `subject` | text | Optional, up to 30 characters. A new subject is created automatically |
| `dueDate` | text | Optional, a real date like `2026-12-31` |
| `done` | true / false | Optional, default `false` |

The server adds `id`, `createdAt` and `updatedAt`. `subject` and `dueDate` are `null` when empty.

### Status codes used
| Code | Meaning | When |
|---|---|---|
| 200 | OK | Successful GET, PUT or PATCH |
| 201 | Created | A task was created |
| 204 | No Content | A task was deleted |
| 400 | Bad Request | Invalid data, or broken JSON |
| 404 | Not Found | Task or route does not exist |
| 409 | Conflict | A value that must be unique already exists |
| 413 | Payload Too Large | Request body bigger than 10 KB |
| 429 | Too Many Requests | More than 100 requests per minute from one visitor |
| 500 | Internal Error | Unexpected server problem |
| 503 | Service Unavailable | The database cannot be reached |

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
    "id": "b86873a5-9c6c-47e2-9344-97ea5c9b7635",
    "title": "Revise chapter 3",
    "subject": "Maths",
    "dueDate": "2026-12-31",
    "done": false,
    "createdAt": "2026-11-01T08:07:04.711Z",
    "updatedAt": "2026-11-01T08:07:04.711Z"
  }
}
```

List the tasks of one subject:

```bash
curl "http://localhost:3000/api/tasks?subject=Maths"
```

Mark a task as done (use the real `id`):

```bash
curl -X PATCH http://localhost:3000/api/tasks/YOUR_TASK_ID \
  -H "Content-Type: application/json" \
  -d '{"done":true}'
```

Delete a task:

```bash
curl -X DELETE http://localhost:3000/api/tasks/YOUR_TASK_ID
```

A validation error (400 Bad Request):

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

**Windows PowerShell tip:** `curl` is a different command there. Use `curl.exe`, Git Bash, or Postman.

## Security and Data Handling
- **Parameterized queries:** every query uses `$1, $2...` placeholders, never string joining. An input like `'); DROP TABLE tasks; --` is saved as plain text and does nothing. The tests prove this.
- **Two layers of checks:** the API validates the format and the logic first, then the database constraints protect the data again.
- **Clear errors:** database problems are turned into proper status codes (409, 400, 503) instead of crashing the server.
- **Secrets:** the database address lives in `.env`, which is not uploaded to GitHub.

## Project Structure
```
server.js        the API (routes, validation, error handling)
db.js            database connection and schema setup
schema.sql       the database design (tables and constraints)
test.js          automatic tests
public/          the StudyPlanner page (index.html, style.css, script.js)
.env.example     example settings file
```

## Deploy (Render + a cloud database)
1. Push this folder to GitHub.
2. On https://render.com create a **New Web Service** from the repository. Set the **Root Directory** to this folder.
3. Build command: `npm install`. Start command: `npm start`.
4. In the service's **Environment** settings add a variable named `DATABASE_URL` with your database connection string.
5. Deploy. Free web services sleep after a while, so the first visit can take up to a minute.

Check the current free limits of your database provider before relying on it for long.

## Limitations
- No login (authentication) yet. That is the next project.
- The API does not use an ORM or database migrations tool. The schema is created from `schema.sql`.
