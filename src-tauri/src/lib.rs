use base64::Engine;
use std::collections::HashSet;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use tauri::Emitter;
use tauri::Manager;
use encoding_rs::{Decoder, Encoding, GBK};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;

#[cfg(windows)]
static STREAMING_PIDS: Mutex<Vec<u32>> = Mutex::new(Vec::new());

static STREAMING_CHILD_COUNT: AtomicUsize = AtomicUsize::new(0);

struct PtySession {
    stdin: Option<Box<dyn Write + Send>>,
    master: Option<Box<dyn MasterPty + Send>>,
    killer: Option<Box<dyn portable_pty::ChildKiller + Send + Sync>>,
}

static PTY_SESSION: Mutex<Option<PtySession>> = Mutex::new(None);

#[cfg(windows)]
mod ide_job {
    use std::os::windows::io::AsRawHandle;
    use std::sync::OnceLock;
    use windows_sys::Win32::Foundation::HANDLE;
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    static JOB: OnceLock<usize> = OnceLock::new();

    fn job_handle() -> HANDLE {
        let ptr = *JOB.get_or_init(|| unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job.is_null() {
                panic!(
                    "CreateJobObjectW failed: {}",
                    std::io::Error::last_os_error()
                );
            }
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let _ = SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const _,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            job as usize
        });
        ptr as HANDLE
    }

    pub fn assign_child(child: &std::process::Child) -> Result<(), String> {
        assign_process_raw_handle(child.as_raw_handle())
    }

    pub fn assign_process_raw_handle(handle: std::os::windows::io::RawHandle) -> Result<(), String> {
        let job = job_handle();
        let r = unsafe { AssignProcessToJobObject(job, handle as HANDLE) };
        if r == 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        Ok(())
    }

    pub fn terminate_all() {
        let job = job_handle();
        unsafe {
            let _ = TerminateJobObject(job, 1);
        }
    }
}

fn register_streaming_child(pid: u32) {
    STREAMING_CHILD_COUNT.fetch_add(1, Ordering::SeqCst);
    #[cfg(windows)]
    if let Ok(mut g) = STREAMING_PIDS.lock() {
        g.push(pid);
    }
}

fn unregister_streaming_child(pid: u32) {
    STREAMING_CHILD_COUNT.fetch_sub(1, Ordering::SeqCst);
    #[cfg(windows)]
    if let Ok(mut g) = STREAMING_PIDS.lock() {
        g.retain(|&x| x != pid);
    }
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct CompileResult {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Option<Vec<FileEntry>>,
}

fn encoding_for_windows_code_page(cp: u32) -> &'static Encoding {
    match cp {
        65001 => encoding_rs::UTF_8,
        936 | 54936 => GBK,
        950 => encoding_rs::BIG5,
        932 => encoding_rs::SHIFT_JIS,
        949 => encoding_rs::EUC_KR,
        1252 => encoding_rs::WINDOWS_1252,
        1251 => encoding_rs::WINDOWS_1251,
        _ => GBK,
    }
}

#[cfg(windows)]
fn windows_subprocess_pipe_encoding() -> &'static Encoding {
    use windows_sys::Win32::Globalization::GetACP;
    use windows_sys::Win32::System::Console::GetConsoleOutputCP;
    unsafe {
        let mut cp = GetConsoleOutputCP();
        if cp == 0 {
            cp = GetACP();
        }
        encoding_for_windows_code_page(cp)
    }
}

#[cfg(windows)]
fn windows_runtime_code_page() -> u32 {
    use windows_sys::Win32::Globalization::{GetACP, GetOEMCP};
    unsafe {
        let mut cp = GetOEMCP();
        if cp == 0 {
            cp = GetACP();
        }
        if cp == 0 {
            cp = 936;
        }
        cp
    }
}

fn decode_full_buffer(bytes: &[u8], enc: &'static Encoding) -> String {
    let (cow, _, _) = enc.decode(bytes);
    cow.into_owned()
}

fn incremental_decode_chunk(decoder: &mut Decoder, src: &[u8], last: bool) -> String {
    let mut out = String::new();
    let _ = decoder.decode_to_string(src, &mut out, last);
    out
}

