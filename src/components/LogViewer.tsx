import { useState, useEffect, useRef } from 'react';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { useLogStore } from '../store';
import { loadLogFile } from './FileManager';
import { listen } from '@tauri-apps/api/event';

export default function LogViewer() {
  const filteredLines = useLogStore((state) => state.filteredLines);
  const highlights = useLogStore((state) => state.highlights);
  const scrollTargetLine = useLogStore((state) => state.scrollTargetLine);
  
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [highlightedLine, setHighlightedLine] = useState<number | null>(null);

  // 处理跳转逻辑
  useEffect(() => {
    if (scrollTargetLine !== null && virtuosoRef.current) {
      // 稍微延迟确保 Virtuoso 已渲染
      const timer = setTimeout(() => {
        const index = filteredLines.findIndex(l => l.lineNumber === scrollTargetLine);
        if (index !== -1) {
          virtuosoRef.current?.scrollToIndex({
            index,
            align: 'center',
            behavior: 'auto'
          });
          setHighlightedLine(scrollTargetLine);
          useLogStore.getState().setScrollTargetLine(null);
          
          // 3秒后取消行高亮
          setTimeout(() => setHighlightedLine(null), 3000);
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [scrollTargetLine, filteredLines]);

  // 监听来自 Rust 的文件拖放事件
  useEffect(() => {
    let active = true;
    let unlistenFn: (() => void) | null = null;
    
    const setupListener = async () => {
      const unlisten = await listen<string>('file-dropped', async (event) => {
        const filePath = event.payload;
        try {
          await loadLogFile(filePath);
        } catch (error) {
          console.error('Failed to load dropped file:', error);
        }
      });
      
      if (!active) {
        unlisten();
      } else {
        unlistenFn = unlisten;
      }
    };

    setupListener();

    return () => {
      active = false;
      if (unlistenFn) {
        unlistenFn();
      }
    };
  }, []);

  const getLevelColor = (level?: string): string => {
    switch (level) {
      case 'DEBUG': return 'text-gray-400';
      case 'INFO': return 'text-blue-400';
      case 'WARN': return 'text-yellow-400';
      case 'ERROR': return 'text-orange-400';
      case 'FATAL': return 'text-red-500 font-bold';
      default: return 'text-gray-300';
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      const file = files[0];
      // Tauri 中可以直接使用 file.path
      const filePath = (file as any).path;
      if (filePath) {
        try {
          await loadLogFile(filePath);
        } catch (error) {
          console.error('Failed to load dropped file:', error);
        }
      }
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
            itemContent={(index) => {
              const line = filteredLines[index];
              const activeHighlight = highlights.find(h => 
                h.enabled && line.content.toLowerCase().includes(h.text.toLowerCase())
              );
              const isTargeted = line.lineNumber === highlightedLine;

              return (
                <div 
                  className={`px-4 py-0.5 font-mono text-xs border-b border-gray-800/50 hover:bg-gray-800 flex items-start transition-all duration-300 ${getLevelColor(line.level)} ${isTargeted ? 'bg-yellow-500/30' : ''}`}
                  style={activeHighlight ? { 
                    backgroundColor: isTargeted ? 'rgba(234, 179, 8, 0.4)' : `${activeHighlight.color}20`,
                    borderLeft: `4px solid ${isTargeted ? '#eab308' : activeHighlight.color}`
                  } : isTargeted ? {
                    borderLeft: '4px solid #eab308'
                  } : {}}
                >
                  <span className="text-gray-500 mr-4 shrink-0 w-12 text-right select-none opacity-50">
                    {line.lineNumber}
                  </span>
                  {line.level && (
                    <span className={`mr-2 px-1 rounded-[3px] text-[10px] font-bold shrink-0 mt-0.5 ${getLevelBadgeColor(line.level)}`}>
                      {line.level}
                    </span>
                  )}
                  <span className={`whitespace-pre-wrap break-all ${activeHighlight ? 'font-bold' : ''}`}
                        style={activeHighlight ? { color: activeHighlight.color } : {}}>
                    {line.content}
                  </span>
                </div>
              );
            }}
          />
        </div>
      )}
    </div>
  );
}

function getLevelBadgeColor(level: string): string {
  switch (level.toUpperCase()) {
    case 'DEBUG': return 'bg-gray-700 text-gray-400';
    case 'INFO': return 'bg-blue-900/50 text-blue-300 border border-blue-800/30';
    case 'WARN': return 'bg-yellow-900/50 text-yellow-300 border border-yellow-800/30';
    case 'ERROR': return 'bg-red-900/50 text-red-300 border border-red-800/30';
    case 'FATAL': return 'bg-purple-900/50 text-purple-300 border border-purple-800/30';
    case 'NORM': return 'bg-green-900/40 text-green-400 border border-green-800/30';
    default: return 'bg-gray-800 text-gray-400 border border-gray-700';
  }
}
