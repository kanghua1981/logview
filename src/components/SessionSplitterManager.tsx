import { useState } from 'react';
import { useLogStore } from '../store';
import { invoke } from '@tauri-apps/api/core';

export default function SessionSplitterManager() {
  const {
    sessionSplitters,
    activeSessionMode,
    currentFileId,
    files,
    addSessionSplitter,
    removeSessionSplitter,
    toggleSessionSplitter,
    setActiveSessionMode,
    setSessions,
    setLogLines
  } = useLogStore();

  const [newName, setNewName] = useState('');
  const [newRegex, setNewRegex] = useState('');
  const [isRegexMode, setIsRegexMode] = useState(false); // 默认简单匹配
  const [isApplying, setIsApplying] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const currentFile = files.find(f => f.id === currentFileId);

  // 辅助函数：转义正则特殊字符
  const escapeRegex = (string: string) => {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  };

  const handleAdd = () => {
    if (newName && newRegex) {
      addSessionSplitter(newName, newRegex, isRegexMode);
      setNewName('');
      setNewRegex('');
    }
  };

  const handleApply = async () => {
    if (!currentFile) return;
    
    setIsApplying(true);
    try {
      // 获取所有启用的分割器，如果是简单匹配则转义
      const enabledRegexes = sessionSplitters
        .filter(s => s.enabled)
        .map(s => s.isRegex ? s.regex : escapeRegex(s.regex));

      if (enabledRegexes.length === 0 && activeSessionMode === 'custom') {
        alert('请至少启用一个分割器');
        setIsApplying(false);
        return;
      }

      // 调用后端重新解析
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
      }>('parse_log_with_custom_splitters', {
        path: currentFile.path,
        splitterRegexes: activeSessionMode === 'boot' 
          ? [useLogStore.getState().bootMarkerRegex] 
          : enabledRegexes,
        levelRegex: useLogStore.getState().logLevelRegex
      });

      setSessions(result.sessions.map(s => ({
        id: s.id,
        startLine: s.start_line,
        endLine: s.end_line,
        bootMarker: s.boot_marker,
        splitType: activeSessionMode === 'boot' ? 'boot' : 'custom'
      })));

      setLogLines(result.lines.map(l => ({
        lineNumber: l.line_number,
        content: l.content,
        level: l.level as any,
      })));
    } catch (error) {
      console.error('Failed to apply splitters:', error);
      alert('应用失败: ' + error);
    } finally {
      setIsApplying(false);
    }
  };

  const commonPatterns = [
    { name: '系统', regex: '(?i)(boot|reboot|restart|startup)' },
    { name: 'HTTP', regex: '(?i)(GET|POST|PUT|DELETE)\\s+/\\w+' },
    { name: '错误', regex: '(?i)(ERROR|FATAL|Exception)' },
    { name: '测试', regex: '(?i)(test_|Test case:)' },
    { name: '函数', regex: '--> \\w+\\(' },
  ];

  return (
    <div className="border-b border-gray-700 bg-gray-900/50">
      <div 
        className="p-3 flex items-center justify-between cursor-pointer hover:bg-gray-800 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center space-x-2">
          <span className="text-lg">🛠️</span>
          <span className="text-sm font-semibold text-gray-300">会话分割设置</span>
        </div>
        <div className="flex items-center space-x-3">
          {currentFile && !isExpanded && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleApply();
              }}
              disabled={isApplying}
              className="px-2 py-0.5 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 text-[10px] text-white rounded transition-colors"
            >
              {isApplying ? '...' : '快速应用'}
            </button>
          )}
          <span className={`text-xs text-gray-500 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}>
            ▼
          </span>
        </div>
      </div>

      {isExpanded && (
        <div className="p-4 pt-0 space-y-4 max-h-[60vh] overflow-y-auto">
          {/* 模式切换 */}
          <div className="bg-gray-800 p-3 rounded-lg border border-gray-700">
            <div className="flex space-x-2">
              <button
                onClick={() => setActiveSessionMode('boot')}
                className={`flex-1 py-1.5 px-3 rounded text-xs font-medium transition-all ${
                  activeSessionMode === 'boot'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                }`}
              >
                Boot 模式
              </button>
              <button
                onClick={() => setActiveSessionMode('custom')}
                className={`flex-1 py-1.5 px-3 rounded text-xs font-medium transition-all ${
                  activeSessionMode === 'custom'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                }`}
              >
                自定义模式
              </button>
            </div>
          </div>

          {activeSessionMode === 'custom' ? (
            <>
              {/* 添加新分割器 */}
              <div className="bg-gray-800/50 p-3 rounded-lg border border-gray-700 space-y-2">
                <input
                  type="text"
                  placeholder="分割器名称"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full px-2 py-1.5 bg-gray-700 text-white rounded border border-gray-600 focus:border-blue-500 outline-none text-xs"
                />
                <input
                  type="text"
                  placeholder={isRegexMode ? "正则表达式" : "匹配关键字"}
                  value={newRegex}
                  onChange={(e) => setNewRegex(e.target.value)}
                  className="w-full px-2 py-1.5 bg-gray-700 text-white rounded border border-gray-600 focus:border-blue-500 outline-none text-xs font-mono"
                />
                <div className="flex items-center justify-between">
                  <label className="flex items-center space-x-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isRegexMode}
                      onChange={(e) => setIsRegexMode(e.target.checked)}
                      className="w-3 h-3 rounded bg-gray-700 border-gray-600 text-blue-500 focus:ring-0"
                    />
                    <span className="text-[10px] text-gray-400">正则模式</span>
                  </label>
                  <button
                    onClick={handleAdd}
                    disabled={!newName || !newRegex}
                    className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 text-white rounded text-xs font-medium transition-colors"
                  >
                    添加
                  </button>
                </div>

                <div className="flex flex-wrap gap-1.5 pt-2 border-t border-gray-700">
                  {commonPatterns.map((pattern, idx) => (
                    <button
                      key={idx}
                      onClick={() => {
                        setNewName(pattern.name);
                        setNewRegex(pattern.regex);
                        setIsRegexMode(true);
                      }}
                      className="px-2 py-0.5 bg-gray-700 hover:bg-gray-600 text-gray-400 rounded text-[10px] transition-colors"
                    >
                      {pattern.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* 分割器列表 */}
              <div className="space-y-1.5">
                <div className="flex justify-between items-center px-1">
                  <span className="text-[10px] uppercase text-gray-500 font-bold">已启用分割器</span>
                  <button
                    onClick={handleApply}
                    disabled={isApplying || !currentFile}
                    className="text-[10px] text-green-400 hover:text-green-300 font-bold"
                  >
                    {isApplying ? '正在应用...' : '应用变更'}
                  </button>
                </div>
                <div className="space-y-1">
                  {sessionSplitters.map((splitter) => (
                    <div
                      key={splitter.id}
                      className={`group p-2 rounded-md border transition-all ${
                        splitter.enabled
                          ? 'bg-gray-800 border-gray-700'
                          : 'bg-gray-900 border-gray-800 opacity-40'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2 min-w-0">
                          <input
                            type="checkbox"
                            checked={splitter.enabled}
                            onChange={() => toggleSessionSplitter(splitter.id)}
                            className="w-3 h-3 rounded"
                          />
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-gray-200 truncate">{splitter.name}</p>
                            <p className="text-[10px] text-gray-500 truncate font-mono">{splitter.regex}</p>
                          </div>
                        </div>
                        <button
                          onClick={() => removeSessionSplitter(splitter.id)}
                          className="opacity-0 group-hover:opacity-100 p-1 text-gray-500 hover:text-red-400 transition-all"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="bg-gray-800 p-3 rounded-lg border border-gray-700 space-y-3">
              <p className="text-xs text-gray-400">目前使用配置中的 Boot 标识符进行分割。</p>
              <button
                onClick={handleApply}
                disabled={isApplying || !currentFile}
                className="w-full py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-medium"
              >
                重新识别 Boot 会话
              </button>
            </div>
          )}
          
          {!currentFile && (
            <p className="text-center text-[10px] text-yellow-500/80">
              请先打开文件以应用设置
            </p>
          )}
        </div>
      )}
    </div>
  );
}
