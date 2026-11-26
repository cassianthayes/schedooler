-- Obsolete tables from earlier versions.
DROP TABLE IF EXISTS seen;
DROP TABLE IF EXISTS state;

CREATE TABLE IF NOT EXISTS relayed (
  post_key TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);
