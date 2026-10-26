// Windows printing: the cheque printer helper is a PowerShell script that compiles a small C# printer
// class inside PowerShell. Both files are part of this program and are written to a private temporary
// folder when first needed, so the portable program stays a single file.
use serde::Serialize;
use std::io::Read;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const SCRIPT: &[u8] = include_bytes!("../../shared/direct/cheque-direct.ps1");
const SOURCE: &[u8] = include_bytes!("../../shared/direct/ChequeDirectPrinter.cs");
const TEMPLATE_SCRIPT: &[u8] = include_bytes!("../../shared/direct/template-print.ps1");
const TEMPLATE_SOURCE: &[u8] = include_bytes!("../../shared/direct/TemplatePrinter.cs");

#[derive(Serialize)]
pub struct Out {
    code: i32,
    out: String,
    err: String,
}

fn fnv(bytes: &[u8]) -> u64 {
    let mut hash = 0xcbf29ce484222325u64;
    for b in bytes {
        hash ^= *b as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

fn helper_dir() -> Result<PathBuf, String> {
    let stamp = fnv(SCRIPT) ^ fnv(SOURCE).rotate_left(1) ^ fnv(TEMPLATE_SCRIPT).rotate_left(2) ^ fnv(TEMPLATE_SOURCE).rotate_left(3);
    let dir = std::env::temp_dir().join(format!("sjmr-cheque-writer-{stamp:016x}"));
    std::fs::create_dir_all(&dir).map_err(|e| format!("The cheque printing files cannot be prepared: {e}"))?;
    for (name, bytes) in [
        ("cheque-direct.ps1", SCRIPT),
        ("ChequeDirectPrinter.cs", SOURCE),
        ("template-print.ps1", TEMPLATE_SCRIPT),
        ("TemplatePrinter.cs", TEMPLATE_SOURCE),
    ] {
        let file = dir.join(name);
        let same = std::fs::read(&file).map(|old| old == bytes).unwrap_or(false);
        if !same {
            std::fs::write(&file, bytes).map_err(|e| format!("The cheque printing files cannot be prepared: {e}"))?;
        }
    }
    Ok(dir)
}

fn capped(mut source: impl Read + Send + 'static) -> std::thread::JoinHandle<Vec<u8>> {
    std::thread::spawn(move || {
        let mut kept = Vec::new();
        let mut buffer = [0u8; 8192];
        while let Ok(n) = source.read(&mut buffer) {
            if n == 0 {
                break;
            }
            if kept.len() < 1024 * 1024 {
                kept.extend_from_slice(&buffer[..n]);
            }
        }
        kept
    })
}

fn run(args: Vec<String>, job: Option<String>, visible: bool, timeout_ms: u64, script: Option<String>) -> Result<Out, String> {
    let name = match script.as_deref() {
        None | Some("cheque-direct.ps1") => "cheque-direct.ps1",
        Some("template-print.ps1") => "template-print.ps1",
        Some(_) => return Err("Unknown printing helper.".to_string()),
    };
    let dir = helper_dir()?;
    let script = dir.join(name);
    let job_file = match &job {
        Some(text) => {
            let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
            let file = std::env::temp_dir().join(format!("cheque_job_{}_{}.json", std::process::id(), nanos));
            std::fs::write(&file, text).map_err(|e| format!("Cannot start Windows printing: {e}"))?;
            Some(file)
        }
        None => None,
    };
    let result = (|| {
        let mut command = Command::new("powershell.exe");
        command.args(["-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass", "-File"]).arg(&script).args(&args);
        if let Some(file) = &job_file {
            command.arg("-Job").arg(file);
        }
        command.current_dir(&dir).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            // Never a console window: the print dialog is its own window, and an empty black console in front of it hides it.
            command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        let _ = visible;
        let mut child = command.spawn().map_err(|e| format!("Cannot start Windows printing: {e}"))?;
        let out = capped(child.stdout.take().ok_or("Cannot start Windows printing")?);
        let err = capped(child.stderr.take().ok_or("Cannot start Windows printing")?);
        let started = Instant::now();
        let status = loop {
            match child.try_wait().map_err(|e| format!("Cannot start Windows printing: {e}"))? {
                Some(status) => break status,
                None if started.elapsed() > Duration::from_millis(timeout_ms) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err("Print result is unknown. Check the printer before retrying.".to_string());
                }
                None => std::thread::sleep(Duration::from_millis(40)),
            }
        };
        let text = |h: std::thread::JoinHandle<Vec<u8>>| String::from_utf8_lossy(&h.join().unwrap_or_default()).trim().to_string();
        Ok(Out { code: status.code().unwrap_or(-1), out: text(out), err: text(err) })
    })();
    if let Some(file) = job_file {
        let _ = std::fs::remove_file(file);
    }
    result
}

#[tauri::command]
pub async fn run_helper(args: Vec<String>, job: Option<String>, visible: bool, timeout_ms: u64, script: Option<String>) -> Result<Out, String> {
    tauri::async_runtime::spawn_blocking(move || run(args, job, visible, timeout_ms, script)).await.map_err(|e| e.to_string())?
}
