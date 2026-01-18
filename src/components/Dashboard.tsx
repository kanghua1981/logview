import { useState } from 'react';
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
        invoke<PatternStat[]>('analyze_log_patterns', { path: currentFile.path }),
        invoke<TimeGap[]>('analyze_time_gaps', { 
          filePath: currentFile.path, 
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
          filePath: currentFile.path,
          regex: startRegex,
          timestampRegex
        });
      } else {
        results = await invoke<WorkflowSegment[]>('analyze_workflow_duration', {
          filePath: currentFile.path,
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
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-semibold text-white flex items-center">
            ⏱️ 业务流程耗时分析
            <span className="ml-2 text-xs font-normal text-gray-500">指定开始/结束关键字来测量流程耗时</span>
          </h3>
          {workflows && workflows.length > 0 && (
            <span className="text-xs text-blue-400">双击数据点跳转开始行，单击跳转结束行</span>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 bg-gray-900/50 p-3 rounded-lg border border-gray-800">
          <div className="space-y-1">
            <div className="flex justify-between items-center">
              <label className="text-[10px] uppercase text-gray-500 font-bold ml-1">
                {isIntervalMode ? '监控关键字' : '开始关键字'}
              </label>
              <label className="flex items-center space-x-1 cursor-pointer group">
                <input 
                  type="checkbox" 
                  checked={isIntervalMode} 
                  onChange={e => setIsIntervalMode(e.target.checked)}
                  className="w-3 h-3 rounded bg-gray-700 border-gray-600 text-blue-500 focus:ring-0"
                />
                <span className="text-[10px] text-gray-400 group-hover:text-blue-400 transition-colors">相同词间隔模式</span>
              </label>
            </div>
            <input 
              type="text" 
              placeholder={isIntervalMode ? "e.g. Heartbeat" : "e.g. Processing request"} 
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm focus:ring-1 focus:ring-blue-500 outline-none"
              value={startRegex}
              onChange={e => setStartRegex(e.target.value)}
            />
          </div>
          <div className={`space-y-1 transition-opacity ${isIntervalMode ? 'opacity-30 pointer-events-none' : ''}`}>
            <label className="text-[10px] uppercase text-gray-500 font-bold ml-1">结束关键字</label>
            <input 
              type="text" 
              placeholder="e.g. Request finished" 
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm focus:ring-1 focus:ring-blue-500 outline-none"
              value={endRegex}
              onChange={e => setEndRegex(e.target.value)}
            />
          </div>
          <div className={`space-y-1 transition-opacity ${isIntervalMode ? 'opacity-30 pointer-events-none' : ''}`}>
            <label className="text-[10px] uppercase text-gray-500 font-bold ml-1">唯一 ID 提取</label>
            <input 
              type="text" 
              placeholder="e.g. req_id=(\d+)" 
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm focus:ring-1 focus:ring-blue-500 outline-none"
              value={idRegex}
              onChange={e => setIdRegex(e.target.value)}
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={handleWorkflowAnalysis}
              disabled={workflowLoading || !startRegex || (!isIntervalMode && !endRegex)}
              className={`w-full py-1.5 rounded font-bold text-sm transition-all ${
                workflowLoading || !startRegex || (!isIntervalMode && !endRegex)
                  ? 'bg-gray-700 text-gray-500 cursor-not-allowed' 
                  : 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/20'
              }`}
            >
              {workflowLoading ? '分析中...' : '开始流程计算'}
            </button>
          </div>
        </div>

        {workflows && workflows.length > 0 ? (
          <div className="h-64 w-full mt-4">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart
                margin={{ top: 20, right: 20, bottom: 20, left: 20 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                <XAxis 
                  type="number" 
                  dataKey="start_line" 
                  name="起始行" 
                  stroke="#6b7280"
                  fontSize={10}
                  tickFormatter={(val) => `L${val}`}
                />
                <YAxis 
                  type="number" 
                  dataKey="duration_ms" 
                  name="耗时" 
                  unit="ms" 
                  stroke="#6b7280"
                  fontSize={10}
                />
                <ZAxis type="category" dataKey="id" name="ID" />
                <Tooltip 
                  cursor={{ strokeDasharray: '3 3' }}
                  contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '0.5rem' }}
                  labelStyle={{ color: '#9ca3af' }}
                  formatter={(value, name) => [
                    name === 'duration_ms' ? `${Number(value).toFixed(2)} ms` : value, 
                    name === 'duration_ms' ? '耗时' : name
                  ]}
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
                      fill={entry.duration_ms > 1000 ? '#ef4444' : '#10b981'} 
                      fillOpacity={0.6}
                    />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        ) : !workflowLoading && (
          <div className="py-10 text-center text-gray-600 border border-dashed border-gray-800 rounded-lg">
            填写正则表达式后，点击“开始流程计算”查看耗时统计图
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
