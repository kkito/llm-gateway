import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * 详细日志记录器
 * 将请求/响应的完整内容输出到文件，避免控制台输出过于冗长
 *
 * 文件命名格式：{requestId}_{stage}.log
 * 输出目录：由调用方指定（推荐使用 getDetailLogDir() 获取默认目录）
 */
export class DetailLogger {
  private logDir: string;
  private enabled: boolean;

  constructor(logDir: string, enabled: boolean = false) {
    this.logDir = logDir;
    this.enabled = enabled;
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }
  }

  /**
   * 记录用户请求的完整内容
   */
  logRequest(requestId: string, body: unknown): void {
    if (!this.enabled) return;
    this.write(requestId, 'request', body);
  }

  /**
   * 记录转发给上游 LLM 的请求
   */
  logUpstreamRequest(requestId: string, body: unknown): void {
    if (!this.enabled) return;
    this.write(requestId, 'upstream_request', body);
  }

  /**
   * 记录上游 LLM 的原始响应
   */
  logUpstreamResponse(requestId: string, data: unknown): void {
    if (!this.enabled) return;
    this.write(requestId, 'upstream_response', data);
  }

  /**
   * 记录返回给用户的响应
   */
  logResponse(requestId: string, data: unknown): void {
    if (!this.enabled) return;
    this.write(requestId, 'response', data);
  }

  /**
   * 记录流式响应的完整内容 (SSE 流)
   */
  logStreamResponse(requestId: string, chunks: string[]): void {
    if (!this.enabled) return;
    const filename = `${requestId}_stream_response.log`;
    const filePath = join(this.logDir, filename);
    const content = chunks.join('\n') + '\n';
    writeFileSync(filePath, content, 'utf-8');
  }

  /**
   * 记录转换后的完整 JSON 响应（用于 OpenAI→Anthropic 流式转非流式）
   */
  logConvertedResponse(requestId: string, data: unknown): void {
    if (!this.enabled) return;
    this.write(requestId, 'converted_response', data);
  }

  /**
   * 通用写入方法
   */
  private write(requestId: string, stage: string, data: unknown): void {
    const filename = `${requestId}_${stage}.log`;
    const filePath = join(this.logDir, filename);
    const content = JSON.stringify(data, null, 2) + '\n';
    writeFileSync(filePath, content, 'utf-8');
  }
}
