import { useLogStore } from '../store';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { loadLogFile } from './logLoader';
import { collectAiContext } from './aiContextCollector';

export interface CommandResult {
  success: boolean;
  message?: string;
  action?: 'export' | 'jump' | 'clear' | 'open' | 'none';
}

const LOG_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'add_filter',
      description: 'Add a search filter (breadcrumb) to narrow down logs. Use this when the user wants to see specific logs or you need to focus on certain patterns.',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'The filter pattern to add. Rules: (1) Plain text like "error" = case-insensitive substring match. (2) IMPORTANT: to use regex, you MUST wrap it with slashes like "/error.*timeout/i" — bare regex without slashes will NOT work as regex. (3) Prefix ! to exclude e.g. "!debug". (4) Prefix = for exact full-line match. Always prefer plain text for simple keywords and /regex/ only when you need multi-word patterns or alternation.'
          },
          reason: {
            type: 'string',
            description: 'Why this filter is being added.'
          }
        },
        required: ['pattern']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'add_metric',
      description: 'Add a numeric metric to track and visualize from logs (e.g., latency, memory).',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Display name of the metric.'
          },
          regex: {
            type: 'string',
            description: 'Regex with exactly one capture group for the numeric value (e.g., "latency:(\\d+)ms").'
          }
        },
        required: ['name', 'regex']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'jump_to_line',
      description: 'Jump the log viewer to a specific line number.',
      parameters: {
        type: 'object',
        properties: {
          line_number: {
            type: 'number',
            description: 'The 1-based line number to jump to.'
          }
        },
        required: ['line_number']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'del_filter',
      description: 'Remove a specific filter from the active filter list by its exact pattern string, or clear ALL filters if no pattern is provided.',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'The exact filter pattern to remove. Omit or pass empty string to clear all filters.'
          }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_log_lines',
      description: 'Read raw log lines around a specific line number to inspect actual log content. Use this to understand what is in the log before filtering or to investigate anomalies.',
      parameters: {
        type: 'object',
        properties: {
          line_number: {
            type: 'number',
            description: 'The center line number (1-based) to read around.'
          },
          context: {
            type: 'number',
            description: 'Number of lines before and after to include (default 15, max 100).'
          }
        },
        required: ['line_number']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_log_content',
      description: 'Search the full log for lines matching a pattern. Returns matching line numbers and content. Use before adding filters to confirm a pattern actually exists.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The text or regex pattern to search for.'
          },
          is_regex: {
            type: 'boolean',
            description: 'Whether to treat query as a regex (default false).'
          },
          max_results: {
            type: 'number',
            description: 'Maximum number of results to return (default 20, max 100).'
          }
        },
        required: ['query']
      }
    }
  }
];

async function handleToolCalls(tool_calls: any[]): Promise<any[]> {
  const store = useLogStore.getState();
  const results = [];

  for (const tool_call of tool_calls) {
    const { name, arguments: argsString } = tool_call.function;
    const args = JSON.parse(argsString);
    let result = "Success";

    console.log(`Executing tool: ${name}`, args);

    if (name === 'add_filter') {
      store.addRefinementFilter(args.pattern);
      result = `Added filter: ${args.pattern}`;
    } else if (name === 'add_metric') {
      store.addMetric(args.name, args.regex);
      result = `Added metric: ${args.name} with regex ${args.regex}`;
    } else if (name === 'jump_to_line') {
      const idx = args.line_number - 1;
      store.setScrollTargetLine(idx);
      store.setFlashLine(idx);
      setTimeout(() => store.setFlashLine(null), 2000);
      result = `Jumped to line: ${args.line_number}`;
    } else if (name === 'del_filter') {
      const pattern = args.pattern as string | undefined;
      if (!pattern) {
        store.setRefinementFilters([]);
        result = 'Cleared all filters.';
      } else {
        const filters = store.refinementFilters;
        const idx = filters.indexOf(pattern);
        if (idx >= 0) {
          store.removeRefinementFilter(idx);
          result = `Removed filter: ${pattern}`;
        } else {
          result = `Filter not found: "${pattern}". Current filters: [${filters.join(', ')}]`;
        }
      }
    } else if (name === 'read_log_lines') {
      const lineNum = Math.max(1, Math.floor(args.line_number));
      const ctx = Math.min(100, Math.max(1, Math.floor(args.context ?? 15)));
      const startLine = Math.max(1, lineNum - ctx);
      const endLine = lineNum + ctx;
      try {
        const lines = await invoke<Array<{ line_number: number; content: string; level: string }>>('get_log_range', {
          startLine,
          endLine
        });
        if (lines.length === 0) {
          result = 'No lines returned (file may not be open or range out of bounds).';
        } else {
          result = lines.map(l => `[L${l.line_number}] ${l.content.trimEnd()}`).join('\n');
        }
      } catch (e) {
        result = `Error reading lines: ${e}`;
      }
    } else if (name === 'search_log_content') {
      const maxResults = Math.min(100, Math.max(1, Math.floor(args.max_results ?? 20)));
      try {
        const lines = await invoke<Array<{ line_number: number; content: string; level: string }>>('search_log', {
          query: args.query as string,
          isRegex: args.is_regex ?? false,
          lineRanges: null
        });
        if (lines.length === 0) {
          result = `No matches found for: "${args.query}"`;
        } else {
          const shown = lines.slice(0, maxResults);
          result = `Found ${lines.length} match(es), showing first ${shown.length}:\n` +
            shown.map(l => `[L${l.line_number}] ${l.content.trimEnd()}`).join('\n');
        }
      } catch (e) {
        result = `Error searching: ${e}`;
      }
    }

    results.push({
      role: 'tool',
      tool_call_id: tool_call.id,
      name: name,
      content: result
    });
  }

  return results;
}

