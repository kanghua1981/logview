import { useState, useEffect } from 'react';
import { useLogStore, LogProfile } from '../store';
import { loadLogFile } from './FileManager';

export default function ConfigPanel() {
  const { 
    profiles, 
    activeProfileId, 
    bootMarkerRegex, 
    logLevelRegex,
    logLevelFilter,
    files,
    currentFileId,
    setBootMarkerRegex,
    setLogLevelRegex,
    setLogLevelFilter,
    addProfile,
    updateProfile,
    deleteProfile,
    setActiveProfile
  } = useLogStore();

  const [bootInput, setBootInput] = useState(bootMarkerRegex);
  const [levelInput, setLevelInput] = useState(logLevelRegex);
  const [profileName, setProfileName] = useState('');

  const currentFile = files.find(f => f.id === currentFileId);

  useEffect(() => {
    setBootInput(bootMarkerRegex);
    setLevelInput(logLevelRegex);
    const activeProfile = profiles.find(p => p.id === activeProfileId);
    if (activeProfile) {
      setProfileName(activeProfile.name);
    }
  }, [bootMarkerRegex, logLevelRegex, activeProfileId, profiles]);

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
        logLevelRegex: levelInput
      });
    } else {
      const newProfile: LogProfile = {
        id: Date.now().toString(),
        name: profileName || '新预设',
        bootMarkerRegex: bootInput,
        logLevelRegex: levelInput
      };
      addProfile(newProfile);
      setActiveProfile(newProfile.id);
    }
  };

  return (
    <div className="p-4 space-y-6">
      {/* 预设管理 */}
      <div>
        <h3 className="text-sm font-semibold text-gray-400 mb-3">预设模式</h3>
        <select 
          value={activeProfileId}
          onChange={(e) => setActiveProfile(e.target.value)}
          className="w-full px-3 py-2 bg-gray-800 text-white rounded-lg border border-gray-700 focus:border-blue-500 focus:outline-none text-sm mb-2"
        >
          {profiles.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        
        <div className="flex space-x-2">
          <input
            type="text"
            value={profileName}
            onChange={(e) => setProfileName(e.target.value)}
            placeholder="预设名称..."
            className="flex-1 px-3 py-1 bg-gray-800 text-white rounded border border-gray-700 focus:border-blue-500 focus:outline-none text-xs"
          />
          <button
            onClick={handleSaveProfile}
            className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-xs transition-colors"
          >
            保存
          </button>
          {activeProfileId !== 'default' && (
            <button
              onClick={() => deleteProfile(activeProfileId)}
              className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-xs transition-colors"
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

      <button
        onClick={handleApply}
        className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors text-sm font-medium"
      >
        应用并重新解析
      </button>

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
