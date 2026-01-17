import { create } from 'zustand';

export interface LogFile {
  id: string;
  name: string;
  path: string;
  size: number;
  lines: number;
  sessions: number;
}

export interface LogSession {
  id: number;
  startLine: number;
  endLine: number;
  bootMarker: string;
  timestamp?: string;
}

export interface LogLine {
  lineNumber: number;
  content: string;
  level?: string;
  timestamp?: string;
}

export interface LogProfile {
  id: string;
  name: string;
  bootMarkerRegex: string;
  logLevelRegex: string;
}

const DEFAULT_PROFILES: LogProfile[] = [
  { 
    id: 'default', 
    name: '标准模式', 
    bootMarkerRegex: '(?i)(system|boot|start)(ed|ing|up)',
    logLevelRegex: '(?i)\\b(DEBUG|INFO|WARN|ERROR|FATAL)\\b'
  },
  { 
    id: 'uboot', 
    name: 'U-Boot/Kernel', 
    bootMarkerRegex: 'U-Boot|Linux version',
    logLevelRegex: '(?i)\\b(DEBUG|INFO|WARN|ERROR|FATAL)\\b'
  }
];

export interface LogHighlight {
  id: string;
  text: string;
  color: string;
  enabled: boolean;
}

export interface LogMetric {
  id: string;
  name: string;
  regex: string;
  data: Array<{ line_number: number; value: number }>;
  color: string;
  enabled: boolean;
}

interface LogViewState {
  // ... 其他状态保持不变
  files: LogFile[];
  currentFileId: string | null;
  sessions: LogSession[];
  selectedSessionIds: number[];
  logLines: LogLine[];
  filteredLines: LogLine[];
  profiles: LogProfile[];
  activeProfileId: string;
  bootMarkerRegex: string;
  logLevelRegex: string;
  timestampRegex: string;
  logLevelFilter: string[];
  highlights: LogHighlight[];
  showOnlyHighlights: boolean;

  // 跳转控制
  scrollTargetLine: number | null;
  activeView: 'log' | 'dashboard' | 'metrics';

  // 新增指标追踪
  metrics: LogMetric[];
  
  // 智能分析结果持久化
  analysisStats: any[];
  analysisTimeGaps: any[];
  analysisWorkflows: any[];
  hasAnalyzed: boolean;

  // Actions
  addFile: (file: LogFile) => void;
  removeFile: (id: string) => void;
  setCurrentFile: (id: string) => void;
  setSessions: (sessions: LogSession[]) => void;
  setSelectedSessions: (ids: number[]) => void;
  setLogLines: (lines: LogLine[]) => void;
  setTimestampRegex: (regex: string) => void;
  setBootMarkerRegex: (regex: string) => void;
  setLogLevelRegex: (regex: string) => void;
  setLogLevelFilter: (levels: string[]) => void;
  addHighlight: (text: string) => void;
  removeHighlight: (id: string) => void;
  toggleHighlight: (id: string) => void;
  setShowOnlyHighlights: (show: boolean) => void;
  addProfile: (profile: LogProfile) => void;
  updateProfile: (profile: LogProfile) => void;
  deleteProfile: (id: string) => void;
  setActiveProfile: (id: string) => void;

  // 视图 & 跳转 Actions
  setActiveView: (view: 'log' | 'dashboard' | 'metrics') => void;
  setScrollTargetLine: (line: number | null) => void;
  setAnalysisResults: (stats: any[], gaps: any[], workflows: any[]) => void;

  // 新增指标 Actions
  addMetric: (name: string, regex: string) => void;
  removeMetric: (id: string) => void;
  updateMetricData: (id: string, data: any[]) => void;
  toggleMetric: (id: string) => void;
  
  filterLogLines: () => void;
}

