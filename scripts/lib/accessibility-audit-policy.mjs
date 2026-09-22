export const BLOCKING_INCOMPLETE_RULE_IDS = Object.freeze([
  'aria-prohibited-attr',
  'aria-valid-attr-value',
]);

const blockingIncompleteRuleIds = new Set(BLOCKING_INCOMPLETE_RULE_IDS);

export const blockingIncompleteRules = (incompleteRules) => (
  incompleteRules.filter((rule) => blockingIncompleteRuleIds.has(rule.id))
);
