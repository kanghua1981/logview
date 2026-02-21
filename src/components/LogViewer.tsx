import { useState, useEffect, useRef } from 'react';
import { useLogStore } from '../store';
import LogPane from './LogPane';
import Dashboard from './Dashboard';
import MetricsPanel from './MetricsPanel';

export default function LogViewer() {
  const isDualPane = useLogStore((state) => state.isDualPane);
  const dualPaneSplit = useLogStore((state) => state.dualPaneSplit);
  const setDualPaneSplit = useLogStore((state) => state.setDualPaneSplit);
  const activeView = useLogStore((state) => state.activeView);
  
  const [isResizing, setIsResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing || !containerRef.current) return;
      
      const containerRect = containerRef.current.getBoundingClientRect();
      const relativeX = e.clientX - containerRect.left;
      const newPercentage = (relativeX / containerRect.width) * 100;
      
      // 限制范围在 15% 到 85% 之间
      const clampedPercentage = Math.max(15, Math.min(85, newPercentage));
      setDualPaneSplit(clampedPercentage);
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
  }, [isResizing, setDualPaneSplit]);

  // 根据当前视图决定渲染什么内容
  if (activeView === 'dashboard') {
    return <Dashboard />;
  }

  if (activeView === 'metrics') {
    return <MetricsPanel />;
  }

  // 默认渲染日志预览区
  return (
    <div className="flex-1 flex overflow-hidden bg-[#0d1117]" ref={containerRef}>
      <div className={`flex flex-1 overflow-hidden transition-all duration-300`}>
        <div className={`flex-1 flex overflow-hidden bg-[#0d1117] relative`}>
          <div 
            style={{ width: isDualPane ? `${dualPaneSplit}%` : '100%' }}
            className="flex h-full overflow-hidden"
          >
            <LogPane side="left" />
          </div>

          {isDualPane && (
            <>
              {/* Resizer Handle */}
              <div
                onMouseDown={(e) => {
                  e.preventDefault();
                  setIsResizing(true);
                }}
                className={`w-1 cursor-col-resize z-50 hover:bg-blue-500/50 transition-colors ${isResizing ? 'bg-blue-500 w-1' : 'bg-gray-800'}`}
              />
              
              <div 
                style={{ width: `${100 - dualPaneSplit}%` }}
                className="flex h-full overflow-hidden shadow-2xl relative"
              >
                <LogPane side="right" />
                <button 
                  className="absolute top-2 right-2 p-1.5 rounded-full bg-gray-900/60 border border-gray-700/50 text-gray-500 hover:text-white hover:bg-gray-800 z-10 transition-all"
                  onClick={() => useLogStore.getState().setDualPane(false)}
                  title="关闭双窗"
                >
                  ✕
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
