import ReactMarkdown from 'react-markdown';
import { useLogStore } from '../store';
import { useEffect, useRef, useState } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';

export default function AiSidePanel() {
  const isAiPanelOpen = useLogStore((state) => state.isAiPanelOpen);
  const setAiPanelOpen = useLogStore((state) => state.setAiPanelOpen);
  const aiPanelWidth = useLogStore((state) => state.aiPanelWidth);
  const setAiPanelWidth = useLogStore((state) => state.setAiPanelWidth);
  const aiMessages = useLogStore((state) => state.aiMessages);
  const isAiLoading = useLogStore((state) => state.isAiLoading);
  const clearAiMessages = useLogStore((state) => state.clearAiMessages);
  const addRefinementFilter = useLogStore((state) => state.addRefinementFilter);
  const activeView = useLogStore((state) => state.activeView);
  const addMetric = useLogStore((state) => state.addMetric);
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isResizing, setIsResizing] = useState(false);

  // 自动滚动到底部
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [aiMessages, isAiLoading]);

  // Resize logic
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const newWidth = Math.max(300, Math.min(800, window.innerWidth - e.clientX));
      setAiPanelWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'default';
    };
  }, [isResizing, setAiPanelWidth]);

  const parseFilters = (content: string) => {
    const lines = content.split('\n');
    const filters: { regex: string; reason: string }[] = [];
    const metrics: { name: string; regex: string; reason: string }[] = [];
    const cleanLines: string[] = [];

    lines.forEach(line => {
      const filterMatch = line.match(/^FILTER:\s*(.*?)\s*\|\|\s*(.*)$/);
      const metricMatch = line.match(/^METRIC:\s*(.*?)\s*\|\|\s*(.*?)\s*\|\|\s*(.*)$/);
      
      if (filterMatch) {
        filters.push({ regex: filterMatch[1], reason: filterMatch[2] });
      } else if (metricMatch) {
        metrics.push({ name: metricMatch[1], regex: metricMatch[2], reason: metricMatch[3] });
      } else {
        cleanLines.push(line);
      }
    });

    return { cleanContent: cleanLines.join('\n'), filters, metrics };
  };

  const handleExportReport = async () => {
    if (aiMessages.length === 0) return;
    
    try {
      const path = await save({
        filters: [{ name: 'Markdown Report', extensions: ['md'] }],
        defaultPath: `ai_analysis_report_${new Date().toISOString().replace(/[:.]/g, '-')}.md`
      });

      if (path) {
        const reportContent = aiMessages.map(msg => 
          `### ${msg.role === 'user' ? '👤 Question' : '✨ Analysis'}\n\n${msg.content}\n\n---`
        ).join('\n\n');
        
        const fullReport = `# LogView AI Analysis Report\n\nGenerated at: ${new Date().toLocaleString()}\n\n${reportContent}`;
        
        await invoke('save_text_file', { path, content: fullReport });
        alert('报告导出成功！');
      }
    } catch (e) {
      console.error('Failed to export AI report:', e);
      alert('导出报告失败: ' + e);
    }
  };

  if (!isAiPanelOpen) return null;

  return (
    <div 
      className="relative flex flex-col border-l border-gray-700 bg-gray-900 shadow-2xl z-40 transition-all select-none"
      style={{ width: `${aiPanelWidth}px` }}
    >
      {/* Resizer Handle (Left Side) */}
      <div
        onMouseDown={handleMouseDown}
        className={`absolute left-0 top-0 bottom-0 w-1 cursor-col-resize z-50 hover:bg-blue-500/50 transition-colors ${isResizing ? 'bg-blue-500 w-1' : ''}`}
      />

      <div className="h-14 flex items-center justify-between px-4 border-b border-gray-700 bg-gray-800">
        <div className="flex items-center space-x-2">
          <span className="text-xl">✨</span>
          <h3 className="font-bold text-gray-200">AI 智能分析</h3>
        </div>
        <div className="flex items-center space-x-2">
          <button 
            onClick={handleExportReport}
            className="p-1.5 hover:bg-gray-700 rounded text-gray-400 hover:text-blue-400"
            title="导出分析报告 (.md)"
            disabled={aiMessages.length === 0}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </button>
          <button 
            onClick={clearAiMessages}
            className="p-1.5 hover:bg-gray-700 rounded text-gray-400 hover:text-red-400"
            title="清空对话"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
          <button 
            onClick={() => setAiPanelOpen(false)}
            className="p-1.5 hover:bg-gray-700 rounded text-gray-400 hover:text-white"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-6 scrollbar-thin scrollbar-thumb-gray-700">
        {aiMessages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-gray-500 text-center px-4">
            <div className="text-4xl mb-4 opacity-20">🔎</div>
            <p className="text-sm">在顶部过滤框输入 <span className="text-blue-400 font-mono">? 你的问题</span></p>
            <p className="text-[10px] mt-2 opacity-60">AI 会结合当前固化的过滤结果进行分析</p>
          </div>
        ) : (
          aiMessages.map((msg, idx) => {
            const { cleanContent, filters, metrics } = msg.role === 'assistant' 
              ? parseFilters(msg.content) 
              : { cleanContent: msg.content, filters: [], metrics: [] };
            
            return (
              <div key={idx} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                <div className={`max-w-[95%] rounded-lg p-3 text-sm ${
                  msg.role === 'user' 
                  ? 'bg-blue-600 text-white rounded-br-none shadow-lg shadow-blue-900/20' 
                  : 'bg-gray-800 text-gray-200 border border-gray-700 rounded-bl-none'
                }`}>
                  {msg.role === 'assistant' ? (
                    <div className="space-y-3">
                      <div className="prose prose-invert prose-sm max-w-none">
                        <ReactMarkdown>{cleanContent}</ReactMarkdown>
                      </div>
                      
                      {(filters.length > 0 || metrics.length > 0) && (
                        <div className="pt-2 border-t border-gray-700 space-y-2">
                          {filters.length > 0 && (
                            <>
                              <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">推荐过滤建议:</p>
                              {filters.map((f, i) => {
                                // 确定真正的过滤项（带前缀）
                                let finalFilter = f.regex;
                                if (!finalFilter.startsWith('!') && !finalFilter.startsWith('=') && !finalFilter.startsWith('/')) {
                                  finalFilter = '/' + finalFilter;
                                }

                                // 获取显示图标和样式
                                const isRegex = finalFilter.startsWith('/');
                                const isExclude = finalFilter.startsWith('!');
                                const isExact = finalFilter.startsWith('=');
                                
                                const icon = isRegex ? '/' : isExclude ? '!' : isExact ? '=' : '🔎';
                                const iconColor = isRegex ? 'text-purple-400' : isExclude ? 'text-red-400' : isExact ? 'text-emerald-400' : 'text-blue-400';

                                return (
                                  <div
                                    key={i}
                                    className="w-full text-left p-2 rounded bg-blue-900/10 border border-blue-800/30 transition-all text-[11px] group mb-2 hover:border-blue-700/50"
                                  >
                                    <div className="mb-2">
                                      <div className="flex items-center space-x-1">
                                        <span className={`${iconColor} font-bold mr-1`}>{icon}</span>
                                        <span className="font-mono text-blue-300 font-bold break-all">{f.regex.replace(/^[!=/]/, '')}</span>
                                      </div>
                                      <div className="text-gray-400 leading-tight italic mt-1">{f.reason}</div>
                                    </div>
                                    
                                    <div className="flex gap-2">
                                      <button
                                        onClick={() => addRefinementFilter(finalFilter)}
                                        title="添加到面包屑过滤器"
                                        className={`flex-1 py-1 px-1.5 rounded border transition-all flex items-center justify-center gap-1
                                          ${activeView !== 'metrics' 
                                            ? 'bg-blue-600/30 border-blue-500/50 text-blue-100 hover:bg-blue-500/40' 
                                            : 'bg-blue-900/20 border-blue-800/40 text-blue-400 hover:bg-blue-800/30'}`}
                                      >
                                        <span className="opacity-70">🔎</span>
                                        <span>添加过滤</span>
                                      </button>
                                      
                                      {(activeView === 'metrics' || f.regex.includes('(')) && (
                                        <button
                                          onClick={() => {
                                            const nameSnippet = f.reason.split(/[，。：: ]/)[0].substring(0, 12);
                                            addMetric(nameSnippet || '新指标', f.regex.replace(/^[!=/]/, ''));
                                          }}
                                          title="作为数据指标提取图表"
                                          className={`flex-1 py-1 px-1.5 rounded border transition-all flex items-center justify-center gap-1
                                            ${activeView === 'metrics' 
                                              ? 'bg-purple-600/30 border-purple-500/50 text-purple-100 hover:bg-purple-500/40' 
                                              : 'bg-purple-900/20 border-purple-800/40 text-purple-400 hover:bg-purple-800/30'}`}
                                        >
                                          <span className="opacity-70">📈</span>
                                          <span>设为指标</span>
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </>
                          )}

                          {metrics.length > 0 && (
                            <>
                              <p className="text-[10px] text-purple-500 font-bold uppercase tracking-wider mt-3">推荐数值指标:</p>
                              {metrics.map((m, i) => (
                                <div
                                  key={`m-${i}`}
                                  className="w-full text-left p-2 rounded bg-purple-900/10 border border-purple-800/30 transition-all text-[11px] group mb-2 hover:border-purple-700/50"
                                >
                                  <div className="mb-2">
                                    <div className="flex items-center justify-between">
                                      <span className="font-bold text-purple-300">📈 {m.name}</span>
                                      <span className="font-mono text-gray-500 text-[9px]">{m.regex}</span>
                                    </div>
                                    <div className="text-gray-400 leading-tight italic mt-1">{m.reason}</div>
                                  </div>
                                  
                                  <button
                                    onClick={() => addMetric(m.name, m.regex)}
                                    className="w-full py-1 px-1.5 rounded border bg-purple-600/30 border-purple-500/50 text-purple-100 hover:bg-purple-500/40 transition-all flex items-center justify-center gap-1"
                                  >
                                    <span>确认并添加到指标面板</span>
                                  </button>
                                </div>
                              ))}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    msg.content
                  )}
                </div>
              </div>
            );
          })
        )}
        
        {isAiLoading && (
          <div className="flex flex-col items-start animate-pulse">
            <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 rounded-bl-none">
              <div className="flex space-x-2">
                <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" />
                <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce [animation-delay:0.2s]" />
                <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce [animation-delay:0.4s]" />
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="p-3 bg-gray-950/50 border-t border-gray-800 text-[10px] text-gray-600">
        AI 可能产生误导，请结合原始日志核对。
      </div>
    </div>
  );
}
