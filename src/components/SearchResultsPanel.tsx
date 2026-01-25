import { useLogStore, LogLine } from '../store';
import { Virtuoso } from 'react-virtuoso';
import { useState, useEffect } from 'react';

export default function SearchResultsPanel() {
  const searchResults = useLogStore((state) => state.searchResults);
  const searchQuery = useLogStore((state) => state.searchQuery);
  const isSearchPanelOpen = useLogStore((state) => state.isSearchPanelOpen);
  const setSearchPanelOpen = useLogStore((state) => state.setSearchPanelOpen);
  const searchPanelHeight = useLogStore((state) => state.searchPanelHeight);
  const setSearchPanelHeight = useLogStore((state) => state.setSearchPanelHeight);
  const setScrollTargetLine = useLogStore((state) => state.setScrollTargetLine);
  const setActiveView = useLogStore((state) => state.setActiveView);
  const fontSize = useLogStore((state) => state.fontSize);
  const searchOnlySelectedSessions = useLogStore((state) => state.searchOnlySelectedSessions);
  const selectedSessionIds = useLogStore((state) => state.selectedSessionIds);
  const isSearchRegex = useLogStore((state) => state.isSearchRegex);

  const [isResizing, setIsResizing] = useState(false);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const newHeight = Math.max(150, Math.min(window.innerHeight * 0.7, window.innerHeight - e.clientY));
      setSearchPanelHeight(newHeight);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'row-resize';
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'default';
    };
  }, [isResizing, setSearchPanelHeight]);

  if (!isSearchPanelOpen) return null;

  const handleResultClick = (line: LogLine) => {
    setActiveView('log');
    // 使用 setTimeout 确保视图切换后再触发跳转
    setTimeout(() => {
      setScrollTargetLine(line.lineNumber);
    }, 50);
  };

  const highlightMatch = (content: string, query: string) => {
    if (!query) return content;
    try {
      const regex = new RegExp(`(${isSearchRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
      const parts = content.split(regex);
      return parts.map((part, i) => (
        regex.test(part) ? (
          <mark key={i} className="bg-yellow-500/40 text-yellow-100 rounded-px px-0.5">{part}</mark>
        ) : part
      ));
    } catch (e) {
      return content;
    }
  };

  return (
    <div 
      className="relative bg-gray-900 border-t border-gray-700 flex flex-col z-40 select-none"
      style={{ height: `${searchPanelHeight}px` }}
    >
      {/* Resizer Handle (Top Side) */}
      <div
        onMouseDown={handleMouseDown}
        className={`absolute top-0 left-0 right-0 h-1 cursor-row-resize z-50 hover:bg-blue-500/50 transition-colors ${isResizing ? 'bg-blue-500 h-1' : ''}`}
      />

      <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700">
        <div className="flex items-center space-x-4">
          <span className="text-sm font-semibold text-gray-300">
            搜索结果: <span className="text-blue-400">"{searchQuery}"</span>
          </span>
          {searchOnlySelectedSessions && (
            selectedSessionIds.length > 0 ? (
              <span className="px-2 py-0.5 bg-blue-900/40 text-blue-400 text-[10px] rounded border border-blue-800/50">
                范围: 已选会话 ({selectedSessionIds.length})
              </span>
            ) : (
              <span className="px-2 py-0.5 bg-yellow-900/20 text-yellow-500 text-[10px] rounded border border-yellow-800/30 flex items-center space-x-1">
                <span>⚠️</span>
                <span>未选会话，正在全局搜索</span>
              </span>
            )
          )}
          <span className="text-xs text-gray-500">
            共找到 {searchResults.length} 处匹配
          </span>
        </div>
        <button 
          onClick={() => setSearchPanelOpen(false)}
          className="text-gray-400 hover:text-white transition-colors"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-hidden">
        {searchResults.length === 0 ? (
          <div className="h-full flex items-center justify-center text-gray-500 text-sm italic">
            没有找到匹配项
          </div>
        ) : (
          <Virtuoso
            style={{ height: '100%' }}
            totalCount={searchResults.length}
            itemContent={(index) => {
              const line = searchResults[index];
              return (
                <div 
                  onClick={() => handleResultClick(line)}
                  className="px-4 py-1.5 border-b border-gray-800/50 hover:bg-blue-600/10 cursor-pointer group flex items-start font-mono transition-colors"
                  style={{ fontSize: `${fontSize}px` }}
                >
                  <span className="text-gray-500 mr-4 shrink-0 w-12 text-right group-hover:text-blue-400 transition-colors" style={{ fontSize: `${Math.max(10, fontSize - 2)}px` }}>
                    {line.lineNumber}
                  </span>
                  <span className="text-gray-300 whitespace-pre-wrap break-all leading-relaxed">
                    {highlightMatch(line.content, searchQuery)}
                  </span>
                </div>
              );
            }}
          />
        )}
      </div>
    </div>
  );
}

