export interface DatedCashFlow {
  date: string;
  amount: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
export const MINIMUM_XIRR_HORIZON_DAYS = 30;

const dateTimestamp = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) ? timestamp : null;
};

export const todayIsoDate = (now = new Date()) => {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const hasMinimumSaleHorizon = (
  purchaseDate: string,
  saleDate: string,
  minimumDays = MINIMUM_XIRR_HORIZON_DAYS,
) => {
  const purchaseTimestamp = dateTimestamp(purchaseDate);
  const saleTimestamp = dateTimestamp(saleDate);
  return purchaseTimestamp !== null
    && saleTimestamp !== null
    && saleTimestamp >= purchaseTimestamp
    && saleTimestamp - purchaseTimestamp >= minimumDays * DAY_MS;
};

export const calculateXirr = (cashFlows: DatedCashFlow[]): number | null => {
  const validFlows = cashFlows
    .map((cashFlow) => ({ ...cashFlow, timestamp: dateTimestamp(cashFlow.date) }))
    .filter((cashFlow): cashFlow is DatedCashFlow & { timestamp: number } => (
      cashFlow.timestamp !== null && Number.isFinite(cashFlow.amount)
    ))
    .sort((a, b) => a.timestamp - b.timestamp);
  if (
    validFlows.length < 2
    || !validFlows.some((flow) => flow.amount < 0)
    || !validFlows.some((flow) => flow.amount > 0)
    || validFlows.at(-1)!.timestamp - validFlows[0].timestamp < MINIMUM_XIRR_HORIZON_DAYS * DAY_MS
  ) {
    return null;
  }

  const firstDate = validFlows[0].timestamp;
  const withYears = validFlows.map((flow) => ({
    amount: flow.amount,
    years: (flow.timestamp - firstDate) / (365.25 * DAY_MS),
  }));
  const npv = (rate: number) => withYears.reduce(
    (sum, flow) => sum + flow.amount / Math.pow(1 + rate, flow.years),
    0,
  );

  let low = -0.9999;
  let high = 10;
  let lowValue = npv(low);
  let highValue = npv(high);
  while (lowValue * highValue > 0 && high < 10000) {
    high *= 2;
    highValue = npv(high);
  }
  if (!Number.isFinite(lowValue) || !Number.isFinite(highValue) || lowValue * highValue > 0) return null;

  for (let iteration = 0; iteration < 160; iteration += 1) {
    const middle = (low + high) / 2;
    const middleValue = npv(middle);
    if (Math.abs(middleValue) < 0.001) return middle;
    if (lowValue * middleValue <= 0) {
      high = middle;
      highValue = middleValue;
    } else {
      low = middle;
      lowValue = middleValue;
    }
  }
  return (low + high) / 2;
};