fn find_gnu_candidates(app: &tauri::AppHandle) -> Vec<String> {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(PathBuf::from))
        .unwrap_or_else(|| PathBuf::from("."));
    let resource_dir = app.path().resource_dir().unwrap_or_else(|_| exe_dir.clone());

    let mut out = Vec::<String>::new();
    let mut seen = HashSet::<String>::new();
    let bases = [exe_dir, resource_dir];

    for base in bases {
        let paths = [
            base.join("mingw").join("bin").join("g++.exe"),
            base.join("mingw").join("bin").join("gcc.exe"),
            base.join("g++.exe"),
            base.join("gcc.exe"),
        ];
        for p in paths {
            if p.exists() {
                let s = p.to_string_lossy().to_string();
                if seen.insert(s.clone()) {
                    out.push(s);
                }
            }
        }
    }

    for s in ["g++.exe", "g++", "gcc.exe", "gcc"] {
        let ss = s.to_string();
        if seen.insert(ss.clone()) {
            out.push(ss);
        }
    }

    out
}

#[tauri::command]
async fn compile_file(
    app: tauri::AppHandle,
    file_path: String,
    output_path: Option<String>,
) -> Result<CompileResult, String> {
    let out = output_path.unwrap_or_else(|| {
        let p = Path::new(&file_path);
        p.with_extension("exe").to_string_lossy().to_string()
    });

    #[cfg(windows)]
    let (compile_source_path, cleanup_source_path) =
        prepare_windows_console_encoded_source(&file_path)?;
    #[cfg(not(windows))]
    let compile_source_path = PathBuf::from(&file_path);
    #[cfg(not(windows))]
    let cleanup_source_path: Option<PathBuf> = None;

    let ext = Path::new(&file_path)
        .extension()
        .and_then(|x| x.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let force_cpp_mode = ext == "c";

    let mut compile_output: Option<std::process::Output> = None;
    let mut spawn_errors: Vec<String> = Vec::new();
    let candidates = find_gnu_candidates(&app);
    for cc in candidates {
        let mut cmd = Command::new(&cc);
        cmd.stdin(Stdio::null());
        if force_cpp_mode {
            cmd.arg("-x").arg("c++");
        }
        cmd.arg("-o").arg(&out).arg(&compile_source_path);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        match cmd.output() {
            Ok(o) => {
                compile_output = Some(o);
                break;
            }
            Err(e) => {
                spawn_errors.push(format!("{}: {}", cc, e));
            }
        }
    }
    let result = compile_output.ok_or_else(|| {
        format!(
            "未找到可用的 GCC/g++ 编译器。请安装 MinGW-w64，或将 mingw/bin 放到应用目录下。尝试记录: {}",
            spawn_errors.join(" | ")
        )
    })?;

    if let Some(tmp) = cleanup_source_path {
        let _ = std::fs::remove_file(tmp);
    }

    #[cfg(windows)]
    let log_enc = windows_subprocess_pipe_encoding();
    #[cfg(not(windows))]
    let log_enc = detect_source_encoding(Some(file_path.as_str()));

    let stdout = decode_full_buffer(&result.stdout, log_enc);

    Ok(CompileResult {
        success: result.status.success(),
        stdout,
        stderr: decode_full_buffer(&result.stderr, log_enc),
        exit_code: result.status.code().unwrap_or(-1),
    })
}

#[derive(Clone, Serialize)]
struct TerminalChunkPayload {
    data: String,
    stream: &'static str, // "stdout" | "stderr" | "meta"
    #[serde(skip_serializing_if = "Option::is_none")]
    b64: Option<String>,
}

fn detect_source_encoding(path: Option<&str>) -> &'static Encoding {
    let Some(p) = path else { return GBK; };
    let Ok(bytes) = std::fs::read(p) else { return GBK; };
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return encoding_rs::UTF_8;
    }
    if bytes.starts_with(&[0xFF, 0xFE]) {
        return encoding_rs::UTF_16LE;
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        return encoding_rs::UTF_16BE;
    }
    if std::str::from_utf8(&bytes).is_ok() {
        return encoding_rs::UTF_8;
    }

    let mut detector = chardetng::EncodingDetector::new(chardetng::Iso2022JpDetection::Deny);
    detector.feed(&bytes, true);
    let enc = detector.guess(None, chardetng::Utf8Detection::Allow);
    Encoding::for_label(enc.name().as_bytes()).unwrap_or(GBK)
}

