import { useLogStore } from '../store';

export default function SessionList() {
  const sessions = useLogStore((state) => state.sessions);
  const selectedSessionIds = useLogStore((state) => state.selectedSessionIds);
  const setSelectedSessions = useLogStore((state) => state.setSelectedSessions);

  const toggleSession = (sessionId: number) => {
    if (selectedSessionIds.includes(sessionId)) {
      setSelectedSessions(selectedSessionIds.filter(id => id !== sessionId));
    } else {
      setSelectedSessions([...selectedSessionIds, sessionId]);
    }
  };

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-400">检测到的会话</h3>
        <span className="text-xs text-gray-500">{sessions.length} 个</span>
      </div>

      <div className="space-y-2">
        {sessions.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            <p>暂无会话</p>
            <p className="text-sm mt-2">先打开日志文件</p>
          </div>
        ) : (
          sessions.map((session) => (
            <div
              key={session.id}
              onClick={() => toggleSession(session.id)}
              className={`p-3 rounded-lg cursor-pointer transition-colors ${
                selectedSessionIds.includes(session.id)
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 hover:bg-gray-700'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">会话 #{session.id + 1}</p>
                  <p className="text-xs opacity-75 mt-1 truncate">
                    {session.bootMarker}
                  </p>
                  <p className="text-xs opacity-60 mt-1">
                    行 {session.startLine} - {session.endLine} 
                    ({session.endLine - session.startLine + 1} 行)
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={selectedSessionIds.includes(session.id)}
                  onChange={() => toggleSession(session.id)}
                  className="ml-2"
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            </div>
          ))
        )}
      </div>

      {sessions.length > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-700">
          <button
            onClick={() => {
              if (selectedSessionIds.length === sessions.length) {
                setSelectedSessions([]);
              } else {
                setSelectedSessions(sessions.map(s => s.id));
              }
            }}
            className="w-full py-2 px-4 bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition-colors text-sm"
          >
            {selectedSessionIds.length === sessions.length ? '取消全选' : '全选'}
          </button>
        </div>
      )}
    </div>
  );
}
