import { useLogStore } from '../store';
import { invoke } from '@tauri-apps/api/core';

export interface LogSample {
  path: string;
  breadcrumbs: string[];
  totalLines: number;
  sampleLines: string;
}

/**
 * 收集当前视图的上下文，用于发送给 AI
 * 会根据行数进行智能采样，防止 Token 超出限制
 */
export const collectAiContext = async (): Promise<LogSample> => {
  const store = useLogStore.getState();
  const indices = store.filteredIndices;
  const total = indices.length;
  
  // 采样策略：如果行数多，采样前 150 行 + 后 150 行
  let targetIndices: number[] = [];
  if (total <= 400) {
    targetIndices = indices;
  } else {
    // 头部采样
    const head = indices.slice(0, 200);
    // 尾部采样
    const tail = indices.slice(-200);
    targetIndices = [...head, ...tail];
  }

  // 从后端获取行内容 (这里不走主列表缓存，确保获取到最新最全的内容)
  const lines = await invoke<any[]>('get_log_lines_by_indices', { 
    indices: targetIndices 
  });

  // 格式化日志
  let contextText = "";
  if (total <= 400) {
    contextText = lines.map(l => `[L${l.line_number}] ${l.content}`).join('\n');
  } else {
    const headLines = lines.slice(0, 200);
    const tailLines = lines.slice(200);
    contextText = [
      headLines.map(l => `[L${l.line_number}] ${l.content}`).join('\n'),
      `\n... (中间由于长度限制被省略了 ${total - 400} 行) ...\n`,
      tailLines.map(l => `[L${l.line_number}] ${l.content}`).join('\n')
    ].join('\n');
  }

  return {
    path: store.files.find(f => f.id === store.currentFileId)?.path || 'Unknown',
    breadcrumbs: store.refinementFilters,
    totalLines: total,
    sampleLines: contextText
  };
};
