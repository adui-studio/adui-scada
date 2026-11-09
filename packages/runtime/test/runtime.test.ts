import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { TagStore } from '@adui/scada-core';
import { applyDemoChange, initialRuntimeState } from '../src/runtime.ts';
const mk = (sequence = 1) => ({ tagId: 'water.level', value: 12, quality: 'GOOD' as const, sourceTimestamp: null, serverTimestamp: '2026-11-09T00:00:00Z', sequence });
test('initial state is idle', () => { assert.equal(initialRuntimeState.status, 'idle'); });
test('fresh snapshot resets sequence after reconnect', () => {
  const store = new TagStore();
  applyDemoChange(store, { kind: 'snapshot', values: [mk(42)] });
  applyDemoChange(store, { kind: 'snapshot', values: [mk(1)] });
  assert.equal(store.get('water.level')?.sequence, 1);
});
test('delta ignores old sequence', () => {
  const store = new TagStore();
  applyDemoChange(store, { kind: 'snapshot', values: [mk(5)] });
  applyDemoChange(store, { kind: 'delta', values: [mk(3)] });
  assert.equal(store.get('water.level')?.sequence, 5);
});
test('disconnect marks previously GOOD readings STALE', () => {
  const store = new TagStore();
  applyDemoChange(store, { kind: 'snapshot', values: [mk()] });
  store.markDisconnected(Date.parse('2026-11-09T00:00:05Z'));
  assert.equal(store.get('water.level')?.quality, 'STALE');
});
test('bad snapshot is atomic', () => {
  const store = new TagStore();
  applyDemoChange(store, { kind: 'snapshot', values: [mk()] });
  assert.throws(() => applyDemoChange(store, { kind: 'snapshot', values: [mk(2), { ...mk(3), value: Infinity }] }));
  assert.equal(store.get('water.level')?.sequence, 1);
});
test('unknown event kind is rejected', () => {
  const store = new TagStore();
  assert.throws(() => applyDemoChange(store, { kind: 'execute', values: [] }), /Invalid event kind/);
});
