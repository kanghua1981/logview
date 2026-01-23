import { useCallback } from 'react';
import { useLogStore } from '../store';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';

// 导出文件加载函数供其他组件使用
export const loadLogFile = async (filePath: string) => {
  const { 
    files, 
    addFile, 
    setCurrentFile, 
    setSessions, 
    setLogLines, 
    bootMarkerRegex, 
    logLevelRegex 
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
      lines: Array<{
        line_number: number;
        content: string;
        level?: string;
      }>;
    }>('parse_log_content', { 
      path: filePath,
      bootRegex: bootMarkerRegex,
      levelRegex: logLevelRegex
    });

    setSessions(result.sessions.map(s => ({
      id: s.id,
      startLine: s.start_line,
      endLine: s.end_line,
      bootMarker: s.boot_marker,
    })));

    setLogLines(result.lines.map(l => ({
      lineNumber: l.line_number,
      content: l.content,
      level: l.level as any,
    })));

    // 新增：打开新文件时，默认关闭“仅限所选会话”搜索
    useLogStore.setState({ 
      searchOnlySelectedSessions: false,
      selectedSessionIds: [] 
    });
  } catch (error) {
    console.error('Failed to load file:', error);
    throw error;
  }
};

export default function FileManager() {
  const files = useLogStore((state) => state.files);
  const currentFileId = useLogStore((state) => state.currentFileId);
  const removeFile = useLogStore((state) => state.removeFile);

  const handleOpenFile = useCallback(async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{
          name: 'Log Files',
          extensions: ['log', 'txt']
        }]
      });

      if (selected) {
        const filePath = typeof selected === 'string' ? selected : 
                        (Array.isArray(selected) ? selected[0] : selected);
        await loadLogFile(filePath);
      }
    } catch (error) {
      console.error('Failed to open file:', error);
    }
  }, []);

  return (
    <div className="p-4">
      <div className="mb-4">
        <button
          onClick={handleOpenFile}
          className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors font-medium"
        >
          + 打开日志文件
        </button>
      </div>

      <div className="space-y-2">
        {files.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            <p>暂无文件</p>
            <p className="text-sm mt-2">点击上方按钮打开日志文件</p>
          </div>
        ) : (
          files.map((file) => (
            <div
              key={file.id}
              onClick={() => {
                if (currentFileId !== file.id) {
                  loadLogFile(file.path);
                }
              }}
              className={`p-3 rounded-lg cursor-pointer transition-colors ${
                currentFileId === file.id
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 hover:bg-gray-700'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{file.name}</p>
                  <p className="text-xs opacity-75 mt-1">
                    {(file.size / 1024).toFixed(2)} KB · {file.lines} 行
                  </p>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFile(file.id);
                  }}
                  className="ml-2 text-red-400 hover:text-red-300 transition-colors"
                >
                  ✕
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
