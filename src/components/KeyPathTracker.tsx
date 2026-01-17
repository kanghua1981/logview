import { useState } from 'react';
import { useLogStore } from '../store';

export default function KeyPathTracker() {
  const { 
    highlights, 
    showOnlyHighlights, 
    addHighlight, 
    removeHighlight, 
    toggleHighlight, 
    setShowOnlyHighlights 
  } = useLogStore();

  const [input, setInput] = useState('');

  const handleAdd = () => {
    if (input.trim()) {
      addHighlight(input.trim());
      setInput('');
    }
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-400">关键路径跟踪</h3>
        <label className="flex items-center space-x-2 cursor-pointer">
          <span className="text-xs text-gray-500 whitespace-nowrap">仅看追踪</span>
          <input
            type="checkbox"
            checked={showOnlyHighlights}
            onChange={(e) => setShowOnlyHighlights(e.target.checked)}
            className="w-4 h-4 rounded border-gray-700 bg-gray-800 text-blue-500 focus:ring-blue-500"
          />
        </label>
      </div>

      <div className="flex space-x-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          placeholder="输入关键字追踪逻辑..."
          className="flex-1 px-3 py-2 bg-gray-800 text-white rounded-lg border border-gray-700 focus:border-blue-500 focus:outline-none text-sm"
        />
        <button
          onClick={handleAdd}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors text-sm font-medium"
        >
          添加
        </button>
      </div>

      <div className="space-y-2">
        {highlights.length === 0 ? (
          <p className="text-center text-gray-600 text-xs py-4 italic">
            添加关键字，通过不同颜色梳理复杂流程
          </p>
        ) : (
          highlights.map((h) => (
            <div
              key={h.id}
              className="group flex items-center justify-between p-2 bg-gray-800/40 rounded-lg border border-gray-700/50 hover:bg-gray-800 transition-colors"
            >
              <div 
                className="flex items-center space-x-2 flex-1 cursor-pointer"
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
                className="ml-2 text-gray-600 hover:text-red-400 transition-colors"
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>

      <div className="mt-4 p-3 bg-blue-900/20 border border-blue-800/30 rounded-lg">
        <p className="text-[10px] text-blue-300 leading-relaxed">
          💡 技巧：您可以同时添加多个关键字（如 "init", "request", "callback"）。
          不同颜色会标记在日志中，勾选“仅看追踪”可快速梳理流程。
        </p>
      </div>
    </div>
  );
}
