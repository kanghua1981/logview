use std::fs;
use std::path::Path;
use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};
use tauri::{Manager, Emitter, State};
use memmap2::Mmap;
use rayon::prelude::*;
use std::sync::{Arc, Mutex};

#[derive(Debug, Serialize, Deserialize)]
pub struct FileInfo {
    name: String,
    size: u64,
    lines: usize,
    sessions: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
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
    line_count: usize,
    levels: Vec<Option<String>>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum FileEncoding {
    Utf8,
    Utf16Le,
    Utf16Be,
}

fn bytes_to_string_with_encoding(bytes: &[u8], encoding: FileEncoding) -> String {
    match encoding {
        FileEncoding::Utf8 => String::from_utf8_lossy(bytes).to_string(),
        FileEncoding::Utf16Le => {
            let u16_data: Vec<u16> = bytes.chunks_exact(2)
                .map(|c| u16::from_le_bytes([c[0], c[1]]))
                .collect();
            String::from_utf16_lossy(&u16_data)
        },
        FileEncoding::Utf16Be => {
            let u16_data: Vec<u16> = bytes.chunks_exact(2)
                .map(|c| u16::from_be_bytes([c[0], c[1]]))
                .collect();
            String::from_utf16_lossy(&u16_data)
        }
    }
}

// 核心索引结构
pub struct LogIndex {
    mmap: Mmap,
    offsets: Vec<usize>, // 每行起始位置的字节偏移
    levels: Vec<Option<String>>, // 每行的日志级别（预处理）
    encoding: FileEncoding,
}

#[derive(Default)]
pub struct AppState {
    pub current_index: Mutex<Option<Arc<LogIndex>>>,
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

// -----------------------------------------------------------------------------
// 高性能索引逻辑
// -----------------------------------------------------------------------------

#[tauri::command]
async fn parse_log_file(
    path: String, 
    boot_regex: String, 
    level_regex: String,
    state: State<'_, AppState>
) -> Result<FileInfo, String> {
    let file = fs::File::open(&path).map_err(|e| e.to_string())?;
    let mmap = unsafe { Mmap::map(&file).map_err(|e| e.to_string())? };
    let bytes = &mmap[..];

    // 0. 编码检测 (BOM)
    let (encoding, start_offset) = if bytes.starts_with(&[0xff, 0xfe]) {
        (FileEncoding::Utf16Le, 2)
    } else if bytes.starts_with(&[0xfe, 0xff]) {
        (FileEncoding::Utf16Be, 2)
    } else if bytes.starts_with(&[0xef, 0xbb, 0xbf]) {
        (FileEncoding::Utf8, 3)
    } else {
        (FileEncoding::Utf8, 0)
    };
    
    // 1. 并行寻找换行符，记录每行起始偏移
    let mut offsets = vec![start_offset]; 
    
    let mut newline_offsets: Vec<usize> = match encoding {
        FileEncoding::Utf16Le => {
            // UTF-16 LE: 寻找 0x0A 并且确认它是偶数索引（相对于 start_offset）
            (start_offset..bytes.len()).into_par_iter()
                .filter(|&idx| bytes[idx] == 0x0A && (idx - start_offset) % 2 == 0)
                .map(|idx| idx + 2) // \n\0 后面的位置
                .collect()
        }
        FileEncoding::Utf16Be => {
            // UTF-16 BE: 寻找 0x0A 并且确认它是奇数索引
            (start_offset..bytes.len()).into_par_iter()
                .filter(|&idx| bytes[idx] == 0x0A && (idx - start_offset) % 2 == 1)
                .map(|idx| idx + 1)
                .collect()
        }
        _ => {
            // UTF-8
            (start_offset..bytes.len()).into_par_iter()
                .filter(|&idx| bytes[idx] == b'\n')
                .map(|idx| idx + 1)
                .collect()
        }
    };
    
    newline_offsets.sort_unstable();
    offsets.extend(newline_offsets);

    if offsets.last() == Some(&bytes.len()) {
        offsets.pop(); 
    }

    let line_count = offsets.len();
    
    // Helper to convert bytes to string based on detected encoding
    let bytes_to_str = |b: &[u8]| -> String {
        match encoding {
            FileEncoding::Utf8 => String::from_utf8_lossy(b).to_string(),
            FileEncoding::Utf16Le => {
                let u16_data: Vec<u16> = b.chunks_exact(2)
                    .map(|c| u16::from_le_bytes([c[0], c[1]]))
                    .collect();
                String::from_utf16_lossy(&u16_data)
            },
            FileEncoding::Utf16Be => {
                let u16_data: Vec<u16> = b.chunks_exact(2)
                    .map(|c| u16::from_be_bytes([c[0], c[1]]))
                    .collect();
                String::from_utf16_lossy(&u16_data)
            }
        }
    };

    // 2. 预分析：并行提取日志级别
    let level_re = if !level_regex.is_empty() {
        Regex::new(&level_regex).ok()
    } else {
        Regex::new(r"(?i)\[(DEBUG|INFO|WARN|ERROR|FATAL|NORM|TRACE|SUCCESS)\]").ok()
    };

    let boot_re = if !boot_regex.is_empty() {
        Regex::new(&boot_regex).ok()
    } else {
        Regex::new(r"(?i)(system|boot|start)(ed|ing|up)").ok()
    };

    // 预提取所有级别的 Logic
    let levels: Vec<Option<String>> = (0..line_count).into_par_iter().map(|idx| {
        let start = offsets[idx];
        let end = if idx + 1 < line_count { offsets[idx+1] } else { bytes.len() };
        let line_bytes = &bytes[start..end];
        let line_str = bytes_to_str(line_bytes);
        
        level_re.as_ref().and_then(|re| {
            re.captures(&line_str).and_then(|cap| {
                if cap.len() > 1 {
                    cap.get(1).map(|m| m.as_str().to_uppercase())
                } else {
                    cap.get(0).map(|m| m.as_str().to_uppercase())
                }
            })
        })
    }).collect();

    // 3. 计算会话数
    let boot_re = if !boot_regex.is_empty() {
        Regex::new(&boot_regex).ok()
    } else {
        Regex::new(r"(?i)(system|boot|start)(ed|ing|up)").ok()
    };

    let sessions_count = if let Some(re) = boot_re {
        (0..line_count).into_par_iter().filter(|&idx| {
            let start = offsets[idx];
            let end = if idx + 1 < line_count { offsets[idx+1] } else { bytes.len() };
            let line_bytes = &bytes[start..end];
            let line_str = bytes_to_str(line_bytes);
            re.is_match(&line_str)
        }).count() + 1
    } else {
        1
    };

    let mmap_len = bytes.len();

    // 保存到全局状态
    let index = Arc::new(LogIndex {
        mmap,
        offsets,
        levels,
        encoding,
    });
    
    let mut current = state.current_index.lock().unwrap();
    *current = Some(index);

    let file_name = Path::new(&path).file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();

    Ok(FileInfo {
        name: file_name,
        size: mmap_len as u64,
        lines: line_count,
        sessions: sessions_count,
    })
}

#[tauri::command]
async fn parse_log_content(
    path: String,
    boot_regex: String,
    level_regex: String,
    timestamp_regex: String,
    time_gap_threshold: f64,
    state: State<'_, AppState>
) -> Result<ParsedLog, String> {
    let index_opt = {
        let current = state.current_index.lock().unwrap();
        current.clone()
    };

    if let Some(index) = index_opt {
        let bytes = &index.mmap[..];
        let line_count = index.offsets.len();
        
        let mut sessions = Vec::new();
        let mut current_session_start = 1;
        let mut session_id = 0;

        let boot_re = if !boot_regex.is_empty() {
            Regex::new(&boot_regex).ok()
        } else {
            Regex::new(r"(?i)(system|boot|start)(ed|ing|up)").ok()
        };

        let ts_re = if !timestamp_regex.is_empty() {
            Regex::new(&timestamp_regex).ok()
        } else {
            None
        };

        let mut last_time: Option<f64> = None;

        for idx in 0..line_count {
            let start = index.offsets[idx];
            let end = if idx + 1 < line_count { index.offsets[idx+1] } else { bytes.len() };
            let line_bytes = &bytes[start..end];
            let line_str = bytes_to_string_with_encoding(line_bytes, index.encoding);

            let mut split_session = false;
            let mut boot_marker = String::new();

            // 1. 基于 Boot 标识符切分
            if let Some(ref re) = boot_re {
                if re.is_match(&line_str) && idx > 0 {
                    split_session = true;
                    boot_marker = line_str.trim().to_string();
                }
            }

            // 2. 基于时间间隙切分
            if !split_session && time_gap_threshold > 0.0 {
                if let Some(ref re) = ts_re {
                    if let Some(caps) = re.captures(&line_str) {
                        let ts_str = caps.get(1).map(|m| m.as_str()).unwrap_or(caps.get(0).unwrap().as_str());
                        if let Some(current_time) = try_parse_timestamp(ts_str) {
                            if let Some(last) = last_time {
                                if (current_time - last).abs() > time_gap_threshold {
                                    split_session = true;
                                    boot_marker = format!("Time Gap Detected: {:.2}s", current_time - last);
                                }
                            }
                            last_time = Some(current_time);
                        }
                    }
                }
            }

            if split_session && idx > 0 {
                sessions.push(LogSession {
                    id: session_id,
                    start_line: current_session_start,
                    end_line: idx,
                    boot_marker: if boot_marker.is_empty() { line_str.trim().to_string() } else { boot_marker },
                });
                session_id += 1;
                current_session_start = idx + 1;
            }
        }

        // 扫尾末尾会话
        sessions.push(LogSession {
            id: session_id,
            start_line: current_session_start,
            end_line: line_count,
            boot_marker: if line_count > 0 { "End of File".to_string() } else { "Full Log".to_string() },
        });

        let levels = index.levels.clone();

        Ok(ParsedLog {
            sessions,
            line_count,
            levels,
        })
    } else {
        Err("No file opened or index missing. Call parse_log_file first.".to_string())
    }
}

// 辅助函数：尝试解析时间戳
fn try_parse_timestamp(s: &str) -> Option<f64> {
    let s = s.trim();
    // 1. 尝试解析为纯数字（如内核秒数 [123.456]）
    if let Ok(val) = s.parse::<f64>() {
        return Some(val);
    }

    // 2. 尝试解析常见日期时间格式
    // 这里我们可以尝试几种常见格式，或者使用更强大的解析库
    // 简便起见，我们尝试几种模式
    let formats = [
        "%Y-%m-%d %H:%M:%S%.3f",
        "%Y-%m-%d %H:%M:%S",
        "%H:%M:%S%.3f",
        "%H:%M:%S",
    ];

    for fmt in formats {
        if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(s, fmt) {
            return Some(dt.and_utc().timestamp() as f64 + dt.and_utc().timestamp_subsec_nanos() as f64 / 1_000_000_000.0);
        }
    }

    // 如果包含日期和时间，但不是标准格式，尝试部分匹配
    // 或者针对 [2026-01-22_21:18:34.723] 这种带下划线的
    let s_clean = s.replace('_', " ").replace('T', " ");
    for fmt in formats {
        if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(&s_clean, fmt) {
            return Some(dt.and_utc().timestamp() as f64 + dt.and_utc().timestamp_subsec_nanos() as f64 / 1_000_000_000.0);
        }
    }

    None
}

#[tauri::command]
async fn parse_log_with_custom_splitters(
    path: String,
    splitter_regexes: Vec<String>,
    _level_regex: String,
    state: State<'_, AppState>
) -> Result<ParsedLog, String> {
    let index_opt = {
        let current = state.current_index.lock().unwrap();
        current.clone()
    };

    let index = if let Some(idx) = index_opt {
        idx
    } else {
        // 如果索引丢了，尝试重新解析文件 (虽然不如直接报错优雅，但更鲁棒)
        parse_log_file(path.clone(), String::new(), String::new(), state.clone()).await?;
        state.current_index.lock().unwrap().clone().ok_or("Failed to re-index file")?
    };

    let bytes = &index.mmap[..];
    let line_count = index.offsets.len();
    
    let mut sessions = Vec::new();
    let mut current_session_start = 1;
    let mut session_id = 0;

    // 编译所有激活的分割器
    let mut compiled_splitters = Vec::new();
    for regex_str in &splitter_regexes {
        if !regex_str.is_empty() {
            if let Ok(re) = Regex::new(regex_str) {
                compiled_splitters.push(re);
            }
        }
    }

    // 遍历所有行，检查是否匹配任意一个分割器
    for idx in 0..line_count {
        let start = index.offsets[idx];
        let end = if idx + 1 < line_count { index.offsets[idx+1] } else { bytes.len() };
        let line_str = bytes_to_string_with_encoding(&bytes[start..end], index.encoding);
        
        let mut is_match = false;
        for re in &compiled_splitters {
            if re.is_match(&line_str) {
                is_match = true;
                break;
            }
        }

        if is_match && idx > 0 {
            sessions.push(LogSession {
                id: session_id,
                start_line: current_session_start,
                end_line: idx,
                boot_marker: line_str.trim().to_string(),
            });
            session_id += 1;
            current_session_start = idx + 1;
        }
    }

    // 扫尾末尾会话
    sessions.push(LogSession {
        id: session_id,
        start_line: current_session_start,
        end_line: line_count,
        boot_marker: if line_count > 0 { "End of File".to_string() } else { "Full Log".to_string() },
    });

    // 兼容性返回：只带元数据
    let levels = index.levels.clone();

    Ok(ParsedLog {
        sessions,
        line_count,
        levels,
    })
}

#[tauri::command]
async fn get_log_range(
    start_line: usize, // 1-based
    end_line: usize,   // 1-based
    state: State<'_, AppState>
) -> Result<Vec<LogLine>, String> {
    let index_opt = {
        let current = state.current_index.lock().unwrap();
        current.clone()
    };

    if let Some(index) = index_opt {
        let line_count = index.offsets.len();
        let start_idx = (start_line.max(1) - 1).min(line_count);
        let end_idx = end_line.min(line_count);
        
        if start_idx >= end_idx { return Ok(vec![]); }

        let bytes = &index.mmap[..];
        let result: Vec<LogLine> = (start_idx..end_idx).into_par_iter().map(|idx| {
            let start = index.offsets[idx];
            let end = if idx + 1 < line_count { index.offsets[idx+1] } else { bytes.len() };
            let line_content = bytes_to_string_with_encoding(&bytes[start..end], index.encoding);
            
            LogLine {
                line_number: idx + 1,
                content: line_content,
                level: index.levels[idx].clone(),
            }
        }).collect();

        Ok(result)
    } else {
        Err("No file opened".to_string())
    }
}

#[tauri::command]
async fn get_log_lines_by_indices(
    indices: Vec<usize>, // 0-based
    state: State<'_, AppState>
) -> Result<Vec<LogLine>, String> {
    let index_opt = state.current_index.lock().unwrap().clone();
    
    if let Some(index) = index_opt {
        let line_count = index.offsets.len();
        let bytes = &index.mmap[..];
        
        let result: Vec<LogLine> = indices.into_par_iter().filter_map(|idx| {
            if idx >= line_count { return None; }
            let start = index.offsets[idx];
            let end = if idx + 1 < line_count { index.offsets[idx+1] } else { bytes.len() };
            let line_content = bytes_to_string_with_encoding(&bytes[start..end], index.encoding);
            
            Some(LogLine {
                line_number: idx + 1,
                content: line_content,
                level: index.levels[idx].clone(),
            })
        }).collect();

        Ok(result)
    } else {
        Err("No file opened".to_string())
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PatternStat {
    content: String,
    count: usize,
    level: Option<String>,
}

#[tauri::command]
async fn analyze_log_patterns(state: State<'_, AppState>) -> Result<Vec<PatternStat>, String> {
    let index_opt = state.current_index.lock().unwrap().clone();
    let index = index_opt.ok_or("No file opened")?;
    
    let bytes = &index.mmap[..];
    let offsets = &index.offsets;
    
    // 预编译正则，放在循环外
    let ts_re = Regex::new(r"\d{2}:\d{2}:\d{2}").unwrap();
    let n_re = Regex::new(r"\d+").unwrap();
    let addr_re = Regex::new(r"0x[0-9a-fA-F]+").unwrap();

    // 使用 parallel fold 和 reduce 来加速聚合并减少中间内存占用
    use std::collections::HashMap;
    
    let pattern_counts: HashMap<String, (usize, Option<String>)> = (0..offsets.len()).into_par_iter().fold(
        || HashMap::<String, (usize, Option<String>)>::new(),
        |mut acc, idx| {
            let start = offsets[idx];
            let end = if idx + 1 < offsets.len() { offsets[idx+1] } else { bytes.len() };
            let line = bytes_to_string_with_encoding(&bytes[start..end], index.encoding);
            if line.trim().is_empty() { return acc; }

            let mut fingerprint = line;
            fingerprint = ts_re.replace_all(&fingerprint, "HH:MM:SS").into_owned();
            fingerprint = n_re.replace_all(&fingerprint, "N").into_owned();
            fingerprint = addr_re.replace_all(&fingerprint, "0xADDR").into_owned();

            let entry = acc.entry(fingerprint).or_insert((0, None));
            entry.0 += 1;
            if entry.1.is_none() {
                entry.1 = index.levels[idx].clone();
            }
            acc
        }
    ).reduce(
        || HashMap::new(),
        |mut m1, m2| {
            for (k, v) in m2 {
                let entry = m1.entry(k).or_insert((0, None));
                entry.0 += v.0;
                if entry.1.is_none() {
                    entry.1 = v.1;
                }
            }
            m1
        }
    );

    let mut stats: Vec<PatternStat> = pattern_counts.into_iter()
        .map(|(content, (count, level))| PatternStat { content, count, level })
        .collect();
    
    stats.sort_by(|a, b| b.count.cmp(&a.count));
    Ok(stats.into_iter().take(50).collect())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MetricDataPoint {
    line_number: usize,
    value: f64,
}

#[tauri::command]
async fn extract_metrics(regex: String, state: State<'_, AppState>) -> Result<Vec<MetricDataPoint>, String> {
    let index_opt = state.current_index.lock().unwrap().clone();
    let index = index_opt.ok_or("No file opened")?;
    
    let re = Regex::new(&regex).map_err(|e| format!("Invalid regex: {}", e))?;
    let bytes = &index.mmap[..];
    let offsets = &index.offsets;

    let data: Vec<MetricDataPoint> = (0..offsets.len()).into_par_iter().filter_map(|idx| {
        let start = offsets[idx];
        let end = if idx + 1 < offsets.len() { offsets[idx+1] } else { bytes.len() };
        let line = String::from_utf8_lossy(&bytes[start..end]);
        
        if let Some(caps) = re.captures(&line) {
            let val_str = if caps.len() > 1 {
                caps.get(1).map(|m| m.as_str())
            } else {
                caps.get(0).map(|m| m.as_str())
            };

            if let Some(s) = val_str {
                if let Ok(val) = s.parse::<f64>() {
                    return Some(MetricDataPoint {
                        line_number: idx + 1,
                        value: val,
                    });
                }
            }
        }
        None
    }).collect();
    
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
async fn search_log(
    query: String,
    is_regex: bool,
    line_ranges: Option<Vec<(usize, usize)>>, // 新增：可选的行号范围限制 (start, end) 1-based
    state: State<'_, AppState>
) -> Result<Vec<LogLine>, String> {
    let index_opt = state.current_index.lock().unwrap().clone();
    let index = index_opt.ok_or("No file opened")?;
    
    let bytes = &index.mmap[..];
    let offsets = &index.offsets;

    let trimmed_query = query.trim_matches(|c: char| c == '\r' || c == '\n');

    if trimmed_query.is_empty() {
        return Ok(vec![]);
    }

    let search_fn: Box<dyn Fn(&str) -> bool + Send + Sync> = if is_regex {
        let re = RegexBuilder::new(trimmed_query)
            .case_insensitive(true)
            .build()
            .map_err(|e| e.to_string())?;
        Box::new(move |s| re.is_match(s))
    } else {
        let q = trimmed_query.to_lowercase();
        Box::new(move |s| s.to_lowercase().contains(&q))
    };

    let result: Vec<LogLine> = if let Some(ranges) = line_ranges {
        if ranges.is_empty() {
            return Ok(vec![]);
        }
        // 将范围转换为索引
        ranges.into_par_iter().flat_map(|(start, end)| {
            let start_idx = (start.max(1) - 1).min(offsets.len());
            let end_idx = end.min(offsets.len());
            
            if start_idx >= end_idx {
                return vec![];
            }

            (start_idx..end_idx).into_iter().filter_map(|idx| {
                let start_pos = offsets[idx];
                let next_start = if idx + 1 < offsets.len() { offsets[idx+1] } else { bytes.len() };
                
                // 掐掉换行符 (编码相关的)
                let mut end_pos = next_start;
                match index.encoding {
                    FileEncoding::Utf16Le | FileEncoding::Utf16Be => {
                        while end_pos >= start_pos + 2 {
                            let b1 = bytes[end_pos - 2];
                            let b2 = bytes[end_pos - 1];
                            if (index.encoding == FileEncoding::Utf16Le && (b1 == 0x0A || b1 == 0x0D) && b2 == 0x00) ||
                               (index.encoding == FileEncoding::Utf16Be && b1 == 0x00 && (b2 == 0x0A || b2 == 0x0D)) {
                                end_pos -= 2;
                            } else {
                                break;
                            }
                        }
                    }
                    _ => {
                        while end_pos > start_pos && (bytes[end_pos-1] == b'\n' || bytes[end_pos-1] == b'\r') {
                            end_pos -= 1;
                        }
                    }
                }
                
                let line_str = bytes_to_string_with_encoding(&bytes[start_pos..end_pos], index.encoding);
                
                if search_fn(&line_str) {
                    Some(LogLine {
                        line_number: idx + 1,
                        content: line_str,
                        level: index.levels[idx].clone(),
                    })
                } else {
                    None
                }
            }).collect::<Vec<_>>()
        }).collect()
    } else {
        // 全文搜索
        (0..offsets.len())
            .into_par_iter()
            .filter_map(|idx| {
                let start_pos = offsets[idx];
                let next_start = if idx + 1 < offsets.len() { offsets[idx+1] } else { bytes.len() };
                
                let mut end_pos = next_start;
                match index.encoding {
                    FileEncoding::Utf16Le | FileEncoding::Utf16Be => {
                        while end_pos >= start_pos + 2 {
                            let b1 = bytes[end_pos - 2];
                            let b2 = bytes[end_pos - 1];
                            if (index.encoding == FileEncoding::Utf16Le && (b1 == 0x0A || b1 == 0x0D) && b2 == 0x00) ||
                               (index.encoding == FileEncoding::Utf16Be && b1 == 0x00 && (b2 == 0x0A || b2 == 0x0D)) {
                                end_pos -= 2;
                            } else {
                                break;
                            }
                        }
                    }
                    _ => {
                        while end_pos > start_pos && (bytes[end_pos-1] == b'\n' || bytes[end_pos-1] == b'\r') {
                            end_pos -= 1;
                        }
                    }
                }

                let line_str = bytes_to_string_with_encoding(&bytes[start_pos..end_pos], index.encoding);
                
                if search_fn(&line_str) {
                    Some(LogLine {
                        line_number: idx + 1,
                        content: line_str,
                        level: index.levels[idx].clone(),
                    })
                } else {
                    None
                }
            })
            .collect()
    };

    Ok(result)
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
async fn analyze_time_gaps(timestamp_regex: String, state: State<'_, AppState>) -> Result<Vec<TimeGap>, String> {
    let index_opt = state.current_index.lock().unwrap().clone();
    let index = index_opt.ok_or("No file opened")?;
    
    let re = Regex::new(&timestamp_regex).map_err(|e| e.to_string())?;
    let bytes = &index.mmap[..];
    let offsets = &index.offsets;

    // 1. 并行提取所有行的时间戳
    let timestamps: Vec<Option<f64>> = (0..offsets.len()).into_par_iter().map(|idx| {
        let start = offsets[idx];
        let end = if idx + 1 < offsets.len() { offsets[idx+1] } else { bytes.len() };
        let line = bytes_to_string_with_encoding(&bytes[start..end], index.encoding);

        if let Some(caps) = re.captures(&line) {
            let ts_str = caps.get(1).map(|m| m.as_str()).unwrap_or("");
            let current_ms = parse_timestamp_to_ms(ts_str);
            if current_ms > 0.0 {
                return Some(current_ms);
            }
        }
        None
    }).collect();

    // 2. 串行计算差值
    let mut last_time: Option<f64> = None;
    let mut gaps = Vec::new();

    for (idx, ts_opt) in timestamps.into_iter().enumerate() {
        if let Some(current_ms) = ts_opt {
            if let Some(last) = last_time {
                let diff = current_ms - last;
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
    start_regex: String,
    end_regex: String,
    timestamp_regex: String,
    id_regex: Option<String>,
    state: State<'_, AppState>
) -> Result<Vec<WorkflowSegment>, String> {
    let index_opt = state.current_index.lock().unwrap().clone();
    let index = index_opt.ok_or("No file opened")?;
    
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

    let bytes = &index.mmap[..];
    let offsets = &index.offsets;

    // 1. 并行预处理：提取时间戳、ID和匹配标记
    // 为了减少内存分配，我们只记录必要信息
    #[derive(Clone)]
    struct LineMeta {
        line_num: usize,
        ts: f64,
        id: Option<String>,
        is_start: bool,
        is_end: bool,
    }

    let metas: Vec<LineMeta> = (0..offsets.len()).into_par_iter().map(|idx| {
        let start = offsets[idx];
        let end = if idx + 1 < offsets.len() { offsets[idx+1] } else { bytes.len() };
        let line = bytes_to_string_with_encoding(&bytes[start..end], index.encoding);
        
        let ts = ts_re.captures(&line)
            .and_then(|c| c.get(1))
            .map(|m| parse_timestamp_to_ms(m.as_str()))
            .unwrap_or(0.0);
            
        let id = id_re.as_ref()
            .and_then(|re| re.captures(&line))
            .and_then(|c| {
                if c.len() > 1 {
                    c.get(1).map(|m| m.as_str().to_string())
                } else {
                    c.get(0).map(|m| m.as_str().to_string())
                }
            });

        LineMeta {
            line_num: idx + 1,
            ts,
            id,
            is_start: start_re.is_match(&line),
            is_end: end_re.is_match(&line),
        }
    }).collect();

    // 2. 串行匹配逻辑 (因为这涉及到状态机)
    let mut segments = Vec::new();
    use std::collections::HashMap;
    let mut active_starts_with_id: HashMap<String, (usize, f64)> = HashMap::new();
    let mut active_starts_no_id: Vec<(usize, f64)> = Vec::new();
    let mut last_valid_ts = 0.0;

    for meta in metas {
        if meta.ts > 0.0 {
            last_valid_ts = meta.ts;
        }
        
        if meta.is_start {
            if let Some(ref flow_id) = meta.id {
                active_starts_with_id.insert(flow_id.clone(), (meta.line_num, last_valid_ts));
            } else {
                active_starts_no_id.push((meta.line_num, last_valid_ts));
            }
        } 
        
        if meta.is_end {
            if let Some(ref flow_id) = meta.id {
                if let Some((s_line, s_ts)) = active_starts_with_id.remove(flow_id) {
                    if last_valid_ts > 0.0 && s_ts > 0.0 {
                        segments.push(WorkflowSegment {
                            start_line: s_line,
                            end_line: meta.line_num,
                            start_time: s_ts,
                            end_time: last_valid_ts,
                            duration_ms: last_valid_ts - s_ts,
                            id: Some(flow_id.clone()),
                        });
                    }
                }
            } else {
                if let Some((s_line, s_ts)) = active_starts_no_id.pop() {
                    if last_valid_ts > 0.0 && s_ts > 0.0 {
                        segments.push(WorkflowSegment {
                            start_line: s_line,
                            end_line: meta.line_num,
                            start_time: s_ts,
                            end_time: last_valid_ts,
                            duration_ms: last_valid_ts - s_ts,
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
    regex: String,
    timestamp_regex: String,
    state: State<'_, AppState>
) -> Result<Vec<WorkflowSegment>, String> {
    let index_opt = state.current_index.lock().unwrap().clone();
    let index = index_opt.ok_or("No file opened")?;
    
    let re = Regex::new(&regex).map_err(|e| format!("Regex Error: {}", e))?;
    let ts_re = Regex::new(&timestamp_regex).map_err(|e| format!("Timestamp Regex Error: {}", e))?;

    let bytes = &index.mmap[..];
    let offsets = &index.offsets;

    // 1. 并行预处理
    struct Hit {
        line_num: usize,
        ts: f64,
        is_hit: bool,
    }

    let hits: Vec<Hit> = (0..offsets.len()).into_par_iter().map(|idx| {
        let start = offsets[idx];
        let end = if idx + 1 < offsets.len() { offsets[idx+1] } else { bytes.len() };
        let line = bytes_to_string_with_encoding(&bytes[start..end], index.encoding);
        
        let ts = ts_re.captures(&line)
            .and_then(|c| c.get(1))
            .map(|m| parse_timestamp_to_ms(m.as_str()))
            .unwrap_or(0.0);

        Hit {
            line_num: idx + 1,
            ts,
            is_hit: re.is_match(&line),
        }
    }).collect();

    // 2. 串行计算间隔
    let mut segments = Vec::new();
    let mut last_hit: Option<(usize, f64)> = None;
    let mut last_valid_ts = 0.0;

    for hit in hits {
        if hit.ts > 0.0 {
            last_valid_ts = hit.ts;
        }

        if hit.is_hit {
            if last_valid_ts > 0.0 {
                if let Some((prev_line, prev_ts)) = last_hit {
                    segments.push(WorkflowSegment {
                        start_line: prev_line,
                        end_line: hit.line_num,
                        start_time: prev_ts,
                        end_time: last_valid_ts,
                        duration_ms: last_valid_ts - prev_ts,
                        id: None,
                    });
                }
                last_hit = Some((hit.line_num, last_valid_ts));
            }
        }
    }
    
    Ok(segments)
}

#[tauri::command]
async fn get_filtered_indices(
    log_levels: Vec<String>,
    line_ranges: Option<Vec<(usize, usize)>>,
    highlights: Vec<String>,
    context_lines: usize,
    refinements: Vec<String>,
    state: State<'_, AppState>
) -> Result<Vec<usize>, String> {
    let index = state.current_index.lock().unwrap().clone()
        .ok_or("No file opened")?;
    
    let bytes = &index.mmap[..];
    let offsets = &index.offsets;
    let line_count = offsets.len();

    let levels_set: std::collections::HashSet<String> = log_levels.iter()
        .map(|s| s.to_uppercase()).collect();
    
    let keywords: Vec<String> = highlights.iter()
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty())
        .collect();

    // 预处理多级过滤器
    enum RefinementMode {
        Include(String),
        Exclude(String),
        Regex(regex::Regex),
        Exact(String),
    }

    let parsed_refinements: Vec<RefinementMode> = refinements.iter()
        .filter(|s| !s.trim().is_empty())
        .map(|s| {
            let s = s.trim();
            if s.starts_with('!') {
                RefinementMode::Exclude(s[1..].to_lowercase())
            } else if s.starts_with('/') {
                let pattern = if s.len() > 1 { &s[1..] } else { "" };
                let re = regex::RegexBuilder::new(pattern)
                    .case_insensitive(true)
                    .build()
                    .unwrap_or_else(|_| regex::Regex::new("").unwrap());
                RefinementMode::Regex(re)
            } else if s.starts_with('=') {
                RefinementMode::Exact(s[1..].to_string())
            } else if s.starts_with('?') {
                // AI 模式暂时作为普通包含匹配处理，直到接入模型
                RefinementMode::Include(s[1..].to_lowercase())
            } else {
                RefinementMode::Include(s.to_lowercase())
            }
        })
        .collect();

    // 第一阶段：确定“种子”行（Trace Keywords 或基础过滤条件）
    let is_seed: Vec<bool> = (0..line_count).into_par_iter().map(|idx| {
        // 范围和级别是全局基础过滤，不参与上下文扩展
        if let Some(ref ranges) = line_ranges {
            let ln = idx + 1;
            if !ranges.iter().any(|(s, e)| ln >= *s && ln <= *e) { return false; }
        }
        if !levels_set.is_empty() {
            let cur_lv = index.levels[idx].as_ref().map(|s| s.to_uppercase()).unwrap_or_else(|| "INFO".to_string());
            if !levels_set.contains(&cur_lv) { return false; }
        }

        // 如果没有关键字，所有符合范围和级别的行都是种子
        if keywords.is_empty() { return true; }

        let start = offsets[idx];
        let end = if idx + 1 < line_count { offsets[idx+1] } else { bytes.len() };
        let line_bytes = &bytes[start..end];
        let line_str_original = bytes_to_string_with_encoding(line_bytes, index.encoding);
        let line_str_lower = line_str_original.to_lowercase();

        keywords.iter().any(|k| line_str_lower.contains(k))
    }).collect();

    // 第二阶段：上下文扩展（仅当有关键字且 context_lines > 0 时有效）
    let mut in_trace = vec![false; line_count];
    if !keywords.is_empty() && context_lines > 0 {
        // 串行扩展 mask（虽然增加了主线程压力，但逻辑简单可靠，对于数百万行也是毫秒级）
        for i in 0..line_count {
            if is_seed[i] {
                let start = i.saturating_sub(context_lines);
                let end = (i + context_lines).min(line_count - 1);
                for j in start..=end { in_trace[j] = true; }
            }
        }
    } else {
        in_trace = is_seed;
    }

    // 第三阶段：在最终的 trace 范围内应用“精简”过滤器 (Refinements)
    let result: Vec<usize> = (0..line_count).into_par_iter().filter_map(|idx| {
        if !in_trace[idx] { return None; }
        
        // 如果没有精简过滤器，直接返回
        if parsed_refinements.is_empty() { return Some(idx); }

        // 获取行内容以进行精简检查
        let start = offsets[idx];
        let end = if idx + 1 < line_count { offsets[idx+1] } else { bytes.len() };
        let line_bytes = &bytes[start..end];
        let line_str_original = bytes_to_string_with_encoding(line_bytes, index.encoding);
        let line_str_lower = line_str_original.to_lowercase();

        for ref_mode in &parsed_refinements {
            match ref_mode {
                RefinementMode::Include(k) => {
                    if !line_str_lower.contains(k) { return None; }
                }
                RefinementMode::Exclude(k) => {
                    if line_str_lower.contains(k) { return None; }
                }
                RefinementMode::Regex(re) => {
                    if !re.is_match(&line_str_original) { return None; }
                }
                RefinementMode::Exact(k) => {
                    if !line_str_original.contains(k) { return None; }
                }
            }
        }

        Some(idx)
    }).collect();

    Ok(result)
}

#[tauri::command]
async fn save_filtered_logs(
    path: String,
    indices: Vec<usize>,
    state: State<'_, AppState>
) -> Result<(), String> {
    use std::fs::File;
    use std::io::{Write, BufWriter};

    let index = state.current_index.lock().unwrap().clone()
        .ok_or("No file opened")?;
    
    let bytes = &index.mmap[..];
    let offsets = &index.offsets;
    let line_count = offsets.len();

    let file = File::create(path).map_err(|e| e.to_string())?;
    let mut writer = BufWriter::new(file);

    for idx in indices {
        if idx >= line_count { continue; }
        let start = offsets[idx];
        let end = if idx + 1 < line_count { offsets[idx+1] } else { bytes.len() };
        let line_str = bytes_to_string_with_encoding(&bytes[start..end], index.encoding);
        
        // 写入 1-based 行号前缀
        writeln!(writer, "{}: {}", idx + 1, line_str.trim_end()).map_err(|e| e.to_string())?;
    }

    writer.flush().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn find_first_occurrence(
    query: String,
    line_ranges: Option<Vec<(usize, usize)>>,
    state: State<'_, AppState>
) -> Result<Option<usize>, String> {
    let index = state.current_index.lock().unwrap().clone()
        .ok_or("No file opened")?;
    
    let bytes = &index.mmap[..];
    let offsets = &index.offsets;
    let line_count = offsets.len();
    let query_lower = query.to_lowercase();

    // 并行查找第一个匹配项
    let first_match = (0..line_count).into_par_iter().find_first(|&idx| {
        // 范围检查
        if let Some(ref ranges) = line_ranges {
            let ln = idx + 1; // 1-based line number for comparison with session ranges
            if !ranges.iter().any(|(s, e)| ln >= *s && ln <= *e) { return false; }
        }

        let start = offsets[idx];
        let end = if idx + 1 < line_count { offsets[idx+1] } else { bytes.len() };
        let line_bytes = &bytes[start..end];
        let line_str = bytes_to_string_with_encoding(line_bytes, index.encoding).to_lowercase();
        
        line_str.contains(&query_lower)
    });

    Ok(first_match)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AppState::default()) // 注册全局状态
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
            get_log_range,
            get_log_lines_by_indices,
            search_log,
            get_filtered_indices,
            analyze_log_patterns,
            extract_metrics,
            analyze_time_gaps,
            analyze_workflow_duration,
            analyze_recurrent_intervals,
            save_sessions,
            save_filtered_logs,
            write_config_file,
            read_config_file,
            find_first_occurrence
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
