import React, { useState } from 'react';
import { useLogStore } from '../store';
import { invoke } from '@tauri-apps/api/core';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';

export default function MetricsPanel() {
  const { 
    metrics, addMetric, removeMetric, toggleMetric, updateMetricData, updateMetricRegex,
    files, currentFileId, setActiveView, setScrollTargetLine 
  } = useLogStore();
  const [newName, setNewName] = useState('');
  const [newRegex, setNewRegex] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);

  const currentFile = files.find(f => f.id === currentFileId);

  const handleAddMetric = () => {
    if (newName && newRegex) {
      addMetric(newName, newRegex);
      setNewName('');
      setNewRegex('');
    }
  };

  const handleStartEdit = (metric: any) => {
    setEditingId(metric.id);
    setEditValue(metric.regex);
  };

  const handleSaveEdit = (id: string) => {
    updateMetricRegex(id, editValue);
    setEditingId(null);
  };

  const handleAutoFix = (id: string, currentRegex: string) => {
    const fixed = currentRegex.replace(/N/g, '\\d+').replace(/HH:MM:SS/g, '\\d{2}:\\d{2}:\\d{2}');
    // 自动添加捕获组
    let withGroup = fixed;
    if (!fixed.includes('(') && fixed.includes('\\d+')) {
      const parts = fixed.split('\\d+');
      const lastPart = parts.pop();
      withGroup = parts.join('\\d+') + '(\\d+)' + lastPart;
    }
    updateMetricRegex(id, withGroup);
  };

  const extractData = async (metricId: string, regex: string) => {
    if (!currentFile) return;
    
    setIsExtracting(true);
    try {
      const data = await invoke('extract_metrics', {
        filePath: currentFile.path,
        regex: regex
      });
      updateMetricData(metricId, data as any[]);
    } catch (error) {
      console.error('Failed to extract metrics:', error);
    } finally {
      setIsExtracting(false);
    }
  };

  // Combine all enabled metrics data for the chart
  const chartData = React.useMemo(() => {
    const enabledMetrics = metrics.filter(m => m.enabled && m.data.length > 0);
    if (enabledMetrics.length === 0) return [];

    // Map by line number to align multiple series
    const dataMap: Record<number, any> = {};
    enabledMetrics.forEach(m => {
      m.data.forEach(p => {
        if (!dataMap[p.line_number]) {
          dataMap[p.line_number] = { line: p.line_number };
        }
        dataMap[p.line_number][m.name] = p.value;
      });
    });

    return Object.values(dataMap).sort((a, b) => a.line - b.line);
  }, [metrics]);

  return (
    <div className="flex-1 flex flex-col p-4 space-y-4 overflow-hidden bg-gray-900">
      <div className="flex justify-between items-center bg-gray-800 p-4 rounded-lg border border-gray-700">
        <div className="flex space-x-4 flex-1">
          <input
            type="text"
            placeholder="指标名称 (如: 内存)"
            className="bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm flex-1"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <input
            type="text"
            placeholder="Regex (如: free:(\d+))"
            className="bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm flex-[2]"
            value={newRegex}
            onChange={(e) => setNewRegex(e.target.value)}
          />
          <button
            onClick={handleAddMetric}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm transition-colors"
          >
            添加指标
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col min-h-0 space-y-4">
        {/* Metrics List */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {metrics.map(metric => {
            const needsFix = metric.regex.includes('N') || metric.regex.includes('HH:MM:SS');
            
            return (
              <div key={metric.id} className={`bg-gray-800 p-4 rounded-lg border ${needsFix ? 'border-yellow-600/50' : 'border-gray-700'} space-y-3`}>
                <div className="flex justify-between items-start">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold flex items-center truncate">
                      <span 
                        className="w-3 h-3 rounded-full mr-2 flex-shrink-0" 
                        style={{ backgroundColor: metric.color }}
                      ></span>
                      {metric.name}
                    </h3>
                    
                    {editingId === metric.id ? (
                      <div className="mt-2 space-y-2">
                        <textarea
                          className="w-full bg-gray-900 border border-blue-500 rounded p-2 text-xs font-mono"
                          rows={3}
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                        />
                        <div className="flex space-x-2">
                          <button 
                            onClick={() => handleSaveEdit(metric.id)}
                            className="bg-blue-600 text-[10px] px-2 py-1 rounded"
                          >保存</button>
                          <button 
                            onClick={() => setEditingId(null)}
                            className="bg-gray-700 text-[10px] px-2 py-1 rounded"
                          >取消</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <code className="text-[10px] text-gray-400 block mt-1 break-all bg-black/30 p-1 rounded">
                          {metric.regex}
                        </code>
                        {needsFix && (
                          <div className="mt-2 flex items-center justify-between bg-yellow-900/20 p-2 rounded border border-yellow-800/30">
                            <span className="text-[10px] text-yellow-500">发现占位符，正则无效</span>
                            <button
                              onClick={() => handleAutoFix(metric.id, metric.regex)}
                              className="bg-yellow-600 hover:bg-yellow-500 text-white text-[10px] px-2 py-0.5 rounded"
                            >
                              自动修正
                            </button>
                          </div>
                        )}
                        <div className="text-xs text-blue-400 mt-1">
                          已提取: {metric.data.length} 点
                        </div>
                      </>
                    )}
                  </div>
                  <div className="flex flex-col space-y-2 ml-2">
                    <button
                      onClick={() => toggleMetric(metric.id)}
                      className={`p-1 rounded ${metric.enabled ? 'text-green-400' : 'text-gray-500'}`}
                      title={metric.enabled ? '已启用' : '已禁用'}
                    >
                      {metric.enabled ? '👁️' : '🕶️'}
                    </button>
                    <button
                      onClick={() => handleStartEdit(metric)}
                      className="p-1 text-blue-400 hover:bg-blue-400/10 rounded text-xs"
                      title="编辑正则"
                    >
                      ✏️
                    </button>
                    <button
                      onClick={() => removeMetric(metric.id)}
                      className="p-1 text-red-400 hover:bg-red-400/10 rounded"
                      title="删除"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
                <button
                  disabled={isExtracting || !!editingId}
                  onClick={() => extractData(metric.id, metric.regex)}
                  className="w-full bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-xs py-1.5 rounded transition-colors"
                >
                  {isExtracting ? '提取中...' : '立即提取数据'}
                </button>
              </div>
            );
          })}
        </div>

        {/* Chart View */}
        <div className="flex-1 bg-gray-800 rounded-lg border border-gray-700 p-4 min-h-[300px]">
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart 
                data={chartData}
                onDoubleClick={(state) => {
                  if (state && state.activeLabel) {
                    setScrollTargetLine(Number(state.activeLabel));
                    setActiveView('log');
                  }
                }}
                style={{ cursor: 'pointer' }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis 
                  dataKey="line" 
                  stroke="#9ca3af" 
                  fontSize={12}
                  label={{ value: '行号 (双击跳转)', position: 'insideBottomRight', offset: -10, fill: '#6b7280' }}
                />
                <YAxis stroke="#9ca3af" fontSize={12} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '0.5rem' }}
                  itemStyle={{ fontSize: '12px' }}
                />
                <Legend />
                {metrics.filter(m => m.enabled).map(m => (
                  <Line
                    key={m.id}
                    type="monotone"
                    dataKey={m.name}
                    stroke={m.color}
                    dot={false}
                    activeDot={{ r: 4 }}
                    strokeWidth={2}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-gray-500 space-y-2">
              <span className="text-4xl">📈</span>
              <p>添加指标并点击“立即提取数据”以显示图表</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
