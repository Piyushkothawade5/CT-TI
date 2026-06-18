const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatDisplayDate(value?: string | null): string {
  if (!value) return "";
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value;
  const monthIndex = Number(match[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) return value;
  return `${match[3]}-${MONTHS[monthIndex]}-${match[1]}`;
}

export function parseDisplayDate(value: string): string | null {
  const text = value.trim();
  if (!text) return "";

  const displayMatch = text.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (displayMatch) {
    const monthIndex = MONTHS.findIndex(
      (month) => month.toLowerCase() === displayMatch[2].toLowerCase()
    );
    const day = Number(displayMatch[1]);
    const year = Number(displayMatch[3]);
    if (monthIndex >= 0 && isValidDate(year, monthIndex + 1, day)) {
      return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch && isValidDate(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]))) {
    return text;
  }

  return null;
}

function isValidDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}
