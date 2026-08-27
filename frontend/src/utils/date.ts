/**
 * 统一中国时区（Asia/Shanghai，UTC+8）日期工具
 * 解决：JS 原生 new Date() / toISOString() 按 UTC 或本地时区导致的日期偏差
 * - 今日日期跨 UTC 日界线错一天（中国凌晨 0-8 点）
 * - 部署在 UTC 时区服务器时后端/前端显示不一致
 *
 * 统一规则：
 *  1) 所有"今日日期"（YYYY-MM-DD 字符串）→ getTodayCn()
 *  2) 所有展示时间戳 → formatDateTimeCn() / formatDateCn() / formatTimeCn()
 *  3) 解析后端返回的字符串（UTC 或无时区）→ parseCn() 转成北京时间 JS Date
 */

const CN_OFFSET_MIN = 8 * 60; // UTC+8

/**
 * 获取"北京时间"下的今日日期（YYYY-MM-DD），避免 toISOString() 用 UTC 取日错一天
 * 当北京时间 2026-08-25 01:00:00，UTC 是 2026-08-24 17:00:00
 * toISOString() → "2026-08-24T..." 取到 08-24（错误）
 * getTodayCn() → "2026-08-25"（正确）
 */
export function getTodayCn(d: Date = new Date()): string {
  const utcMs = d.getTime() + d.getTimezoneOffset() * 60_000; // 转 UTC 绝对毫秒
  const cnMs = utcMs + CN_OFFSET_MIN * 60_000; // 强制 +8h → 北京时间本地 ms
  const cn = new Date(cnMs); // 此时 getUTCFullYear/getUTCMonth/getUTCDate 就是北京日历
  const y = cn.getUTCFullYear();
  const m = String(cn.getUTCMonth() + 1).padStart(2, '0');
  const day = String(cn.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 北京时间"昨天"日期字符串
 */
export function getYesterdayCn(): string {
  const utcMs = Date.now() + new Date().getTimezoneOffset() * 60_000;
  const cnMs = utcMs + CN_OFFSET_MIN * 60_000 - 86_400_000;
  const cn = new Date(cnMs);
  const y = cn.getUTCFullYear();
  const m = String(cn.getUTCMonth() + 1).padStart(2, '0');
  const day = String(cn.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 解析任意时间输入 → 相对于北京时间的 JS Date 对象（内部 absolute ms 正确）
 * 支持输入：ISO 字符串 / SQL datetime("YYYY-MM-DD HH:mm:ss") / 时间戳 / Date
 */
export function parseCn(input: string | number | Date | null | undefined): Date | null {
  if (input == null || input === '') return null;
  if (input instanceof Date) return input;
  if (typeof input === 'number') return new Date(input);
  // SQL 风格 YYYY-MM-DD HH:mm:ss → 替换空格为 T，JS 会按本地时区解析
  let s = input.trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(s)) s = s.replace(' ', 'T');
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * 北京时间格式化：完整日期时间 → YYYY-MM-DD HH:mm
 */
export function formatDateTimeCn(input: any, opts?: { withSecond?: boolean }): string {
  const d = parseCn(input);
  if (!d) return '-';
  const pad = (n: number) => String(n).padStart(2, '0');
  const utcMs = d.getTime() + d.getTimezoneOffset() * 60_000;
  const cnMs = utcMs + CN_OFFSET_MIN * 60_000;
  const cn = new Date(cnMs);
  const base = `${cn.getUTCFullYear()}-${pad(cn.getUTCMonth() + 1)}-${pad(cn.getUTCDate())} ${pad(cn.getUTCHours())}:${pad(cn.getUTCMinutes())}`;
  if (opts?.withSecond) return `${base}:${pad(cn.getUTCSeconds())}`;
  return base;
}

/**
 * 北京时间格式化：仅日期 → YYYY-MM-DD
 */
export function formatDateCn(input: any): string {
  const d = parseCn(input);
  if (!d) return '-';
  const pad = (n: number) => String(n).padStart(2, '0');
  const utcMs = d.getTime() + d.getTimezoneOffset() * 60_000;
  const cnMs = utcMs + CN_OFFSET_MIN * 60_000;
  const cn = new Date(cnMs);
  return `${cn.getUTCFullYear()}-${pad(cn.getUTCMonth() + 1)}-${pad(cn.getUTCDate())}`;
}

/**
 * 北京时间格式化：仅时间 → HH:mm（或 HH:mm:ss）
 */
export function formatTimeCn(input: any, withSecond = false): string {
  const d = parseCn(input);
  if (!d) return '-';
  const pad = (n: number) => String(n).padStart(2, '0');
  const utcMs = d.getTime() + d.getTimezoneOffset() * 60_000;
  const cnMs = utcMs + CN_OFFSET_MIN * 60_000;
  const cn = new Date(cnMs);
  const base = `${pad(cn.getUTCHours())}:${pad(cn.getUTCMinutes())}`;
  return withSecond ? `${base}:${pad(cn.getUTCSeconds())}` : base;
}

/**
 * 获取当前北京时间的小时（0-23），用于欢迎语"早上好/下午好/晚上好"
 * 解决：UTC 容器部署时 new Date().getHours() 错 8 小时
 */
export function getCnHour(d: Date = new Date()): number {
  const utcMs = d.getTime() + d.getTimezoneOffset() * 60_000;
  const cnMs = utcMs + CN_OFFSET_MIN * 60_000;
  return new Date(cnMs).getUTCHours();
}

/**
 * 展示用中文友好格式：今天/昨天/前天 + 最近 MM-DD
 */
export function formatRelativeCn(input: any): string {
  const d = parseCn(input);
  if (!d) return '-';
  const today = getTodayCn();
  const yesterday = getYesterdayCn();
  const dt = formatDateCn(d);
  const hm = formatTimeCn(d);
  if (dt === today) return `今天 ${hm}`;
  if (dt === yesterday) return `昨天 ${hm}`;
  return `${dt.slice(5)} ${hm}`;
}

/**
 * Dashboard 欢迎横幅用的中文完整格式：YYYY年MM月DD日 周X
 * 格式严格跟随北京时间，不是浏览器本地时区
 */
export function formatDateWithWeekdayCn(input: any): string {
  const d = parseCn(input) ?? new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const utcMs = d!.getTime() + d!.getTimezoneOffset() * 60_000;
  const cnMs = utcMs + CN_OFFSET_MIN * 60_000;
  const cn = new Date(cnMs);
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return `${cn.getUTCFullYear()}-${pad(cn.getUTCMonth() + 1)}-${pad(cn.getUTCDate())} ${weekdays[cn.getUTCDay()]}`;
}
