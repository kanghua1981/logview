import React, { useState, useEffect, useRef } from 'react';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { useLogStore } from '../store';
import { invoke } from '@tauri-apps/api/core';

interface LogPaneProps {
  side: 'left' | 'right';
}

export default function LogPane({ side }: LogPaneProps) {
  const isLeft = side === 'left';
  
  // 选择侧相关的 Store 状态
  const filteredIndices = useLogStore((state) => isLeft ? state.filteredIndices : state.rightFilteredIndices);
  const refinementFilters = useLogStore((state) => isLeft ? state.refinementFilters : state.rightRefinementFilters);
  const scrollTargetLine = useLogStore((state) => isLeft ? state.scrollTargetLine : state.rightScrollTargetLine);
  
  const addRefinementFilter = useLogStore((state) => isLeft ? state.addRefinementFilter : state.addRightRefinementFilter);
  const removeRefinementFilter = useLogStore((state) => isLeft ? state.removeRefinementFilter : state.removeRightRefinementFilter);
  const setTransientRefinement = useLogStore((state) => isLeft ? state.setTransientRefinement : state.setRightTransientRefinement);
  const setScrollTargetLineStore = useLogStore((state) => isLeft ? state.setScrollTargetLine : state.setRightScrollTargetLine);
  
  // 共享的 Store 状态
  const lineLevels = useLogStore((state) => state.lineLevels);
  const lineContents = useLogStore((state) => state.lineContents);
  const highlights = useLogStore((state) => state.highlights);
  const fontSize = useLogStore((state) => state.fontSize);
  const timestampRegex = useLogStore((state) => state.timestampRegex);
  const flashLine = useLogStore((state) => state.flashLine); 
  const currentFileId = useLogStore((state) => state.currentFileId);
  const activeView = useLogStore((state) => state.activeView);

  // 本地搜索项
  const [localSearch, setLocalSearch] = useState('');
  const [refinementMode, setRefinementMode] = useState<'include' | 'exclude' | 'regex' | 'exact' | 'ai' | 'command' | 'time'>('include');
  const filterInputRef = useRef<HTMLInputElement>(null);

  const displayIndices = filteredIndices;

  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const rangeRef = useRef<{ startIndex: number; endIndex: number } | null>(null);
  const isProgrammaticScroll = useRef(false);
  const fetchTimeoutRef = useRef<any>(null);

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

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isInputFocused = activeEl?.tagName === 'INPUT' || activeEl?.tagName === 'TEXTAREA';
      
      if (e.key === 'Escape') {
        if (isInputFocused) {
          (activeEl as HTMLElement).blur();
          if (localSearch) {
            setLocalSearch('');
            setTransientRefinement('');
            setRefinementMode('include');
          }
          return;
        }
        if (localSearch) {
          setLocalSearch('');
          setTransientRefinement('');
          setRefinementMode('include');
        } else if (refinementFilters.length > 0) {
          removeRefinementFilter(refinementFilters.length - 1);
        }
        return;
      }

      if (activeView !== 'log' || isInputFocused || e.ctrlKey || e.metaKey || e.altKey) {
        return;
      }

      if (!isLeft) return;

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
        setRefinementMode(prev => prev === prefixKeys[e.key] ? 'include' : prefixKeys[e.key]);
        return;
      }

      if (e.key.length === 1) {
        filterInputRef.current?.focus();
        setLocalSearch(prev => {
          const newVal = prev + e.key;
          const prefix = getActiveModeInfo().prefix;
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
  }, [activeView, localSearch, refinementFilters, refinementMode, setTransientRefinement, removeRefinementFilter, isLeft]);

  useEffect(() => {
    const trimmed = localSearch.trim();
    if (refinementMode === 'command' || refinementMode === 'time' || refinementMode === 'ai' || 
        trimmed.startsWith(':') || trimmed.startsWith('@') || trimmed.startsWith('?')) {
      setTransientRefinement('');
      return;
    }
    const prefix = getActiveModeInfo().prefix;
    setTransientRefinement(localSearch ? prefix + localSearch : '');
  }, [localSearch, refinementMode]);

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
    return (curTs !== null && prevTs !== null) ? curTs - prevTs : null;
  };

  const getLevelColor = (level?: string | null) => {
    switch (level?.toUpperCase()) {
      case 'ERROR': return 'bg-red-500/10 text-red-100 hover:bg-red-500/20';
      case 'WARN': return 'bg-yellow-500/10 text-yellow-100 hover:bg-yellow-500/20';
      case 'INFO': return 'bg-blue-500/5 text-blue-50 hover:bg-blue-500/15';
      case 'DEBUG': return 'bg-gray-500/5 text-gray-400 hover:bg-gray-500/15';
      default: return 'hover:bg-gray-800/40 text-gray-300';
    }
  };

  const fetchLogs = async (startIndex: number, endIndex: number) => {
    const indicesToFetch = displayIndices.slice(startIndex, endIndex + 1);
    if (indicesToFetch.length === 0) return;
    try {
      const results = await invoke<any[]>('get_log_lines_by_indices', { indices: indicesToFetch });
      useLogStore.getState().updateLogLinesContent(results.map(r => ({
        lineNumber: r.line_number,
        content: r.content,
        level: r.level
      })));
    } catch (e) {
      console.error('Fetch logs failed:', e);
    }
  };

  useEffect(() => {
    if (scrollTargetLine !== null && virtuosoRef.current) {
      const index = displayIndices.indexOf(scrollTargetLine - 1);
      if (index !== -1) {
        isProgrammaticScroll.current = true;
        virtuosoRef.current.scrollToIndex({ index, align: 'center', behavior: 'auto' });
        setTimeout(() => {
          setScrollTargetLineStore(null);
          isProgrammaticScroll.current = false;
        }, 100);
      }
    }
  }, [scrollTargetLine, displayIndices]);

  const handleScroll = (range: { startIndex: number; endIndex: number }) => {
    rangeRef.current = range;
    if (fetchTimeoutRef.current) clearTimeout(fetchTimeoutRef.current);
    fetchTimeoutRef.current = setTimeout(() => fetchLogs(range.startIndex, range.endIndex), 50);
  };

  // 当日志索引发生变化（如加载新文件或过滤条件改变）时，立即拉取当前可见区域的内容
  useEffect(() => {
    if (currentFileId && displayIndices.length > 0) {
      const start = rangeRef.current?.startIndex || 0;
      const end = rangeRef.current?.endIndex || 50;
      fetchLogs(start, end);
    }
  }, [displayIndices, currentFileId]);

  const highlightContent = (content: string) => {
    if (!highlights.length) return content;
    let parts: (string | React.ReactNode)[] = [content];
    highlights.filter(h => h.enabled).forEach(h => {
      const newParts: (string | React.ReactNode)[] = [];
      parts.forEach(part => {
        if (typeof part !== 'string') {
          newParts.push(part);
          return;
        }
        const regex = new RegExp(`(${h.text})`, 'gi');
        const split = part.split(regex);
        split.forEach((s, i) => {
          if (s.toLowerCase() === h.text.toLowerCase()) {
            newParts.push(<mark key={`${h.id}-${i}`} style={{ backgroundColor: h.color, color: 'white', padding: '0 2px', borderRadius: '2px' }}>{s}</mark>);
          } else if (s) {
            newParts.push(s);
          }
        });
      });
      parts = newParts;
    });
    return parts;
  };

  if (!currentFileId) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-gray-500 bg-[#0d1117]">
        <div className="text-6xl mb-4">📂</div>
        <p>未打开日志文件</p>
      </div>
    );
  }

  return (
    <div className={`flex-1 flex flex-col bg-[#0d1117] h-full ${!isLeft ? 'border-l border-gray-800' : ''}`}>
      <div className="px-2 py-1.5 bg-[#161b22] border-b border-gray-800 flex flex-wrap items-center gap-1.5 min-h-[40px] shadow-sm">
        <div className="flex items-center text-gray-500 mr-2">
          <span className="text-xs font-mono px-1.5 py-0.5 bg-gray-800 rounded text-gray-400">
            {side === 'left' ? 'L' : 'R'}
          </span>
        </div>
        
        {refinementFilters.map((filter, idx) => {
          const info = getRefinementInfo(filter);
          return (
            <div key={idx} className={`flex items-center h-6 pl-1.5 pr-1 rounded-md border ${info.bg} ${info.border} ${info.color} text-xs transition-all hover:brightness-110 group`}>
              <span className="mr-1 opacity-70">{info.icon}</span>
              <span className="font-medium">{info.text}</span>
              <button 
                onClick={() => removeRefinementFilter(idx)}
                className="ml-1.5 p-0.5 rounded-sm hover:bg-black/20 opacity-40 group-hover:opacity-100 transition-opacity"
              >
                ✕
              </button>
            </div>
          );
        })}

        <div className="relative flex-1 min-w-[120px] max-w-md flex items-center">
          {localSearch === '' && (
            <div className={`absolute left-2 flex items-center pointer-events-none transition-opacity duration-200`}>
              <span className={`text-[10px] uppercase font-bold px-1 rounded mr-2 ${getActiveModeInfo().bg} ${getActiveModeInfo().color}`}>
                {getActiveModeInfo().label}
              </span>
              <span className="text-gray-600 text-xs">
                {refinementMode === 'include' ? 'Type to filter...' : 'Enter expression...'}
              </span>
            </div>
          )}
          <input
            ref={filterInputRef}
            type="text"
            className={`w-full bg-[#0d1117] text-gray-200 text-sm h-7 pl-2 pr-8 rounded border border-gray-700 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20 outline-none transition-all`}
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            onKeyDown={async (e) => {
              if (e.key === 'Enter') {
                const trimmed = localSearch.trim();
                if (!trimmed) return;
                
                const prefix = getActiveModeInfo().prefix;
                if (refinementMode === 'ai' || trimmed.startsWith('?')) {
                  const query = trimmed.startsWith('?') ? trimmed.substring(1) : trimmed;
                  useLogStore.getState().addAiMessage({ role: 'user', content: query });
                  useLogStore.getState().setAiPanelOpen(true);
                  setLocalSearch('');
                  setTransientRefinement('');
                  return;
                }
                
                if (refinementMode === 'command' || trimmed.startsWith(':')) {
                  const cmd = trimmed.startsWith(':') ? trimmed.substring(1) : trimmed;
                  const result = await processCommand(cmd, 'command');
                  if (result.success) {
                    setLocalSearch(''); setTransientRefinement(''); setRefinementMode('include');
                  } else if (result.message) {
                    alert(result.message);
                  }
                  return;
                }

                if (refinementMode === 'time' || trimmed.startsWith('@')) {
                  const time = trimmed.startsWith('@') ? trimmed.substring(1) : trimmed;
                  const result = await processCommand(time, 'time');
                  if (result.success) {
                    setLocalSearch(''); setTransientRefinement(''); setRefinementMode('include');
                  }
                  return;
                }

                addRefinementFilter(prefix + localSearch);
                setLocalSearch(''); setTransientRefinement(''); setRefinementMode('include');
              }
            }}
          />
          {localSearch && (
            <button 
              className="absolute right-2 text-gray-500 hover:text-gray-300"
              onClick={() => { setLocalSearch(''); setTransientRefinement(''); }}
            >
              ✕
            </button>
          )}
        </div>
        
        <div className="flex items-center gap-2 ml-auto text-[10px] text-gray-500">
          <span>{displayIndices.length.toLocaleString()} lines</span>
        </div>
      </div>

      <div className="flex-1 relative overflow-hidden">
        <Virtuoso
          ref={virtuosoRef}
          style={{ height: '100%' }}
          totalCount={displayIndices.length}
          rangeChanged={handleScroll}
          itemContent={(index) => {
            const originalLineIndex = displayIndices[index];
            const content = lineContents.get(originalLineIndex + 1) || 'Loading...';
            const level = lineLevels[originalLineIndex];
            const isHighlighted = flashLine === (originalLineIndex + 1);
            
            let timeDelta = null;
            if (index > 0) {
              const prevIndex = displayIndices[index - 1];
              const prevContent = lineContents.get(prevIndex + 1);
              if (prevContent) timeDelta = calculateTimeDelta(content, prevContent);
            }

            return (
              <div 
                className={`flex w-full group transition-colors duration-200 border-l-2 ${isHighlighted ? 'border-blue-500 bg-blue-500/20' : 'border-transparent'} ${getLevelColor(level)}`}
                style={{ fontSize: `${fontSize}px`, minHeight: `${fontSize + 4}px` }}
              >
                <div 
                  className="w-16 shrink-0 text-right pr-3 text-gray-600 select-none font-mono opacity-60 group-hover:opacity-100 italic flex items-center justify-end cursor-pointer hover:text-blue-400"
                  onClick={() => {
                    if (isLeft) {
                      useLogStore.getState().setRightScrollTargetLine(originalLineIndex + 1);
                    }
                  }}
                >
                  {originalLineIndex + 1}
                </div>
                <div className="flex-1 font-mono whitespace-pre break-all py-0.5 px-1 leading-tight tracking-tight selection:bg-blue-500/30">
                  {highlightContent(content)}
                </div>
                {timeDelta !== null && timeDelta > 1000 && (
                  <div className="shrink-0 px-2 flex items-center">
                    <span className="text-[10px] text-orange-500/60 font-mono">
                      +{ (timeDelta / 1000).toFixed(1) }s
                    </span>
                  </div>
                )}
              </div>
            );
          }}
        />
      </div>
    </div>
  );
}

async function processCommand(cmd: string, mode: 'command' | 'time') {
  const { processCommand: realProcessCommand } = await import('../utils/commandProcessor');
  return realProcessCommand(cmd, mode);
}
