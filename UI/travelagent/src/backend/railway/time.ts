const MINUTE = 60_000

// Calendar arithmetic in UTC fields avoids depending on the desktop's local timezone.
// All railway dates and clocks below represent China time, not UTC instants.
export function calendar(date: string, clock = '00:00') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(clock))
    throw new Error('日期和时间必须使用 YYYY-MM-DD、HH:mm 格式')
  const [year, month, day] = date.split('-').map(Number)
  const [hours, minutes] = clock.split(':').map(Number)
  const value = Date.UTC(year, month - 1, day, hours, minutes)
  if (hours > 23 || minutes > 59 || datePart(value) !== date) throw new Error('无效的日期或时间')
  return value
}

export const datePart = (value: number) => new Date(value).toISOString().slice(0, 10)
export const clockPart = (value: number) => new Date(value).toISOString().slice(11, 16)
export const addMinutes = (value: number, minutes: number) => value + minutes * MINUTE
export const chinaToday = (now = Date.now()) => datePart(now + 8 * 60 * MINUTE)

export function durationMinutes(value: string) {
  const clock = /^(\d{1,3}):(\d{2})$/.exec(value)
  if (clock && Number(clock[2]) < 60) return Number(clock[1]) * 60 + Number(clock[2])
  const chinese = /^(?:(\d+)小时)?(?:(\d+)分钟)?$/.exec(value)
  if (chinese && (chinese[1] || chinese[2]))
    return Number(chinese[1] || 0) * 60 + Number(chinese[2] || 0)
  throw new Error('无效的列车历时')
}

export function formatDuration(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

export function validateBookingDate(date: string, now = Date.now()) {
  const days = (calendar(date) - calendar(chinaToday(now))) / 86_400_000
  if (days < 0 || days > 14) throw new Error('乘车日期须在北京时间今天起的 15 天预售期内')
}
