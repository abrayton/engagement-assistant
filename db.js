import Database from 'better-sqlite3';

export function createDb(dbPath) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  function migrate() {
    db.exec(`
      CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY,
        subreddit TEXT,
        title TEXT,
        body TEXT,
        url TEXT,
        author TEXT,
        score INTEGER,
        comment_count INTEGER,
        created_utc INTEGER,
        fetched_at INTEGER,
        age_hours REAL,
        matched_strong TEXT,
        matched_weak TEXT,
        relevance_score INTEGER,
        raw_relevance_score INTEGER,
        relevance_reason TEXT,
        suggested_angle TEXT,
        high_traffic_flag INTEGER DEFAULT 0,
        attempts INTEGER DEFAULT 0,
        last_error TEXT,
        status TEXT DEFAULT 'pending'
      );

      CREATE TABLE IF NOT EXISTS drafts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT,
        draft_text TEXT,
        created_at INTEGER,
        FOREIGN KEY (thread_id) REFERENCES threads(id)
      );

      CREATE TABLE IF NOT EXISTS posted (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT,
        subreddit TEXT,
        thread_title TEXT,
        thread_url TEXT,
        final_text TEXT,
        posted_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS cycle_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at INTEGER,
        finished_at INTEGER,
        threads_fetched INTEGER DEFAULT 0,
        threads_inserted INTEGER DEFAULT 0,
        scoring_calls INTEGER DEFAULT 0,
        drafting_calls INTEGER DEFAULT 0,
        errors INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS api_call_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        called_at INTEGER,
        module TEXT,
        model TEXT,
        thread_id TEXT,
        input_tokens INTEGER DEFAULT 0,
        output_tokens INTEGER DEFAULT 0,
        success INTEGER DEFAULT 1
      );

      CREATE INDEX IF NOT EXISTS idx_threads_status ON threads(status);
      CREATE INDEX IF NOT EXISTS idx_api_call_log_called_at ON api_call_log(called_at);
    `);
  }
  migrate();

  // ---- prepared statements ----
  const stmts = {
    threadExists: db.prepare('SELECT 1 FROM threads WHERE id = ?'),
    insertThread: db.prepare(`
      INSERT INTO threads (
        id, subreddit, title, body, url, author, score, comment_count,
        created_utc, fetched_at, age_hours, matched_strong, matched_weak
      ) VALUES (
        @id, @subreddit, @title, @body, @url, @author, @score, @comment_count,
        @created_utc, @fetched_at, @age_hours, @matched_strong, @matched_weak
      )
    `),
    getThreadById: db.prepare('SELECT * FROM threads WHERE id = ?')
  };

  return {
    migrate,
    threadExists(id) { return !!stmts.threadExists.get(id); },
    insertThread(row) { stmts.insertThread.run(row); },
    getThreadById(id) { return stmts.getThreadById.get(id); },
    close() { db.close(); }
  };
}
