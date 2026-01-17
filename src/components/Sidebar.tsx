import { useState } from 'react';
import FileManager from './FileManager';
import SessionList from './SessionList';
import ConfigPanel from './ConfigPanel';
import KeyPathTracker from './KeyPathTracker';

type SidebarTab = 'files' | 'sessions' | 'track' | 'config';

interface SidebarProps {
  onViewChange: (view: 'log' | 'dashboard' | 'metrics') => void;
  currentView: 'log' | 'dashboard' | 'metrics';
}

export default function Sidebar({ onViewChange, currentView }: SidebarProps) {
  const [activeTab, setActiveTab] = useState<SidebarTab>('files');

  const tabs = [
    { id: 'files' as SidebarTab, label: '文件', icon: '📁' },
    { id: 'sessions' as SidebarTab, label: '会话', icon: '🔄' },
    { id: 'track' as SidebarTab, label: '踪迹', icon: '🎯' },
    { id: 'config' as SidebarTab, label: '配置', icon: '⚙️' },
  ];

  return (
    <aside className="w-80 bg-gray-900 text-white flex flex-col border-r border-gray-700">
      {/* View Switcher */}
      <div className="p-2 grid grid-cols-3 gap-2 bg-gray-950 border-b border-gray-800">
        <button
          onClick={() => onViewChange('log')}
          className={`py-1.5 text-xs font-medium rounded-md transition-all ${
            currentView === 'log' 
            ? 'bg-blue-600 text-white shadow-lg' 
            : 'text-gray-400 hover:bg-gray-800'
          }`}
        >
          📄 日志
        </button>
        <button
          onClick={() => onViewChange('dashboard')}
          className={`py-1.5 text-xs font-medium rounded-md transition-all ${
            currentView === 'dashboard' 
            ? 'bg-blue-600 text-white shadow-lg' 
            : 'text-gray-400 hover:bg-gray-800'
          }`}
        >
          📊 分析
        </button>
        <button
          onClick={() => onViewChange('metrics')}
          className={`py-1.5 text-xs font-medium rounded-md transition-all ${
            currentView === 'metrics' 
            ? 'bg-blue-600 text-white shadow-lg' 
            : 'text-gray-400 hover:bg-gray-800'
          }`}
        >
          📈 指标
        </button>
      </div>

      {/* Tab Navigation */}
      <div className="flex border-b border-gray-700">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 py-3 px-4 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-gray-800 text-white border-b-2 border-blue-500'
                : 'text-gray-400 hover:text-white hover:bg-gray-800'
            }`}
          >
            <span className="mr-2">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'files' && <FileManager />}
        {activeTab === 'sessions' && <SessionList />}
        {activeTab === 'track' && <KeyPathTracker />}
        {activeTab === 'config' && <ConfigPanel />}
      </div>
    </aside>
  );
}
