-- StudyPlanner database schema (PostgreSQL)
-- One subject has many tasks (one-to-many). Each task may belong to one subject.

CREATE TABLE IF NOT EXISTS subjects (
  id         UUID PRIMARY KEY,                         -- primary key: unique id for each row
  name       VARCHAR(30) NOT NULL,                     -- NOT NULL: a subject must have a name
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (char_length(name) >= 1)                       -- CHECK: no empty names
);

-- UNIQUE (ignoring upper/lower case): "Maths" and "maths" are the same subject
CREATE UNIQUE INDEX IF NOT EXISTS subjects_name_unique ON subjects (lower(name));

CREATE TABLE IF NOT EXISTS tasks (
  id         UUID PRIMARY KEY,
  title      VARCHAR(80) NOT NULL,
  subject_id UUID REFERENCES subjects (id) ON DELETE SET NULL,   -- foreign key to subjects
  due_date   DATE,
  done       BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (char_length(title) >= 3)                      -- CHECK: title needs at least 3 characters
);

CREATE INDEX IF NOT EXISTS tasks_subject_id_idx ON tasks (subject_id);
CREATE INDEX IF NOT EXISTS tasks_created_at_idx ON tasks (created_at)
