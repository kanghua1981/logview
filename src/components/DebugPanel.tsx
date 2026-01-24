import { useLogStore } from '../store';

export default function DebugPanel() {
  const showOnlyHighlights = useLogStore((state) => state.showOnlyHighlights);
  const highlights = useLogStore((state) => state.highlights);
  const filteredIndices = useLogStore((state) => state.filteredIndices);
  const lineCount = useLogStore((state) => state.lineCount);
  const logLevelFilter = useLogStore((state) => state.logLevelFilter);
  const highlightContextLines = useLogStore((state) => state.highlightContextLines);

  const activeHighlights = highlights.filter(h => h.enabled);

  return (
    <div className="fixed bottom-4 right-4 bg-gray-900/95 border-2 border-yellow-500 rounded-lg p-4 text-xs font-mono max-w-md shadow-2xl z-50">
      <div className="text-yellow-400 font-bold mb-2 text-sm">🔧 调试面板</div>
      
      <div className="space-y-1 text-gray-300">
        <div className="flex justify-between">
          <span>脱水模式:</span>
          <span className={showOnlyHighlights ? 'text-green-400' : 'text-red-400'}>
            {showOnlyHighlights ? '✅ 开启' : '❌ 关闭'}
          </span>
        </div>
        
        <div className="flex justify-between">
          <span>总关键字数:</span>
          <span className="text-blue-400">{highlights.length}</span>
        </div>
        
        <div className="flex justify-between">
          <span>启用的关键字:</span>
          <span className="text-green-400">{activeHighlights.length}</span>
        </div>
        
        <div className="border-t border-gray-700 my-2 pt-2">
          <div className="text-gray-400 mb-1">关键字列表:</div>
          {highlights.length === 0 ? (
            <div className="text-gray-600 italic">无</div>
          ) : (
            highlights.map(h => (
              <div key={h.id} className="flex items-center space-x-2 ml-2">
                <div 
                  className="w-2 h-2 rounded-full" 
                  style={{ backgroundColor: h.color }}
                />
                <span className={h.enabled ? 'text-white' : 'text-gray-600 line-through'}>
                  {h.text}
                </span>
                <span className={h.enabled ? 'text-green-500' : 'text-red-500'}>
                  {h.enabled ? '✓' : '✗'}
                </span>
              </div>
            ))
          )}
        </div>
        
        <div className="border-t border-gray-700 my-2 pt-2">
          <div className="flex justify-between">
            <span>总行数:</span>
            <span className="text-blue-400">{lineCount.toLocaleString()}</span>
          </div>
          
          <div className="flex justify-between">
            <span>过滤后行数:</span>
            <span className="text-purple-400">{filteredIndices.length.toLocaleString()}</span>
          </div>
          
          <div className="flex justify-between">
            <span>过滤比例:</span>
            <span className="text-yellow-400">
              {lineCount > 0 ? ((filteredIndices.length / lineCount) * 100).toFixed(2) : 0}%
            </span>
          </div>
        </div>
        
        <div className="border-t border-gray-700 my-2 pt-2">
          <div className="flex justify-between">
            <span>上下文轮廓:</span>
            <span className="text-cyan-400">{highlightContextLines} 行</span>
          </div>
          
          <div className="flex justify-between">
            <span>日志级别过滤:</span>
            <span className="text-gray-400">{logLevelFilter.length} 项</span>
          </div>
        </div>

        {showOnlyHighlights && activeHighlights.length === 0 && (
          <div className="border-t border-red-700 mt-2 pt-2 text-red-400">
            ⚠️ 脱水模式已开启但无启用的关键字！
          </div>
        )}

        {!showOnlyHighlights && filteredIndices.length === lineCount && lineCount > 0 && (
          <div className="border-t border-green-700 mt-2 pt-2 text-green-400">
            ✓ 正常模式：显示所有行
          </div>
        )}
      </div>
      
      <button 
        onClick={() => {
          const store = useLogStore.getState();
          console.log('=== 完整状态导出 ===');
          console.log('showOnlyHighlights:', store.showOnlyHighlights);
          console.log('highlights:', store.highlights);
          console.log('filteredIndices length:', store.filteredIndices.length);
          console.log('filteredIndices (first 20):', store.filteredIndices.slice(0, 20));
          console.log('lineCount:', store.lineCount);
          console.log('logLevelFilter:', store.logLevelFilter);
        }}
        className="mt-2 w-full py-1 bg-yellow-600 hover:bg-yellow-700 rounded text-white text-xs"
      >
        导出状态到控制台
      </button>
    </div>
  );
}
