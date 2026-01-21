import { useLogStore } from '../store';
import SessionSplitterManager from './SessionSplitterManager';
import { save } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { useState } from 'react';

export default function SessionList() {
  const sessions = useLogStore((state) => state.sessions);
  const selectedSessionIds = useLogStore((state) => state.selectedSessionIds);
  const setSelectedSessions = useLogStore((state) => state.setSelectedSessions);
  const activeSessionMode = useLogStore((state) => state.activeSessionMode);
  const currentFileId = useLogStore((state) => state.currentFileId);
  const files = useLogStore((state) => state.files);
  
  const [isExporting, setIsExporting] = useState(false);

  const currentFile = files.find(f => f.id === currentFileId);

  const handleExport = async () => {
    if (!currentFile || selectedSessionIds.length === 0) return;

    try {
      const selectedSessions = sessions
        .filter(s => selectedSessionIds.includes(s.id))
        .sort((a, b) => a.startLine - b.startLine);

      if (selectedSessions.length === 0) return;

      // 选择保存路径
      const savePath = await save({
        filters: [{
          name: 'Log',
          extensions: ['log', 'txt']
        }],
        defaultPath: `${currentFile.name.replace(/\.[^/.]+$/, "")}_sessions.log`
      });

      if (!savePath) return;

      setIsExporting(true);

      // 提取行范围数据
      const ranges = selectedSessions.map(s => [s.startLine, s.endLine]);

      // 调用后端保存
      await invoke('save_sessions', {
        sourcePath: currentFile.path,
        targetPath: savePath,
        ranges: ranges
      });

      alert('导出成功！');
    } catch (error) {
      console.error('Export failed:', error);
      alert('导出失败: ' + error);
    } finally {
      setIsExporting(false);
    }
  };

  const toggleSession = (sessionId: number) => {
    if (selectedSessionIds.includes(sessionId)) {
      setSelectedSessions(selectedSessionIds.filter(id => id !== sessionId));
    } else {
      setSelectedSessions([...selectedSessionIds, sessionId]);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* 分割器管理面板 */}
      <SessionSplitterManager />
      
      {/* 会话列表 */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        <div className="mb-2 flex items-center justify-between sticky top-0 bg-gray-900 py-1 z-10 border-b border-gray-800">
          <h3 className="text-[11px] uppercase tracking-wider font-bold text-gray-500">
            {activeSessionMode === 'boot' ? 'Boot 会话' : '自定义会话'}
          </h3>
          <span className="text-[10px] text-gray-500 font-mono">{selectedSessionIds.length}/{sessions.length}</span>
        </div>

        <div className="space-y-1 mt-2">
          {sessions.length === 0 ? (
            <div className="text-center text-gray-600 py-12">
              <span className="text-4xl block mb-2 opacity-20">📂</span>
              <p className="text-xs">暂无识别出的会话</p>
            </div>
          ) : (
            sessions.map((session) => (
              <div
                key={session.id}
                onClick={() => toggleSession(session.id)}
                className={`group px-3 py-2 rounded border transition-all cursor-pointer relative ${
                  selectedSessionIds.includes(session.id)
                    ? 'bg-blue-600/90 border-blue-500 shadow-lg shadow-blue-900/20'
                    : 'bg-gray-800/40 border-gray-700/50 hover:bg-gray-800 hover:border-gray-600'
                }`}
              >
                <div className="flex items-center space-x-3">
                  <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    selectedSessionIds.includes(session.id) ? 'bg-white' : 'bg-blue-500'
                  }`} />
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className={`font-semibold text-xs truncate ${
                        selectedSessionIds.includes(session.id) ? 'text-white' : 'text-gray-200'
                      }`}>
                        {session.name || `会话 #${session.id + 1}`}
                      </p>
                      {session.splitType === 'custom' && !selectedSessionIds.includes(session.id) && (
                        <span className="text-[9px] px-1 bg-purple-900/40 text-purple-300 border border-purple-800 rounded">
                          CUSTOM
                        </span>
                      )}
                    </div>
                    
                    <p className={`text-[10px] mt-0.5 truncate font-mono ${
                      selectedSessionIds.includes(session.id) ? 'text-blue-100/80' : 'text-gray-500'
                    }`}>
                      {session.bootMarker || 'No marker found'}
                    </p>
                    
                    <div className="flex items-center justify-between mt-1">
                      <span className={`text-[9px] font-mono ${
                        selectedSessionIds.includes(session.id) ? 'text-blue-100/60' : 'text-gray-600'
                      }`}>
                        L{session.startLine} → L{session.endLine}
                      </span>
                      <span className={`text-[9px] font-bold ${
                        selectedSessionIds.includes(session.id) ? 'text-white' : 'text-blue-400/80'
                      }`}>
                        {session.endLine - session.startLine + 1} lines
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {sessions.length > 0 && (
          <div className="sticky bottom-0 bg-gray-900/90 backdrop-blur-sm pt-3 pb-2 mt-4 border-t border-gray-800 space-y-2">
            <button
              onClick={handleExport}
              disabled={selectedSessionIds.length === 0 || isExporting}
              className="w-full py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-800 disabled:text-gray-600 text-white rounded text-xs font-bold transition-all flex items-center justify-center space-x-2 shadow-lg shadow-blue-900/20"
            >
              <span>{isExporting ? '⏳ 正在导出...' : '📤 导出所选会话'}</span>
            </button>
            <div className="flex space-x-2">
              <button
                onClick={() => setSelectedSessions(sessions.map(s => s.id))}
                className="flex-1 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-[10px] font-bold transition-colors"
              >
                全选
              </button>
              <button
                onClick={() => setSelectedSessions([])}
                className="flex-1 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-[10px] font-bold transition-colors"
              >
                取消
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
