import { useState, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useLogStore } from '../store';

import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  ScatterChart,
  Scatter,
  ZAxis
} from 'recharts';

interface TimeGap {
  line_number: number;
  gap_ms: number;
}

interface WorkflowSegment {
  start_line: number;
  end_line: number;
  start_time: number;
  end_time: number;
  duration_ms: number;
  id: string | null;
}

interface PatternStat {
  content: string;
  count: number;
  level: string | null;
}

export default function Dashboard() {
  const currentFileId = useLogStore((state) => state.currentFileId);
  const files = useLogStore((state) => state.files);
  const addMetric = useLogStore((state) => state.addMetric);
  const currentFile = files.find(f => f.id === currentFileId);
  const timestampRegex = useLogStore((state) => state.timestampRegex);
  const { 
    setActiveView, 
    setScrollTargetLine, 
    analysisStats: stats, 
    analysisTimeGaps: timeGaps, 
    analysisWorkflows: workflows,
    hasAnalyzedStats,
    highlights,
    setAnalysisStatsResults,
    setAnalysisWorkflowResults
  } = useLogStore();
  
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // 流程分析相关的本地状态
  const [startRegex, setStartRegex] = useState('');
  const [endRegex, setEndRegex] = useState('');
  const [idRegex, setIdRegex] = useState('');
  const [isIntervalMode, setIsIntervalMode] = useState(false);
  const [workflowLoading, setWorkflowLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const workflowStats = useMemo(() => {
    if (!workflows || workflows.length === 0) return null;
    const durs = workflows.map(w => w.duration_ms);
    return {
      avg: durs.reduce((a, b) => a + b, 0) / durs.length,
      max: Math.max(...durs),
      min: Math.min(...durs),
      count: durs.length
    };
  }, [workflows]);

  const escapeRegex = (str: string) => {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  };

  const convertPlaceholderToRegex = (pattern: string) => {
    // 1. 先进行基础的正则转义
    let escaped = escapeRegex(pattern);
    
    // 2. 将特殊占位符替换为正则语法
    // 将 HH:MM:SS 替换为数字时间匹配
    escaped = escaped.replace(/HH:MM:SS/g, '\\d{2}:\\d{2}:\\d{2}');
    // 将 N 替换为数字匹配
    escaped = escaped.replace(/N/g, '\\d+');
    // 将 0xADDR 替换为十六进制地址匹配
    escaped = escaped.replace(/0xADDR/g, '0x[0-9a-fA-F]+');
    
    return escaped;
  };

  const handleApplyPattern = (pattern: string) => {
    setStartRegex(convertPlaceholderToRegex(pattern));
  };

  const loadStats = async () => {
    if (!currentFile) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const [patterns, gaps] = await Promise.all([
        invoke<PatternStat[]>('analyze_log_patterns'),
        invoke<TimeGap[]>('analyze_time_gaps', { 
          timestampRegex: timestampRegex 
        })
      ]);
      setAnalysisStatsResults(patterns, gaps);
    } catch (err) {
      console.error('Failed to analyze:', err);
      setErrorMsg('分析失败: ' + err);
    } finally {
      setLoading(false);
    }
  };

  const handleWorkflowAnalysis = async () => {
    if (!currentFile || !startRegex || (!isIntervalMode && !endRegex)) {
      alert('请填写必要的正则表达式');
      return;
    }
    setWorkflowLoading(true);
    setErrorMsg(null);
    try {
      let results;
      if (isIntervalMode) {
        results = await invoke<WorkflowSegment[]>('analyze_recurrent_intervals', {
          regex: startRegex,
          timestampRegex
        });
      } else {
        results = await invoke<WorkflowSegment[]>('analyze_workflow_duration', {
          startRegex,
          endRegex,
          timestampRegex,
          idRegex: idRegex || null
        });
      }
      
      if (results.length === 0) {
        setErrorMsg('未找到匹配流程。请检查：1. 正则表达式是否包含特殊字符(如 []()+)需要转义；2. 时间戳正则是否正确提取了时间；3. 逻辑关键字是否存在。');
      }
      setAnalysisWorkflowResults(results);
    } catch (err: any) {
      setErrorMsg('计算失败: ' + err);
    } finally {
      setWorkflowLoading(false);
    }
  };

  const handleQuickAddMetric = (pattern: string) => {
    // 1. 先进行基础的正则转义
    let escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    // 2. 将特殊占位符替换为正则语法
    // 将 HH:MM:SS 替换为数字时间匹配
    escaped = escaped.replace(/HH:MM:SS/g, '\\d{2}:\\d{2}:\\d{2}');
    // 将 0xADDR 替换为十六进制地址匹配
    escaped = escaped.replace(/0xADDR/g, '0x[0-9a-fA-F]+');
    
    // 3. 处理数字占位符 N
    // 我们假设模式中最后一个 N 是用户关心的数值指标，将其设为捕获组 (\d+)
    // 其他前面的 N 设为普通的 \d+
    let suggestedRegex = '';
    const parts = escaped.split('N');
    if (parts.length > 1) {
      // 最后一个 N 之前的所有部分用 \d+ 连接
      const lastPart = parts.pop();
      suggestedRegex = parts.join('\\d+') + '(\\d+)' + lastPart;
    } else {
      suggestedRegex = escaped;
    }
      
    const name = window.prompt('请输入指标名称:', '追踪指标');
    if (name) {
      addMetric(name, suggestedRegex);
      alert(`已添加指标: ${name}，请前往“指标”页提取数据`);
    }
  };

  const filteredStats = stats.filter(s => 
    s.content.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (!currentFile) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-500">
        <p className="text-lg">请先选择一个日志文件</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full bg-gray-900 text-gray-200">
      <header className="flex justify-between items-start">
        <div>
          <h2 className="text-2xl font-bold text-white mb-2">智能分析报告</h2>
          <p className="text-sm text-gray-400">正在分析: {currentFile.name}</p>
        </div>
        <div className="flex space-x-3">
          {errorMsg && (
            <div className="bg-red-900/30 border border-red-800 text-red-200 px-4 py-2 rounded-lg text-xs max-w-sm flex items-center">
              ⚠️ {errorMsg}
            </div>
          )}
          {!hasAnalyzedStats && !loading && (
            <button
              onClick={loadStats}
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-lg font-bold shadow-lg shadow-blue-900/20 transition-all flex items-center space-x-2"
            >
              <span>🚀 启动全量模式分析</span>
            </button>
          )}
        </div>
      </header>

      {/* 概览卡片只在有文件时显示 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* ... 卡片内容保持不变 ... */}
        <div className="bg-gray-800 p-4 rounded-xl border border-gray-700">
          <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">总行数</p>
          <p className="text-2xl font-mono text-blue-400">{currentFile.lines.toLocaleString()}</p>
        </div>
        <div className="bg-gray-800 p-4 rounded-xl border border-gray-700">
          <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">检测到的启动次数</p>
          <p className="text-2xl font-mono text-green-400">{currentFile.sessions}</p>
        </div>
        <div className="bg-gray-800 p-4 rounded-xl border border-gray-700">
          <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">文件大小</p>
          <p className="text-2xl font-mono text-purple-400">{(currentFile.size / 1024).toFixed(2)} KB</p>
        </div>
      </div>

      {hasAnalyzedStats && timeGaps.length > 0 && (
        <section className="bg-gray-800/30 p-4 rounded-xl border border-gray-700">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold text-white flex items-center">
              时间空隙分析 (卡顿检测)
              <span className="ml-2 text-xs font-normal text-gray-500">发现超过 10ms 的日志间隔</span>
            </h3>
            <span className="text-xs text-blue-400">双击柱状图跳转对应日志</span>
          </div>
          <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart 
                data={timeGaps}
                onDoubleClick={(state) => {
                  if (state && state.activeLabel) {
                    setScrollTargetLine(Number(state.activeLabel));
                    setActiveView('log');
                  }
                }}
                style={{ cursor: 'pointer' }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                <XAxis dataKey="line_number" hide />
                <YAxis 
                  stroke="#9ca3af" 
                  fontSize={10} 
                  label={{ value: 'ms', angle: -90, position: 'insideLeft', fill: '#6b7280' }}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '0.5rem' }}
                  itemStyle={{ fontSize: '12px', color: '#f87171' }}
                  labelStyle={{ color: '#9ca3af' }}
                  labelFormatter={(value) => `行号: ${value}`}
                  formatter={(value) => [`${value} ms`, '时间空隙']}
                />
                <Bar dataKey="gap_ms" radius={[2, 2, 0, 0]}>
                  {timeGaps.map((entry, index) => (
                    <Cell 
                      key={`cell-${index}`} 
                      fill={entry.gap_ms > 100 ? '#ef4444' : entry.gap_ms > 20 ? '#f59e0b' : '#3b82f6'} 
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      <section className="bg-gray-800/60 p-5 rounded-xl border border-gray-700 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between space-y-2 md:space-y-0">
          <div>
            <h3 className="text-lg font-semibold text-white flex items-center">
              ⏱️ 业务流程耗时分析
              <span className="ml-2 px-2 py-0.5 bg-blue-500/10 text-blue-400 text-[10px] rounded uppercase font-bold tracking-wider border border-blue-500/20">βeta</span>
            </h3>
            <p className="text-xs text-gray-500 mt-1">通过指定流程的开始与结束标识，自动匹配全量日志中的成对任务并计算执行时长</p>
          </div>
          {workflowStats && (
            <div className="flex space-x-4 bg-gray-900/50 px-4 py-2 rounded-lg border border-gray-800">
              <div className="flex flex-col">
                <span className="text-[9px] text-gray-500 uppercase font-bold">平均耗时</span>
                <span className="text-sm font-mono text-blue-400 font-bold">{workflowStats.avg.toFixed(1)}ms</span>
              </div>
              <div className="flex flex-col border-l border-gray-800 pl-4">
                <span className="text-[9px] text-gray-500 uppercase font-bold">最大/最小</span>
                <span className="text-sm font-mono text-gray-300">{workflowStats.max.toFixed(0)}/{workflowStats.min.toFixed(0)}</span>
              </div>
              <div className="flex flex-col border-l border-gray-800 pl-4">
                <span className="text-[9px] text-gray-500 uppercase font-bold">样本数</span>
                <span className="text-sm font-mono text-green-400 font-bold">{workflowStats.count}</span>
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-gray-900/50 p-4 rounded-xl border border-gray-800">
          {/* Start Point */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label className="text-[10px] uppercase text-gray-400 font-black tracking-widest">
                {isIntervalMode ? '监控模式关键字' : 'STEP 1: 开始行标记'}
              </label>
              <label className="flex items-center space-x-1.5 cursor-pointer group">
                <input 
                  type="checkbox" 
                  checked={isIntervalMode} 
                  onChange={e => setIsIntervalMode(e.target.checked)}
                  className="w-3 h-3 rounded bg-gray-800 border-gray-700 text-blue-500 focus:ring-0 cursor-pointer"
                />
                <span className="text-[10px] text-gray-500 group-hover:text-blue-400 transition-colors">自循环间隔</span>
              </label>
            </div>
            <input 
              type="text" 
              placeholder={isIntervalMode ? "关键词，如: Heartbeat" : "例如: Processing request"} 
              className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20 outline-none transition-all"
              value={startRegex}
              onChange={e => setStartRegex(e.target.value)}
            />
            {highlights.length > 0 && (
              <div className="flex flex-wrap gap-1.5 opacity-60 hover:opacity-100 transition-opacity">
                {highlights.filter(h => h.enabled).slice(0, 4).map(h => (
                  <button 
                    key={h.id}
                    onClick={() => setStartRegex(h.text)}
                    className="text-[9px] px-2 py-0.5 bg-gray-800 border border-gray-700 rounded hover:border-blue-500 hover:text-blue-400 transition-colors truncate max-w-[80px]"
                  >
                    {h.text}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* End Point */}
          <div className={`space-y-2 transition-all ${isIntervalMode ? 'opacity-20 pointer-events-none filter blur-[1px]' : ''}`}>
            <label className="text-[10px] uppercase text-gray-400 font-black tracking-widest pl-1">STEP 2: 结束行标记</label>
            <input 
              type="text" 
              placeholder="例如: Request finished" 
              className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20 outline-none transition-all"
              value={endRegex}
              onChange={e => setEndRegex(e.target.value)}
            />
            {highlights.length > 0 && (
              <div className="flex flex-wrap gap-1.5 opacity-60 hover:opacity-100 transition-opacity">
                {highlights.filter(h => h.enabled).slice(0, 4).map(h => (
                  <button 
                    key={h.id}
                    onClick={() => setEndRegex(h.text)}
                    className="text-[9px] px-2 py-0.5 bg-gray-800 border border-gray-700 rounded hover:border-blue-500 hover:text-blue-400 transition-colors truncate max-w-[80px]"
                  >
                    {h.text}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ID Linker */}
          <div className={`space-y-2 transition-all ${isIntervalMode ? 'opacity-20 pointer-events-none filter blur-[1px]' : ''}`}>
            <label className="text-[10px] uppercase text-gray-400 font-black tracking-widest pl-1">STEP 3: 唯一ID提取 (可选)</label>
            <input 
              type="text" 
              placeholder="正则提取 ID, 如: ID=(\d+)" 
              className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20 outline-none transition-all"
              value={idRegex}
              onChange={e => setIdRegex(e.target.value)}
            />
            <div className="flex flex-wrap gap-1.5">
              {[
                { label: 'ReqID', pat: 'req_id=([^ ]+)' },
                { label: 'Digit', pat: 'ID:(\\d+)' }
              ].map(tmp => (
                <button 
                  key={tmp.label}
                  onClick={() => setIdRegex(tmp.pat)}
                  className="text-[9px] px-2 py-0.5 bg-blue-900/20 border border-blue-800/50 text-blue-400 rounded hover:bg-blue-800/40 transition-colors"
                >
                  {tmp.label}
                </button>
              ))}
            </div>
          </div>

          {/* Action Button */}
          <div className="flex flex-col justify-end pt-5">
            <button
              onClick={handleWorkflowAnalysis}
              disabled={workflowLoading || !startRegex || (!isIntervalMode && !endRegex)}
              className={`w-full h-10 rounded-lg font-bold text-sm transition-all flex items-center justify-center space-x-2 ${
                workflowLoading || !startRegex || (!isIntervalMode && !endRegex)
                  ? 'bg-gray-800 text-gray-600 cursor-not-allowed border border-gray-700' 
                  : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-xl shadow-blue-900/30'
              }`}
            >
              {workflowLoading ? (
                <>
                  <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white"></div>
                  <span>分析中...</span>
                </>
              ) : (
                <>
                  <span>⚡</span>
                  <span>开始流程计算</span>
                </>
              )}
            </button>
            {errorMsg && <p className="text-[10px] text-red-400 mt-2 text-center bg-red-900/10 py-1 rounded border border-red-900/20 px-2">{errorMsg}</p>}
          </div>
        </div>

        {workflows && workflows.length > 0 ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-4">
            <div className="lg:col-span-2 h-72 bg-gray-950/50 p-4 rounded-xl border border-gray-800 shadow-inner">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                  <XAxis 
                    type="number" 
                    dataKey="start_line" 
                    name="起始行" 
                    stroke="#4b5563"
                    fontSize={9}
                    tickFormatter={(val) => `L${val}`}
                  />
                  <YAxis 
                    type="number" 
                    dataKey="duration_ms" 
                    name="耗时" 
                    unit="ms" 
                    stroke="#4b5563"
                    fontSize={9}
                  />
                  <ZAxis type="category" dataKey="id" name="ID" />
                  <Tooltip 
                    cursor={{ strokeDasharray: '3 3' }}
                    contentStyle={{ 
                      backgroundColor: '#0f172a', 
                      border: '1px solid #334155', 
                      borderRadius: '0.75rem', 
                      fontSize: '11px',
                      boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)'
                    }}
                    itemStyle={{ padding: '0px', color: '#f1f5f9' }}
                    labelStyle={{ display: 'none' }}
                    formatter={(value, name) => {
                      if (name === '耗时' || name === 'duration_ms') return [`${Number(value).toFixed(2)} ms`, '⏱️ 耗时'];
                      if (name === '起始行' || name === 'start_line') return [`L${value}`, '📍 起始行'];
                      if (name === 'ID' || name === 'id') return [value || '无', '🆔 任务标识'];
                      return [value, name];
                    }}
                  />
                  <Scatter 
                    name="Workflows" 
                    data={workflows} 
                    onClick={(data) => {
                      setScrollTargetLine(data.end_line);
                      setActiveView('log');
                    }}
                    onDoubleClick={(data) => {
                      setScrollTargetLine(data.start_line);
                      setActiveView('log');
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    {workflows.map((entry: any, index: number) => (
                      <Cell 
                        key={`cell-${index}`} 
                        fill={entry.duration_ms > workflowStats!.avg * 1.5 ? '#f87171' : '#34d399'} 
                        fillOpacity={0.7}
                      />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-gray-950/50 border border-gray-800 rounded-xl overflow-hidden flex flex-col h-72">
              <div className="bg-gray-800/50 px-4 py-2 border-b border-gray-700 flex justify-between items-center text-[10px] uppercase font-bold text-gray-400 tracking-widest">
                <span>耗时细节排行 (TOP 50)</span>
                <span className="text-gray-600">双击跳转开始 / 单击跳转结束</span>
              </div>
              <div className="flex-1 overflow-y-auto custom-scrollbar">
                {workflows.slice().sort((a,b) => b.duration_ms - a.duration_ms).slice(0, 50).map((w, i) => (
                  <div 
                    key={i}
                    onClick={() => { setScrollTargetLine(w.end_line); setActiveView('log'); }}
                    onDoubleClick={() => { setScrollTargetLine(w.start_line); setActiveView('log'); }}
                    className="px-4 py-2 border-b border-gray-800 hover:bg-white/5 transition-colors cursor-pointer group flex items-center justify-between"
                  >
                    <div className="flex flex-col">
                      <span className="text-[10px] text-gray-500 font-mono">ID: {w.id || `Task-${i+1}`}</span>
                      <span className="text-[9px] text-gray-600 italic">Ln: {w.start_line} → {w.end_line}</span>
                    </div>
                    <span className={`text-xs font-mono font-bold ${w.duration_ms > workflowStats!.avg * 1.2 ? 'text-red-400' : 'text-blue-400'}`}>
                      {w.duration_ms.toFixed(1)}ms
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : !workflowLoading && (
          <div className="py-12 text-center bg-gray-900/20 border border-dashed border-gray-800 rounded-2xl flex flex-col items-center">
            <div className="text-3xl mb-3 opacity-20">📊</div>
            <p className="text-sm text-gray-600 font-medium whitespace-pre-line">
              填写 STEP 1 & 2 的关键字，点击“开始流程计算”
              {"\n"}<span className="text-[10px] opacity-70">系统将自动从百万行日志中提取出成对的异步执行链路并分析耗时</span>
            </p>
          </div>
        )}
      </section>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 space-y-4">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500"></div>
          <p className="text-gray-400 animate-pulse">正在扫描全量文件提取指纹模式...</p>
        </div>
      ) : hasAnalyzedStats ? (
        <section className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-semibold text-white flex items-center">
              高频日志模式
              <span className="ml-2 text-xs font-normal text-gray-500">(已合并相似行并屏蔽变量)</span>
            </h3>
            <div className="flex space-x-2">
              <input 
                type="text"
                placeholder="搜索模式..."
                className="bg-gray-800 border border-gray-700 rounded px-3 py-1 text-xs focus:ring-1 focus:ring-blue-500 outline-none w-48"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-3">
            {filteredStats.slice(0, 50).map((stat, idx) => (
              <div key={idx} className="group bg-gray-800/40 p-3 rounded-lg border border-gray-700/50 hover:border-gray-500 transition-all relative">
                <div className="flex justify-between items-start mb-2">
                  <div className="flex items-center space-x-2">
                    <span className="text-xs font-bold px-2 py-0.5 rounded bg-blue-900/40 text-blue-300 border border-blue-800/30">
                      {stat.count} 次
                    </span>
                    {stat.level && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${getLevelBg(stat.level)}`}>
                        {stat.level}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center space-x-3">
                    <span className="text-xs text-gray-500 font-mono">
                      {((stat.count / currentFile.lines) * 100).toFixed(1)}%
                    </span>
                    <button
                      onClick={() => handleApplyPattern(stat.content)}
                      className="opacity-0 group-hover:opacity-100 bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] px-2 py-0.5 rounded transition-all mr-2"
                      title="将此关键字应用到下方的流程分析中"
                    >
                      🎯 分析此流程
                    </button>
                    <button
                      onClick={() => handleQuickAddMetric(stat.content)}
                      className="opacity-0 group-hover:opacity-100 bg-blue-600 hover:bg-blue-500 text-white text-[10px] px-2 py-0.5 rounded transition-all"
                      title="将此模式中的数值添加到指标页追踪"
                    >
                      📈 追踪此指标
                    </button>
                  </div>
                </div>
                <p className="text-sm font-mono text-gray-300 break-all leading-relaxed pr-24">
                  {stat.content}
                </p>
              </div>
            ))}
            {filteredStats.length === 0 && (
              <div className="text-center py-10 text-gray-500 border-2 border-dashed border-gray-800 rounded-xl">
                未匹配到相关模式
              </div>
            )}
          </div>
        </section>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-gray-500 border-2 border-dashed border-gray-800 rounded-2xl bg-gray-800/20">
          <span className="text-5xl mb-4">🔍</span>
          <p className="text-lg font-medium">点击“启动深度分析”开始扫描模式</p>
          <p className="text-sm mt-2 max-w-md text-center">系统将分析文件中的高频日志指纹，并尝试识别可追踪的数值指标。</p>
        </div>
      )}
    </div>
  );
}

function getLevelBg(level: string): string {
  switch (level.toUpperCase()) {
    case 'ERROR': return 'bg-red-900/50 text-red-400 border border-red-800/50';
    case 'WARN': return 'bg-yellow-900/50 text-yellow-400 border border-yellow-800/50';
    case 'FATAL': return 'bg-purple-900/50 text-purple-400 border border-purple-800/50';
    default: return 'bg-blue-900/40 text-blue-400 border border-blue-800/50';
  }
}
