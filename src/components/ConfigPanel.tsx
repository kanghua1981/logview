import { useState, useEffect } from 'react';
import { useLogStore, LogProfile } from '../store';
import { loadLogFile } from '../utils/logLoader';
import { save, open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';

export default function ConfigPanel() {
  const { 
    profiles, 
    activeProfileId, 
    bootMarkerRegex, 
    logLevelRegex,
    timestampRegex,
    timeGapThreshold,
    logLevelFilter,
    files,
    currentFileId,
    setBootMarkerRegex,
    setLogLevelRegex,
    setTimestampRegex,
    setTimeGapThreshold,
    setLogLevelFilter,
    addProfile,
    updateProfile,
    deleteProfile,
    setActiveProfile,
    exportConfig,
    importConfig,
    aiEndpoint,
    aiModel,
    aiApiKey,
    aiSystemPrompt,
    aiMaxIterations,
    setAiConfig
  } = useLogStore();

  const [bootInput, setBootInput] = useState(bootMarkerRegex);
  const [levelInput, setLevelInput] = useState(logLevelRegex);
  const [timestampInput, setTimestampInput] = useState(timestampRegex);
  const [timeGapInput, setTimeGapInput] = useState(timeGapThreshold);
  const [profileName, setProfileName] = useState('');

  // AI 配置本地状态
  const [endpointInput, setEndpointInput] = useState(aiEndpoint);
  const [modelInput, setModelInput] = useState(aiModel);
  const [apiKeyInput, setApiKeyInput] = useState(aiApiKey);
  const [systemPromptInput, setSystemPromptInput] = useState(aiSystemPrompt);
  const [maxIterationsInput, setMaxIterationsInput] = useState(aiMaxIterations);

  const currentFile = files.find(f => f.id === currentFileId);

  useEffect(() => {
    setBootInput(bootMarkerRegex);
    setLevelInput(logLevelRegex);
    setTimestampInput(timestampRegex);
    setTimeGapInput(timeGapThreshold);
    setEndpointInput(aiEndpoint);
    setModelInput(aiModel);
    setApiKeyInput(aiApiKey);
    setSystemPromptInput(aiSystemPrompt);
    setMaxIterationsInput(aiMaxIterations);
    const activeProfile = profiles.find(p => p.id === activeProfileId);
    if (activeProfile) {
      setProfileName(activeProfile.name);
    }
  }, [bootMarkerRegex, logLevelRegex, timestampRegex, activeProfileId, profiles, aiEndpoint, aiModel, aiApiKey, aiSystemPrompt, aiMaxIterations]);

  const logLevels = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'];

  const toggleLogLevel = (level: string) => {
    if (logLevelFilter.includes(level)) {
      setLogLevelFilter(logLevelFilter.filter(l => l !== level));
    } else {
      setLogLevelFilter([...logLevelFilter, level]);
    }
  };

  const handleApply = async () => {
    setBootMarkerRegex(bootInput);
    setLogLevelRegex(levelInput);
    setTimestampRegex(timestampInput);
    setTimeGapThreshold(timeGapInput);
    
    // 如果有当前文件，触发重新解析
    if (currentFile) {
      try {
        await loadLogFile(currentFile.path);
      } catch (err) {
        console.error('Failed to re-parse log file:', err);
      }
    }
  };

  const handleSaveProfile = () => {
    const activeProfile = profiles.find(p => p.id === activeProfileId);
    if (activeProfile && activeProfile.id !== 'default') {
      updateProfile({
        ...activeProfile,
        name: profileName,
        bootMarkerRegex: bootInput,
        logLevelRegex: levelInput,
        timestampRegex: timestampInput,
        timeGapThreshold: timeGapInput
      });
    } else {
      const newProfile: LogProfile = {
        id: Date.now().toString(),
        name: profileName || '新预设',
        bootMarkerRegex: bootInput,
        logLevelRegex: levelInput,
        timestampRegex: timestampInput,
        timeGapThreshold: timeGapInput
      };
      addProfile(newProfile);
      setActiveProfile(newProfile.id);
    }
  };

  const handleExportConfig = async () => {
    try {
      const configJson = exportConfig();
      const path = await save({
        filters: [{ name: 'Log Analysis Config', extensions: ['json'] }],
        defaultPath: 'log_analysis_config.json'
      });
      if (path) {
        await invoke('write_config_file', { path, content: configJson });
        alert('配置导出成功！');
      }
    } catch (err) {
      console.error('Failed to export config:', err);
      alert('导出失败: ' + err);
    }
  };

  const handleImportConfig = async () => {
    try {
      const path = await open({
        filters: [{ name: 'Log Analysis Config', extensions: ['json'] }],
        multiple: false
      });
      if (path && typeof path === 'string') {
        const content = await invoke<string>('read_config_file', { path });
        const success = importConfig(content);
        if (success) {
          alert('配置导入成功！');
        } else {
          alert('配置导入失败：文件格式不符合要求');
        }
      }
    } catch (err) {
      console.error('Failed to import config:', err);
      alert('导入失败: ' + err);
    }
  };

  return (
    <div className="p-4 space-y-6">
      {/* 导入导出全局配置 */}
      <div className="bg-blue-900/20 border border-blue-800/50 p-4 rounded-lg space-y-3">
        <h3 className="text-sm font-semibold text-blue-300 flex items-center">
          <span className="mr-2">💾</span> 全局解析方案管理
        </h3>
        <p className="text-[10px] text-blue-400/80">
          导出所有正则、会话分割器、高亮及指标定义。
        </p>
        <div className="flex space-x-2">
          <button 
            onClick={handleExportConfig}
            className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-medium transition-colors"
          >
            导出方案
          </button>
          <button 
            onClick={handleImportConfig}
            className="flex-1 py-1.5 border border-blue-600 text-blue-400 hover:bg-blue-600/10 rounded text-xs font-medium transition-colors"
          >
            导入方案
          </button>
        </div>
      </div>

      {/* 预设管理 */}
      <div className="bg-gray-900/40 p-3 rounded-lg border border-gray-800">
        <h3 className="text-xs font-bold text-gray-500 mb-3 uppercase tracking-widest">预设方案切换</h3>
        <select 
          value={activeProfileId}
          onChange={(e) => setActiveProfile(e.target.value)}
          className="w-full px-3 py-2 bg-gray-950 text-blue-400 rounded-lg border border-gray-700 focus:border-blue-500 focus:outline-none text-sm mb-3 appearance-none cursor-pointer"
          style={{ backgroundImage: 'linear-gradient(45deg, transparent 50%, #6b7280 50%), linear-gradient(135deg, #6b7280 50%, transparent 50%)', backgroundPosition: 'calc(100% - 20px) calc(1em + 2px), calc(100% - 15px) calc(1em + 2px)', backgroundSize: '5px 5px, 5px 5px', backgroundRepeat: 'no-repeat' }}
        >
          {profiles.map(p => (
            <option key={p.id} value={p.id} className="bg-gray-900 text-white">{p.name}</option>
          ))}
        </select>
        
        <div className="flex space-x-2">
          <input
            type="text"
            value={profileName}
            onChange={(e) => setProfileName(e.target.value)}
            placeholder="为当前配置起个名字..."
            className="flex-1 px-3 py-1.5 bg-gray-950 text-white placeholder-gray-600 rounded border border-gray-700 focus:border-blue-500 focus:outline-none text-xs transition-all"
          />
          <button
            onClick={handleSaveProfile}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-bold transition-all shadow-lg shadow-blue-900/20"
          >
            保存
          </button>
          {activeProfileId !== 'default' && (
            <button
              onClick={() => deleteProfile(activeProfileId)}
              className="px-3 py-1.5 bg-gray-800 hover:bg-red-600 text-gray-400 hover:text-white rounded border border-gray-700 hover:border-red-500 text-xs transition-all"
            >
              删除
            </button>
          )}
        </div>
      </div>

      <hr className="border-gray-700" />

      {/* Boot 标识符配置 */}
      <div>
        <h3 className="text-sm font-semibold text-gray-400 mb-3">Boot 标识符 (正则)</h3>
        <input
          type="text"
          value={bootInput}
          onChange={(e) => setBootInput(e.target.value)}
          placeholder="例如: (?i)boot|start..."
          className="w-full px-3 py-2 bg-gray-800 text-white rounded-lg border border-gray-700 focus:border-blue-500 focus:outline-none text-sm font-mono"
        />
      </div>

      {/* 日志级别识别正则 */}
      <div>
        <h3 className="text-sm font-semibold text-gray-400 mb-3">级别识别 (正则)</h3>
        <input
          type="text"
          value={levelInput}
          onChange={(e) => setLevelInput(e.target.value)}
          placeholder="例如: \[(DEBUG|INFO|WARN|ERROR)\]..."
          className="w-full px-3 py-2 bg-gray-800 text-white rounded-lg border border-gray-700 focus:border-blue-500 focus:outline-none text-sm font-mono"
        />
        <p className="text-[10px] text-gray-500 mt-1">
          提示：通过第一个捕获组提取级别名称
        </p>
      </div>

      {/* 时间戳识别正则 */}
      <div>
        <h3 className="text-sm font-semibold text-gray-400 mb-3">时间戳提取 (正则)</h3>
        <input
          type="text"
          value={timestampInput}
          onChange={(e) => setTimestampInput(e.target.value)}
          placeholder="例如: \[(.*?)\]"
          className="w-full px-3 py-2 bg-gray-800 text-white rounded-lg border border-gray-700 focus:border-blue-500 focus:outline-none text-sm font-mono"
        />
        <div className="flex items-center justify-between mt-3">
          <h3 className="text-sm font-semibold text-gray-400">时间间隙切分会话 (秒)</h3>
          <span className="text-[10px] text-gray-500">0 表示禁用</span>
        </div>
        <input
          type="number"
          min="0"
          value={timeGapInput}
          onChange={(e) => setTimeGapInput(parseInt(e.target.value) || 0)}
          className="w-full px-3 py-2 bg-gray-800 text-blue-400 rounded-lg border border-gray-700 focus:border-blue-500 focus:outline-none text-sm font-bold"
        />
        <p className="text-[10px] text-gray-500 mt-1">
          提示：当相邻两行的时间超过此阈值时自动创建新会话
        </p>
      </div>

      <button
        onClick={handleApply}
        className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors text-sm font-medium"
      >
        应用并重新解析
      </button>

      <hr className="border-gray-700" />

      {/* AI 助手配置 */}
      <div className="bg-purple-900/10 border border-purple-800/30 p-4 rounded-lg space-y-4">
        <h3 className="text-sm font-semibold text-purple-300 flex items-center">
          <span className="mr-2">🤖</span> AI 智能诊断配置
        </h3>
        <p className="text-[10px] text-purple-400/80">
          支持 OpenAI 兼容接口。输入 ? 即可在命令栏发起询问。
        </p>
        
        <div className="space-y-3">
          <div>
            <label className="text-[10px] text-gray-500 block mb-1 uppercase">API Endpoint / Base URL</label>
            <input
              type="text"
              value={endpointInput}
              onChange={(e) => setEndpointInput(e.target.value)}
              placeholder="https://api.openai.com/v1"
              className="w-full px-2 py-1.5 bg-gray-900 text-purple-200 rounded border border-purple-900/50 focus:border-purple-500 focus:outline-none text-[11px] font-mono"
            />
          </div>
          
          <div className="flex space-x-2">
            <div className="flex-1">
              <label className="text-[10px] text-gray-500 block mb-1 uppercase">Model</label>
              <input
                type="text"
                value={modelInput}
                onChange={(e) => setModelInput(e.target.value)}
                placeholder="gpt-4o / deepseek-chat"
                className="w-full px-2 py-1.5 bg-gray-900 text-purple-200 rounded border border-purple-900/50 focus:border-purple-500 focus:outline-none text-[11px] font-mono"
              />
            </div>
            <div className="flex-1">
              <label className="text-[10px] text-gray-500 block mb-1 uppercase">API Key</label>
              <input
                type="password"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder="sk-..."
                className="w-full px-2 py-1.5 bg-gray-900 text-purple-200 rounded border border-purple-900/50 focus:border-purple-500 focus:outline-none text-[11px] font-mono"
              />
            </div>
          </div>

          <div>
            <label className="text-[10px] text-gray-500 block mb-1 uppercase">System Prompt (业务背景/专家角色)</label>
            <textarea
              value={systemPromptInput}
              onChange={(e) => setSystemPromptInput(e.target.value)}
              placeholder="你是一个专业的日志分析专家..."
              rows={4}
              className="w-full px-2 py-1.5 bg-gray-900 text-purple-200 rounded border border-purple-900/50 focus:border-purple-500 focus:outline-none text-[10px] font-sans leading-relaxed resize-none"
            />
            <p className="text-[9px] text-gray-600 mt-1 italic">
              * 正则过滤格式协议 (FILTER:) 会自动附加在你的提示词之后，无需重复设置。
            </p>
          </div>

          <div>
            <label className="text-[10px] text-gray-500 block mb-1 uppercase">最大分析轮数 (Agentic Loop)</label>
            <input
              type="number"
              min={1}
              max={50}
              value={maxIterationsInput}
              onChange={(e) => setMaxIterationsInput(Math.max(1, Math.min(50, Number(e.target.value))))}
              className="w-full px-2 py-1.5 bg-gray-900 text-purple-200 rounded border border-purple-900/50 focus:border-purple-500 focus:outline-none text-[11px] font-mono"
            />
            <p className="text-[9px] text-gray-600 mt-1">AI 每次问答最多循环调用 tools 的次数（默认 20）</p>
          </div>
          
          <button
            onClick={() => {
              setAiConfig({
                endpoint: endpointInput,
                model: modelInput,
                apiKey: apiKeyInput,
                systemPrompt: systemPromptInput,
                maxIterations: maxIterationsInput
              });
              alert('AI 配置已保存');
            }}
            className="w-full py-1.5 bg-purple-600/50 hover:bg-purple-600 text-white rounded text-xs font-medium transition-all border border-purple-500/30"
          >
            保存 AI 设置
          </button>
        </div>
      </div>

      <hr className="border-gray-700" />

      {/* 日志级别过滤 */}
      <div>
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-sm font-semibold text-gray-400">显示级别</h3>
          <button
            onClick={() => {
              if (logLevelFilter.length === logLevels.length) {
                setLogLevelFilter([]);
              } else {
                setLogLevelFilter([...logLevels]);
              }
            }}
            className="text-[10px] text-blue-400 hover:underline"
          >
            {logLevelFilter.length === logLevels.length ? '取消全选' : '全选'}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {logLevels.map((level) => (
            <label
              key={level}
              className="flex items-center space-x-2 cursor-pointer p-2 rounded bg-gray-800 hover:bg-gray-700 transition-colors border border-transparent"
            >
              <input
                type="checkbox"
                checked={logLevelFilter.includes(level)}
                onChange={() => toggleLogLevel(level)}
                className="w-3 h-3"
              />
              <span className={`text-xs ${getLevelColor(level)}`}>
                {level}
              </span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

function getLevelColor(level: string): string {
  switch (level.toUpperCase()) {
    case 'DEBUG': return 'text-gray-400';
    case 'INFO': return 'text-blue-400';
    case 'WARN': return 'text-yellow-400';
    case 'ERROR': return 'text-orange-400';
    case 'FATAL': return 'text-red-400';
    default: return 'text-white';
  }
}
