import { useLogStore } from '../store';
import { invoke } from '@tauri-apps/api/core';

export interface CommandResult {
  success: boolean;
  message?: string;
  action?: 'export' | 'jump' | 'clear' | 'open' | 'none';
}

/**
 * 处理命令模式 (:) 和时间模式 (@) 的逻辑
 * @param input 原始输入内容 (不含前缀)
 * @param mode 当前模式
 * @returns 处理结果
 */
export const processCommand = async (input: string, mode: 'command' | 'time'): Promise<CommandResult> => {
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
      return { success: true, action: 'export' };
    }

    // 4. 打开新文件
    if (cmd === 'o' || cmd === 'open') {
      return { success: true, action: 'open' };
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

  return { success: false };
};
