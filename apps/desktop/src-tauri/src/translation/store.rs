//! SQLite store (`app_data_dir/translation.db`), modelled on `mol/db.py`:
//! projects, chapters, chunks (with resume), glossary, events (log), pilot runs.

use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

use rusqlite::{params, Connection, OptionalExtension};

use super::source::SourceBook;
use super::provider::{credits, TokenUsage};
use super::{
    now_f64, now_secs, pipeline, GlossaryEntry, LocalUsage, LogEvent, PilotRun, ProjectDetail, ProjectStatus,
    ProjectSummary, Scope,
};

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    source_dir TEXT NOT NULL,
    source_epub TEXT NOT NULL,
    source_novel_id TEXT,
    cover_path TEXT,
    model TEXT NOT NULL,
    effort TEXT NOT NULL,
    workers INTEGER NOT NULL DEFAULT 2,
    scope_json TEXT NOT NULL DEFAULT '{"kind":"all"}',
    status TEXT NOT NULL,
    glossary_status TEXT NOT NULL DEFAULT 'idle',
    output_dir TEXT,
    session_started_at REAL,
    resume_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS chapters (
    project_id TEXT NOT NULL,
    idx INTEGER NOT NULL,
    title TEXT NOT NULL,
    href TEXT NOT NULL,
    forced INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (project_id, idx)
);
CREATE TABLE IF NOT EXISTS chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    chapter_idx INTEGER NOT NULL,
    idx INTEGER NOT NULL,
    src_html TEXT NOT NULL,
    src_words INTEGER NOT NULL,
    src_blocks INTEGER NOT NULL,
    dst_html TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    model TEXT,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    updated_at REAL,
    UNIQUE (project_id, chapter_idx, idx)
);
CREATE INDEX IF NOT EXISTS chunks_project ON chunks (project_id, chapter_idx, idx);
CREATE TABLE IF NOT EXISTS glossary (
    project_id TEXT NOT NULL,
    term TEXT NOT NULL,
    kind TEXT NOT NULL,
    target TEXT,
    count INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL,
    missed INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (project_id, term)
);
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    at INTEGER NOT NULL,
    level TEXT NOT NULL,
    message TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_project ON events (project_id, id);