#[cfg(windows)]
fn prepare_windows_console_encoded_source(
    file_path: &str,
) -> Result<(PathBuf, Option<PathBuf>), String> {
    let src_path = PathBuf::from(file_path);
    let src_bytes = std::fs::read(&src_path).map_err(|e| format!("无法读取源文件: {}", e))?;
    let src_enc = detect_source_encoding(Some(file_path));
    let target_cp = windows_runtime_code_page();
    let target_enc = encoding_for_windows_code_page(target_cp);

    // If the file already matches target console code page, compile it directly.
    if src_enc.name() == target_enc.name() {
        return Ok((src_path, None));
    }

    let (text, _, _) = src_enc.decode(&src_bytes);
    let (encoded, _, _) = target_enc.encode(&text);

    let mut tmp = std::env::temp_dir();
    let ext = src_path
        .extension()
        .and_then(|x| x.to_str())
        .unwrap_or("c");
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    tmp.push(format!(
        "minic-compile-{}-{}-cp{}.{}",
        std::process::id(),
        ts,
        target_cp,
        ext
    ));

    std::fs::write(&tmp, encoded.as_ref()).map_err(|e| format!("无法写入临时转码文件: {}", e))?;

    Ok((tmp.clone(), Some(tmp)))
}

fn spawn_streaming_process(
    mut command: Command,
    app: tauri::AppHandle,
    _window_label: String,
) -> Result<(), String> {
    use std::io::Read;

    command.stdin(Stdio::null());
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());

    let mut child = command.spawn().map_err(|e| e.to_string())?;
    let pid = child.id();
    register_streaming_child(pid);
    #[cfg(windows)]
    {
        let _ = ide_job::assign_child(&child);
    }

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    #[cfg(windows)]
    let pipe_enc = windows_subprocess_pipe_encoding();
    #[cfg(not(windows))]
    let pipe_enc = encoding_rs::UTF_8;

    if let Some(mut stdout) = stdout {
        let app_out = app.clone();
        let enc = pipe_enc;
        std::thread::spawn(move || {
            let mut dec = enc.new_decoder();
            let mut buf = [0u8; 8192];
            loop {
                match stdout.read(&mut buf) {
                    Ok(0) => {
                        let data = incremental_decode_chunk(&mut dec, &[], true);
                        if !data.is_empty() {
                            let _ = app_out.emit(
                                "terminal-output-chunk",
                                TerminalChunkPayload {
                                    data,
                                    stream: "stdout",
                                    b64: None,
                                },
                            );
                        }
                        break;
                    }
                    Ok(n) => {
                        let data = incremental_decode_chunk(&mut dec, &buf[..n], false);
                        if !data.is_empty() {
                            let _ = app_out.emit(
                                "terminal-output-chunk",
                                TerminalChunkPayload {
                                    data,
                                    stream: "stdout",
                                    b64: None,
                                },
                            );
                        }
                    }
                    Err(_) => break,
                }
            }
        });
    }

    if let Some(mut stderr) = stderr {
        let app_err = app.clone();
        let enc = pipe_enc;
        std::thread::spawn(move || {
            let mut dec = enc.new_decoder();
            let mut buf = [0u8; 8192];
            loop {
                match stderr.read(&mut buf) {
                    Ok(0) => {
                        let data = incremental_decode_chunk(&mut dec, &[], true);
                        if !data.is_empty() {
                            let _ = app_err.emit(
                                "terminal-output-chunk",
                                TerminalChunkPayload {
                                    data,
                                    stream: "stderr",
                                    b64: None,
                                },
                            );
                        }
                        break;
                    }
                    Ok(n) => {
                        let data = incremental_decode_chunk(&mut dec, &buf[..n], false);
                        if !data.is_empty() {
                            let _ = app_err.emit(
                                "terminal-output-chunk",
                                TerminalChunkPayload {
                                    data,
                                    stream: "stderr",
                                    b64: None,
                                },
                            );
                        }
                    }
                    Err(_) => break,
                }
            }
        });
    }

    let app_meta = app;
    std::thread::spawn(move || {
        let code = child.wait().ok().and_then(|s| s.code()).unwrap_or(-1);
        unregister_streaming_child(pid);
        let _ = app_meta.emit(
            "terminal-output-chunk",
            TerminalChunkPayload {
                data: format!("__MINIC_EXIT_CODE__{}", code),
                stream: "meta",
                b64: None,
            },
        );
    });

    Ok(())
}

fn clear_pty_session() {
    if let Ok(mut g) = PTY_SESSION.lock() {
        *g = None;
    }
}

