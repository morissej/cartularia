export type HorizontalNavigationDirection = -1 | 1;

export const horizontalNavigationDirection = (key: string): HorizontalNavigationDirection | null => {
  if (key === 'ArrowLeft') return -1;
  if (key === 'ArrowRight') return 1;
  return null;
};

export const targetConsumesHorizontalNavigation = (target: unknown) => {
  if (!target || typeof target !== 'object') return false;
  const candidate = target as {
    tagName?: unknown;
    isContentEditable?: unknown;
    getAttribute?: (name: string) => string | null;
  };
  if (candidate.isContentEditable === true) return true;
  const tagName = typeof candidate.tagName === 'string' ? candidate.tagName.toUpperCase() : '';
  if (['INPUT', 'TEXTAREA', 'SELECT', 'VIDEO', 'AUDIO'].includes(tagName)) return true;
  const role = candidate.getAttribute?.('role');
  return role === 'slider' || role === 'spinbutton';
};
