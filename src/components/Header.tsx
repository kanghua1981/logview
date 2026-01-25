import { useRef, useEffect, useState } from 'react';
import { useLogStore } from '../store';

export default function Header() {
  const searchQuery = useLogStore((state) => state.searchQuery);
  const setSearchQuery = useLogStore((state) => state.setSearchQuery);
  const performSearch = useLogStore((state) => state.performSearch);
  const currentFileId = useLogStore((state) => state.currentFileId);
  const files = useLogStore((state) => state.files);
  const searchOnlySelectedSessions = useLogStore((state) => state.searchOnlySelectedSessions);
  const setSearchOnlySelectedSessions = useLogStore((state) => state.setSearchOnlySelectedSessions);
  const selectedSessionIds = useLogStore((state) => state.selectedSessionIds);
  const isSearchRegex = useLogStore((state) => state.isSearchRegex);
  const setSearchRegex = useLogStore((state) => state.setSearchRegex);
  const isSidebarOpen = useLogStore((state) => state.isSidebarOpen);
  const setSidebarOpen = useLogStore((state) => state.setSidebarOpen);
  const isAiPanelOpen = useLogStore((state) => state.isAiPanelOpen);
  const setAiPanelOpen = useLogStore((state) => state.setAiPanelOpen);
  
  const currentFile = files.find(f => f.id === currentFileId);
  const inputRef = useRef<HTMLInputElement>(null);
  const [showRegexHelp, setShowRegexHelp] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      performSearch();
    }
  };

  const regexTips = [
    { pattern: '\\d+', desc: '匹配数字 (如: 123)' },
    { pattern: '\\bERROR\\b', desc: '全字匹配 ERROR' },
    { pattern: 'init|start', desc: '匹配 init 或 start' },
    { pattern: '0x[0-9a-fA-F]+', desc: '匹配十六进制地址' },
    { pattern: '^ID:\\s*\\d+', desc: '以 ID: 开头的行' },
    { pattern: '\\[(.*?)\\]', desc: '匹配方括号内的内容' },
  ];

  return (
    <header className="h-14 bg-gray-800 text-white flex items-center justify-between px-4 border-b border-gray-700 relative z-50">
      <div className="flex items-center space-x-4">
        <button
          onClick={() => setSidebarOpen(!isSidebarOpen)}
          title={isSidebarOpen ? "收起侧边栏 (Ctrl+B)" : "展开侧边栏 (Ctrl+B)"}
          className={`p-1.5 rounded-md transition-colors ${isSidebarOpen ? 'text-blue-400 hover:bg-gray-700' : 'text-gray-400 hover:bg-gray-700'}`}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        <button
          onClick={() => setAiPanelOpen(!isAiPanelOpen)}
          title={isAiPanelOpen ? "关闭 AI 面板" : "打开 AI 面板 (或在过滤框输入 ?)"}
          className={`p-1.5 rounded-md transition-colors ${isAiPanelOpen ? 'text-blue-400 bg-blue-500/10' : 'text-gray-400 hover:bg-gray-700'}`}
        >
          <span className="text-lg">✨</span>
        </button>

        <div className="flex items-baseline space-x-2">
          <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-transparent">LogView</h1>
          <span className="text-[10px] font-mono text-gray-500 px-1.5 py-0.5 bg-gray-900 border border-gray-700 rounded select-none">v1.2.0</span>
        </div>
        {currentFile && (
          <div className="flex items-center space-x-2 text-sm text-gray-400">
            <span className="px-2 py-0.5 bg-gray-900 border border-gray-700 rounded text-gray-300">
              {currentFile.name}
            </span>
            <span className="opacity-60">{(currentFile.size / 1024).toFixed(1)} KB</span>
            <span className="opacity-60">{currentFile.lines} 行</span>
          </div>
        )}
      </div>

      <div className="flex items-center flex-1 max-w-2xl mx-8 space-x-4">
        <div className="relative flex-1 group flex items-center bg-gray-950 border border-gray-700 rounded-lg transition-all focus-within:border-blue-500 group-hover:border-gray-600">
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isSearchRegex ? "正则搜索..." : "输入关键词搜索... (Ctrl+F 搜索, Ctrl+H 开关结果)"}
            className="flex-1 bg-transparent px-4 py-1.5 text-sm focus:outline-none"
          />
          <div className="flex items-center pr-2 space-x-1">
            <button
              onClick={() => setSearchRegex(!isSearchRegex)}
              title="使用正则表达式"
              className={`p-1 rounded text-xs transition-colors font-mono ${isSearchRegex ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-800'}`}
            >
              .*
            </button>
            <button
              onMouseEnter={() => setShowRegexHelp(true)}
              onMouseLeave={() => setShowRegexHelp(false)}
              className="p-1 text-gray-500 hover:text-blue-400 text-xs"
            >
              ❓
            </button>
          </div>

          {/* Regex Help Tooltip */}
          {showRegexHelp && (
            <div className="absolute top-full right-0 mt-2 w-72 bg-gray-800 border border-gray-700 rounded-xl shadow-2xl p-4 transition-all z-[100]">
              <h4 className="text-xs font-bold text-blue-400 mb-2 uppercase tracking-wider">常用正则表达式</h4>
              <div className="space-y-2">
                {regexTips.map((tip, i) => (
                  <div key={i} className="flex flex-col">
                    <code className="text-[10px] text-green-400 bg-black/30 px-1 py-0.5 rounded w-fit">{tip.pattern}</code>
                    <span className="text-[10px] text-gray-400 mt-0.5">{tip.desc}</span>
                  </div>
                ))}
              </div>
              <p className="mt-3 pt-3 border-t border-gray-700 text-[9px] text-gray-500">
                提示：正则表达式默认不区分大小写。
              </p>
            </div>
          )}

          <button 
            onClick={performSearch}
            className="px-3 text-gray-500 hover:text-blue-400 transition-colors border-l border-gray-800"
          >
            🔍
          </button>
        </div>
        
        <label className="flex items-center space-x-2 cursor-pointer select-none shrink-0 group">
          <div className="relative flex items-center">
            <input
              type="checkbox"
              checked={searchOnlySelectedSessions}
              onChange={(e) => setSearchOnlySelectedSessions(e.target.checked)}
              className="sr-only"
            />
            <div className={`w-8 h-4 rounded-full transition-colors ${searchOnlySelectedSessions ? 'bg-blue-600' : 'bg-gray-700 group-hover:bg-gray-600'}`}></div>
            <div className={`absolute left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${searchOnlySelectedSessions ? 'translate-x-4' : 'translate-x-0'}`}></div>
          </div>
          <span className={`text-xs transition-colors ${searchOnlySelectedSessions ? 'text-blue-400 font-medium' : 'text-gray-500 group-hover:text-gray-400'}`}>
            仅限选中会话 ({selectedSessionIds.length})
          </span>
        </label>
      </div>

      <div className="flex items-center space-x-3">
        {/* 这里以后可以放其他工具按钮 */}
      </div>
    </header>
  );
}