fn spawn_pty_executable(
    exe_path: String,
    cwd: String,
    _source_path: Option<String>,
    rows: u16,
    cols: u16,
    app: tauri::AppHandle,
    _window_label: String,
) -> Result<(), String> {
    use std::io::Read;
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("{}", e))?;

    let resolved_exe_path = {
        let p = Path::new(&exe_path);
        if p.is_absolute() {
            PathBuf::from(p)
        } else if !cwd.is_empty() {
            Path::new(&cwd).join(p)
        } else {
            PathBuf::from(p)
        }
    };

    let resolved_exe_path_str = resolved_exe_path.to_string_lossy().to_string();

    #[cfg(windows)]
    let (mut cmd, wrapper_script_path): (CommandBuilder, Option<PathBuf>) = {
        let mut script_path = std::env::temp_dir();
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        script_path.push(format!("minic-run-{}-{}.cmd", std::process::id(), ts));

        let escaped_exe = resolved_exe_path_str.replace('\"', "\"\"");
        let cp = windows_runtime_code_page();
        let script = format!("@echo off\r\nchcp {} > nul\r\n\"{}\"\r\n", cp, escaped_exe);
        std::fs::write(&script_path, script)
            .map_err(|e| format!("无法创建运行脚本: {}", e))?;

        let mut c = CommandBuilder::new("cmd.exe");
        c.arg("/d");
        c.arg("/c");
        c.arg(script_path.to_string_lossy().to_string());
        (c, Some(script_path))
    };

    #[cfg(not(windows))]
    let mut cmd = CommandBuilder::new(&resolved_exe_path_str);
    #[cfg(not(windows))]
    let wrapper_script_path: Option<PathBuf> = None;

    if !cwd.is_empty() && Path::new(&cwd).exists() {
        cmd.cwd(&cwd);
    }
    let mut child = match pair.slave.spawn_command(cmd) {
        Ok(c) => c,
        Err(e) => {
            #[cfg(windows)]
            if let Some(p) = &wrapper_script_path {
                let _ = std::fs::remove_file(p);
            }
            return Err(format!("{}", e));
        }
    };
    drop(pair.slave);

    let killer = child.clone_killer();

    let pid = child.process_id().unwrap_or(0);
    if pid == 0 {
        return Err("子进程无 PID".into());
    }
    register_streaming_child(pid);
    #[cfg(windows)]
    {
        if let Some(h) = child.as_raw_handle() {
            let _ = ide_job::assign_process_raw_handle(h);
        }
    }

    if let Ok(Some(status)) = child.try_wait() {
        #[cfg(windows)]
        if let Some(p) = &wrapper_script_path {
            let _ = std::fs::remove_file(p);
        }
        unregister_streaming_child(pid);
        let code = status.exit_code() as i32;
        let _ = app.emit(
            "terminal-output-chunk",
            TerminalChunkPayload {
                data: format!("__MINIC_EXIT_CODE__{}", code),
                stream: "meta",
                b64: None,
            },
        );
        return Ok(());
    }

    #[cfg(windows)]
    let pty_cp: u32 = windows_runtime_code_page();
    #[cfg(not(windows))]
    let pty_cp: u32 = 65001;
    let _ = app.emit(
        "terminal-output-chunk",
        TerminalChunkPayload {
            data: format!("__MINIC_CODEPAGE__{}", pty_cp),
            stream: "meta",
            b64: None,
        },
    );

    let master = pair.master;
    let reader = master
        .try_clone_reader()
        .map_err(|e| format!("{}", e))?;
    let writer = master
        .take_writer()
        .map_err(|e| format!("{}", e))?;

    {
        let mut guard = PTY_SESSION.lock().map_err(|e| e.to_string())?;
        *guard = Some(PtySession {
            stdin: Some(writer),
            master: Some(master),
            killer: Some(killer),
        });
    }

    let app_out = app.clone();
    std::thread::spawn(move || {
        let mut r = reader;
        let mut buf = [0u8; 8192];
        loop {
            match r.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let b64 = base64::engine::general_purpose::STANDARD.encode(&buf[..n]);
                    let _ = app_out.emit(
                        "terminal-output-chunk",
                        TerminalChunkPayload {
                            data: String::new(),
                            stream: "stdout",
                            b64: Some(b64),
                        },
                    );
                }
                Err(_) => break,
            }
        }
    });

    let app_meta = app;
    #[cfg(windows)]
    let wrapper_script_path_for_waiter = wrapper_script_path;
    std::thread::spawn(move || {
        let code = child
            .wait()
            .ok()
            .map(|s| s.exit_code() as i32)
            .unwrap_or(-1);

        #[cfg(windows)]
        if let Some(p) = wrapper_script_path_for_waiter {
            let _ = std::fs::remove_file(p);
        }

        clear_pty_session();
        unregister_streaming_child(pid);
        let _ = app_meta.emit(
            "terminal-output-chunk",
            TerminalChunkPayload {
                data: format!("__MINIC_EXIT_CODE__{}", code),
                stream: "meta",
                b64: None,
            },
        );
    });

    Ok(())
}

