import { useState, useMemo } from 'react';
import { useLogStore } from '../store';
import { save, open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';

export default function KeyPathTracker() {
  const { 
    highlights, 
    showOnlyHighlights, 
    highlightContextLines,
    lineContents,
    addHighlight, 
    removeHighlight, 
    toggleHighlight, 
    setShowOnlyHighlights,
    setHighlightContextLines,
    setScrollTargetLine,
    exportHighlights,
    importHighlights,
    filteredIndices,
    refinementFilters,
    addRefinementFilter,
    removeRefinementFilter,
    setTransientRefinement
  } = useLogStore();

  const [exporting, setExporting] = useState(false);

  const [input, setInput] = useState('');
  const [refinementInput, setRefinementInput] = useState('');

  // 计算每个关键字的出现次数和行号 (仅基于当前缓存的行)
  const highlightStats = useMemo(() => {
    const stats: Record<string, number[]> = {};
    highlights.forEach(h => {
      stats[h.id] = [];
    });

    // 性能优化：仅统计已加载出的内容
    lineContents.forEach((content, lineNumber) => {
      const lowerContent = content.toLowerCase();
      highlights.forEach(h => {
        if (lowerContent.includes(h.text.toLowerCase())) {
          stats[h.id].push(lineNumber);
        }
      });
    });
    
    // 对行号排序
    Object.values(stats).forEach(arr => arr.sort((a, b) => a - b));
    return stats;
  }, [lineContents, highlights]);

  const handleAdd = () => {
    if (input.trim()) {
      addHighlight(input.trim());
      setInput('');
    }
  };

  const scrollToOccurrence = (id: string, direction: 'next' | 'prev') => {
    const lineNumbers = highlightStats[id];
    if (!lineNumbers || lineNumbers.length === 0) return;

    // 直接从 store 获取当前滚动到的行
    const store = useLogStore.getState();
    const currentPos = store.currentVisibleLine || 0;
    
    let target;
    if (direction === 'next') {
      // 找第一个严格大于当前位置的
      target = lineNumbers.find(ln => ln > currentPos);
      if (target === undefined) target = lineNumbers[0]; // 回绕
    } else {
      // 找第一个严格小于当前位置的（从后往前找）
      const reversed = [...lineNumbers].reverse();
      target = reversed.find(ln => ln < currentPos);
      if (target === undefined) target = lineNumbers[lineNumbers.length - 1]; // 回绕
    }
    
    if (target !== undefined) {
      // 关键：立即更新 store 中的当前行，防止连续快速点击时逻辑失效
      store.setCurrentVisibleLine(target);
      setScrollTargetLine(target);
    }
  };

  const handleExport = async () => {
    try {
      const json = exportHighlights();
      const path = await save({
        filters: [{ name: 'Log Trace Config', extensions: ['json'] }],
        defaultPath: 'my_traces.json'
      });
      if (path) {
        await invoke('write_config_file', { path, content: json });
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleImport = async () => {
    try {
      const path = await open({
        filters: [{ name: 'Log Trace Config', extensions: ['json'] }],
        multiple: false
      });
      if (path && typeof path === 'string') {
        const content = await invoke<string>('read_config_file', { path });
        importHighlights(content);
      }
    } catch (e) {
      console.error(e);
    }
  };
  const handleExportResult = async () => {
    if (filteredIndices.length === 0) return;
    
    try {
      setExporting(true);
      const path = await save({
        filters: [{ name: 'Log File', extensions: ['log', 'txt'] }],
        defaultPath: `trace_result_${new Date().getTime()}.log`
      });

      if (path) {
        await invoke('save_filtered_logs', { 
          path, 
          indices: filteredIndices 
        });
        alert('导出成功！');
      }
    } catch (e) {
      console.error(e);
      alert('导出失败: ' + e);
    } finally {
      setExporting(false);
    }
  };
  return (
    <div className="p-4 space-y-4 select-none">
      <div className="flex flex-col space-y-3">
        <div className="flex items-center justify-between border-b border-gray-800 pb-2">
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">关键路径跟踪</h3>
          <div className="flex items-center space-x-1">
            <button 
              onClick={handleExportResult}
              disabled={exporting || filteredIndices.length === 0}
              title="导出当前过滤后的追踪结果日志"
              className={`px-3 py-1.5 text-xs rounded border transition-colors flex items-center space-x-2 ${
                exporting || filteredIndices.length === 0
                ? 'bg-gray-800 text-gray-600 border-gray-800 cursor-not-allowed'
                : 'bg-emerald-900/30 text-emerald-400 border-emerald-800/50 hover:bg-emerald-800/50'
              }`}
            >
              <svg className={`w-3.5 h-3.5 ${exporting ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {exporting ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                )}
              </svg>
              <span>{exporting ? '导出中...' : '导出结果'}</span>
            </button>
            <div className="w-[1px] h-4 bg-gray-700 mx-1"></div>
            <button 
              onClick={handleExport}
              title="导出追踪方案"
              className="px-3 py-1.5 text-xs bg-gray-800 text-gray-400 hover:text-blue-400 hover:bg-gray-700 rounded border border-gray-700 transition-colors"
            >
              配置导出
            </button>
            <button 
              onClick={handleImport}
              title="导入追踪方案"
              className="px-3 py-1.5 text-xs bg-gray-800 text-gray-400 hover:text-blue-400 hover:bg-gray-700 rounded border border-gray-700 transition-colors"
            >
              方案恢复
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between bg-gray-800/30 p-3 rounded-lg border border-gray-700/30">
          <div className="flex items-center space-x-4">
            <label className="flex items-center space-x-3 cursor-pointer group">
              <span className="text-xs text-gray-500 group-hover:text-gray-400 transition-colors">上下文轮廓</span>
              <input
                type="number"
                min="0"
                max="100"
                value={highlightContextLines}
                onChange={(e) => setHighlightContextLines(parseInt(e.target.value) || 0)}
                className="w-14 px-2 py-1.5 bg-gray-900 text-blue-400 rounded-md border border-gray-700 focus:border-blue-500 focus:outline-none text-xs text-center font-bold"
              />
            </label>
          </div>
          
          <label className="flex items-center space-x-3 cursor-pointer group">
            <span className="text-xs text-gray-500 group-hover:text-gray-400 transition-colors">脱水模式</span>
            <div className="relative inline-flex items-center">
              <input
                type="checkbox"
                checked={showOnlyHighlights}
                onChange={(e) => setShowOnlyHighlights(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-10 h-5 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-5 rtl:peer-checked:after:-translate-x-5 peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
            </div>
          </label>
        </div>
      </div>

      <div className="flex flex-col space-y-2">
        <label className="text-[10px] font-bold text-gray-600 uppercase">1. 定义踪迹 (OR)</label>
        <div className="flex space-x-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder="输入关键字..."
            className="flex-1 px-3 py-2 bg-gray-800 text-white rounded-lg border border-gray-700 focus:border-blue-500 focus:outline-none text-sm"
          />
          <button
            onClick={handleAdd}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors text-sm font-medium"
          >
            添加
          </button>
        </div>
      </div>

      <div className="flex flex-col space-y-2 pt-2 border-t border-gray-800/50">
        <label className="text-[10px] font-bold text-gray-500 uppercase">2. 级联精简 (AND)</label>
        <div className="flex space-x-2">
          <input
            type="text"
            value={refinementInput}
            onChange={(e) => {
              const val = e.target.value;
              setRefinementInput(val);
              setTransientRefinement(val);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && refinementInput.trim()) {
                addRefinementFilter(refinementInput.trim());
                setRefinementInput('');
                setTransientRefinement('');
              }
            }}
            placeholder="进一步缩小范围..."
            className="flex-1 px-3 py-2 bg-gray-900/50 text-white rounded-lg border border-gray-700/50 focus:border-blue-500/50 focus:outline-none text-sm placeholder:text-gray-600"
          />
          <button
            onClick={() => {
              if (refinementInput.trim()) {
                addRefinementFilter(refinementInput.trim());
                setRefinementInput('');
                setTransientRefinement('');
              }
            }}
            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-blue-400 rounded-lg transition-colors text-sm border border-gray-700"
          >
            追加
          </button>
        </div>

        {/* 精简器列表 */}
        {refinementFilters.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {refinementFilters.map((filter, idx) => (
              <div key={idx} className="flex items-center bg-blue-900/20 text-blue-400 px-2 py-1 rounded-md border border-blue-800/30 text-[11px] group">
                <span className="opacity-50 mr-1">🔍</span>
                {filter}
                <button 
                  onClick={() => removeRefinementFilter(idx)}
                  className="ml-2 hover:text-red-400"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="pt-2 border-t border-gray-800/50">
        <label className="text-[10px] font-bold text-gray-600 uppercase mb-2 block">已添加的踪迹关键字</label>
        <div className="space-y-2">
        {highlights.length === 0 ? (
          <p className="text-center text-gray-600 text-xs py-4 italic">
            添加关键字，通过不同颜色梳理复杂流程
          </p>
        ) : (
          highlights.map((h) => (
            <div
              key={h.id}
              className="group flex flex-col p-2 bg-gray-800/40 rounded-lg border border-gray-700/50 hover:bg-gray-800 transition-colors"
            >
              <div className="flex items-center justify-between mb-1 min-w-0">
                <div 
                  className="flex items-center space-x-2 flex-1 cursor-pointer min-w-0"
                  onClick={() => toggleHighlight(h.id)}
                >
                  <div 
                    className={`w-3 h-3 rounded-full flex-shrink-0 ${h.enabled ? '' : 'opacity-20 grayscale'}`} 
                    style={{ backgroundColor: h.color }}
                  />
                  <span className={`text-sm truncate font-mono ${h.enabled ? 'text-gray-200' : 'text-gray-600 line-through'}`}>
                    {h.text}
                  </span>
                </div>
                <button
                  onClick={() => removeHighlight(h.id)}
                  className="ml-2 text-gray-600 hover:text-red-400 transition-colors text-xs shrink-0 p-1"
                >
                  ✕
                </button>
              </div>

              {h.enabled && (
                <div className="flex items-center justify-between mt-1 pl-5">
                  <span className="text-[10px] text-gray-500 font-medium">
                    出现 {highlightStats[h.id]?.length || 0} 次
                  </span>
                  <div className="flex space-x-1">
                    <button
                      onClick={() => scrollToOccurrence(h.id, 'prev')}
                      className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-blue-400 transition-colors"
                      title="上一个"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 15l7-7 7 7" /></svg>
                    </button>
                    <button
                      onClick={() => scrollToOccurrence(h.id, 'next')}
                      className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-blue-400 transition-colors"
                      title="下一个"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
        </div>
      </div>

      <div className="mt-4 p-3 bg-gray-800/50 border border-gray-700/50 rounded-lg">
        <p className="text-[10px] text-gray-500 leading-relaxed">
          <span className="text-blue-400 font-bold mr-1">TIPS</span> 
          开启“脱水模式”并配置“上下文轮廓”，可以更高效地分析业务执行链条。
        </p>
      </div>
    </div>
  );
}
