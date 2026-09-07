/** Preserve stable generic labels, reserving them before naming new codes. */
export const allocateGenericCodeLabels = (
  codes: string[], existing: ReadonlyMap<string, { genericLabel?: unknown }>, prefix: 'Lieu' | 'Personne',
) => {
  const labels = new Map<string, string>();
  const used = new Set<string>();
  const pattern = new RegExp(`^${prefix} [1-9][0-9]*$`);
  for (const code of codes) {
    const label = existing.get(code)?.genericLabel;
    if (typeof label === 'string' && pattern.test(label) && !used.has(label)) {
      labels.set(code, label); used.add(label);
    }
  }
  let index = 1;
  for (const code of codes) {
    if (labels.has(code)) continue;
    while (used.has(`${prefix} ${index}`)) index++;
    const label = `${prefix} ${index++}`;
    labels.set(code, label); used.add(label);
  }
  return labels;
};
