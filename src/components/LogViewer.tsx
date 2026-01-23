import { useState, useEffect, useRef } from 'react';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { useLogStore } from '../store';
import { loadLogFile } from './FileManager';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

export default function LogViewer() {
  const filteredLines = useLogStore((state) => state.filteredLines);
  const highlights = useLogStore((state) => state.highlights);
  const scrollTargetLine = useLogStore((state) => state.scrollTargetLine);
  const fontSize = useLogStore((state) => state.fontSize);
  const showOnlyHighlights = useLogStore((state) => state.showOnlyHighlights);
  const timestampRegex = useLogStore((state) => state.timestampRegex);
  const highlightedLine = useLogStore((state) => state.flashLine); 
  
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [isDragging, setIsDragging] = useState(false);
  const lastUpdateRef = useRef(0);
  const isProgrammaticScroll = useRef(false);
  const fetchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const rangeRef = useRef<{ startIndex: number; endIndex: number } | null>(null);

  // 辅助函数：计算时间差
  const calculateTimeDelta = (current: any, previous: any) => {
    if (!previous || !current) return null;
    
    const extractTs = (content: string) => {
      const re = new RegExp(timestampRegex);
      const match = content.match(re);
      if (match) {
        // 尝试从捕获组中提取，如果没有捕获组则取匹配项
        const tsStr = match[1] || match[0];
        // 简单处理常见的 [HH:MM:SS.mmm] 或 HH:MM:SS.mmm
        const timeMatch = tsStr.match(/(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?/);
        if (timeMatch) {
          const [_, h, m, s, ms] = timeMatch;
          return (parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s)) * 1000 + (parseInt(ms || '0'));
        }
      }
      return null;
    };

    const curTs = extractTs(current.content);
    const prevTs = extractTs(previous.content);
    
    if (curTs !== null && prevTs !== null) {
      return curTs - prevTs;
    }
    return null;
  };

  // 辅助函数：根据日志级别渲染背景色
  const getLevelColor = (level?: string) => {
    switch (level?.toUpperCase()) {
      case 'ERROR': return 'bg-red-500/10 text-red-100 hover:bg-red-500/20';
      case 'WARN': return 'bg-yellow-500/10 text-yellow-100 hover:bg-yellow-500/20';
      case 'INFO': return 'bg-blue-500/5 text-blue-50 hover:bg-blue-500/15';
      case 'DEBUG': return 'bg-gray-500/5 text-gray-400 hover:bg-gray-500/15';
      default: return 'hover:bg-gray-800';
    }
  };

  // 拖拽处理逻辑
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      // 在 Tauri 中，我们需要通过路径读取。但 web input file.path 为空
      // 这里的 handleDrop 主要是为了处理浏览器原生拖拽，但在 Tauri 环境下
      // 建议监听 window-event (已经在 Rust 中实现) 或使用 @tauri-apps/api/event
    }
  };

  useEffect(() => {
    // 监听 Rust 端发出的文件拖入事件
    const unlisten = listen<{ path: string }>('file-dropped', (event) => {
      // event.payload 是路径字符串 (或者包含路径的对象)
      const path = typeof event.payload === 'string' ? event.payload : (event.payload as any).path;
      if (path) {
        loadLogFile(path);
      }
    });

    return () => {
      unlisten.then(f => f());
    };
  }, []);

  // 监听跳转请求
  useEffect(() => {
    if (scrollTargetLine !== null && filteredLines.length > 0) {
      // 找到行号对应的列表索引
      const index = filteredLines.findIndex(l => l.lineNumber === scrollTargetLine);
      if (index !== -1) {
        isProgrammaticScroll.current = true;
        virtuosoRef.current?.scrollToIndex({
          index,
          align: 'center',
          behavior: 'auto'
        });
        
        // 跳转后清除目标行，防止重新渲染时重复跳转
        // 但保留 flashLine 以维持高亮
        setTimeout(() => {
          useLogStore.setState({ scrollTargetLine: null });
        }, 100);
      }
    }
  }, [scrollTargetLine, filteredLines.length]);

  // 高性能延迟加载逻辑
  const fetchLinesData = async (startIndex: number, endIndex: number) => {
    if (filteredLines.length === 0) return;
    
    // 检查这个范围内是否已经有内容
    const needsFetch = filteredLines.slice(startIndex, endIndex + 1).some(l => !l.content);
    if (!needsFetch) return;

    // 向前向后多预加载一些
    const startLine = filteredLines[Math.max(0, startIndex - 50)].lineNumber;
    const endLine = filteredLines[Math.min(filteredLines.length - 1, endIndex + 50)].lineNumber;

    try {
      const result = await invoke<Array<{
        line_number: number;
        content: string;
        level?: string;
      }>>('get_log_range', { 
        startLine,
        endLine
      });

      if (result && result.length > 0) {
        useLogStore.getState().updateLogLinesContent(result.map(l => ({
          lineNumber: l.line_number,
          content: l.content,
          level: l.level as any,
        })));
      }
    } catch (error) {
      console.error('Lazy fetch failed:', error);
    }
  };

  const handleRangeChanged = (range: { startIndex: number; endIndex: number }) => {
    rangeRef.current = range;

    // 1. 更新当前可见行（用于同步其他面板）
    if (filteredLines.length > 0) {
      const midIndex = Math.floor((range.startIndex + range.endIndex) / 2);
      const safeIndex = Math.min(Math.max(0, midIndex), filteredLines.length - 1);
      const line = filteredLines[safeIndex];
      if (line) {
        const now = Date.now();
        if (now - lastUpdateRef.current > 100) {
          useLogStore.getState().setCurrentVisibleLine(line.lineNumber);
          lastUpdateRef.current = now;
        }
      }
    }

    // 2. 触发延迟加载（防抖处理）
    if (fetchTimeoutRef.current) clearTimeout(fetchTimeoutRef.current);
    fetchTimeoutRef.current = setTimeout(() => {
      fetchLinesData(range.startIndex, range.endIndex);
    }, 100); // 100ms 停顿后开始加载
  };

  const getLevelBadgeColor = (level: string): string => {
    switch (level.toUpperCase()) {
      case 'DEBUG': return 'bg-gray-700 text-gray-400';
      case 'INFO': return 'bg-blue-900/50 text-blue-300 border border-blue-800/30';
      case 'WARN': return 'bg-yellow-900/50 text-yellow-300 border border-yellow-800/30';
      case 'ERROR': return 'bg-red-900/50 text-red-300 border border-red-800/30';
      case 'FATAL': return 'bg-purple-900/50 text-purple-300 border border-purple-800/30';
      case 'NORM': return 'bg-green-900/40 text-green-400 border border-green-800/30';
      default: return 'bg-gray-800 text-gray-400 border border-gray-700';
    }
  };

  return (
    <div 
      className="flex-1 w-full h-full bg-gray-900 text-white overflow-hidden relative"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="absolute inset-0 bg-blue-600/20 border-4 border-dashed border-blue-400 flex items-center justify-center z-50">
          <div className="text-center">
            <p className="text-2xl mb-2 text-blue-300">📁 松开以打开日志文件</p>
            <p className="text-sm text-blue-200">支持 .log 和 .txt 文件</p>
          </div>
        </div>
      )}
      {filteredLines.length === 0 ? (
        <div className="h-full w-full flex items-center justify-center text-gray-500">
          <div className="text-center">
            <p className="text-xl mb-2">暂无日志</p>
            <p className="text-sm">该文件可能已被过滤，或者没有内容</p>
          </div>
        </div>
      ) : (
        <div className="h-full w-full">
          <Virtuoso
            ref={virtuosoRef}
            style={{ height: '100%', width: '100%' }}
            totalCount={filteredLines.length}
            rangeChanged={handleRangeChanged}
            itemContent={(index) => {
              const line = filteredLines[index];
              const prevLine = index > 0 ? filteredLines[index - 1] : null;
              const timeDelta = showOnlyHighlights ? calculateTimeDelta(line, prevLine) : null;

              const activeHighlight = highlights.find(h => 
                h.enabled && line.content.toLowerCase().includes(h.text.toLowerCase())
              );
              const isTargeted = line.lineNumber === highlightedLine;

              return (
                <div>
                  {timeDelta !== null && (
                    <div className="flex items-center px-4 py-1">
                      <div className="flex-1 h-px bg-gray-800"></div>
                      <span className="mx-4 text-[10px] font-bold text-blue-500/60 bg-blue-500/5 px-2 py-0.5 rounded-full border border-blue-500/20">
                        Δ {timeDelta >= 1000 ? `${(timeDelta / 1000).toFixed(3)}s` : `${timeDelta}ms`}
                      </span>
                      <div className="flex-1 h-px bg-gray-800"></div>
                    </div>
                  )}
                  <div 
                    className={`px-4 py-0.5 font-mono border-b border-gray-800/50 hover:bg-gray-800 flex items-start transition-all duration-300 ${getLevelColor(line.level)} ${isTargeted ? 'bg-yellow-500/30' : ''}`}
                  style={{
                    fontSize: `${fontSize}px`,
                    ...(activeHighlight ? { 
                      backgroundColor: isTargeted ? 'rgba(234, 179, 8, 0.4)' : `${activeHighlight.color}20`,
                      borderLeft: `4px solid ${isTargeted ? '#eab308' : activeHighlight.color}`
                    } : isTargeted ? {
                      borderLeft: '4px solid #eab308'
                    } : {})
                  }}
                >
                  <span className="text-gray-500 mr-4 shrink-0 w-12 text-right select-none opacity-50" style={{ fontSize: `${Math.max(10, fontSize - 2)}px` }}>
                    {line.lineNumber}
                  </span>
                  {line.level && (
                    <span 
                      className={`mr-2 px-1 rounded-[3px] font-bold shrink-0 mt-0.5 ${getLevelBadgeColor(line.level)}`}
                      style={{ fontSize: `${Math.max(8, fontSize - 4)}px` }}
                    >
                      {line.level}
                    </span>
                  )}
                  <span className={`whitespace-pre-wrap break-all ${activeHighlight ? 'font-bold' : ''}`}
                        style={activeHighlight ? { color: activeHighlight.color } : {}}>
                    {line.content || <span className="text-gray-700 italic">加载中...</span>}
                  </span>
                </div>
              </div>
            );
            }}
          />
        </div>
      )}
    </div>
  );
}