/**
 * 处理命令模式 (:), 时间模式 (@) 和 AI 模式 (?) 的逻辑
 * @param input 原始输入内容 (不含前缀)
 * @param mode 当前模式
 * @param side 是从左窗还是右窗发起的 (用于双分窗模式下的跳转逻辑)
 * @returns 处理结果
 */
export const processCommand = async (input: string, mode: 'command' | 'time' | 'ai', side: 'left' | 'right' = 'left'): Promise<CommandResult> => {
  const store = useLogStore.getState();
  const cmd = input.trim();
  const isLeft = side === 'left';

  if (mode === 'command') {
    // 1. 基础跳转指令
    if (cmd === 'top' || cmd === 't') {
      if (isLeft) store.setScrollTargetLine(0);
      else store.setRightScrollTargetLine(0);
      return { success: true, message: '已跳转至顶部', action: 'jump' };
    }
    
    if (cmd === 'bot' || cmd === 'b') {
      const target = store.lineCount > 0 ? store.lineCount - 1 : 0;
      if (isLeft) store.setScrollTargetLine(target);
      else store.setRightScrollTargetLine(target);
      return { success: true, message: '已跳转至底部', action: 'jump' };
    }

    // 2. 行号跳转
    if (/^\d+$/.test(cmd)) {
      const lineNum = parseInt(cmd);
      if (lineNum > 0 && lineNum <= store.lineCount) {
        const idx = lineNum - 1;
        if (isLeft) {
          store.setScrollTargetLine(idx);
          store.setFlashLine(idx);
          setTimeout(() => store.setFlashLine(null), 2000);
        } else {
          store.setRightScrollTargetLine(idx);
        }
        return { success: true, message: `已跳转至第 ${lineNum} 行`, action: 'jump' };
      } else {
        return { success: false, message: `行号超出范围 (1-${store.lineCount})` };
      }
    }

    // 3. 导出指令
    if (cmd === 'export' || cmd === 'exp') {
      const displayIndices = isLeft ? store.filteredIndices : store.rightFilteredIndices;
      if (displayIndices.length === 0) return { success: false, message: '当前视图无内容可导出' };
      
      try {
        const path = await save({
          filters: [{ name: 'Log File', extensions: ['log', 'txt'] }],
          defaultPath: `export_result_${new Date().getTime()}.log`
        });

        if (path) {
          await invoke('save_filtered_logs', { path, indices: displayIndices });
          return { success: true, message: '导出成功', action: 'export' };
        }
        return { success: false }; // 用户取消
      } catch (e) {
        return { success: false, message: '导出失败: ' + e };
      }
    }

    // 4. 打开新文件
    if (cmd === 'o' || cmd === 'open') {
      try {
        const path = await open({
          multiple: false,
          filters: [{ name: 'Log Files', extensions: ['log', 'txt', 'out', 'txt*'] }]
        });
        if (path && typeof path === 'string') {
          await loadLogFile(path);
          return { success: true, action: 'open' };
        }
        return { success: false }; // 用户取消
      } catch (e) {
        return { success: false, message: '打开文件失败: ' + e };
      }
    }

    // 5. 清空精简器
    if (cmd === 'clear') {
      if (isLeft) store.setRefinementFilters([]);
      else store.setRightRefinementFilters([]);
      return { success: true, message: '已清空所有精简器', action: 'clear' };
    }

    return { success: false, message: `未知指令: ${cmd}` };
  }

  if (mode === 'time') {
    if (!cmd) return { success: false };

    try {
      // 获取当前选中的 Session 范围，如果没有选中则搜索全量
      const sessionRanges = store.selectedSessionIds.length > 0
        ? store.sessions
            .filter(s => store.selectedSessionIds.includes(s.id))
            .map(s => [s.startLine, s.endLine])
        : null;

      // 调用后端查找第一个匹配的行号 (0-based)
      const targetIdx = await invoke<number | null>('find_first_occurrence', {
        query: cmd,
        lineRanges: sessionRanges
      });

      if (targetIdx !== null) {
        if (isLeft) {
          store.setScrollTargetLine(targetIdx);
          store.setFlashLine(targetIdx);
          setTimeout(() => store.setFlashLine(null), 2000);
        } else {
          store.setRightScrollTargetLine(targetIdx);
        }
        return { success: true, message: `已定位到包含 "${cmd}" 的行`, action: 'jump' };
      } else {
        return { success: false, message: `未找到时间标记: ${cmd}` };
      }
    } catch (e) {
      return { success: false, message: '跳转失败: ' + e };
    }
  }

  if (mode === 'ai') {
    if (!cmd) return { success: false };

    store.setAiPanelOpen(true);
    store.setAiLoading(true);

    try {
      const context = await collectAiContext();
      // 在 addAiMessage 之前捕获历史，这样历史不含本轮 user 消息
      const { aiEndpoint, aiModel, aiApiKey, aiSystemPrompt, aiMessages, aiMaxIterations } = useLogStore.getState();

      store.addAiMessage({ role: 'user', content: cmd });

      if (!aiApiKey) {
        store.addAiMessage({ 
          role: 'assistant', 
          content: '❌ 未在配置中找到 API Key。请前往左侧"配置"面板设置您的 AI 提供商信息（Endpoint, Model, API Key）。' 
        });
        return { success: true }; 
      }

      // 如果行数太多且没有面包屑，给个提示
      if (context.totalLines > 2000 && context.breadcrumbs.length === 0) {
        store.addAiMessage({ 
          role: 'assistant', 
          content: '⚠️ 当前数据量较大且无过滤条件，建议通过面包屑（如输入 "error" 或 "!ignore"）缩小范围，分析会更准确。' 
        });
      }

      const prompt = `分析路径: ${context.breadcrumbs.join(' -> ') || '全文'}\n分析文件: ${context.path}\n用户提议: ${cmd}\n\n日志采样内容:\n${context.sampleLines}`;
      
      const technicalProtocol = `
---
你是一个自主分析 Agent，可以反复调用工具来缩小范围、定位问题，直到找到答案再输出总结。
工具说明:
- add_filter: 添加过滤条件缩小日志范围
- add_metric: 提取数值指标用于趋势分析
- jump_to_line: 跳转到关键行让用户查看
策略: 如果一次过滤后还有疑问，继续调用工具深入分析，不要过早给出模糊结论。
`;

      // 构建本轮 Agent 运行的消息列表（独立维护，不依赖 store 状态变化）
      let runMessages: any[] = [
        { 
          role: 'system', 
          content: `${aiSystemPrompt}\n${technicalProtocol}` 
        },
        // aiMessages 是本轮前的历史，直接用，不需要 slice
        ...aiMessages.map(m => ({
          role: m.role,
          content: m.content,
          tool_calls: m.tool_calls,
          tool_call_id: m.tool_call_id,
          name: m.name
        })),
        { role: 'user', content: prompt }
      ];

      // 限制总历史长度，保留 system + 最近 11 条
      if (runMessages.length > 12) {
        runMessages = [runMessages[0], ...runMessages.slice(-11)];
      }

      // === Agent 循环：最多 N 轮，直到 AI 不再调用工具为止 ===
      store.setAiShouldAbort(false);
      const MAX_ITERATIONS = aiMaxIterations;
      let iterations = 0;

      while (iterations < MAX_ITERATIONS) {
        // 用户点击停止
        if (useLogStore.getState().aiShouldAbort) {
          store.addAiMessage({ role: 'assistant', content: '⏹️ 已手动停止分析。' });
          break;
        }
        iterations++;

        const response = await invoke<any>('call_openai_api', {
          baseUrl: aiEndpoint,
          apiKey: aiApiKey,
          model: aiModel,
          messages: runMessages,
          tools: LOG_TOOLS
        });

        // 存入 store 显示，同时追加进本轮消息链
        store.addAiMessage({ 
          role: 'assistant', 
          content: response.content || null,
          tool_calls: response.tool_calls
        });
        runMessages.push({
          role: 'assistant',
          content: response.content || null,
          tool_calls: response.tool_calls
        });

        // 没有工具调用 → AI 分析完毕，退出循环
        if (!response.tool_calls || response.tool_calls.length === 0) {
          break;
        }

        // 执行工具调用，结果追加进消息链
        const toolResults = await handleToolCalls(response.tool_calls);
        for (const res of toolResults) {
          store.addAiMessage(res);
          runMessages.push(res);
        }
      }

      if (iterations >= MAX_ITERATIONS && !useLogStore.getState().aiShouldAbort) {
        store.addAiMessage({
          role: 'assistant',
          content: `⚠️ 已达到最大分析轮次（${MAX_ITERATIONS}轮），自动停止。如需继续，请追问。`
        });
      }

      return { success: true };
    } catch (e) {
      console.error("AI Error:", e);
      store.addAiMessage({ role: 'assistant', content: `❌ 分析失败: ${e}` });
      return { success: false, message: 'AI 分析失败' };
    } finally {
      store.setAiLoading(false);
    }
  }
  return { success: false };
};