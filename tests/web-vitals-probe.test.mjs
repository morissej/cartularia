import assert from 'node:assert/strict';
import test from 'node:test';

import {
  INP_DURATION_THRESHOLD_MS,
  WEB_VITALS_ENTRY_TYPES,
  createWebVitalsCollector,
  observeWebVitals,
} from '../scripts/lib/web-vitals-probe.mjs';

const createFakePerformanceObserver = ({ supportedEntryTypes, rejectedTypes = [] } = {}) => {
  const observeCalls = [];
  const instances = [];
  class FakePerformanceObserver {
    constructor(callback) {
      this.callback = callback;
      this.type = null;
      this.disconnected = false;
      instances.push(this);
    }

    observe(init) {
      observeCalls.push(init);
      if (rejectedTypes.includes(init.type)) throw new TypeError(`Type refusé par le moteur : ${init.type}`);
      this.type = init.type;
    }

    disconnect() {
      this.disconnected = true;
    }

    emit(entries) {
      this.callback({ getEntries: () => entries }, this);
    }
  }
  if (supportedEntryTypes !== undefined) FakePerformanceObserver.supportedEntryTypes = supportedEntryTypes;
  return { FakePerformanceObserver, observeCalls, instances };
};

const withGlobalPerformanceObserver = async (constructor, run) => {
  const hadPrevious = Object.prototype.hasOwnProperty.call(globalThis, 'PerformanceObserver');
  const previous = globalThis.PerformanceObserver;
  if (constructor === undefined) delete globalThis.PerformanceObserver;
  else globalThis.PerformanceObserver = constructor;
  try {
    await run();
  } finally {
    if (hadPrevious) globalThis.PerformanceObserver = previous;
    else delete globalThis.PerformanceObserver;
  }
};

test('observe() est appelé une fois par type supporté, avec { type, buffered: true } et jamais entryTypes', async () => {
  const fake = createFakePerformanceObserver({
    supportedEntryTypes: ['navigation', 'largest-contentful-paint', 'layout-shift', 'event', 'first-input'],
  });
  await withGlobalPerformanceObserver(fake.FakePerformanceObserver, () => {
    const stop = observeWebVitals(() => {});
    assert.equal(typeof stop, 'function');
    stop();
  });

  assert.deepEqual(fake.observeCalls.map((init) => init.type), [...WEB_VITALS_ENTRY_TYPES]);
  for (const init of fake.observeCalls) {
    assert.ok(!('entryTypes' in init), `observe(${JSON.stringify(init)}) ne doit pas utiliser entryTypes`);
    assert.equal(typeof init.type, 'string');
    assert.equal(init.buffered, true);
  }
  const eventInit = fake.observeCalls.find((init) => init.type === 'event');
  assert.equal(eventInit.durationThreshold, INP_DURATION_THRESHOLD_MS);
  assert.ok(fake.instances.every((instance) => instance.disconnected), 'stop() doit déconnecter chaque observateur');
});

test('les types absents de supportedEntryTypes ne sont jamais passés à observe()', async () => {
  const fake = createFakePerformanceObserver({ supportedEntryTypes: ['largest-contentful-paint', 'navigation'] });
  await withGlobalPerformanceObserver(fake.FakePerformanceObserver, () => {
    observeWebVitals(() => {})();
  });

  assert.deepEqual(fake.observeCalls, [{ type: 'largest-contentful-paint', buffered: true }]);
  assert.equal(fake.instances.length, 1, 'aucun observateur ne doit être créé pour un type non supporté');
});

test('sans supportedEntryTypes, aucun type n’est observé (garde-fou moteur ancien)', async () => {
  const fake = createFakePerformanceObserver();
  assert.equal(fake.FakePerformanceObserver.supportedEntryTypes, undefined);
  await withGlobalPerformanceObserver(fake.FakePerformanceObserver, () => {
    const stop = observeWebVitals(() => {});
    assert.equal(typeof stop, 'function');
    assert.doesNotThrow(stop);
  });

  assert.deepEqual(fake.observeCalls, []);
  assert.equal(fake.instances.length, 0);
});

test('sans PerformanceObserver global, la sonde est inerte et n’échoue pas', async () => {
  await withGlobalPerformanceObserver(undefined, () => {
    assert.equal(globalThis.PerformanceObserver, undefined);
    const stop = observeWebVitals(() => {});
    assert.equal(typeof stop, 'function');
    assert.doesNotThrow(stop);
    const collector = createWebVitalsCollector();
    assert.deepEqual(collector.snapshot(), { lcp: null, cls: 0, inp: null });
    assert.doesNotThrow(collector.stop);
  });
});

test('un observe() qui lève est ignoré sans empêcher les autres types', async () => {
  const fake = createFakePerformanceObserver({
    supportedEntryTypes: [...WEB_VITALS_ENTRY_TYPES],
    rejectedTypes: ['layout-shift'],
  });
  await withGlobalPerformanceObserver(fake.FakePerformanceObserver, () => {
    assert.doesNotThrow(() => observeWebVitals(() => {})());
  });

  assert.deepEqual(fake.observeCalls.map((init) => init.type), ['largest-contentful-paint', 'layout-shift', 'event']);
  const kept = fake.instances.filter((instance) => instance.type !== null);
  assert.deepEqual(kept.map((instance) => instance.type), ['largest-contentful-paint', 'event']);
  assert.ok(kept.every((instance) => instance.disconnected));
});

test('les entrées sont transmises avec leur type, les doublons de types sont dédoublonnés', async () => {
  const fake = createFakePerformanceObserver({ supportedEntryTypes: ['layout-shift'] });
  const received = [];
  await withGlobalPerformanceObserver(fake.FakePerformanceObserver, () => {
    observeWebVitals((type, entry) => received.push([type, entry]), ['layout-shift', 'layout-shift', 'inconnu']);
    fake.instances[0].emit([{ value: 0.01 }, { value: 0.02 }]);
  });

  assert.equal(fake.observeCalls.length, 1);
  assert.deepEqual(received, [['layout-shift', { value: 0.01 }], ['layout-shift', { value: 0.02 }]]);
});

test('le collecteur agrège LCP (dernière entrée), CLS (sans hadRecentInput) et INP (durée maximale)', async () => {
  const fake = createFakePerformanceObserver({ supportedEntryTypes: [...WEB_VITALS_ENTRY_TYPES] });
  await withGlobalPerformanceObserver(fake.FakePerformanceObserver, () => {
    const collector = createWebVitalsCollector();
    assert.deepEqual(collector.snapshot(), { lcp: null, cls: 0, inp: null });

    const byType = Object.fromEntries(fake.instances.map((instance) => [instance.type, instance]));
    byType['largest-contentful-paint'].emit([
      { renderTime: 0, loadTime: 800, startTime: 800 },
      { renderTime: 1200, loadTime: 0, startTime: 1200 },
    ]);
    byType['layout-shift'].emit([
      { value: 0.05, hadRecentInput: false },
      { value: 0.5, hadRecentInput: true },
      { value: 0.02 },
    ]);
    byType.event.emit([{ duration: 56 }, { duration: 120 }, { duration: 48 }]);

    const snapshot = collector.snapshot();
    assert.equal(snapshot.lcp, 1200);
    assert.ok(Math.abs(snapshot.cls - 0.07) < 1e-9, `CLS attendu 0,07, obtenu ${snapshot.cls}`);
    assert.equal(snapshot.inp, 120);

    collector.stop();
    assert.ok(fake.instances.every((instance) => instance.disconnected));
  });
});

test('observeWebVitals exige une fonction de rappel', () => {
  assert.throws(() => observeWebVitals(null), TypeError);
});
