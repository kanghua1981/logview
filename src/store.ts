import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

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
  name?: string; // 用户自定义会话名称
  splitType?: 'boot' | 'custom'; // 分割类型
}

export interface SessionSplitter {
  id: string;
  name: string;
  regex: string;
  enabled: boolean;
  isRegex: boolean; // 新增：是否使用正则表达式
  color?: string; // 用于UI显示
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
  timestampRegex: string;
  timeGapThreshold?: number;
}

const DEFAULT_PROFILES: LogProfile[] = [
  { 
    id: 'default', 
    name: '标准模式', 
    bootMarkerRegex: '(?i)(system|boot|start)(ed|ing|up)',
    logLevelRegex: '(?i)\\b(DEBUG|INFO|WARN|ERROR|FATAL)\\b',
    timestampRegex: '\\[(.*?)\\]'
  },
  { 
    id: 'uboot', 
    name: 'U-Boot/Kernel', 
    bootMarkerRegex: 'U-Boot|Linux version',
    logLevelRegex: '(?i)\\b(DEBUG|INFO|WARN|ERROR|FATAL)\\b',
    timestampRegex: '\\[(.*?)\\]'
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
  files: LogFile[];
  currentFileId: string | null;
  sessions: LogSession[];
  selectedSessionIds: number[];
  sessionSplitters: SessionSplitter[]; 
  activeSessionMode: 'boot' | 'custom';
  
  // 核心数据优化：不再存储几十万个对象
  lineLevels: (string | null)[];
  lineCount: number;
  // 缓存已拉取内容的文件行 (只有可见区域才会有 content)
  lineContents: Map<number, string>;
  
  filteredIndices: number[]; // 存储过滤后的行号索引（0-based）
  
  profiles: LogProfile[];
  activeProfileId: string;
  bootMarkerRegex: string;
  logLevelRegex: string;
  timestampRegex: string;
  timeGapThreshold: number; // 新增：时间间隙阈值（秒），0 表示禁用
  logLevelFilter: string[];
  highlights: LogHighlight[];
  highlightContextLines: number;
  showOnlyHighlights: boolean;

  // 跳转控制
  scrollTargetLine: number | null;
  flashLine: number | null;
  currentVisibleLine: number;
  activeView: 'log' | 'dashboard' | 'metrics';

  // 独立查询结果
  searchQuery: string;
  searchResults: LogLine[];
  isSearchPanelOpen: boolean;
  searchOnlySelectedSessions: boolean;
  isSearchRegex: boolean;

  // 字体大小
  fontSize: number;
  refinementFilters: string[];
  transientRefinement: string;

  // 新增指标追踪
  metrics: LogMetric[];
  
  // 智能分析结果持久化
  analysisStats: any[];
  analysisTimeGaps: any[];
  analysisWorkflows: any[];
  hasAnalyzedStats: boolean;
  hasAnalyzedWorkflows: boolean;

  // Actions
  addFile: (file: LogFile) => void;
  removeFile: (id: string) => void;
  setCurrentFile: (id: string) => void;
  setSessions: (sessions: LogSession[]) => void;
  setSelectedSessions: (ids: number[]) => void;
  
  // 新的高性能加载 Action
  setParsedLog: (parsed: { sessions: LogSession[], levels: (string|null)[], line_count: number }) => void;
  
  // 会话分割器管理
  addSessionSplitter: (name: string, regex: string, isRegex: boolean) => void;
  removeSessionSplitter: (id: string) => void;
  toggleSessionSplitter: (id: string) => void;
  updateSessionSplitter: (id: string, regex: string) => void;
  setActiveSessionMode: (mode: 'boot' | 'custom') => void;
  applySessionSplitters: () => Promise<void>;
  setTimeGapThreshold: (threshold: number) => void;
  setTimestampRegex: (regex: string) => void;
  setBootMarkerRegex: (regex: string) => void;
  setLogLevelRegex: (regex: string) => void;
  setLogLevelFilter: (levels: string[]) => void;
  addHighlight: (text: string) => void;
  removeHighlight: (id: string) => void;
  toggleHighlight: (id: string) => void;
  setShowOnlyHighlights: (show: boolean) => void;
  setHighlightContextLines: (lines: number) => void;
  addProfile: (profile: LogProfile) => void;
  updateProfile: (profile: LogProfile) => void;
  deleteProfile: (id: string) => void;
  setActiveProfile: (id: string) => void;

  // 视图 & 跳转 Actions
  setActiveView: (view: 'log' | 'dashboard' | 'metrics') => void;
  setScrollTargetLine: (line: number | null) => void;
  setFlashLine: (line: number | null) => void;
  setCurrentVisibleLine: (line: number) => void;
  setAnalysisStatsResults: (stats: any[], gaps: any[]) => void;
  setAnalysisWorkflowResults: (workflows: any[]) => void;

  // 独立查询 Actions
  setSearchQuery: (query: string) => void;
  performSearch: () => void;
  setSearchPanelOpen: (open: boolean) => void;
  setSearchOnlySelectedSessions: (only: boolean) => void;
  setSearchRegex: (isRegex: boolean) => void;
  addRefinementFilter: (term: string) => void;
  removeRefinementFilter: (index: number) => void;
  setRefinementFilters: (filters: string[]) => void;
  setTransientRefinement: (term: string) => void;
  setFontSize: (size: number | ((prev: number) => number)) => void;

  // 新增指标 Actions
  addMetric: (name: string, regex: string) => void;
  removeMetric: (id: string) => void;
  updateMetricRegex: (id: string, regex: string) => void;
  updateMetricData: (id: string, data: any[]) => void;
  toggleMetric: (id: string) => void;
  
  // 导入导出配置
  exportConfig: () => string;
  importConfig: (json: string) => boolean;
  exportHighlights: () => string;
  importHighlights: (json: string) => boolean;

  updateLogLinesContent: (updatedLines: LogLine[]) => void;
  filterLogLines: () => Promise<void>;
}

export const useLogStore = create<LogViewState>((set, get) => ({
  files: [],
  currentFileId: null,
  sessions: [],
  selectedSessionIds: [],
  sessionSplitters: JSON.parse(localStorage.getItem('session_splitters') || '[]'),
  activeSessionMode: (localStorage.getItem('active_session_mode') as 'boot' | 'custom') || 'boot',
  lineLevels: [],
  lineCount: 0,
  lineContents: new Map(),
  filteredIndices: [],
  profiles: JSON.parse(localStorage.getItem('log_profiles') || JSON.stringify(DEFAULT_PROFILES)),
  activeProfileId: localStorage.getItem('active_profile_id') || 'default',
  bootMarkerRegex: localStorage.getItem('boot_marker_regex') || '',
  logLevelRegex: localStorage.getItem('log_level_regex') || '',
  timestampRegex: localStorage.getItem('timestamp_regex') || '\\[(.*?)\\]', 
  timeGapThreshold: Number(localStorage.getItem('time_gap_threshold')) || 0,
  logLevelFilter: JSON.parse(localStorage.getItem('log_level_filter') || '["DEBUG", "INFO", "NORM", "WARN", "ERROR", "FATAL", "TRACE", "SUCCESS"]'),
  highlights: JSON.parse(localStorage.getItem('highlights') || '[]'),
  highlightContextLines: Number(localStorage.getItem('highlight_context_lines')) || 0,
  showOnlyHighlights: localStorage.getItem('show_only_highlights') === 'true',
  metrics: JSON.parse(localStorage.getItem('metrics') || '[]'),
  scrollTargetLine: null,
  flashLine: null,
  currentVisibleLine: 1,
  activeView: 'log',
  searchQuery: '',
  searchResults: [],
  isSearchPanelOpen: false,
  searchOnlySelectedSessions: false,
  isSearchRegex: false,
  fontSize: Number(localStorage.getItem('font_size')) || 12,
  refinementFilters: [],
  transientRefinement: '',
  analysisStats: [],
  analysisTimeGaps: [],
  analysisWorkflows: [],
  hasAnalyzedStats: false,
  hasAnalyzedWorkflows: false,
  
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
      lineLevels: isCurrent ? [] : state.lineLevels,
      lineCount: isCurrent ? 0 : state.lineCount,
      lineContents: isCurrent ? new Map() : state.lineContents,
      filteredIndices: isCurrent ? [] : state.filteredIndices,
      refinementFilters: isCurrent ? [] : state.refinementFilters,
      transientRefinement: isCurrent ? '' : state.transientRefinement,
      sessions: isCurrent ? [] : state.sessions,
      selectedSessionIds: isCurrent ? [] : state.selectedSessionIds,
      metrics: isCurrent ? state.metrics.map(m => ({ ...m, data: [] })) : state.metrics,
      scrollTargetLine: isCurrent ? null : state.scrollTargetLine,
      analysisStats: isCurrent ? [] : state.analysisStats,
      analysisTimeGaps: isCurrent ? [] : state.analysisTimeGaps,
      analysisWorkflows: isCurrent ? [] : state.analysisWorkflows,
      hasAnalyzedStats: isCurrent ? false : state.hasAnalyzedStats,
      hasAnalyzedWorkflows: isCurrent ? false : state.hasAnalyzedWorkflows
    };
  }),
  
  setCurrentFile: (id) => set((state) => ({ 
    currentFileId: id,
    lineLevels: [],
    lineCount: 0,
    lineContents: new Map(),
    filteredIndices: [],
    sessions: [],
    selectedSessionIds: [],
    refinementFilters: [],
    transientRefinement: '',
    metrics: state.metrics.map(m => ({ ...m, data: [] })),
    scrollTargetLine: null,
    analysisStats: [],
    analysisTimeGaps: [],
    analysisWorkflows: [],
    hasAnalyzedStats: false,
    hasAnalyzedWorkflows: false
  })),
  setSessions: (sessions) => set({ sessions }),
  setSelectedSessions: (ids) => {
    set({ selectedSessionIds: ids });
    get().filterLogLines();
    if (get().isSearchPanelOpen && get().searchOnlySelectedSessions) {
      get().performSearch();
    }
  },
  
  setParsedLog: (parsed) => {
    set({ 
      sessions: parsed.sessions, 
      lineLevels: parsed.levels, 
      lineCount: parsed.line_count,
      lineContents: new Map()
    });
    get().filterLogLines();
  },

  setTimeGapThreshold: (threshold) => {
    localStorage.setItem('time_gap_threshold', threshold.toString());
    set({ timeGapThreshold: threshold });
  },
  setTimestampRegex: (regex) => {
    localStorage.setItem('timestamp_regex', regex);
    set({ timestampRegex: regex });
  },
  setBootMarkerRegex: (regex) => {
    localStorage.setItem('boot_marker_regex', regex);
    set({ bootMarkerRegex: regex });
  },
  setLogLevelRegex: (regex) => {
    localStorage.setItem('log_level_regex', regex);
    set({ logLevelRegex: regex });
  },
  setLogLevelFilter: (levels) => {
    localStorage.setItem('log_level_filter', JSON.stringify(levels));
    set({ logLevelFilter: levels });
    get().filterLogLines();
  },

  updateLogLinesContent: (updatedLines) => {
    set(state => {
      const newContents = new Map(state.lineContents);
      updatedLines.forEach(l => {
        newContents.set(l.lineNumber, l.content);
      });
      return { lineContents: newContents };
    });
  },

  addHighlight: (text) => set((state) => {
    const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
    const newHighlight: LogHighlight = {
      id: Date.now().toString(),
      text,
      color: colors[state.highlights.length % colors.length],
      enabled: true
    };
    const newHighlights = [...state.highlights, newHighlight];
    localStorage.setItem('highlights', JSON.stringify(newHighlights));
    const newState = { highlights: newHighlights };
    setTimeout(() => get().filterLogLines(), 0);
    return newState;
  }),
  removeHighlight: (id) => set((state) => {
    const newHighlights = state.highlights.filter(h => h.id !== id);
    localStorage.setItem('highlights', JSON.stringify(newHighlights));
    const newState = { highlights: newHighlights };
    setTimeout(() => get().filterLogLines(), 0);
    return newState;
  }),
  toggleHighlight: (id) => set((state) => {
    const newHighlights = state.highlights.map(h => h.id === id ? { ...h, enabled: !h.enabled } : h);
    localStorage.setItem('highlights', JSON.stringify(newHighlights));
    const newState = { highlights: newHighlights };
    setTimeout(() => get().filterLogLines(), 0);
    return newState;
  }),
  setShowOnlyHighlights: (show) => {
    localStorage.setItem('show_only_highlights', show.toString());
    set({ showOnlyHighlights: show });
    get().filterLogLines();
  },
  setHighlightContextLines: (lines) => {
    localStorage.setItem('highlight_context_lines', lines.toString());
    set({ highlightContextLines: lines });
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
      localStorage.setItem('boot_marker_regex', profile.bootMarkerRegex);
      localStorage.setItem('log_level_regex', profile.logLevelRegex);
      localStorage.setItem('timestamp_regex', profile.timestampRegex || '\\[(.*?)\\]');
      localStorage.setItem('time_gap_threshold', (profile.timeGapThreshold || 0).toString());
      
      return { 
        activeProfileId: id,
        bootMarkerRegex: profile.bootMarkerRegex,
        logLevelRegex: profile.logLevelRegex,
        timestampRegex: profile.timestampRegex || '\\[(.*?)\\]',
        timeGapThreshold: profile.timeGapThreshold || 0
      };
    }
    return state;
  }),

  setActiveView: (view) => set({ activeView: view }),
  setScrollTargetLine: (line) => set({ scrollTargetLine: line, flashLine: line }),
  setFlashLine: (line) => set({ flashLine: line }),
  setCurrentVisibleLine: (line) => set({ currentVisibleLine: line }),
  
  setSearchQuery: (query) => set({ searchQuery: query }),
  addRefinementFilter: (term) => {
    if (!term.trim()) return;
    set(state => ({ refinementFilters: [...state.refinementFilters, term.trim()] }));
    get().filterLogLines();
  },
  removeRefinementFilter: (index) => {
    set(state => ({ refinementFilters: state.refinementFilters.filter((_, i) => i !== index) }));
    get().filterLogLines();
  },
  setRefinementFilters: (filters) => {
    set({ refinementFilters: filters });
    get().filterLogLines();
  },
  setTransientRefinement: (term) => {
    set({ transientRefinement: term });
    get().filterLogLines();
  },
  setSearchPanelOpen: (open) => set({ isSearchPanelOpen: open }),
  setSearchOnlySelectedSessions: (only) => {
    set({ searchOnlySelectedSessions: only });
    get().performSearch();
  },
  setSearchRegex: (isRegex) => {
    set({ isSearchRegex: isRegex });
    get().performSearch();
  },
  setFontSize: (size) => set((state) => {
    const newSize = typeof size === 'function' ? size(state.fontSize) : size;
    const clampedSize = Math.max(8, Math.min(30, newSize)); // 限制在 8px - 30px
    localStorage.setItem('font_size', clampedSize.toString());
    return { fontSize: clampedSize };
  }),
  performSearch: async () => {
    const { searchQuery, isSearchRegex, searchOnlySelectedSessions, selectedSessionIds, sessions } = get();
    if (!searchQuery.trim()) {
      set({ searchResults: [], isSearchPanelOpen: false });
      return;
    }
    
    try {
      // 计算搜索范围
      let lineRanges = null;
      if (searchOnlySelectedSessions && selectedSessionIds.length > 0) {
        // 只有在选边了会话的情况下才应用范围限制
        lineRanges = selectedSessionIds.map(id => {
          const s = sessions.find(sess => sess.id === id);
          return s ? [s.startLine, s.endLine] : null;
        }).filter(Boolean);
      }

      const results = await invoke<any[]>('search_log', {
        query: searchQuery, // 不再在前端 trim，改由后端精确处理换行符
        isRegex: isSearchRegex,
        lineRanges
      });
      
      set({ 
        searchResults: results.map(l => ({
          lineNumber: l.line_number,
          content: l.content,
          level: l.level as any
        })), 
        isSearchPanelOpen: true 
      });
    } catch (e) {
      console.error('Search failed:', e);
    }
  },

  setAnalysisStatsResults: (stats, gaps) => set({ 
    analysisStats: stats, 
    analysisTimeGaps: gaps, 
    hasAnalyzedStats: true 
  }),
  setAnalysisWorkflowResults: (workflows) => set({ 
    analysisWorkflows: workflows, 
    hasAnalyzedWorkflows: true 
  }),

  // 指标 Actions 实现
  addMetric: (name, regex) => set((state) => {
    const colors = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981'];
    const newMetrics = [...state.metrics, {
      id: Date.now().toString(),
      name,
      regex,
      data: [],
      color: colors[state.metrics.length % colors.length],
      enabled: true
    }];
    localStorage.setItem('metrics', JSON.stringify(newMetrics));
    return { metrics: newMetrics };
  }),
  removeMetric: (id) => set((state) => {
    const newMetrics = state.metrics.filter(m => m.id !== id);
    localStorage.setItem('metrics', JSON.stringify(newMetrics));
    return { metrics: newMetrics };
  }),
  updateMetricRegex: (id, regex) => set((state) => {
    const newMetrics = state.metrics.map(m => m.id === id ? { ...m, regex, data: [] } : m);
    localStorage.setItem('metrics', JSON.stringify(newMetrics));
    return { metrics: newMetrics };
  }),
  updateMetricData: (id, data) => set((state) => ({
    metrics: state.metrics.map(m => m.id === id ? { ...m, data } : m)
  })),
  toggleMetric: (id) => set((state) => {
    const newMetrics = state.metrics.map(m => m.id === id ? { ...m, enabled: !m.enabled } : m);
    localStorage.setItem('metrics', JSON.stringify(newMetrics));
    return { metrics: newMetrics };
  }),
  exportConfig: () => {
    const state = get();
    const config = {
      version: '1.0',
      timestamp: new Date().toISOString(),
      analysis: {
        bootMarkerRegex: state.bootMarkerRegex,
        logLevelRegex: state.logLevelRegex,
        timestampRegex: state.timestampRegex,
        timeGapThreshold: state.timeGapThreshold,
        logLevelFilter: state.logLevelFilter,
        activeSessionMode: state.activeSessionMode,
      },
      sessionSplitters: state.sessionSplitters,
      highlights: state.highlights,
      metrics: state.metrics.map(({ id, name, regex, color, enabled }) => ({
        id, name, regex, color, enabled, data: [] // 不导出提取出的数据
      }))
    };
    return JSON.stringify(config, null, 2);
  },

  importConfig: (json: string) => {
    try {
      const config = JSON.parse(json);
      if (!config.analysis) throw new Error('无效的配置文件');

      set({
        bootMarkerRegex: config.analysis.bootMarkerRegex || '',
        logLevelRegex: config.analysis.logLevelRegex || '',
        timestampRegex: config.analysis.timestampRegex || '',
        timeGapThreshold: config.analysis.timeGapThreshold || 0,
        logLevelFilter: config.analysis.logLevelFilter || [],
        activeSessionMode: config.analysis.activeSessionMode || 'boot',
        sessionSplitters: config.sessionSplitters || [],
        highlights: config.highlights || [],
        metrics: config.metrics || [],
      });

      // 同步到本地存储
      localStorage.setItem('session_splitters', JSON.stringify(config.sessionSplitters || []));
      localStorage.setItem('active_session_mode', config.analysis.activeSessionMode || 'boot');
      localStorage.setItem('highlights', JSON.stringify(config.highlights || []));
      localStorage.setItem('metrics', JSON.stringify(config.metrics || []));
      localStorage.setItem('boot_marker_regex', config.analysis.bootMarkerRegex || '');
      localStorage.setItem('log_level_regex', config.analysis.logLevelRegex || '');
      localStorage.setItem('timestamp_regex', config.analysis.timestampRegex || '');
      localStorage.setItem('time_gap_threshold', (config.analysis.timeGapThreshold || 0).toString());
      localStorage.setItem('log_level_filter', JSON.stringify(config.analysis.logLevelFilter || []));
      
      // 触发一次过滤
      setTimeout(() => get().filterLogLines(), 0);
      
      return true;
    } catch (err) {
      console.error('Failed to import config:', err);
      // alert('导入失败: ' + err);
      return false;
    }
  },

  exportHighlights: () => {
    return JSON.stringify({ 
      type: 'logview-highlights',
      version: '1.0',
      highlights: get().highlights 
    }, null, 2);
  },

  importHighlights: (json: string) => {
    try {
      const data = JSON.parse(json);
      if (data.type !== 'logview-highlights' || !Array.isArray(data.highlights)) {
        return false;
      }
      set({ highlights: data.highlights });
      localStorage.setItem('highlights', JSON.stringify(data.highlights));
      get().filterLogLines();
      return true;
    } catch (e) {
      return false;
    }
  },
  
  // 会话分割器管理实现
  addSessionSplitter: (name, regex, isRegex) => set((state) => {
    const colors = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];
    const newSplitter: SessionSplitter = {
      id: Date.now().toString(),
      name,
      regex,
      enabled: true,
      isRegex,
      color: colors[state.sessionSplitters.length % colors.length]
    };
    const newSplitters = [...state.sessionSplitters, newSplitter];
    localStorage.setItem('session_splitters', JSON.stringify(newSplitters));
    return { sessionSplitters: newSplitters };
  }),
  
  removeSessionSplitter: (id) => set((state) => {
    const newSplitters = state.sessionSplitters.filter(s => s.id !== id);
    localStorage.setItem('session_splitters', JSON.stringify(newSplitters));
    return { sessionSplitters: newSplitters };
  }),
  
  toggleSessionSplitter: (id) => set((state) => {
    const newSplitters = state.sessionSplitters.map(s => 
      s.id === id ? { ...s, enabled: !s.enabled } : s
    );
    localStorage.setItem('session_splitters', JSON.stringify(newSplitters));
    return { sessionSplitters: newSplitters };
  }),
  
  updateSessionSplitter: (id, regex) => set((state) => {
    const newSplitters = state.sessionSplitters.map(s => 
      s.id === id ? { ...s, regex } : s
    );
    localStorage.setItem('session_splitters', JSON.stringify(newSplitters));
    return { sessionSplitters: newSplitters };
  }),
  
  setActiveSessionMode: (mode) => {
    localStorage.setItem('active_session_mode', mode);
    set({ activeSessionMode: mode });
  },
  
  applySessionSplitters: async () => {
    const state = get();
    const currentFile = state.files.find(f => f.id === state.currentFileId);
    if (!currentFile) return;
    
    const { loadLogFile } = await import('./components/FileManager');
    await loadLogFile(currentFile.path);
  },
  
  filterLogLines: async () => {
    const { 
      lineCount, 
      logLevelFilter, 
      selectedSessionIds, 
      sessions, 
      highlights, 
      showOnlyHighlights,
      highlightContextLines
    } = get();
    
    // 1. 基础范围：会话过滤
    let lineRanges: [number, number][] | null = null;
    if (selectedSessionIds && selectedSessionIds.length > 0) {
      lineRanges = selectedSessionIds.map(id => {
        const s = sessions.find(sess => sess.id === id);
        return s ? [s.startLine, s.endLine] : null;
      }).filter((r): r is [number, number] => r !== null);
    }

    try {
      const activeHighlights = showOnlyHighlights 
        ? highlights.filter(h => h.enabled).map(h => h.text)
        : [];

      // 核心调整：如果在脱水模式下没有有效的关键字，我们不应该显示全部，而是显示空或者警告
      // 这里的逻辑维持现状（显示空），但要确保 activeHighlights 抓取到了内容
      if (showOnlyHighlights && activeHighlights.length === 0) {
        console.warn('Dehydration mode on but no active highlights found.');
        set({ filteredIndices: [] });
        return;
      }

      const indices = await invoke<number[]>('get_filtered_indices', {
        logLevels: logLevelFilter,
        lineRanges: lineRanges,
        highlights: activeHighlights,
        contextLines: showOnlyHighlights ? highlightContextLines : 0,
        refinements: [...get().refinementFilters, get().transientRefinement].filter(r => r.trim() !== '')
      });
      
      set({ filteredIndices: indices });
    } catch (err) {
      console.error('Failed to filter logs:', err);
      // 回退方案：至少显示会话范围内的日志
      const simpleIndices = [];
      if (lineRanges) {
        for (const [start, end] of lineRanges) {
          for (let i = start - 1; i < end; i++) simpleIndices.push(i);
        }
      } else {
        for (let i = 0; i < lineCount; i++) simpleIndices.push(i);
      }
      set({ filteredIndices: simpleIndices });
    }
  },
}));

// Initialize active profile if no saved regex found
const initialState = useLogStore.getState();
if (!localStorage.getItem('boot_marker_regex') && initialState.profiles.length > 0) {
  const activeProfile = initialState.profiles.find(p => p.id === initialState.activeProfileId) || initialState.profiles[0];
  useLogStore.setState({
    bootMarkerRegex: activeProfile.bootMarkerRegex,
    logLevelRegex: activeProfile.logLevelRegex,
    timestampRegex: activeProfile.timestampRegex || '\\[(.*?)\\]'
  });
}

