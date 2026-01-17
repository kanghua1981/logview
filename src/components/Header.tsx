import { useLogStore } from '../store';

export default function Header() {
  const currentFile = useLogStore((state) => 
    state.files.find(f => f.id === state.currentFileId)
  );

  return (
    <header className="h-14 bg-gray-800 text-white flex items-center px-4 border-b border-gray-700">
      <div className="flex items-center space-x-4">
        <h1 className="text-xl font-bold">LogView</h1>
        {currentFile && (
          <div className="flex items-center space-x-2 text-sm text-gray-300">
            <span className="px-2 py-1 bg-gray-700 rounded">
              {currentFile.name}
            </span>
            <span>{(currentFile.size / 1024).toFixed(2)} KB</span>
            <span>{currentFile.lines} 行</span>
            <span>{currentFile.sessions} 个会话</span>
          </div>
        )}
      </div>
    </header>
  );
}
