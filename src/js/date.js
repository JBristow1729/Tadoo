export const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function today() {
  const value = new Date();
  value.setHours(0, 0, 0, 0);
  return value;
}

export function dateStr(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function todayStr() {
  return dateStr(today());
}

export function parseDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function addDays(date, count) {
  const value = new Date(date);
  value.setDate(value.getDate() + count);
  return value;
}

export function addWeeks(date, count) {
  return addDays(date, count * 7);
}

export function addMonths(date, count) {
  const value = new Date(date);
  value.setMonth(value.getMonth() + count);
  return value;
}
