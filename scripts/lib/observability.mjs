const SENSITIVE_KEY = /(email|phone|address|serial|token|secret|password|private|legalname|firstname|lastname)/i;

export const redactOperationalValue = (value, key = '') => {
  if (SENSITIVE_KEY.test(key)) return '[REDACTED]';
  if (Array.isArray(value)) return value.map((child) => redactOperationalValue(child));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [
      childKey,
      redactOperationalValue(child, childKey),
    ]));
  }
  return value;
};

export const createStructuredLogger = ({ service, sink = (entry) => console.log(JSON.stringify(entry)) }) => ({
  emit(event, details = {}) {
    const entry = redactOperationalValue({
      timestamp: new Date().toISOString(),
      service,
      event,
      severity: details.severity ?? 'INFO',
      ...details,
    });
    sink(entry);
    return entry;
  },
});