#[tauri::command]
async fn run_executable(
    window: tauri::Window,
    exe_path: String,
    cwd: String,
    source_path: Option<String>,
    rows: Option<u16>,
    cols: Option<u16>,
) -> Result<(), String> {
    let rows = rows.filter(|&r| r > 0).unwrap_or(24);
    let cols = cols.filter(|&c| c > 0).unwrap_or(80);
    let app = window.app_handle().clone();
    let label = window.label().to_string();
    tauri::async_runtime::spawn_blocking(move || {
        spawn_pty_executable(exe_path, cwd, source_path, rows, cols, app, label)
    })
    .await
    .map_err(|e| format!("{}", e))??;
    Ok(())
}

#[tauri::command]
fn pty_write(data: String) -> Result<(), String> {
    let mut guard = PTY_SESSION.lock().map_err(|e| e.to_string())?;
    let session = guard
        .as_mut()
        .ok_or_else(|| "无活动伪终端会话".to_string())?;
    let w = session
        .stdin
        .as_mut()
        .ok_or_else(|| "stdin 已关闭".to_string())?;
    w.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    w.flush().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn pty_kill() -> Result<(), String> {
    let mut guard = PTY_SESSION.lock().map_err(|e| e.to_string())?;
    let session = guard
        .as_mut()
        .ok_or_else(|| "无活动伪终端会话".to_string())?;
    let k = session
        .killer
        .as_mut()
        .ok_or_else(|| "killer 不可用".to_string())?;
    k.kill().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn pty_resize(rows: u16, cols: u16) -> Result<(), String> {
    if rows == 0 || cols == 0 {
        return Ok(());
    }
    let guard = PTY_SESSION.lock().map_err(|e| e.to_string())?;
    let session = guard
        .as_ref()
        .ok_or_else(|| "无活动伪终端会话".to_string())?;
    let m = session
        .master
        .as_ref()
        .ok_or_else(|| "master 不可用".to_string())?;
    m.resize(PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    })
    .map_err(|e| format!("{}", e))?;
    Ok(())
}

#[tauri::command]
async fn run_terminal_command(window: tauri::Window, cmd: String, cwd: String) -> Result<(), String> {
    let mut command = if cfg!(windows) {
        Command::new("cmd")
    } else {
        Command::new("/bin/sh")
    };
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
        command.args(["/d", "/c", &cmd]);
    }
    #[cfg(not(windows))]
    {
        command.arg("-c").arg(&cmd);
    }
    if !cwd.is_empty() && Path::new(&cwd).exists() {
        command.current_dir(&cwd);
    }

    let app = window.app_handle().clone();
    let label = window.label().to_string();
    spawn_streaming_process(command, app, label)
}

#[tauri::command]
async fn read_file_content(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("无法读取文件 {}: {}", path, e))?;
    if bytes.contains(&0u8) {
        return Err(format!("[二进制文件] 此文件为二进制格式，无法以文本方式显示: {}", path));
    }
    if let Ok(s) = std::str::from_utf8(&bytes) {
        return Ok(s.to_string());
    }
    let (cow, _enc, had_errors) = GBK.decode(&bytes);
    if !had_errors {
        return Ok(cow.into_owned());
    }
    let (cow2, _enc2, _) = encoding_rs::UTF_16LE.decode(&bytes);
    Ok(cow2.into_owned())
}

#[tauri::command]
async fn write_file_content(path: String, content: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, content).map_err(|e| format!("Cannot write {}: {}", path, e))
}

#[tauri::command]
async fn read_dir_recursive(dir_path: String) -> Result<Vec<FileEntry>, String> {
    read_dir_inner(&dir_path).map_err(|e| e.to_string())
}

