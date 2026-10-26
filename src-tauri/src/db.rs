// SQLite for the window: one connection per opened file, used through ids. The cheque logic itself
// is JavaScript (core/); this module only runs the statements it sends.
use rusqlite::{types::Value as Sql, types::ValueRef, Connection, OpenFlags};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use tauri::State;

#[derive(Default)]
pub struct Dbs {
    map: Mutex<HashMap<u32, Connection>>,
    next: AtomicU32,
}

impl Dbs {
    pub fn close_all(&self) {
        if let Ok(mut map) = self.map.lock() {
            map.clear();
        }
    }
}

fn text(error: impl std::fmt::Display) -> String {
    error.to_string()
}

fn to_sql(value: &Value) -> Result<Sql, String> {
    Ok(match value {
        Value::Null => Sql::Null,
        Value::Bool(b) => Sql::Integer(*b as i64),
        Value::Number(n) => match n.as_i64() {
            Some(i) => Sql::Integer(i),
            None => Sql::Real(n.as_f64().ok_or("Unsupported number")?),
        },
        Value::String(s) => Sql::Text(s.clone()),
        _ => return Err("Unsupported value for the database".into()),
    })
}

#[tauri::command]
pub async fn db_open(dbs: State<'_, Dbs>, path: String, read_only: bool) -> Result<u32, String> {
    let connection = if path == ":memory:" {
        Connection::open_in_memory().map_err(text)?
    } else if read_only {
        Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI).map_err(text)?
    } else {
        if let Some(parent) = std::path::Path::new(&path).parent() {
            std::fs::create_dir_all(parent).map_err(text)?;
        }
        Connection::open(&path).map_err(text)?
    };
    connection.busy_timeout(std::time::Duration::from_secs(5)).map_err(text)?;
    let id = dbs.next.fetch_add(1, Ordering::SeqCst) + 1;
    dbs.map.lock().map_err(text)?.insert(id, connection);
    Ok(id)
}

#[tauri::command]
pub async fn db_close(dbs: State<'_, Dbs>, id: u32) -> Result<(), String> {
    dbs.map.lock().map_err(text)?.remove(&id);
    Ok(())
}

fn bind_params(values: &[Value]) -> Result<Vec<Sql>, String> {
    values.iter().map(to_sql).collect()
}

/// Runs one statement. A statement that returns rows (for example `pragma journal_mode`) is run to the end.
fn exec_on(connection: &Connection, sql: &str, list: &[Value]) -> Result<Value, String> {
    let bound = bind_params(list)?;
    let mut statement = connection.prepare(sql).map_err(text)?;
    if statement.column_count() > 0 {
        let mut rows = statement.query(rusqlite::params_from_iter(bound.iter())).map_err(text)?;
        while rows.next().map_err(text)?.is_some() {}
    } else {
        statement.execute(rusqlite::params_from_iter(bound.iter())).map_err(text)?;
    }
    Ok(json!({ "changes": connection.changes() }))
}

fn all_on(connection: &Connection, sql: &str, list: &[Value]) -> Result<Vec<Value>, String> {
    let bound = bind_params(list)?;
    let mut statement = connection.prepare(sql).map_err(text)?;
    let names: Vec<String> = statement.column_names().iter().map(|n| n.to_string()).collect();
    let mut rows = statement.query(rusqlite::params_from_iter(bound.iter())).map_err(text)?;
    let mut out = Vec::new();
    while let Some(row) = rows.next().map_err(text)? {
        let mut object = Map::new();
        for (index, name) in names.iter().enumerate() {
            let value = match row.get_ref(index).map_err(text)? {
                ValueRef::Null => Value::Null,
                ValueRef::Integer(i) => json!(i),
                ValueRef::Real(f) => json!(f),
                ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
                ValueRef::Blob(_) => Value::Null,
            };
            object.insert(name.clone(), value);
        }
        out.push(Value::Object(object));
    }
    Ok(out)
}

#[tauri::command]
pub async fn db_exec(dbs: State<'_, Dbs>, id: u32, sql: String, params: Option<Vec<Value>>) -> Result<Value, String> {
    let map = dbs.map.lock().map_err(text)?;
    exec_on(map.get(&id).ok_or("The data file is not open.")?, &sql, &params.unwrap_or_default())
}

#[tauri::command]
pub async fn db_all(dbs: State<'_, Dbs>, id: u32, sql: String, params: Option<Vec<Value>>) -> Result<Vec<Value>, String> {
    let map = dbs.map.lock().map_err(text)?;
    all_on(map.get(&id).ok_or("The data file is not open.")?, &sql, &params.unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runs_what_the_cheque_store_sends() {
        let dir = std::env::temp_dir().join(format!("cw-db-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("a.db");
        let c = Connection::open(&file).unwrap();
        // Statements that return rows still run.
        exec_on(&c, "pragma journal_mode = wal", &[]).unwrap();
        exec_on(&c, "pragma foreign_keys = on", &[]).unwrap();
        exec_on(&c, "create table if not exists t(id text primary key, n integer not null default 0, x real, note text)", &[]).unwrap();
        exec_on(&c, "begin immediate", &[]).unwrap();
        let r = exec_on(&c, "insert into t(id,n,x,note) values(?,?,?,?)", &[json!("a"), json!(7), json!(1.5), Value::Null]).unwrap();
        assert_eq!(r["changes"], 1);
        exec_on(&c, "insert into t(id,n) values(?,?)", &[json!("b"), json!(true)]).unwrap();
        exec_on(&c, "commit", &[]).unwrap();
        let rows = all_on(&c, "select * from t where n >= ? order by id", &[json!(1)]).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0]["id"], "a");
        assert_eq!(rows[0]["n"], 7);
        assert_eq!(rows[0]["x"], 1.5);
        assert!(rows[0]["note"].is_null());
        assert_eq!(rows[1]["n"], 1);
        // Rollback leaves nothing behind.
        exec_on(&c, "begin immediate", &[]).unwrap();
        exec_on(&c, "delete from t", &[]).unwrap();
        exec_on(&c, "rollback", &[]).unwrap();
        assert_eq!(all_on(&c, "select count(*) n from t", &[]).unwrap()[0]["n"], 2);
        // A copy of the file with a bound target, and a second connection can read it read-only.
        let copy = dir.join("copy.db");
        exec_on(&c, "vacuum into ?", &[json!(copy.to_string_lossy())]).unwrap();
        let ro = Connection::open_with_flags(&copy, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
        assert_eq!(all_on(&ro, "select name from sqlite_master where type='table'", &[]).unwrap()[0]["name"], "t");
        assert!(exec_on(&ro, "insert into t(id) values('z')", &[]).is_err());
        assert!(exec_on(&c, "insert into t(id,n) values(?,?)", &[json!("a"), json!(1)]).is_err(), "unique key refused");
        assert!(bind_params(&[json!([1])]).is_err());
        drop((c, ro));
        let _ = std::fs::remove_dir_all(dir);
    }
}
