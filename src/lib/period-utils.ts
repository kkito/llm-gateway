/**
 * 将 Date 对象转换为本地 YYYY-MM-DD 格式
 */
function toLocalDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 获取今日日期字符串 (YYYY-MM-DD)
 */
export function getTodayDate(): string {
  return toLocalDateString(new Date());
}

/**
 * 获取本周一的日期字符串 (YYYY-MM-DD)
 */
export function getWeekStart(): string {
  const now = new Date();
  const day = now.getDay() || 7; // 周日转为 7
  const monday = new Date(now);
  monday.setDate(now.getDate() - day + 1);
  return toLocalDateString(monday);
}

/**
 * 获取本月 1 号的日期字符串 (YYYY-MM-DD)
 */
export function getMonthStart(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

/**
 * 周期范围
 */
export interface PeriodRange {
  start: string;  // YYYY-MM-DD
  end: string;    // YYYY-MM-DD
  description: string;  // 用于错误信息
}

/**
 * 获取周期范围
 */
export function getPeriodRange(period: 'day' | 'hours' | 'week' | 'month', periodValue?: number): PeriodRange {
  const today = getTodayDate();
  
  switch (period) {
    case 'day':
      return {
        start: today,
        end: today,
        description: 'daily'
      };
    
    case 'week':
      return {
        start: getWeekStart(),
        end: today,
        description: 'weekly'
      };
    
    case 'month':
      return {
        start: getMonthStart(),
        end: today,
        description: 'monthly'
      };
    
    case 'hours': {
      const hours = periodValue || 24;
      const now = new Date();
      const past = new Date(now.getTime() - hours * 3600 * 1000);
      return {
        start: toLocalDateString(past),
        end: today,
        description: `last ${hours} hours`
      };
    }
  }
}

/**
 * 获取周期描述（用于错误信息）
 */
export function getPeriodDescription(period: 'day' | 'hours' | 'week' | 'month', periodValue?: number): string {
  return getPeriodRange(period, periodValue).description;
}