fn read_dir_inner(dir_path: &str) -> std::io::Result<Vec<FileEntry>> {
    let mut entries = Vec::new();
    for entry in std::fs::read_dir(dir_path)? {
        let entry = entry?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let path_str = path.to_string_lossy().to_string();
        if path.is_dir() {
            let children = read_dir_inner(&path_str).ok();
            entries.push(FileEntry { name, path: path_str, is_dir: true, children });
        } else {
            entries.push(FileEntry { name, path: path_str, is_dir: false, children: None });
        }
    }
    entries.sort_by(|a, b| {
        if a.is_dir == b.is_dir { a.name.cmp(&b.name) }
        else if a.is_dir { std::cmp::Ordering::Less }
        else { std::cmp::Ordering::Greater }
    });
    Ok(entries)
}

#[tauri::command]
async fn create_file(path: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, "").map_err(|e| e.to_string())
}

#[tauri::command]
async fn create_directory(path: String) -> Result<(), String> {
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_path(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.is_dir() {
        std::fs::remove_dir_all(&path).map_err(|e| e.to_string())
    } else {
        std::fs::remove_file(&path).map_err(|e| e.to_string())
    }
}

#[tauri::command]
async fn rename_path(old_path: String, new_path: String) -> Result<(), String> {
    std::fs::rename(&old_path, &new_path).map_err(|e| e.to_string())
}

#[tauri::command]
async fn reveal_in_file_manager(path: String) -> Result<(), String> {
    let input = PathBuf::from(&path);
    let target = if input.is_dir() {
        input
    } else {
        input
            .parent()
            .map(PathBuf::from)
            .ok_or_else(|| "无效路径".to_string())?
    };

    if !target.exists() {
        return Err(format!("路径不存在: {}", target.to_string_lossy()));
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        Command::new("explorer.exe")
            .arg(target.as_os_str())
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(target.as_os_str())
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(target.as_os_str())
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Ok(())
}

#[tauri::command]
async fn open_folder_dialog(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let folder = app.dialog().file().blocking_pick_folder();
    Ok(folder.map(|f| f.to_string()))
}

#[tauri::command]
async fn open_file_dialog(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let file = app.dialog()
        .file()
        .add_filter("C/C++ Files", &["c", "h", "cpp", "cc", "cxx", "hpp", "hh", "hxx"])
        .add_filter("All Files", &["*"])
        .blocking_pick_file();
    Ok(file.map(|f| f.to_string()))
}

#[tauri::command]
async fn save_file_dialog(app: tauri::AppHandle, default_name: Option<String>) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let mut builder = app.dialog().file().add_filter("C/C++ Files", &["c", "h", "cpp", "cc", "cxx", "hpp", "hh", "hxx"]);
    if let Some(name) = default_name {
        builder = builder.set_file_name(&name);
    }
    let file = builder.blocking_save_file();
    Ok(file.map(|f| f.to_string()))
}

#[tauri::command]
fn running_child_count() -> usize {
    STREAMING_CHILD_COUNT.load(Ordering::SeqCst)
}

#[tauri::command]
fn kill_child_processes() -> Result<(), String> {
    clear_pty_session();
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        ide_job::terminate_all();
        let pids: Vec<u32> = STREAMING_PIDS
            .lock()
            .map_err(|e| e.to_string())?
            .clone();
        for pid in pids {
            let _ = Command::new("taskkill")
                .args(["/PID", &pid.to_string(), "/T", "/F"])
                .creation_flags(CREATE_NO_WINDOW)
                .status();
        }
        if let Ok(mut g) = STREAMING_PIDS.lock() {
            g.clear();
        }
    }
    Ok(())
}

#[tauri::command]
fn request_app_exit(app: tauri::AppHandle) -> Result<(), String> {
    clear_pty_session();
    #[cfg(windows)]
    {
        ide_job::terminate_all();
    }
    std::thread::spawn(move || {
        app.exit(0);
    });
    Ok(())
}

#[tauri::command]
async fn get_file_info(path: String) -> Result<serde_json::Value, String> {
    let metadata = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({
        "size": metadata.len(),
        "is_dir": metadata.is_dir(),
        "is_file": metadata.is_file(),
    }))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            compile_file,
            run_executable,
            read_file_content,
            write_file_content,
            read_dir_recursive,
            create_file,
            create_directory,
            delete_path,
            rename_path,
            reveal_in_file_manager,
            open_folder_dialog,
            open_file_dialog,
            save_file_dialog,
            get_file_info,
            run_terminal_command,
            running_child_count,
            kill_child_processes,
            request_app_exit,
            pty_write,
            pty_kill,
            pty_resize,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
