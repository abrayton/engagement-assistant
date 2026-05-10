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
    getThreadById: db.prepare('SELECT * FROM threads WHERE id = ?'),
    getPending: db.prepare(`
      SELECT * FROM threads
      WHERE status = 'pending' AND attempts < ?
      ORDER BY fetched_at ASC
    `),
    getScored: db.prepare(`
      SELECT * FROM threads
      WHERE status = 'scored' AND attempts < ?
      ORDER BY relevance_score DESC, fetched_at ASC
    `),
    updateThreadAfterScoring: db.prepare(`
      UPDATE threads SET
        raw_relevance_score = @raw_relevance_score,
        relevance_score = @relevance_score,
        relevance_reason = @relevance_reason,
        suggested_angle = @suggested_angle,
        high_traffic_flag = @high_traffic_flag,
        status = @status
      WHERE id = @id
    `),
    updateThreadStatus: db.prepare('UPDATE threads SET status = ? WHERE id = ?'),
    incrementAttempts: db.prepare(`
      UPDATE threads SET
        attempts = attempts + 1,
        last_error = ?,
        status = ?
      WHERE id = ?
    `),
    insertDraft: db.prepare(`
      INSERT INTO drafts (thread_id, draft_text, created_at)
      VALUES (?, ?, ?)
    `),
    getLatestDraft: db.prepare(`
      SELECT * FROM drafts WHERE thread_id = ?
      ORDER BY created_at DESC, id DESC LIMIT 1
    `),
    deleteDraftsForThread: db.prepare('DELETE FROM drafts WHERE thread_id = ?'),
    insertPosted: db.prepare(`
      INSERT INTO posted (thread_id, subreddit, thread_title, thread_url, final_text, posted_at)
      VALUES (@thread_id, @subreddit, @thread_title, @thread_url, @final_text, @posted_at)
    `),
    getRecentPosted: db.prepare('SELECT * FROM posted ORDER BY posted_at DESC LIMIT ?'),
    insertCycleLog: db.prepare(`
      INSERT INTO cycle_log (
        started_at, finished_at, threads_fetched, threads_inserted,
        scoring_calls, drafting_calls, errors
      ) VALUES (
        @started_at, @finished_at, @threads_fetched, @threads_inserted,
        @scoring_calls, @drafting_calls, @errors
      )
    `),
    getLastCycleLog: db.prepare('SELECT * FROM cycle_log ORDER BY id DESC LIMIT 1'),
    logApiCall: db.prepare(`
      INSERT INTO api_call_log (called_at, module, model, thread_id, input_tokens, output_tokens, success)
      VALUES (@called_at, @module, @model, @thread_id, @input_tokens, @output_tokens, @success)
    `),
    getApiCallsSince: db.prepare('SELECT * FROM api_call_log WHERE called_at >= ?')
  };

  return {
    migrate,
    threadExists(id) { return !!stmts.threadExists.get(id); },
    insertThread(row) { stmts.insertThread.run(row); },
    getThreadById(id) { return stmts.getThreadById.get(id); },
    getPending(maxAttempts) { return stmts.getPending.all(maxAttempts); },
    getScored(maxAttempts) { return stmts.getScored.all(maxAttempts); },
    updateThreadAfterScoring(id, fields) {
      stmts.updateThreadAfterScoring.run({ id, ...fields });
    },
    updateThreadStatus(id, status) { stmts.updateThreadStatus.run(status, id); },
    incrementAttempts(id, errorMessage, newStatus) {
      stmts.incrementAttempts.run(errorMessage, newStatus, id);
    },
    insertDraft(threadId, text) {
      stmts.insertDraft.run(threadId, text, Date.now());
    },
    getLatestDraft(threadId) { return stmts.getLatestDraft.get(threadId); },
    deleteDraftsForThread(threadId) { stmts.deleteDraftsForThread.run(threadId); },
    insertPosted(row) { stmts.insertPosted.run(row); },
    getRecentPosted(limit) { return stmts.getRecentPosted.all(limit); },
    insertCycleLog(row) { stmts.insertCycleLog.run(row); },
    getLastCycleLog() { return stmts.getLastCycleLog.get(); },
    logApiCall(row) { stmts.logApiCall.run(row); },
    getApiCallsSince(timestamp) { return stmts.getApiCallsSince.all(timestamp); },
    close() { db.close(); }
  };
}
