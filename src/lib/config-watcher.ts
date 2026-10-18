import { watch, type FSWatcher } from 'fs';
import { basename, dirname } from 'path';
import { loadFullConfig, type ProxyConfig } from '../config.js';

/**
 * 记录最近一次由本进程写入配置的时间戳（毫秒）。
 * 用于让 watcher 忽略 saveConfig 自己触发的事件，避免「保存 → 监听 → 再刷新」的重复。
 * 用进程内 Date.now() 而非文件 mtime 比对：mtime 精度/时区在各 OS 上不一致，
 * 同一进程内的单调时钟才是跨平台可靠的判据。
 */
let lastSelfWrite = 0;

/** 标记一次「本进程正在写配置」，供 saveConfig 调用 */
export function markSelfWrite(): void {
  lastSelfWrite = Date.now();
}

/** 清除自写盘标记（测试隔离用） */
export function clearSelfWrite(): void {
  lastSelfWrite = 0;
}

const SELF_WRITE_IGNORE_MS = 2000;
const DEBOUNCE_MS = 200;

/**
 * 监听 config.json 所在目录，在外部修改时热加载配置。
 *
 * 跨平台要点：
 * - 监听「目录」而非文件：Linux(inotify) 下编辑器常见的「删旧建新」保存会让文件级 watcher 失效。
 * - filename 在 macOS(FSEvents) 上可能为 null，此时放行（多重载一次是幂等的，漏掉变更才是问题）。
 * - saveConfig 自己写盘会触发事件，用 markSelfWrite 的时间戳窗口忽略。
 * - 解析/校验失败时保留旧配置并打警告，不让坏配置带崩服务。
 *
 * @returns stop 函数，用于关闭 watcher
 */
export function watchConfigFile(
  configPath: string,
  onConfigChange: (config: ProxyConfig) => void,
  log: (message: string) => void = console.log
): () => void {
  const dir = dirname(configPath);
  const target = basename(configPath);

  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const reload = () => {
    if (closed) return;
    if (Date.now() - lastSelfWrite < SELF_WRITE_IGNORE_MS) {
      return;
    }
    try {
      const config = loadFullConfig(configPath);
      onConfigChange(config);
      log(`🔄 检测到配置文件变更，已热加载`);
    } catch (error: any) {
      // 半截 JSON、校验失败等：忽略本次变更，保留旧配置
      log(`⚠️  配置文件变更无效，已忽略并保留原配置：${error.message}`);
    }
  };

  const scheduleReload = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(reload, DEBOUNCE_MS);
  };

  let watcher: FSWatcher | null = null;
  const attach = () => {
    try {
      watcher = watch(dir, (_eventType, filename) => {
        // macOS 可能不提供 filename；有值时才做过滤
        if (filename && filename !== target) return;
        scheduleReload();
      });
      watcher.on('error', (error) => {
        log(`⚠️  配置文件监听出错，热加载已停止：${error.message}`);
      });
    } catch (error: any) {
      log(`⚠️  无法监听配置文件，热加载不可用：${error.message}`);
    }
  };

  attach();

  return () => {
    closed = true;
    if (timer) clearTimeout(timer);
    watcher?.close();
    watcher = null;
  };
}
