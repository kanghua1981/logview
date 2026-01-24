import { useLogStore } from '../store';
import { invoke } from '@tauri-apps/api/core';

/**
 * 核心文件加载函数：处理文件解析、索引建立和 Session 切分
 */
export const loadLogFile = async (filePath: string) => {
  const { 
    files, 
    addFile, 
    setCurrentFile, 
    bootMarkerRegex, 
    logLevelRegex,
    timestampRegex,
    timeGapThreshold
  } = useLogStore.getState();
  
  try {
    // 检查文件是否已加载
    const existingFile = files.find(f => f.path === filePath);
    
    // 调用 Rust 后端解析文件基本信息
    const fileInfo = await invoke<{
      name: string;
      size: number;
      lines: number;
      sessions: number;
    }>('parse_log_file', { 
      path: filePath,
      bootRegex: bootMarkerRegex,
      levelRegex: logLevelRegex
    });

    const fileId = existingFile ? existingFile.id : Date.now().toString();
    
    if (!existingFile) {
      addFile({
        id: fileId,
        name: fileInfo.name,
        path: filePath,
        size: fileInfo.size,
        lines: fileInfo.lines,
        sessions: fileInfo.sessions,
      });
    } else {
      // 更新现有文件信息
      useLogStore.setState(state => ({
        files: state.files.map(f => f.id === fileId ? {
          ...f,
          size: fileInfo.size,
          lines: fileInfo.lines,
          sessions: fileInfo.sessions,
        } : f)
      }));
      setCurrentFile(fileId);
    }

    // 加载日志内容
    const result = await invoke<{
      sessions: Array<{
        id: number;
        start_line: number;
        end_line: number;
        boot_marker: string;
      }>;
      line_count: number;
      levels: (string|null)[];
    }>('parse_log_content', { 
      path: filePath,
      bootRegex: bootMarkerRegex,
      levelRegex: logLevelRegex,
      timestampRegex: timestampRegex,
      timeGapThreshold: timeGapThreshold
    });

    useLogStore.getState().setParsedLog({
      sessions: result.sessions.map(s => ({
        id: s.id,
        startLine: s.start_line,
        endLine: s.end_line,
        bootMarker: s.boot_marker,
      })),
      levels: result.levels,
      line_count: result.line_count
    });

    // 打开新文件时，默认关闭“仅限所选会话”搜索
    useLogStore.setState({ 
      searchOnlySelectedSessions: false,
      selectedSessionIds: [] 
    });
  } catch (error) {
    console.error('Failed to load file:', error);
    throw error;
  }
};
