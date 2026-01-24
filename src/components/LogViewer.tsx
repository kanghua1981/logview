import { useState, useEffect, useRef } from 'react';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { useLogStore } from '../store';
import { loadLogFile } from '../utils/logLoader';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { processCommand } from '../utils/commandProcessor';
import AiSidePanel from './AiSidePanel';

export default function LogViewer() {
  const filteredIndices = useLogStore((state) => state.filteredIndices);
  const lineLevels = useLogStore((state) => state.lineLevels);
  const lineContents = useLogStore((state) => state.lineContents);
  const highlights = useLogStore((state) => state.highlights);
  const scrollTargetLine = useLogStore((state) => state.scrollTargetLine);
  const fontSize = useLogStore((state) => state.fontSize);
  const showOnlyHighlights = useLogStore((state) => state.showOnlyHighlights);
  const timestampRegex = useLogStore((state) => state.timestampRegex);
  const highlightedLine = useLogStore((state) => state.flashLine); 
  const refinementFilters = useLogStore((state) => state.refinementFilters);
  const addRefinementFilter = useLogStore((state) => state.addRefinementFilter);
  const removeRefinementFilter = useLogStore((state) => state.removeRefinementFilter);
  const setTransientRefinement = useLogStore((state) => state.setTransientRefinement);
  const currentFileId = useLogStore((state) => state.currentFileId);
  const files = useLogStore((state) => state.files);
  const currentSessionIds = useLogStore((state) => state.selectedSessionIds);
  const activeView = useLogStore((state) => state.activeView);
  const currentFile = files.find(f => f.id === currentFileId);

  // 本地搜索项
  const [localSearch, setLocalSearch] = useState('');
  const [refinementMode, setRefinementMode] = useState<'include' | 'exclude' | 'regex' | 'exact' | 'ai' | 'command' | 'time'>('include');
  const filterInputRef = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);

  // 重要：定义 displayIndices。目前它等同于 filteredIndices，
  // 因为实时搜索已经集成到了后端过滤逻辑中。
  const displayIndices = filteredIndices;

  const [isDragging, setIsDragging] = useState(false);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const rangeRef = useRef<{ startIndex: number; endIndex: number } | null>(null);
  const isProgrammaticScroll = useRef(false);
  const fetchTimeoutRef = useRef<any>(null);
  const lastUpdateRef = useRef<number>(0);
  const handleExportResult = async () => {
    setExporting(true);
    const result = await processCommand('export', 'command');
    if (!result.success && result.message) {
      alert(result.message);
    }
    setExporting(false);
  };

  const getRefinementInfo = (filter: string) => {
    if (filter.startsWith('!')) return { label: 'Exclude', text: filter.substring(1), icon: '✕', color: 'text-red-400', bg: 'bg-red-900/40', border: 'border-red-900/50' };
    if (filter.startsWith('/')) return { label: 'Regex', text: filter.substring(1), icon: '◈', color: 'text-purple-400', bg: 'bg-purple-900/40', border: 'border-purple-900/50' };
    if (filter.startsWith('=')) return { label: 'Exact', text: filter.substring(1), icon: '≡', color: 'text-emerald-400', bg: 'bg-emerald-900/40', border: 'border-emerald-900/50' };
    if (filter.startsWith('?')) return { label: 'AI', text: filter.substring(1), icon: '✨', color: 'text-blue-400', bg: 'bg-blue-900/40', border: 'border-blue-900/50' };
    if (filter.startsWith(':')) return { label: 'Command', text: filter.substring(1), icon: '⌨', color: 'text-amber-400', bg: 'bg-amber-900/40', border: 'border-amber-900/50' };
    if (filter.startsWith('@')) return { label: 'Time', text: filter.substring(1), icon: '🕒', color: 'text-cyan-400', bg: 'bg-cyan-900/40', border: 'border-cyan-900/50' };
    return { label: 'Include', text: filter, icon: '🔎', color: 'text-blue-300', bg: 'bg-blue-900/40', border: 'border-blue-700/50' };
  };

  const getActiveModeInfo = () => {
    switch (refinementMode) {
      case 'exclude': return { label: 'Exclude', color: 'text-red-400', bg: 'bg-red-500/20', prefix: '!' };
      case 'regex': return { label: 'Regex', color: 'text-purple-400', bg: 'bg-purple-500/20', prefix: '/' };
      case 'exact': return { label: 'Exact', color: 'text-emerald-400', bg: 'bg-emerald-500/20', prefix: '=' };
      case 'ai': return { label: 'AI', color: 'text-blue-400', bg: 'bg-blue-500/20', prefix: '?' };
      case 'command': return { label: 'Command', color: 'text-amber-400', bg: 'bg-amber-500/20', prefix: ':' };
      case 'time': return { label: 'Time', color: 'text-cyan-400', bg: 'bg-cyan-500/20', prefix: '@' };
      default: return { label: 'Filter', color: 'text-gray-400', bg: 'bg-gray-800', prefix: '' };
    }
  };

  // 1. 全局快捷输入监听：在日志视图下，按下任何字母/数字直接进入实时过滤
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isInputFocused = activeEl?.tagName === 'INPUT' || activeEl?.tagName === 'TEXTAREA';
      
      // A. 处理 Escape 逻辑：优先退出输入框聚焦，其次才是清除内容或后退面包屑
      if (e.key === 'Escape') {
        if (isInputFocused) {
          (activeEl as HTMLElement).blur();
          // 如果有正在正在预览的搜索内容，Esc 也会将其清空，方便用户重新选择模式
          if (localSearch) {
            setLocalSearch('');
            setTransientRefinement('');
            setRefinementMode('include');
          }
          return;
        }

        // 处于非输入状态时，Esc 作为“撤销/后退”键：先清空预览，再删除已固定的面包屑
        if (localSearch) {
          setLocalSearch('');
          setTransientRefinement('');
          setRefinementMode('include');
        } else if (refinementFilters.length > 0) {
          removeRefinementFilter(refinementFilters.length - 1);
        }
        return;
      }

      // B. 过滤掉非日志视图、已聚焦输入框或快捷键组合
      if (activeView !== 'log' || isInputFocused || e.ctrlKey || e.metaKey || e.altKey) {
        return;
      }

      // C. 处理前缀切换模式逻辑
      const prefixKeys: Record<string, typeof refinementMode> = {
        '!': 'exclude',
        '/': 'regex',
        '=': 'exact',
        '?': 'ai',
        ':': 'command',
        '@': 'time'
      };

      if (prefixKeys[e.key]) {
        e.preventDefault();
        filterInputRef.current?.focus();
        if (refinementMode === prefixKeys[e.key]) {
          setRefinementMode('include');
        } else {
          setRefinementMode(prefixKeys[e.key]);
        }
        return;
      }

      // D. 字母数字直达：聚焦并带入字符
      if (e.key.length === 1) {
        filterInputRef.current?.focus();
        setLocalSearch(prev => {
          const newVal = prev + e.key;
          const prefix = getActiveModeInfo().prefix;
          // 命令、时间、AI 模式下不触发实时过滤，亦或用户正在手动输入这些前缀，避免输入过程中视图消失
          if (refinementMode !== 'command' && refinementMode !== 'time' && refinementMode !== 'ai' && 
              !newVal.startsWith(':') && !newVal.startsWith('@') && !newVal.startsWith('?')) {
            setTransientRefinement(prefix + newVal);
          }
          return newVal;
        });
        e.preventDefault();
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [activeView, localSearch, refinementFilters, refinementMode, setTransientRefinement, removeRefinementFilter]);

  // 当 localSearch 或 mode 变化时同步到 store
  useEffect(() => {
    const trimmed = localSearch.trim();
    // 命令、时间、AI 模式是“指令型”而非“搜索型”，亦或用户正在手动输入这些前缀，均不触发实时过滤
    if (refinementMode === 'command' || refinementMode === 'time' || refinementMode === 'ai' || 
        trimmed.startsWith(':') || trimmed.startsWith('@') || trimmed.startsWith('?')) {
      setTransientRefinement('');
      return;
    }
    
    const prefix = getActiveModeInfo().prefix;
    setTransientRefinement(localSearch ? prefix + localSearch : '');
  }, [localSearch, refinementMode]);

  // 辅助函数：计算时间差
  const calculateTimeDelta = (currentContent: string, previousContent: string) => {
    if (!previousContent || !currentContent) return null;
    
    const extractTs = (content: string) => {
      const re = new RegExp(timestampRegex);
      const match = content.match(re);
      if (match) {
        const tsStr = match[1] || match[0];
        const timeMatch = tsStr.match(/(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?/);
        if (timeMatch) {
          const [_, h, m, s, ms] = timeMatch;
          return (parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s)) * 1000 + (parseInt(ms || '0'));
        }
      }
      return null;
    };

    const curTs = extractTs(currentContent);
    const prevTs = extractTs(previousContent);
    
    if (curTs !== null && prevTs !== null) {
      return curTs - prevTs;
    }
    return null;
  };

  // 辅助函数：根据日志级别渲染背景色
  const getLevelColor = (level?: string | null) => {
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
    if (scrollTargetLine !== null && displayIndices.length > 0) {
      // 找到行号对应的列表索引
      const index = displayIndices.findIndex(lineIdx => (lineIdx + 1) === scrollTargetLine);
      if (index !== -1) {
        isProgrammaticScroll.current = true;
        virtuosoRef.current?.scrollToIndex({
          index,
          align: 'center',
          behavior: 'auto'
        });
        
        setTimeout(() => {
          useLogStore.setState({ scrollTargetLine: null });
        }, 100);
      }
    }
  }, [scrollTargetLine, displayIndices]); // 使用 displayIndices 引用作为依赖

  // 当过滤索引改变（如切换 contextLines 或关键字）时，立即触发当前视图内容的抓取
  useEffect(() => {
    if (rangeRef.current && displayIndices.length > 0) {
      fetchLinesData(rangeRef.current.startIndex, rangeRef.current.endIndex);
    }
  }, [displayIndices]);

  // 高性能延迟加载逻辑优化：基于索引批量获取
  // 解决了离散行号下 IPC 通信过多或范围过大的平衡问题
  const fetchLinesData = async (startIndex: number, endIndex: number) => {
    if (displayIndices.length === 0) return;
    
    // 扩大加载范围：向前后各多加载200行，提升滚动流畅度
    const bufferSize = 200;
    const expandedStart = Math.max(0, startIndex - bufferSize);
    const expandedEnd = Math.min(displayIndices.length - 1, endIndex + bufferSize);
    
    const requestedIndices = displayIndices.slice(expandedStart, expandedEnd + 1);
    const missingIndices = requestedIndices.filter(idx => !lineContents.has(idx + 1));
    
    if (missingIndices.length === 0) return;

    try {
      // 核心优化：直接传递离散索引列表给后端
      const result = await invoke<Array<{
        line_number: number;
        content: string;
        level?: string;
      }>>('get_log_lines_by_indices', { 
        indices: missingIndices 
      });

      console.log(`Fetched ${result?.length || 0} discrete lines.`);

      if (result && result.length > 0) {
        useLogStore.getState().updateLogLinesContent(result.map(l => ({
          lineNumber: l.line_number,
          content: l.content,
          level: l.level
        })));
      }
    } catch (error) {
      console.error('Discrete fetch failed, falling back to chunked range:', error);
      
      // 备选方案：如果索引获取失败，回退到范围抓取（带 Chunking 优化）
      let currentChunk = [missingIndices[0]];
      const chunks = [];
      for (let i = 1; i < missingIndices.length; i++) {
        if (missingIndices[i] - missingIndices[i-1] < 10) {
          currentChunk.push(missingIndices[i]);
        } else {
          chunks.push(currentChunk);
          currentChunk = [missingIndices[i]];
        }
      }
      chunks.push(currentChunk);

      for (const chunk of chunks) {
        const startLine = chunk[0] + 1;
        const endLine = chunk[chunk.length - 1] + 1;
        try {
          const res = await invoke<any[]>('get_log_range', { 
            start_line: startLine, 
            end_line: endLine 
          });
          useLogStore.getState().updateLogLinesContent(res.map(l => ({
            lineNumber: l.line_number,
            content: l.content,
            level: l.level
          })));
        } catch (e) {
          console.error('Fallback fetch failed:', e);
        }
      }
    }
  };

  const handleRangeChanged = (range: { startIndex: number; endIndex: number }) => {
    rangeRef.current = range;

    // 1. 更新当前可见行（用于同步其他面板）
    if (displayIndices.length > 0) {
      const midIndex = Math.floor((range.startIndex + range.endIndex) / 2);
      const safeIndex = Math.min(Math.max(0, midIndex), displayIndices.length - 1);
      const lineIdx = displayIndices[safeIndex];
      if (lineIdx !== undefined) {
        const now = Date.now();
        if (now - lastUpdateRef.current > 100) {
          useLogStore.getState().setCurrentVisibleLine(lineIdx + 1);
          lastUpdateRef.current = now;
        }
      }
    }

    // 2. 触发延迟加载（防抖处理）
    if (fetchTimeoutRef.current) clearTimeout(fetchTimeoutRef.current);
    fetchTimeoutRef.current = setTimeout(() => {
      fetchLinesData(range.startIndex, range.endIndex);
    }, 50); // 50ms 停顿后开始加载，减少等待时间
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
    <div className="flex h-full w-full overflow-hidden">
      <div 
        className="flex-1 h-full bg-gray-900 text-white overflow-hidden relative"
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

      {/* 多级过滤器面包屑 */}
      <div className="bg-gray-900 border-b border-gray-800 px-4 py-1.5 flex items-center justify-between text-xs overflow-x-auto no-scrollbar">
        <div className="flex items-center space-x-2 shrink-0">
          <span className="text-gray-500 font-medium">当前范围：</span>
          
          {/* 一级：文件 */}
          {currentFile && (
            <div className="flex items-center bg-gray-800 text-gray-300 px-2 py-0.5 rounded border border-gray-700">
               <span className="opacity-60 mr-1 text-[10px]">📁</span>
               {currentFile.name}
            </div>
          )}

          <span className="text-gray-700">/</span>

          {/* 二级：Session */}
          {currentSessionIds.length > 0 && (
            <div className="flex items-center bg-blue-900/30 text-blue-300 px-2 py-0.5 rounded border border-blue-800/50">
               <span className="opacity-60 mr-1 text-[10px]">🔄 Session</span>
               {currentSessionIds.length === 1 ? `#${currentSessionIds[0]}` : `${currentSessionIds.length} 个`}
            </div>
          )}

          {currentSessionIds.length > 0 && <span className="text-gray-700">/</span>}

          {/* 三级：踪迹/模式 (如果有的话) */}
          {showOnlyHighlights && (
            <>
              <div className="flex items-center bg-emerald-900/30 text-emerald-300 px-2 py-0.5 rounded border border-emerald-800/50">
                 <span className="opacity-60 mr-1 text-[10px]">🎯</span>
                 踪迹模式
              </div>
              {refinementFilters.length > 0 && <span className="text-gray-700">/</span>}
            </>
          )}

          {/* 四级及以上：精细过滤器 */}
          {refinementFilters.map((filter, idx) => {
            const info = getRefinementInfo(filter);
            return (
              <div key={idx} className="flex items-center space-x-1">
                <div className={`group flex items-center ${info.bg} ${info.color} px-2 py-0.5 rounded border ${info.border} hover:border-blue-500/50 transition-colors`}>
                  <span className="opacity-60 mr-1 text-[10px]">{info.icon}</span>
                  {info.text}
                  <button 
                    onClick={() => removeRefinementFilter(idx)}
                    className="ml-1.5 opacity-40 hover:opacity-100 hover:text-red-400 font-bold transition-all"
                  >
                    ×
                  </button>
                </div>
                {idx < refinementFilters.length - 1 && <span className="text-gray-700">/</span>}
              </div>
            );
          })}
        </div>

        <div className="flex items-center ml-4 relative min-w-[240px] flex-1 max-w-md">
          <div className={`absolute left-2 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase transition-all flex items-center ${getActiveModeInfo().bg} ${getActiveModeInfo().color}`}>
            {getActiveModeInfo().label}
          </div>
          <input
            ref={filterInputRef}
            type="text"
            placeholder={
              refinementMode === 'include' ? "输入并回车锁定..." : 
              refinementMode === 'command' ? "输入命令 (如: :top, :500, :export)..." :
              refinementMode === 'time' ? "输入时间戳跳转 (如: @10:30:05)..." :
              `正在使用 ${refinementMode} 模式...`
            }
            value={localSearch}
            onChange={(e) => {
              const val = e.target.value;
              setLocalSearch(val);
            }}
            onKeyDown={async (e) => {
              if (e.key === 'Enter' && localSearch.trim()) {
                const trimmedInput = localSearch.trim();
                let targetMode = refinementMode;
                let finalInput = trimmedInput;

                // 自动识别前缀输入，即使用户没有通过快捷键切换模式
                if (trimmedInput.startsWith(':')) {
                  targetMode = 'command';
                  finalInput = trimmedInput.substring(1);
                } else if (trimmedInput.startsWith('@')) {
                  targetMode = 'time';
                  finalInput = trimmedInput.substring(1);
                } else if (trimmedInput.startsWith('!')) {
                  targetMode = 'exclude';
                  finalInput = trimmedInput.substring(1);
                } else if (trimmedInput.startsWith('/')) {
                  targetMode = 'regex';
                  finalInput = trimmedInput.substring(1);
                } else if (trimmedInput.startsWith('=')) {
                  targetMode = 'exact';
                  finalInput = trimmedInput.substring(1);
                } else if (trimmedInput.startsWith('?')) {
                  targetMode = 'ai';
                  finalInput = trimmedInput.substring(1);
                }

                if (targetMode === 'command' || targetMode === 'time' || targetMode === 'ai') {
                  const result = await processCommand(finalInput, targetMode);
                  if (result.success) {
                    setLocalSearch('');
                    setRefinementMode('include');
                  } else if (result.message) {
                    alert(result.message);
                  }
                } else {
                  // 对于过滤模式，依然遵循之前的逻辑，但会自动剥离手动输入的重复前缀
                  const prefix = getActiveModeInfo().prefix;
                  // 如果手动输入了前缀且与当前模式一致，或者处于 include 模式但输入了前缀
                  addRefinementFilter(
                    (targetMode !== 'include' && !trimmedInput.startsWith(prefix)) 
                    ? prefix + finalInput 
                    : trimmedInput
                  );
                  setLocalSearch('');
                  setRefinementMode('include');
                }
              }
            }}
            className="w-full bg-gray-950 border border-gray-800 rounded-full pl-20 pr-8 py-1 text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500/50 placeholder-gray-700 transition-all"
          />
          {localSearch && (
            <button 
              onClick={() => {
                setLocalSearch('');
                setRefinementMode('include');
              }}
              className="absolute right-3 top-1.5 text-gray-500 hover:text-white"
            >
              ✕
            </button>
          )}
        </div>

        <div className="ml-4 shrink-0 text-gray-500 flex items-center space-x-3">
           <button
             onClick={handleExportResult}
             disabled={exporting || displayIndices.length === 0}
             title="导出当前过滤结果"
             className={`p-1.5 rounded transition-colors ${
               exporting || displayIndices.length === 0 
               ? 'text-gray-700 cursor-not-allowed' 
               : 'text-gray-400 hover:text-emerald-400 hover:bg-gray-800'
             }`}
           >
             {exporting ? (
               <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                 <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                 <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
               </svg>
             ) : (
               <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
               </svg>
             )}
           </button>
           <span className="font-mono bg-gray-800 px-2 py-0.5 rounded text-[10px]">
             {displayIndices.length} / {filteredIndices.length} 行
           </span>
        </div>
      </div>

      {displayIndices.length === 0 ? (
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
            totalCount={displayIndices.length}
            overscan={300}
            increaseViewportBy={{ top: 800, bottom: 800 }}
            rangeChanged={handleRangeChanged}
            itemContent={(index) => {
              const lineIdx = displayIndices[index];
              const lineNumber = lineIdx + 1;
              const level = lineLevels[lineIdx];
              const content = lineContents.get(lineNumber) || "";

              const prevLineIdx = index > 0 ? displayIndices[index - 1] : null;
              const prevContent = prevLineIdx !== null ? lineContents.get(prevLineIdx + 1) : null;
              
              const timeDelta = (showOnlyHighlights && content && prevContent) 
                ? calculateTimeDelta(content, prevContent) 
                : null;

              const activeHighlight = highlights.find(h => 
                h.enabled && content && content.toLowerCase().includes(h.text.toLowerCase())
              );
              const isTargeted = lineNumber === highlightedLine;

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
                    className={`px-4 py-0.5 font-mono border-b border-gray-800/50 hover:bg-gray-800 flex items-start transition-all duration-300 ${getLevelColor(level)} ${isTargeted ? 'bg-yellow-500/30' : ''}`}
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
                      {lineNumber}
                    </span>
                    {level && (
                      <span 
                        className={`mr-2 px-1 rounded-[3px] font-bold shrink-0 mt-0.5 ${getLevelBadgeColor(level)}`}
                        style={{ fontSize: `${Math.max(8, fontSize - 4)}px` }}
                      >
                        {level}
                      </span>
                    )}
                    <span className={`whitespace-pre-wrap break-all ${activeHighlight ? 'font-bold' : ''}`}
                          style={activeHighlight ? { color: activeHighlight.color } : {}}>
                      {content || <span className="text-gray-700 italic">加载中...</span>}
                    </span>
                  </div>
                </div>
              );
            }}
          />
        </div>
      )}
      </div>
      <AiSidePanel />
    </div>
  );
}
