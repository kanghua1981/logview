import { useEffect } from 'react';
import { useLogStore } from './store';
import Header from "./components/Header";
import Sidebar from "./components/Sidebar";
import LogViewer from "./components/LogViewer";
import Dashboard from "./components/Dashboard";
import MetricsPanel from "./components/MetricsPanel";
import SearchResultsPanel from "./components/SearchResultsPanel";
import "./App.css";

function App() {
  const { activeView, setActiveView, setFontSize, isSearchPanelOpen, setSearchPanelOpen } = useLogStore();

  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -1 : 1;
        setFontSize(prev => prev + delta);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl + H 切换搜索面板
      if (e.ctrlKey && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        setSearchPanelOpen(!isSearchPanelOpen);
      }
    };

    window.addEventListener('wheel', handleWheel, { passive: false });
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('wheel', handleWheel);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [setFontSize, isSearchPanelOpen, setSearchPanelOpen]);

  return (
    <div className="h-screen w-screen flex flex-col bg-gray-900 text-white overflow-hidden">
      <Header />
      <div className="flex-1 flex overflow-hidden">
        <Sidebar onViewChange={setActiveView} currentView={activeView} />
        <main className="flex-1 flex flex-col overflow-hidden relative bg-gray-900">
          <div className="flex-1 flex flex-col overflow-hidden">
            {activeView === 'log' && <LogViewer />}
            {activeView === 'dashboard' && <Dashboard />}
            {activeView === 'metrics' && <MetricsPanel />}
          </div>
          <SearchResultsPanel />
        </main>
      </div>
    </div>
  );
}

export default App;
