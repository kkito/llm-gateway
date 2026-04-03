/**
 * 密码工具函数
 */

import { createHash } from 'crypto';

/**
 * 对密码进行 SHA256 加密
 * @param password 明文密码
 * @returns SHA256 哈希值
 */
export function hashPassword(password: string): string {
  return createHash('sha256').update('llm-gateway' + password).digest('hex');
}

/**
 * 验证密码是否正确
 * @param password 明文密码
 * @param digest 存储的哈希值
 * @returns 是否匹配
 */
export function verifyPassword(password: string, digest: string): boolean {
  return hashPassword(password) === digest;
}