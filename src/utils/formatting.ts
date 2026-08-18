export const validDate = (value: string | number | Date) => {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const formatLocalDate = (
  value: string | number | Date,
  locale = 'fr-FR',
  fallback = 'Date à vérifier',
) => {
  const date = validDate(value);
  return date ? new Intl.DateTimeFormat(locale).format(date) : fallback;
};

export const formatLocalDateTime = (
  value: string | number | Date,
  locale = 'fr-FR',
  fallback = 'Horodatage à vérifier',
) => {
  const date = validDate(value);
  return date ? new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date) : fallback;
};

export const formatUtcDateTime = (
  value: string | number | Date,
  locale = 'fr-FR',
  fallback = 'Horodatage à vérifier',
) => {
  const date = validDate(value);
  return date ? new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'long',
    timeZone: 'UTC',
  }).format(date) : fallback;
};

export const formatMoney = (
  value: number,
  currency = 'EUR',
  locale = 'fr-FR',
) => new Intl.NumberFormat(locale, {
  style: 'currency',
  currency,
  maximumFractionDigits: 0,
}).format(value);

export const formatFileSize = (value: number) => {
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
  if (safeValue >= 1024 * 1024) {
    return `${(safeValue / (1024 * 1024)).toFixed(1)} Mo`;
  }
  return `${Math.ceil(safeValue / 1024)} ko`;
};

export const formatPercent = (value: number | null, locale = 'fr-FR') => value === null
  ? 'N/A'
  : new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);

// Compatibility aliases retained while Cartularia pages migrate progressively.
export const formatDate = formatLocalDate;
export const formatDateTime = formatLocalDateTime;