CREATE TABLE IF NOT EXISTS pilot_runs (
    project_id TEXT PRIMARY KEY,
    run_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS usage_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at REAL NOT NULL,
    project_id TEXT,
    model TEXT NOT NULL,
    words INTEGER NOT NULL DEFAULT 0,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    cached_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    credits REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS usage_log_at ON usage_log (at);
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"#;

#[derive(Debug, Clone)]
pub struct NewProject {
    pub title: String,
    pub source_dir: String,
    pub source_epub: String,
    pub source_novel_id: Option<String>,
    pub cover_path: Option<String>,
    pub model: String,
    pub effort: String,
}

#[derive(Debug, Clone)]
pub struct ProjectRow {
    pub id: String,
    pub title: String,
    pub source_dir: String,
    pub source_epub: String,
    pub source_novel_id: Option<String>,
    pub cover_path: Option<String>,
    pub model: String,
    pub effort: String,
    pub workers: u32,
    pub scope: Scope,
    pub status: ProjectStatus,
    pub glossary_status: String,
    pub output_dir: Option<String>,
    pub session_started_at: Option<f64>,
    pub resume_at: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct ChapterRow {
    pub index: u32,
    pub title: String,
    pub href: String,
    pub forced: bool,
}

#[derive(Debug, Clone)]
pub struct ChunkRow {
    pub id: i64,
    pub chapter: u32,
    pub index: u32,
    pub src_html: String,
    pub src_words: u64,
    pub src_blocks: u32,
    pub dst_html: Option<String>,
    pub status: String,
    pub error: Option<String>,
}

impl ChunkRow {
    pub fn is_translated(&self) -> bool {
        matches!(self.status.as_str(), "done" | "needs_review") && self.dst_html.is_some()
    }
}

pub struct Store {
    conn: Mutex<Connection>,
}

fn err(e: rusqlite::Error) -> String {
    format!("Erro no banco de tradução: {e}")
}

impl Store {
    pub fn open(path: &Path) -> Result<Store, String> {
        let conn = Connection::open(path).map_err(err)?;
        let _ = conn.pragma_update(None, "journal_mode", "WAL");
        Self::init(conn)
    }

    pub fn open_in_memory() -> Result<Store, String> {
        Self::init(Connection::open_in_memory().map_err(err)?)
    }

    fn init(conn: Connection) -> Result<Store, String> {
        conn.busy_timeout(std::time::Duration::from_secs(5)).map_err(err)?;
        conn.execute_batch(SCHEMA).map_err(err)?;
        Ok(Store { conn: Mutex::new(conn) })
    }

    fn with<T>(&self, f: impl FnOnce(&mut Connection) -> rusqlite::Result<T>) -> Result<T, String> {
        let mut conn = self.conn.lock().map_err(|_| "Banco de tradução indisponível".to_string())?;
        f(&mut conn).map_err(err)
    }

    // -- projects ------------------------------------------------------------

    pub fn create_project(&self, new: &NewProject, book: &SourceBook, chunk_words: usize) -> Result<String, String> {
        let id = format!("tp-{:x}", (now_f64() * 1000.0) as u64);
        let now = now_secs();
        self.with(|conn| {
            let tx = conn.transaction()?;
            tx.execute(
                "INSERT INTO projects (id, title, source_dir, source_epub, source_novel_id, cover_path, model, effort, status, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'ready', ?9, ?9)",
                params![id, new.title, new.source_dir, new.source_epub, new.source_novel_id, new.cover_path, new.model, new.effort, now],
            )?;
            for chapter in &book.chapters {
                tx.execute(
                    "INSERT INTO chapters (project_id, idx, title, href) VALUES (?1, ?2, ?3, ?4)",
                    params![id, chapter.index, chapter.title, chapter.href],
                )?;
                for (index, chunk) in pipeline::make_chunks(&chapter.blocks, chunk_words).iter().enumerate() {
                    tx.execute(
                        "INSERT INTO chunks (project_id, chapter_idx, idx, src_html, src_words, src_blocks) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                        params![id, chapter.index, index as i64, chunk.html, chunk.words as i64, chunk.blocks as i64],
                    )?;
                }
            }
            tx.commit()
        })?;
        Ok(id)
    }

    pub fn find_by_source(&self, source_dir: &str) -> Result<Option<String>, String> {
        self.with(|conn| {
            conn.query_row("SELECT id FROM projects WHERE source_dir = ?1", params![source_dir], |row| row.get(0))
                .optional()
        })
    }

    pub fn project_ids(&self) -> Result<Vec<String>, String> {
        self.with(|conn| {
            let mut stmt = conn.prepare("SELECT id FROM projects ORDER BY created_at DESC, id DESC")?;
            let rows = stmt.query_map([], |row| row.get(0))?;
            rows.collect()
        })
    }

    pub fn project(&self, id: &str) -> Result<ProjectRow, String> {
        let row = self.with(|conn| {
            conn.query_row(
                "SELECT id, title, source_dir, source_epub, source_novel_id, cover_path, model, effort,
                        workers, scope_json, status, glossary_status, output_dir, session_started_at, resume_at
                 FROM projects WHERE id = ?1",
                params![id],
                |row| {
                    let scope_json: String = row.get(9)?;
                    let status: String = row.get(10)?;
                    Ok(ProjectRow {
                        id: row.get(0)?,
                        title: row.get(1)?,
                        source_dir: row.get(2)?,
                        source_epub: row.get(3)?,
                        source_novel_id: row.get(4)?,
                        cover_path: row.get(5)?,
                        model: row.get(6)?,
                        effort: row.get(7)?,
                        workers: row.get::<_, i64>(8)?.clamp(1, 3) as u32,
                        scope: serde_json::from_str(&scope_json).unwrap_or(Scope::All),
                        status: ProjectStatus::parse(&status),
                        glossary_status: row.get(11)?,
                        output_dir: row.get(12)?,
                        session_started_at: row.get(13)?,
                        resume_at: row.get(14)?,
                    })
                },
            )
            .optional()
        })?;
        row.ok_or_else(|| "Projeto de tradução não encontrado".to_string())
    }

    fn set_field(&self, id: &str, sql: &str, value: rusqlite::types::Value) -> Result<(), String> {
        self.with(|conn| {
            conn.execute(sql, params![value, now_secs(), id])?;
            Ok(())
        })
    }

    pub fn set_status(&self, id: &str, status: ProjectStatus) -> Result<(), String> {
        self.set_field(
            id,
            "UPDATE projects SET status = ?1, updated_at = ?2 WHERE id = ?3",
            status.as_str().to_string().into(),
        )
    }

    pub fn set_glossary_status(&self, id: &str, status: &str) -> Result<(), String> {
        self.set_field(id, "UPDATE projects SET glossary_status = ?1, updated_at = ?2 WHERE id = ?3", status.to_string().into())
    }

    pub fn set_output_dir(&self, id: &str, dir: &str) -> Result<(), String> {
        self.set_field(id, "UPDATE projects SET output_dir = ?1, updated_at = ?2 WHERE id = ?3", dir.to_string().into())
    }

    pub fn set_resume_at(&self, id: &str, at: Option<i64>) -> Result<(), String> {
        let value = at.map(rusqlite::types::Value::Integer).unwrap_or(rusqlite::types::Value::Null);
        self.set_field(id, "UPDATE projects SET resume_at = ?1, updated_at = ?2 WHERE id = ?3", value)
    }

    pub fn set_model(&self, id: &str, model: &str) -> Result<(), String> {
        self.set_field(id, "UPDATE projects SET model = ?1, updated_at = ?2 WHERE id = ?3", model.to_string().into())
    }

    pub fn update_settings(
        &self,
        id: &str,
        model: Option<&str>,
        effort: Option<&str>,
        workers: Option<u32>,
        scope: Option<&Scope>,
    ) -> Result<(), String> {
        if let Some(model) = model {
            self.set_model(id, model)?;
        }
        if let Some(effort) = effort {
            self.set_field(id, "UPDATE projects SET effort = ?1, updated_at = ?2 WHERE id = ?3", effort.to_string().into())?;
        }
        if let Some(workers) = workers {
            self.set_field(id, "UPDATE projects SET workers = ?1, updated_at = ?2 WHERE id = ?3", (workers as i64).into())?;
        }
        if let Some(scope) = scope {
            let json = serde_json::to_string(scope).unwrap_or_else(|_| "{\"kind\":\"all\"}".into());
            self.set_field(id, "UPDATE projects SET scope_json = ?1, updated_at = ?2 WHERE id = ?3", json.into())?;
        }
        Ok(())
    }

    /// Starts an ETA session: chunks/min is measured from here.
    pub fn start_session(&self, id: &str) -> Result<(), String> {
        self.with(|conn| {
            conn.execute("UPDATE projects SET session_started_at = ?1 WHERE id = ?2", params![now_f64(), id])?;
            Ok(())
        })
    }

    pub fn delete_project(&self, id: &str) -> Result<(), String> {
        self.with(|conn| {
            let tx = conn.transaction()?;
            for table in ["chunks", "chapters", "glossary", "events", "pilot_runs"] {
                tx.execute(&format!("DELETE FROM {table} WHERE project_id = ?1"), params![id])?;
            }
            tx.execute("DELETE FROM projects WHERE id = ?1", params![id])?;
            tx.commit()
        })
    }

    // -- chapters & chunks ---------------------------------------------------

    pub fn chapters(&self, id: &str) -> Result<Vec<ChapterRow>, String> {
        self.with(|conn| {
            let mut stmt = conn.prepare("SELECT idx, title, href, forced FROM chapters WHERE project_id = ?1 ORDER BY idx")?;
            let rows = stmt.query_map(params![id], |row| {
                Ok(ChapterRow {
                    index: row.get::<_, i64>(0)? as u32,
                    title: row.get(1)?,
                    href: row.get(2)?,
                    forced: row.get::<_, i64>(3)? != 0,
                })
            })?;
            rows.collect()
        })
    }

    pub fn chapter_title(&self, id: &str, index: u32) -> Result<String, String> {
        self.with(|conn| {
            conn.query_row(
                "SELECT title FROM chapters WHERE project_id = ?1 AND idx = ?2",
                params![id, index],
                |row| row.get(0),
            )
        })
    }

    pub fn chunks(&self, id: &str, chapter: u32) -> Result<Vec<ChunkRow>, String> {
        self.with(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, chapter_idx, idx, src_html, src_words, src_blocks, dst_html, status, error
                 FROM chunks WHERE project_id = ?1 AND chapter_idx = ?2 ORDER BY idx",
            )?;
            let rows = stmt.query_map(params![id, chapter], |row| {
                Ok(ChunkRow {
                    id: row.get(0)?,
                    chapter: row.get::<_, i64>(1)? as u32,
                    index: row.get::<_, i64>(2)? as u32,
                    src_html: row.get(3)?,
                    src_words: row.get::<_, i64>(4)? as u64,
                    src_blocks: row.get::<_, i64>(5)? as u32,
                    dst_html: row.get(6)?,
                    status: row.get(7)?,
                    error: row.get(8)?,
                })
            })?;
            rows.collect()
        })
    }

    /// Chapters (in scope, or forced by "retranslate") that still have pending/error chunks.
    pub fn chapters_to_run(&self, id: &str, scope: &Scope) -> Result<Vec<u32>, String> {
        let forced: HashMap<u32, bool> = self.chapters(id)?.into_iter().map(|c| (c.index, c.forced)).collect();
        let open: Vec<u32> = self.with(|conn| {
            let mut stmt = conn.prepare(
                "SELECT DISTINCT chapter_idx FROM chunks WHERE project_id = ?1 AND status IN ('pending', 'error') ORDER BY chapter_idx",
            )?;
            let rows = stmt.query_map(params![id], |row| Ok(row.get::<_, i64>(0)? as u32))?;
            rows.collect()
        })?;
        Ok(open
            .into_iter()
            .filter(|chapter| scope.contains(*chapter) || forced.get(chapter).copied().unwrap_or(false))
            .collect())
    }

    pub fn save_chunk(
        &self,
        chunk_id: i64,
        dst_html: &str,
        status: &str,
        note: Option<&str>,
        model: &str,
        input_tokens: i64,
        output_tokens: i64,
    ) -> Result<(), String> {
        self.with(|conn| {
            conn.execute(
                "UPDATE chunks SET dst_html = ?1, status = ?2, error = ?3, model = ?4, input_tokens = ?5, output_tokens = ?6,
                        attempts = attempts + 1, updated_at = ?7 WHERE id = ?8",
                params![dst_html, status, note, model, input_tokens, output_tokens, now_f64(), chunk_id],
            )?;
            Ok(())
        })
    }

    pub fn mark_chunk_error(&self, chunk_id: i64, error: &str) -> Result<(), String> {
        self.with(|conn| {
            conn.execute(
                "UPDATE chunks SET status = 'error', error = ?1, attempts = attempts + 1, updated_at = ?2 WHERE id = ?3",
                params![error, now_f64(), chunk_id],
            )?;
            Ok(())
        })
    }

    /// "Retranslate": every chunk of the chapter goes back to pending; the chapter
    /// is forced into the run even when it is outside the scope.
    pub fn reset_chapter(&self, id: &str, chapter: u32) -> Result<(), String> {
        self.with(|conn| {
            conn.execute(
                "UPDATE chunks SET status = 'pending', dst_html = NULL, error = NULL WHERE project_id = ?1 AND chapter_idx = ?2",
                params![id, chapter],
            )?;
            conn.execute("UPDATE chapters SET forced = 1 WHERE project_id = ?1 AND idx = ?2", params![id, chapter])?;
            Ok(())
        })
    }

    pub fn clear_forced(&self, id: &str, chapter: u32) -> Result<(), String> {
        self.with(|conn| {
            conn.execute("UPDATE chapters SET forced = 0 WHERE project_id = ?1 AND idx = ?2", params![id, chapter])?;
            Ok(())
        })
    }

    /// Source HTML of every chapter (for the glossary heuristics).
    pub fn corpus(&self, id: &str) -> Result<Vec<String>, String> {
        self.with(|conn| {
            let mut stmt = conn.prepare(
                "SELECT group_concat(src_html, char(10)) FROM
                   (SELECT chapter_idx, src_html FROM chunks WHERE project_id = ?1 ORDER BY chapter_idx, idx)
                 GROUP BY chapter_idx ORDER BY chapter_idx",
            )?;
            let rows = stmt.query_map(params![id], |row| row.get(0))?;
            rows.collect()
        })
    }

    /// Light per-chunk view for counters: (chapter, status, words, updated_at).
    fn chunk_stats(&self, id: &str) -> Result<Vec<(u32, String, u64, Option<f64>)>, String> {
        self.with(|conn| {
            let mut stmt = conn.prepare(
                "SELECT chapter_idx, status, src_words, updated_at FROM chunks WHERE project_id = ?1 ORDER BY chapter_idx, idx",
            )?;
            let rows = stmt.query_map(params![id], |row| {
                Ok((row.get::<_, i64>(0)? as u32, row.get(1)?, row.get::<_, i64>(2)? as u64, row.get(3)?))
            })?;
            rows.collect()
        })
    }

    /// Builds `ProjectDetail` (counters are restricted to the scope). `cover_url`
    /// carries the raw cover path; the engine turns it into an asset URL.
    pub fn project_detail(&self, id: &str, active_titles: Option<Vec<String>>) -> Result<ProjectDetail, String> {
        let row = self.project(id)?;
        let chapters = self.chapters(id)?;
        let stats = self.chunk_stats(id)?;
        let titles: HashMap<u32, &str> = chapters.iter().map(|c| (c.index, c.title.as_str())).collect();

        let mut per_chapter: HashMap<u32, (u32, u32)> = HashMap::new();
        let (mut chunks_total, mut chunks_done, mut needs_review, mut errors, mut pending) = (0u32, 0u32, 0u32, 0u32, 0u32);
        let (mut words_total, mut words_done) = (0u64, 0u64);
        let mut session_chunks = 0u32;
        let started = row.session_started_at;
        for (chapter, status, words, updated) in &stats {
            let finished = matches!(status.as_str(), "done" | "needs_review");
            if let (Some(started), Some(updated)) = (started, updated) {
                if finished && *updated >= started {
                    session_chunks += 1;
                }
            }
            if !row.scope.contains(*chapter) {
                continue;
            }
            let entry = per_chapter.entry(*chapter).or_insert((0, 0));
            entry.0 += 1;
            chunks_total += 1;
            words_total += words;
            if finished {
                entry.1 += 1;
                chunks_done += 1;
                words_done += words;
            }
            match status.as_str() {
                "needs_review" => needs_review += 1,
                "error" => errors += 1,
                "pending" => pending += 1,
                _ => {}
            }
        }
        let chapters_total = chapters.iter().filter(|c| row.scope.contains(c.index)).count() as u32;
        let chapters_done = per_chapter.values().filter(|(total, done)| *total > 0 && total == done).count() as u32;
        let percent = if chunks_total > 0 {
            ((chunks_done as f64 / chunks_total as f64) * 1000.0).round() / 10.0
        } else {
            0.0
        };
        let chapters_in_progress = active_titles.unwrap_or_else(|| {
            let mut partial: Vec<u32> = per_chapter
                .iter()
                .filter(|(_, (total, done))| *done > 0 && done < total)
                .map(|(chapter, _)| *chapter)
                .collect();
            partial.sort();
            partial.into_iter().take(8).filter_map(|c| titles.get(&c).map(|t| t.to_string())).collect()
        });

        let elapsed = started.map(|s| now_f64() - s).unwrap_or(0.0);
        let chunks_per_minute = (elapsed > 30.0 && session_chunks > 0).then(|| session_chunks as f64 / (elapsed / 60.0));
        let eta_seconds = chunks_per_minute
            .filter(|rate| *rate > 0.0)
            .map(|rate| (pending + errors) as f64 / rate * 60.0);
        Ok(ProjectDetail {
            summary: ProjectSummary {
                id: row.id.clone(),
                title: row.title.clone(),
                cover_url: row.cover_path.clone(),
                source_novel_id: row.source_novel_id.clone(),
                status: row.status,
                chapters_total,
                chapters_done,
                chunks_total,
                chunks_done,
                percent,
                output_dir: row.output_dir.clone(),
            },
            model: row.model,
            effort: row.effort,
            workers: row.workers,
            scope: row.scope,
            words_total,
            words_done,
            needs_review,
            errors,
            pending,
            chapters_in_progress,
            chunks_per_minute,
            eta_seconds,
            resume_at: row.resume_at,
            glossary_status: row.glossary_status,
        })
    }

    // -- glossary ------------------------------------------------------------

    pub fn glossary(&self, id: &str) -> Result<Vec<GlossaryEntry>, String> {
        self.with(|conn| {
            let mut stmt = conn.prepare(
                "SELECT term, kind, target, count, source, missed FROM glossary WHERE project_id = ?1
                 ORDER BY count DESC, term COLLATE NOCASE",
            )?;
            let rows = stmt.query_map(params![id], |row| {
                Ok(GlossaryEntry {
                    term: row.get(0)?,
                    kind: row.get(1)?,
                    target: row.get(2)?,
                    count: row.get::<_, i64>(3)? as u64,
                    source: row.get(4)?,
                    missed: row.get::<_, i64>(5)? as u64,
                })
            })?;
            rows.collect()
        })
    }

    pub fn glossary_upsert(&self, id: &str, entry: &GlossaryEntry) -> Result<(), String> {
        self.with(|conn| {
            conn.execute(
                "INSERT INTO glossary (project_id, term, kind, target, count, source, missed) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)
                 ON CONFLICT (project_id, term) DO UPDATE SET kind = excluded.kind, target = excluded.target,
                     count = excluded.count, source = excluded.source",
                params![id, entry.term, entry.kind, entry.target, entry.count as i64, entry.source],
            )?;
            Ok(())
        })
    }

    pub fn glossary_delete(&self, id: &str, term: &str) -> Result<(), String> {
        self.with(|conn| {
            conn.execute("DELETE FROM glossary WHERE project_id = ?1 AND term = ?2", params![id, term])?;
            Ok(())
        })
    }

    /// Replaces the automatic entries; manual entries always win.
    pub fn glossary_replace_auto(&self, id: &str, entries: &[GlossaryEntry]) -> Result<(), String> {
        self.with(|conn| {
            let tx = conn.transaction()?;
            tx.execute("DELETE FROM glossary WHERE project_id = ?1 AND source = 'auto'", params![id])?;
            for entry in entries {
                tx.execute(
                    "INSERT OR IGNORE INTO glossary (project_id, term, kind, target, count, source, missed)
                     VALUES (?1, ?2, ?3, ?4, ?5, 'auto', 0)",
                    params![id, entry.term, entry.kind, entry.target, entry.count as i64],
                )?;
            }
            tx.commit()
        })
    }

    pub fn glossary_add_missed(&self, id: &str, terms: &[String]) -> Result<(), String> {
        self.with(|conn| {
            for term in terms {
                conn.execute(
                    "UPDATE glossary SET missed = missed + 1 WHERE project_id = ?1 AND term = ?2",
                    params![id, term],
                )?;
            }
            Ok(())
        })
    }

    // -- events, pilot, meta -------------------------------------------------

    pub fn log(&self, id: &str, level: &str, message: &str) -> Result<LogEvent, String> {
        let at = now_secs();
        self.with(|conn| {
            conn.execute(
                "INSERT INTO events (project_id, at, level, message) VALUES (?1, ?2, ?3, ?4)",
                params![id, at, level, message],
            )?;
            Ok(())
        })?;
        Ok(LogEvent { at, level: level.to_string(), message: message.to_string() })
    }

    /// The last `limit` events, oldest first.
    pub fn events(&self, id: &str, limit: u32) -> Result<Vec<LogEvent>, String> {
        let mut events: Vec<LogEvent> = self.with(|conn| {
            let mut stmt =
                conn.prepare("SELECT at, level, message FROM events WHERE project_id = ?1 ORDER BY id DESC LIMIT ?2")?;
            let rows = stmt.query_map(params![id, limit], |row| {
                Ok(LogEvent { at: row.get(0)?, level: row.get(1)?, message: row.get(2)? })
            })?;
            rows.collect()
        })?;
        events.reverse();
        Ok(events)
    }

    pub fn pilot(&self, id: &str) -> Result<Option<PilotRun>, String> {
        let json: Option<String> = self.with(|conn| {
            conn.query_row("SELECT run_json FROM pilot_runs WHERE project_id = ?1", params![id], |row| row.get(0))
                .optional()
        })?;
        Ok(json.and_then(|json| serde_json::from_str(&json).ok()))
    }

    pub fn save_pilot(&self, id: &str, run: &PilotRun) -> Result<(), String> {
        let json = serde_json::to_string(run).map_err(|e| e.to_string())?;
        self.with(|conn| {
            conn.execute(
                "INSERT INTO pilot_runs (project_id, run_json) VALUES (?1, ?2)
                 ON CONFLICT (project_id) DO UPDATE SET run_json = excluded.run_json",
                params![id, json],
            )?;
            Ok(())
        })
    }

    /// One provider request (chunk, fallback block, glossary or pilot turn). Returns its credits.
    pub fn log_usage(&self, project_id: Option<&str>, model: &str, words: u64, usage: &TokenUsage) -> Result<f64, String> {
        let spent = credits(model, usage);
        self.with(|conn| {
            conn.execute(
                "INSERT INTO usage_log (at, project_id, model, words, input_tokens, cached_tokens, output_tokens, credits)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    now_f64(),
                    project_id,
                    model,
                    words as i64,
                    usage.input_tokens,
                    usage.cached_input_tokens,
                    usage.output_tokens,
                    spent
                ],
            )?;
            Ok(())
        })?;
        Ok(spent)
    }

    /// Words and credits in the last 5 h and 7 days.
    pub fn local_usage(&self) -> Result<LocalUsage, String> {
        let now = now_f64();
        let window = |since: f64| -> Result<(u64, f64), String> {
            self.with(|conn| {
                conn.query_row(
                    "SELECT COALESCE(SUM(words), 0), COALESCE(SUM(credits), 0) FROM usage_log WHERE at >= ?1",
                    params![since],
                    |row| Ok((row.get::<_, i64>(0)? as u64, row.get::<_, f64>(1)?)),
                )
            })
        };
        let (words_5h, credits_5h) = window(now - 5.0 * 3600.0)?;
        let (words_7d, credits_7d) = window(now - 7.0 * 86_400.0)?;
        Ok(LocalUsage { words_5h, credits_5h, words_7d, credits_7d })
    }

    pub fn meta_get(&self, key: &str) -> Result<Option<String>, String> {
        self.with(|conn| conn.query_row("SELECT value FROM meta WHERE key = ?1", params![key], |row| row.get(0)).optional())
    }

    pub fn meta_set(&self, key: &str, value: &str) -> Result<(), String> {
        self.with(|conn| {
            conn.execute(
                "INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
                params![key, value],
            )?;
            Ok(())
        })
    }
}
