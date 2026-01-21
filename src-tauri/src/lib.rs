use std::fs;
use std::path::Path;
use regex::Regex;
use serde::{Deserialize, Serialize};
use tauri::{Manager, Emitter};

#[derive(Debug, Serialize, Deserialize)]
pub struct FileInfo {
    name: String,
    size: u64,
    lines: usize,
    sessions: usize,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LogSession {
    id: usize,
    start_line: usize,
    end_line: usize,
    boot_marker: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LogLine {
    line_number: usize,
    content: String,
    level: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ParsedLog {
    sessions: Vec<LogSession>,
    lines: Vec<LogLine>,
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
async fn parse_log_file(path: String, boot_regex: String) -> Result<FileInfo, String> {
    let file_path = Path::new(&path);
    
    // 获取文件名
    let file_name = file_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();
    
    // 读取文件内容（支持非UTF-8编码）
    let bytes = fs::read(file_path)
        .map_err(|e| format!("Failed to read file: {}", e))?;
    let content = String::from_utf8_lossy(&bytes).to_string();
    
    // 获取文件大小
    let metadata = fs::metadata(file_path)
        .map_err(|e| format!("Failed to get file metadata: {}", e))?;
    let size = metadata.len();
    
    // 统计行数
    let lines: Vec<&str> = content.lines().collect();
    let line_count = lines.len();
    
    // 检测 Boot 会话 (使用用户定义的正则，如果没提供则使用默认)
    let boot_count = if !boot_regex.is_empty() {
        if let Ok(re) = Regex::new(&boot_regex) {
            lines.iter().filter(|line| re.is_match(line)).count()
        } else {
            0
        }
    } else {
        // 默认匹配
        let boot_re = Regex::new(r"(?i)(system|boot|start)(ed|ing|up)").unwrap();
        lines.iter().filter(|line| boot_re.is_match(line)).count()
    };
    
    // 会话数等于 Boot 标记数 + 1 (初始会话)
    // 但如果文件开头就是 Boot 标记，idx > 0 的判断会跳过第一个 marker 导致的会话切分 (逻辑见 parse_log_content)
    // 为了简单且一致：
    let session_count = boot_count + 1;
    
    Ok(FileInfo {
        name: file_name,
        size,
        lines: line_count,
        sessions: session_count,
    })
}

#[tauri::command]
async fn parse_log_content(
    path: String, 
    boot_regex: String,
    level_regex: String
) -> Result<ParsedLog, String> {
    parse_log_with_splitters(path, vec![boot_regex], level_regex).await
}

#[tauri::command]
async fn parse_log_with_custom_splitters(
    path: String,
    splitter_regexes: Vec<String>,
    level_regex: String
) -> Result<ParsedLog, String> {
    parse_log_with_splitters(path, splitter_regexes, level_regex).await
}

async fn parse_log_with_splitters(
    path: String, 
    splitter_regexes: Vec<String>,
    level_regex: String
) -> Result<ParsedLog, String> {
    // 读取文件内容（支持非UTF-8编码）
    let bytes = fs::read(&path)
        .map_err(|e| format!("Failed to read file: {}", e))?;
    let content = String::from_utf8_lossy(&bytes).to_string();
    
    let lines: Vec<&str> = content.lines().collect();
    let mut sessions: Vec<LogSession> = Vec::new();
    let mut log_lines: Vec<LogLine> = Vec::new();
    
    // 编译所有分割器正则
    let mut compiled_splitters = Vec::new();
    for regex_str in &splitter_regexes {
        if !regex_str.is_empty() {
            if let Ok(re) = Regex::new(regex_str) {
                compiled_splitters.push(re);
            }
        }
    }
    
    // 如果没有有效的分割器，使用默认
    if compiled_splitters.is_empty() {
        let default_re = Regex::new(r"(?i)(system|boot|start)(ed|ing|up)").unwrap();
        compiled_splitters.push(default_re);
    }
    
    // 检测日志级别的正则
    let level_re = if !level_regex.is_empty() {
        Regex::new(&level_regex).ok()
    } else {
        Regex::new(r"(?i)\b(DEBUG|INFO|WARN|ERROR|FATAL)\b").ok()
    };
    
    let mut current_session_start = 1;
    let mut session_id = 0;
    
    for (idx, line) in lines.iter().enumerate() {
        let line_num = idx + 1;
        
        // 检测日志级别
        let level = level_re.as_ref()
            .and_then(|re| re.captures(line))
            .and_then(|cap| {
                // 如果有捕获组，取第一个捕获组，否则取整个匹配
                if cap.len() > 1 {
                    cap.get(1).map(|m| m.as_str().to_uppercase())
                } else {
                    cap.get(0).map(|m| m.as_str().to_uppercase())
                }
            });
        
        // 检查是否匹配任何一个分割器
        let mut is_session_start = false;
        let mut matched_marker = String::new();
        
        for splitter in &compiled_splitters {
            if splitter.is_match(line) {
                is_session_start = true;
                matched_marker = splitter.find(line)
                    .map(|m| m.as_str().to_string())
                    .unwrap_or_else(|| line.to_string());
                break;
            }
        }
        
        if is_session_start && idx > 0 {
            // 结束上一个会话
            sessions.push(LogSession {
                id: session_id,
                start_line: current_session_start,
                end_line: line_num - 1,
                boot_marker: matched_marker.clone(),
            });
            
            session_id += 1;
            current_session_start = line_num;
        }
        
        log_lines.push(LogLine {
            line_number: line_num,
            content: line.to_string(),
            level,
        });
    }
    
    // 添加最后一个会话
    if current_session_start < lines.len() {
        sessions.push(LogSession {
            id: session_id,
            start_line: current_session_start,
            end_line: lines.len(),
            boot_marker: if current_session_start < lines.len() {
                lines[current_session_start].to_string()
            } else {
                String::new()
            },
        });
    }
    
    // 如果没有检测到会话，创建一个默认会话
    if sessions.is_empty() {
        sessions.push(LogSession {
            id: 0,
            start_line: 1,
            end_line: lines.len(),
            boot_marker: String::from("Full Log"),
        });
    }
    
    Ok(ParsedLog {
        sessions,
        lines: log_lines,
    })
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PatternStat {
    content: String,
    count: usize,
    level: Option<String>,
}

#[tauri::command]
async fn analyze_log_patterns(path: String) -> Result<Vec<PatternStat>, String> {
    let bytes = fs::read(&path)
        .map_err(|e| format!("Failed to read file: {}", e))?;
    let content = String::from_utf8_lossy(&bytes).to_string();
    
    use std::collections::HashMap;
    let mut patterns: HashMap<String, (usize, Option<String>)> = HashMap::new();
    
    let level_re = Regex::new(r"(?i)\b(DEBUG|INFO|WARN|ERROR|FATAL)\b").unwrap();

    for line in content.lines() {
        if line.trim().is_empty() { continue; }
        
        // 简单的“指纹”提取：将数字、类十六进制地址替换为占位符
        let mut fingerprint = line.to_string();
        // 屏蔽时间戳样式 (00:00:00)
        fingerprint = Regex::new(r"\d{2}:\d{2}:\d{2}").unwrap().replace_all(&fingerprint, "HH:MM:SS").into_owned();
        // 屏蔽长数字
        fingerprint = Regex::new(r"\d+").unwrap().replace_all(&fingerprint, "N").into_owned();
        // 屏蔽 0x 地址
        fingerprint = Regex::new(r"0x[0-9a-fA-F]+").unwrap().replace_all(&fingerprint, "0xADDR").into_owned();

        let count_tuple = patterns.entry(fingerprint).or_insert((0, None));
        count_tuple.0 += 1;
        
        if count_tuple.1.is_none() {
            count_tuple.1 = level_re.captures(line)
                .and_then(|cap| cap.get(1))
                .map(|m| m.as_str().to_uppercase());
        }
    }

    let mut stats: Vec<PatternStat> = patterns.into_iter()
        .map(|(content, (count, level))| PatternStat { content, count, level })
        .collect();
    
    // 按频率排序
    stats.sort_by(|a, b| b.count.cmp(&a.count));
    
    Ok(stats.into_iter().take(50).collect()) // 只取前 50 个最频繁的模式
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MetricDataPoint {
    line_number: usize,
    value: f64,
}

#[tauri::command]
async fn extract_metrics(file_path: String, regex: String) -> Result<Vec<MetricDataPoint>, String> {
    let bytes = fs::read(&file_path)
        .map_err(|e| format!("Failed to read file: {}", e))?;
    let content = String::from_utf8_lossy(&bytes).to_string();
    
    let re = Regex::new(&regex)
        .map_err(|e| format!("Invalid regex: {}", e))?;
    
    let mut data = Vec::new();
    for (idx, line) in content.lines().enumerate() {
        if let Some(caps) = re.captures(line) {
            // 尝试获取第一个捕获组，如果没有捕获组则尝试匹配整个数值
            let val_str = if caps.len() > 1 {
                caps.get(1).map(|m| m.as_str())
            } else {
                caps.get(0).map(|m| m.as_str())
            };

            if let Some(s) = val_str {
                if let Ok(val) = s.parse::<f64>() {
                    data.push(MetricDataPoint {
                        line_number: idx + 1,
                        value: val,
                    });
                }
            }
        }
    }
    
    Ok(data)
}

#[tauri::command]
async fn save_sessions(
    source_path: String,
    target_path: String,
    ranges: Vec<(usize, usize)>
) -> Result<(), String> {
    let bytes = fs::read(&source_path)
        .map_err(|e| format!("Failed to read source file: {}", e))?;
    let content = String::from_utf8_lossy(&bytes);
    let lines: Vec<&str> = content.lines().collect();

    let mut output = String::new();
    for (start, end) in ranges {
        // start and end are 1-based line numbers
        if start > 0 && start <= lines.len() && end >= start {
            let actual_end = if end > lines.len() { lines.len() } else { end };
            for i in (start - 1)..(actual_end) {
                output.push_str(lines[i]);
                output.push('\n');
            }
        }
    }

    fs::write(&target_path, output)
        .map_err(|e| format!("Failed to write to target file: {}", e))?;

    Ok(())
}

#[tauri::command]
async fn write_config_file(path: String, content: String) -> Result<(), String> {
    fs::write(path, content).map_err(|e| e.to_string())
}

#[tauri::command]
async fn read_config_file(path: String) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&bytes).to_string())
}

use chrono::NaiveDateTime;

fn parse_timestamp_to_ms(ts_str: &str) -> f64 {
    if let Ok(val) = ts_str.parse::<f64>() {
        // 情况 1: Uptime 或 Unix Timestamp (1234.567)
        // 如果数字小于 10^10，我们假设它是秒，转为毫秒
        if val < 10_000_000_000.0 { val * 1000.0 } else { val }
    } else {
        // 情况 2: 日期字符串
        // 尝试解析常见格式 [2026-01-16 20:30:44.295]
        let formats = [
            "%Y-%m-%d %H:%M:%S%.3f",
            "%Y-%m-%d %H:%M:%S",
            "%Y-%m-%d_%H:%M:%S",
            "%Y-%m-%dT%H:%M:%S%.3f",
            "%Y/%m/%d %H:%M:%S%.3f",
            "%H:%M:%S%.3f",
            "%H:%M:%S",
        ];
        
        let mut parsed_ms = None;
        for fmt in formats {
            if let Ok(dt) = NaiveDateTime::parse_from_str(ts_str, fmt) {
                parsed_ms = Some(dt.and_utc().timestamp_millis() as f64);
                break;
            }
        }
        parsed_ms.unwrap_or(0.0)
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TimeGap {
    line_number: usize,
    gap_ms: f64,
}

#[tauri::command]
async fn analyze_time_gaps(file_path: String, timestamp_regex: String) -> Result<Vec<TimeGap>, String> {
    let bytes = fs::read(&file_path).map_err(|e| e.to_string())?;
    let content = String::from_utf8_lossy(&bytes).to_string();
    
    let re = Regex::new(&timestamp_regex).map_err(|e| e.to_string())?;
    let mut last_time: Option<f64> = None;
    let mut gaps = Vec::new();

    for (idx, line) in content.lines().enumerate() {
        if let Some(caps) = re.captures(line) {
            let ts_str = caps.get(1).map(|m| m.as_str()).unwrap_or("");
            let current_ms = parse_timestamp_to_ms(ts_str);

            if current_ms > 0.0 {
                if let Some(last) = last_time {
                    let diff = current_ms - last;
                    // 只有当差距显著（如 > 10ms）时才记录，避免数据过多
                    if diff > 10.0 {
                        gaps.push(TimeGap {
                            line_number: idx + 1,
                            gap_ms: diff,
                        });
                    }
                }
                last_time = Some(current_ms);
            }
        }
    }
    
    Ok(gaps)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WorkflowSegment {
    start_line: usize,
    end_line: usize,
    start_time: f64,
    end_time: f64,
    duration_ms: f64,
    id: Option<String>,
}

#[tauri::command]
async fn analyze_workflow_duration(
    file_path: String,
    start_regex: String,
    end_regex: String,
    timestamp_regex: String,
    id_regex: Option<String>
) -> Result<Vec<WorkflowSegment>, String> {
    let bytes = fs::read(&file_path).map_err(|e| e.to_string())?;
    let content = String::from_utf8_lossy(&bytes).to_string();
    
    let start_re = Regex::new(&start_regex).map_err(|e| format!("Start Regex Error: {}", e))?;
    let end_re = Regex::new(&end_regex).map_err(|e| format!("End Regex Error: {}", e))?;
    let ts_re = Regex::new(&timestamp_regex).map_err(|e| format!("Timestamp Regex Error: {}", e))?;
    let id_re = if let Some(ref r) = id_regex {
        if r.is_empty() { None } else {
            Some(Regex::new(r).map_err(|e| format!("ID Regex Error: {}", e))?)
        }
    } else {
        None
    };

    let mut segments = Vec::new();
    
    // 如果有 ID，用 Map 跟踪。如果没有 ID，用 Stack (支持嵌套) 或简单的顺序。
    // 这里我们默认支持嵌套 (Stack) 如果没有 ID。
    use std::collections::HashMap;
    let mut active_starts_with_id: HashMap<String, (usize, f64)> = HashMap::new();
    let mut active_starts_no_id: Vec<(usize, f64)> = Vec::new();
    let mut last_ts = 0.0;

    for (idx, line) in content.lines().enumerate() {
        let line_num = idx + 1;
        
        if let Some(caps) = ts_re.captures(line) {
            if let Some(m) = caps.get(1) {
                let ts = parse_timestamp_to_ms(m.as_str());
                if ts > 0.0 {
                    last_ts = ts;
                }
            }
        }
        
        let id = id_re.as_ref()
            .and_then(|re| re.captures(line))
            .and_then(|c| {
                if c.len() > 1 {
                    c.get(1).map(|m| m.as_str().to_string())
                } else {
                    c.get(0).map(|m| m.as_str().to_string())
                }
            });

        if start_re.is_match(line) {
            if let Some(ref flow_id) = id {
                active_starts_with_id.insert(flow_id.clone(), (line_num, last_ts));
            } else {
                active_starts_no_id.push((line_num, last_ts));
            }
        } else if end_re.is_match(line) {
            if let Some(ref flow_id) = id {
                if let Some((s_line, s_ts)) = active_starts_with_id.remove(flow_id) {
                    if last_ts > 0.0 && s_ts > 0.0 {
                        segments.push(WorkflowSegment {
                            start_line: s_line,
                            end_line: line_num,
                            start_time: s_ts,
                            end_time: last_ts,
                            duration_ms: last_ts - s_ts,
                            id: Some(flow_id.clone()),
                        });
                    }
                }
            } else {
                if let Some((s_line, s_ts)) = active_starts_no_id.pop() {
                    if last_ts > 0.0 && s_ts > 0.0 {
                        segments.push(WorkflowSegment {
                            start_line: s_line,
                            end_line: line_num,
                            start_time: s_ts,
                            end_time: last_ts,
                            duration_ms: last_ts - s_ts,
                            id: None,
                        });
                    }
                }
            }
        }
    }
    
    Ok(segments)
}

#[tauri::command]
async fn analyze_recurrent_intervals(
    file_path: String,
    regex: String,
    timestamp_regex: String,
) -> Result<Vec<WorkflowSegment>, String> {
    let bytes = fs::read(&file_path).map_err(|e| e.to_string())?;
    let content = String::from_utf8_lossy(&bytes).to_string();
    
    let re = Regex::new(&regex).map_err(|e| format!("Regex Error: {}", e))?;
    let ts_re = Regex::new(&timestamp_regex).map_err(|e| format!("Timestamp Regex Error: {}", e))?;

    let mut segments = Vec::new();
    let mut last_hit: Option<(usize, f64)> = None;
    let mut last_ts = 0.0;

    for (idx, line) in content.lines().enumerate() {
        let line_num = idx + 1;
        
        if let Some(caps) = ts_re.captures(line) {
            if let Some(m) = caps.get(1) {
                let ts = parse_timestamp_to_ms(m.as_str());
                if ts > 0.0 {
                    last_ts = ts;
                }
            }
        }

        if re.is_match(line) {
            if last_ts > 0.0 {
                if let Some((prev_line, prev_ts)) = last_hit {
                    segments.push(WorkflowSegment {
                        start_line: prev_line,
                        end_line: line_num,
                        start_time: prev_ts,
                        end_time: last_ts,
                        duration_ms: last_ts - prev_ts,
                        id: None,
                    });
                }
                last_hit = Some((line_num, last_ts));
            }
        }
    }
    
    Ok(segments)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();
            
            // 监听文件拖放事件
            let window_clone = window.clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, position: _ }) = event {
                    if let Some(path) = paths.first() {
                        let _ = window_clone.emit("file-dropped", path.to_string_lossy().to_string());
                    }
                }
            });
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            parse_log_file,
            parse_log_content,
            parse_log_with_custom_splitters,
            analyze_log_patterns,
            extract_metrics,
            analyze_time_gaps,
            analyze_workflow_duration,
            analyze_recurrent_intervals,
            save_sessions,
            write_config_file,
            read_config_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