export const useLogStore = create<LogViewState>((set, get) => ({
  files: [],
  currentFileId: null,
  sessions: [],
  selectedSessionIds: [],
  logLines: [],
  filteredLines: [],
  profiles: JSON.parse(localStorage.getItem('log_profiles') || JSON.stringify(DEFAULT_PROFILES)),
  activeProfileId: localStorage.getItem('active_profile_id') || 'default',
  bootMarkerRegex: '',
  logLevelRegex: '',
  timestampRegex: '^\\[(.*?)\\]', // 默认提取第一个方括号内容
  logLevelFilter: ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'],
  highlights: [],
  showOnlyHighlights: false,
  metrics: [],
  scrollTargetLine: null,
  activeView: 'log',
  analysisStats: [],
  analysisTimeGaps: [],
  analysisWorkflows: [],
  hasAnalyzed: false,
  
  // ... 其他 Actions 保持不变
  addFile: (file) => set((state) => {
    const exists = state.files.find(f => f.path === file.path);
    if (exists) {
      return { 
        currentFileId: exists.id,
        files: state.files.map(f => f.path === file.path ? { ...f, ...file, id: exists.id } : f)
      };
    }
    return {
      files: [...state.files, file],
      currentFileId: file.id,
    };
  }),
  
  removeFile: (id) => set((state) => {
    const isCurrent = state.currentFileId === id;
    return {
      files: state.files.filter(f => f.id !== id),
      currentFileId: isCurrent ? null : state.currentFileId,
      analysisStats: isCurrent ? [] : state.analysisStats,
      analysisTimeGaps: isCurrent ? [] : state.analysisTimeGaps,
      analysisWorkflows: isCurrent ? [] : state.analysisWorkflows,
      hasAnalyzed: isCurrent ? false : state.hasAnalyzed
    };
  }),
  
  setCurrentFile: (id) => set({ 
    currentFileId: id,
    analysisStats: [],
    analysisTimeGaps: [],
    analysisWorkflows: [],
    hasAnalyzed: false
  }),
  setSessions: (sessions) => set({ sessions }),
  setSelectedSessions: (ids) => {
    set({ selectedSessionIds: ids });
    get().filterLogLines();
  },
  setLogLines: (lines) => {
    set({ logLines: lines });
    get().filterLogLines();
  },
  setTimestampRegex: (regex) => set({ timestampRegex: regex }),
  setBootMarkerRegex: (regex) => set({ bootMarkerRegex: regex }),
  setLogLevelRegex: (regex) => set({ logLevelRegex: regex }),
  setLogLevelFilter: (levels) => {
    set({ logLevelFilter: levels });
    get().filterLogLines();
  },

  addHighlight: (text) => set((state) => {
    const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
    const newHighlight: LogHighlight = {
      id: Date.now().toString(),
      text,
      color: colors[state.highlights.length % colors.length],
      enabled: true
    };
    const newState = { highlights: [...state.highlights, newHighlight] };
    setTimeout(() => get().filterLogLines(), 0);
    return newState;
  }),
  removeHighlight: (id) => set((state) => {
    const newState = { highlights: state.highlights.filter(h => h.id !== id) };
    setTimeout(() => get().filterLogLines(), 0);
    return newState;
  }),
  toggleHighlight: (id) => set((state) => {
    const newState = { 
      highlights: state.highlights.map(h => h.id === id ? { ...h, enabled: !h.enabled } : h) 
    };
    setTimeout(() => get().filterLogLines(), 0);
    return newState;
  }),
  setShowOnlyHighlights: (show) => {
    set({ showOnlyHighlights: show });
    get().filterLogLines();
  },

  addProfile: (profile) => set((state) => {
    const newProfiles = [...state.profiles, profile];
    localStorage.setItem('log_profiles', JSON.stringify(newProfiles));
    return { profiles: newProfiles };
  }),
  updateProfile: (profile) => set((state) => {
    const newProfiles = state.profiles.map(p => p.id === profile.id ? profile : p);
    localStorage.setItem('log_profiles', JSON.stringify(newProfiles));
    return { profiles: newProfiles };
  }),
  deleteProfile: (id) => set((state) => {
    const newProfiles = state.profiles.filter(p => p.id !== id);
    localStorage.setItem('log_profiles', JSON.stringify(newProfiles));
    return { 
      profiles: newProfiles,
      activeProfileId: state.activeProfileId === id ? 'default' : state.activeProfileId 
    };
  }),
  setActiveProfile: (id) => set((state) => {
    const profile = state.profiles.find(p => p.id === id);
    if (profile) {
      localStorage.setItem('active_profile_id', id);
      return { 
        activeProfileId: id,
        bootMarkerRegex: profile.bootMarkerRegex,
        logLevelRegex: profile.logLevelRegex
      };
    }
    return state;
  }),

  setActiveView: (view) => set({ activeView: view }),
  setScrollTargetLine: (line) => set({ scrollTargetLine: line }),
  setAnalysisResults: (stats, gaps, workflows) => set({ 
    analysisStats: stats, 
    analysisTimeGaps: gaps, 
    analysisWorkflows: workflows,
    hasAnalyzed: true 
  }),

  // 指标 Actions 实现
  addMetric: (name, regex) => set((state) => {
    const colors = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981'];
    return {
      metrics: [...state.metrics, {
        id: Date.now().toString(),
        name,
        regex,
        data: [],
        color: colors[state.metrics.length % colors.length],
        enabled: true
      }]
    };
  }),
  removeMetric: (id) => set((state) => ({
    metrics: state.metrics.filter(m => m.id !== id)
  })),
  updateMetricData: (id, data) => set((state) => ({
    metrics: state.metrics.map(m => m.id === id ? { ...m, data } : m)
  })),
  toggleMetric: (id) => set((state) => ({
    metrics: state.metrics.map(m => m.id === id ? { ...m, enabled: !m.enabled } : m)
  })),
  
  filterLogLines: () => {
    const { logLines, logLevelFilter, selectedSessionIds, sessions, highlights, showOnlyHighlights } = get();
    let filtered = logLines;

    if (selectedSessionIds.length > 0) {
      filtered = filtered.filter(line => {
        return selectedSessionIds.some(sessionId => {
          const session = sessions.find(s => s.id === sessionId);
          if (!session) return false;
          return line.lineNumber >= session.startLine && 
                 line.lineNumber <= session.endLine;
        });
      });
    }

    if (showOnlyHighlights && highlights.some(h => h.enabled)) {
      const activeHighlights = highlights.filter(h => h.enabled);
      filtered = filtered.filter(line => 
        activeHighlights.some(h => line.content.toLowerCase().includes(h.text.toLowerCase()))
      );
    }
    
    if (logLevelFilter.length > 0) {
      filtered = filtered.filter(line => {
        if (!line.level) return true;
        const standardLevels = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'];
        if (standardLevels.includes(line.level)) {
          return logLevelFilter.includes(line.level);
        }
        return true;
      });
    }
    
    set({ filteredLines: filtered });
  },
}));

// Initialize active profile
const initialState = useLogStore.getState();
if (initialState.profiles.length > 0) {
  const activeProfile = initialState.profiles.find(p => p.id === initialState.activeProfileId) || initialState.profiles[0];
  useLogStore.setState({
    bootMarkerRegex: activeProfile.bootMarkerRegex,
    logLevelRegex: activeProfile.logLevelRegex
  });
}

