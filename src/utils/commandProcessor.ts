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

/**
 * 处理命令模式 (:), 时间模式 (@) 和 AI 模式 (?) 的逻辑
 * @param input 原始输入内容 (不含前缀)
 * @param mode 当前模式
 * @returns 处理结果
 */
export const processCommand = async (input: string, mode: 'command' | 'time' | 'ai'): Promise<CommandResult> => {
  const store = useLogStore.getState();
  const cmd = input.trim();

  if (mode === 'command') {
    // 1. 基础跳转指令
    if (cmd === 'top' || cmd === 't') {
      store.setScrollTargetLine(0);
      return { success: true, message: '已跳转至顶部', action: 'jump' };
    }
    
    if (cmd === 'bot' || cmd === 'b') {
      const target = store.lineCount > 0 ? store.lineCount - 1 : 0;
      store.setScrollTargetLine(target);
      return { success: true, message: '已跳转至底部', action: 'jump' };
    }

    // 2. 行号跳转
    if (/^\d+$/.test(cmd)) {
      const lineNum = parseInt(cmd);
      if (lineNum > 0 && lineNum <= store.lineCount) {
        const idx = lineNum - 1;
        store.setScrollTargetLine(idx);
        store.setFlashLine(idx);
        setTimeout(() => store.setFlashLine(null), 2000);
        return { success: true, message: `已跳转至第 ${lineNum} 行`, action: 'jump' };
      } else {
        return { success: false, message: `行号超出范围 (1-${store.lineCount})` };
      }
    }

    // 3. 导出指令
    if (cmd === 'export' || cmd === 'exp') {
      const displayIndices = store.filteredIndices;
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
      store.setRefinementFilters([]);
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
        store.setScrollTargetLine(targetIdx);
        store.setFlashLine(targetIdx);
        setTimeout(() => store.setFlashLine(null), 2000);
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
    store.addAiMessage({ role: 'user', content: cmd });

    try {
      const context = await collectAiContext();
      const { aiEndpoint, aiModel, aiApiKey, aiSystemPrompt } = useLogStore.getState();
      
      if (!aiApiKey) {
        store.addAiMessage({ 
          role: 'assistant', 
          content: '❌ 未在配置中找到 API Key。请前往左侧“配置”面板设置您的 AI 提供商信息（Endpoint, Model, API Key）。' 
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
注意：
1. 如果发现关键字有助于排查，请在末尾按此格式建议过滤:
   FILTER: <pattern> || <说明建议理由>
   (pattern 规范: 直接写正则，或以 ! 开头表示排除，或以 = 开头表示精确匹配)

2. 如果日志中有可量化的数值（如内存、延迟、温度、码率等），请按此格式建议指标提取:
   METRIC: <指标名称> || <带捕获组的正则表达式> || <指标含义说明>
   (例如: METRIC: 内存占用 || free:(\d+) || 监控剩余内存变化趋势)
`;

      const response = await invoke<string>('call_openai_api', {
        baseUrl: aiEndpoint,
        apiKey: aiApiKey,
        model: aiModel,
        messages: [
          { 
            role: 'system', 
            content: `${aiSystemPrompt}\n${technicalProtocol}` 
          },
          { role: 'user', content: prompt }
        ]
      });

      store.addAiMessage({ role: 'assistant', content: response });
      return { success: true };
    } catch (e) {
      store.addAiMessage({ role: 'assistant', content: `❌ 分析失败: ${e}` });
      return { success: false, message: 'AI 分析失败' };
    } finally {
      store.setAiLoading(false);
    }
  }

  return { success: false };
};
