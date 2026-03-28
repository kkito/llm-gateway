#!/usr/bin/env node

import { Command } from 'commander';
import { serve } from '@hono/node-server';
import { loadConfig, getProxyDir, createDefaultConfig } from '../config.js';
import { Logger } from '../logger.js';
import { DetailLogger } from '../detail-logger.js';
import { createServer } from '../server.js';
import { existsSync, writeFileSync, readFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

interface CliOptions {
  dir: string;
  config: string;
  logDir: string;
  port: number;
  timeout: number;
  daemon: boolean;
  stop: boolean;
  debug: boolean;
}

/**
 * 解析配置目录
 * 优先级：--config/--log-dir 指定值 > --dir 指定值 > 默认 ~/.llm-gateway/
 */
function resolvePaths(options: CliOptions) {
  const defaultDir = getProxyDir();
  const userDir = options.dir || defaultDir;

  // 如果用户指定了 --config，使用用户值；否则使用 defaultDir/config.json
  const configPath = options.config
    ? options.config
    : join(userDir, 'config.json');

  // 如果用户指定了 --log-dir，使用用户值；否则使用 defaultDir/logs/proxy
  const logDirPath = options.logDir
    ? options.logDir
    : join(userDir, 'logs/proxy');

  // 详细日志目录
  const detailLogDir = options.logDir
    ? join(options.logDir, '..')
    : join(userDir, 'logs');

  return { configPath, logDirPath, detailLogDir, userDir };
}

/**
 * 获取 PID 文件路径
 */
function getPidFile(userDir: string): string {
  return join(userDir, 'llm-proxy.pid');
}

/**
 * 检查是否已在运行
 */
function checkRunning(pidFile: string): number | null {
  if (!existsSync(pidFile)) {
    return null;
  }
  try {
    const pid = parseInt(readFileSync(pidFile, 'utf-8').trim());
    // 检查进程是否存在
    process.kill(pid, 0);
    return pid;
  } catch (e) {
    // 进程不存在，删除 PID 文件
    try {
      unlinkSync(pidFile);
    } catch (e) {
      // 忽略删除失败
    }
    return null;
  }
}

/**
 * 停止正在运行的服务
 */
function stopRunning(pidFile: string, userDir: string): void {
  const pid = checkRunning(pidFile);
  if (pid) {
    console.log(`🛑 正在停止已运行的服务 (PID: ${pid})...`);
    try {
      process.kill(pid, 'SIGTERM');
      // 等待进程退出
      setTimeout(() => {
        try {
          process.kill(pid, 0);
          console.log('⚠️  进程未正常退出，强制终止...');
          process.kill(pid, 'SIGKILL');
        } catch (e) {
          // 进程已退出
        }
      }, 3000);
    } catch (e: any) {
      console.log(`⚠️  停止失败：${e.message}`);
    }
  }
  try {
    unlinkSync(pidFile);
  } catch (e) {
    // 忽略删除失败
  }
}

/**
 * 以守护进程方式启动
 */
function startDaemon(options: CliOptions, userDir: string): void {
  const pidFile = getPidFile(userDir);
  
  // 检查是否已在运行
  const runningPid = checkRunning(pidFile);
  if (runningPid) {
    console.log(`⚠️  服务已在后台运行 (PID: ${runningPid})`);
    console.log('   如需重启，请先停止：kill ' + runningPid);
    return;
  }

  // 获取当前脚本路径
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const scriptPath = join(__dirname, 'start.js');

  // 构建子进程参数
  const args = process.argv.slice(2).filter(arg => arg !== '-D' && arg !== '--daemon');

  // 启动子进程
  const child = spawn(process.execPath, [scriptPath, ...args], {
    detached: true,
    stdio: 'ignore'
  });

  // 写 PID 文件
  writeFileSync(pidFile, child.pid!.toString());

  console.log('🚀 LLM Proxy 已后台启动');
  console.log(`   PID: ${child.pid}`);
  console.log(`   端口：http://localhost:${options.port}`);
  console.log(`   健康检查：http://localhost:${options.port}/health`);
  console.log(`   工作目录：${userDir}`);
  console.log(`\n停止服务:`);
  console.log(`   kill ${child.pid}`);
  console.log(`   或：llm-gateway-start --stop`);
  console.log(`\n查看日志:`);
  console.log(`   tail -f ${join(userDir, 'logs/proxy')}/proxy-*.log`);

  // 父进程退出
  process.exit(0);
}

/**
 * 停止后台服务
 */
function stopDaemon(userDir: string): void {
  const pidFile = getPidFile(userDir);
  stopRunning(pidFile, userDir);
  console.log('✓ 服务已停止');
}

function main() {
  const program = new Command();

  program
    .name('llm-gateway-start')
    .description('启动 LLM 代理服务器')
    .option('-d, --dir <path>', '工作目录 (默认 ~/.llm-gateway/)')
    .option('-c, --config <path>', '配置文件路径')
    .option('-l, --log-dir <path>', '日志目录')
    .option('-p, --port <number>', '服务端口', '4000')
    .option('-t, --timeout <ms>', '请求超时 (ms)', '300000')
    .option('-D, --daemon', '后台启动 (守护进程模式)')
    .option('--debug', '启用详细日志（记录完整请求/响应内容到文件）')
    .option('--stop', '停止后台运行的服务')
    .action(async (options: CliOptions) => {
      try {
        // 解析路径
        const { configPath, logDirPath, detailLogDir, userDir } = resolvePaths(options);
        const pidFile = getPidFile(userDir);

        // 处理 --stop 选项
        if (options.stop) {
          stopDaemon(userDir);
          return;
        }

        // 显示使用的目录
        console.log(`📁 工作目录：${userDir}`);

        // 检查配置文件是否存在，不存在则创建默认空配置
        if (!existsSync(configPath)) {
          console.log(`📝 配置文件不存在，正在创建默认配置：${configPath}`);
          createDefaultConfig(configPath);
        }

        // 加载配置
        const config = loadConfig(configPath);
        console.log(`✓ 已加载 ${config.length} 个 provider 配置`);
        config.forEach((p, i) => {
          console.log(`  [${i + 1}] ${p.customModel} -> ${p.baseUrl}`);
        });

        // 如果是后台模式，启动守护进程
        if (options.daemon) {
          startDaemon(options, userDir);
          return;
        }

        // 检查是否已有后台服务在运行
        const runningPid = checkRunning(pidFile);
        if (runningPid) {
          console.log(`⚠️  检测到后台服务正在运行 (PID: ${runningPid})`);
          console.log('   如需重启，请先执行：llm-gateway-start --stop');
          console.log('   或使用前台模式启动\n');
        }

        // 创建日志实例
        const logger = new Logger(logDirPath);
        const logPath = logger.getFilePath();
        console.log(`✓ 结构化日志目录：${logPath}`);

        // 创建详细日志实例 (输出到 logs/ 目录)
        const detailLogger = new DetailLogger(detailLogDir, options.debug || false);
        if (options.debug) {
          console.log(`✓ 详细日志已启用：${detailLogDir}/{requestId}_{stage}.log`);
        } else {
          console.log(`✓ 详细日志已禁用 (使用 --debug 启用)`);
        }

        // 创建服务器 (确保 timeout 是数字类型)
        const timeoutMs = Number(options.timeout);
        const app = createServer(config, logger, detailLogger, timeoutMs, configPath);
        console.log(`✓ 服务器已创建，超时设置：${timeoutMs}ms`);

        // 启动服务器
        serve({
          fetch: app.fetch,
          port: options.port
        }, (info) => {
          console.log(`\n🚀 LLM Proxy 已启动`);
          console.log(`   端口：http://localhost:${info.port}`);
          console.log(`   健康检查：http://localhost:${info.port}/health`);
          console.log(`   结构化日志：${logPath}`);
          console.log(`   详细日志：${options.debug ? '已启用' : '已禁用 (使用 --debug 启用)'}`);
          console.log(`\n按 Ctrl+C 停止服务器\n`);
        });

      } catch (error: any) {
        console.error('❌ 启动失败:', error.message);
        console.error('错误堆栈:', error.stack);
        process.exit(1);
      }
    });

  program.parse();
}

main();
