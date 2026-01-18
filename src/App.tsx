import { useLogStore } from './store';
import Header from "./components/Header";
import Sidebar from "./components/Sidebar";
import LogViewer from "./components/LogViewer";
import Dashboard from "./components/Dashboard";
import MetricsPanel from "./components/MetricsPanel";
import "./App.css";

function App() {
  const { activeView, setActiveView } = useLogStore();

  return (
    <div className="h-screen w-screen flex flex-col bg-gray-900 text-white overflow-hidden">
      <Header />
      <div className="flex-1 flex overflow-hidden">
        <Sidebar onViewChange={setActiveView} currentView={activeView} />
        <main className="flex-1 flex flex-col overflow-hidden relative bg-gray-900">
          {activeView === 'log' && <LogViewer />}
          {activeView === 'dashboard' && <Dashboard />}
          {activeView === 'metrics' && <MetricsPanel />}
        </main>
      </div>
    </div>
  );
}

export default App;
