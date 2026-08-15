import { createHash } from 'node:crypto';

export const CANONICALIZATION_VERSION = 'jcs-1';

const assertValidUnicode = (value) => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new TypeError('Chaîne non I-JSON : surrogate haut isolé.');
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError('Chaîne non I-JSON : surrogate bas isolé.');
    }
  }
};

const normalize = (value, stack = new Set()) => {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    assertValidUnicode(value);
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('JCS refuse NaN et les valeurs infinies.');
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    throw new TypeError(`Type non JSON dans la sérialisation canonique : ${typeof value}.`);
  }
  if (stack.has(value)) throw new TypeError('Structure cyclique interdite dans la sérialisation canonique.');
  stack.add(value);
  try {
    if (Array.isArray(value)) return value.map((entry) => normalize(entry, stack));
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      throw new TypeError('Seuls les objets JSON simples sont acceptés par JCS.');
    }
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => {
          assertValidUnicode(key);
          return [key, normalize(value[key], stack)];
        }),
    );
  } finally {
    stack.delete(value);
  }
};

// Profil JCS/RFC 8785 : types I-JSON, ordre UTF-16 des propriétés et sérialisation ECMAScript des nombres.
export const canonicalize = (value) => JSON.stringify(normalize(value));

export const sha256Digest = (value) =>
  `sha256:${createHash('sha256').update(typeof value === 'string' ? value : canonicalize(value)).digest('hex')}`;

export const sha256Bytes = (value) =>
  `sha256:${createHash('sha256').update(value).digest('hex')}`;
