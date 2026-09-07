/** Canonical public derivative path, not a URL or a private Storage location. */
export const validPublicMediaPath = (path?: string | null): path is string => Boolean(path && /^public\/[A-Za-z0-9_-]{1,160}\/[A-Za-z0-9_-]{1,160}\/[A-Za-z0-9_-]{1,160}$/.test(path));
