import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDefaultWorkspace,
  createWorkspaceStore,
  validateWorkspaceEnvelope,
  WORKSPACE_STORAGE_KEY,
} from '../workspace-model.mjs';

class MemoryStorage {
  values = new Map();
  reads = [];
  writes = [];

  getItem(key) {
    this.reads.push(key);
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    this.writes.push([key, value]);
    this.values.set(key, value);
  }
}

const clone = (value) => structuredClone(value);
const defaultInstances = () => createDefaultWorkspace().profiles[0].instances;

test('missing storage resolves deterministic default modules without persisting observed data', () => {
  const store = createWorkspaceStore();
  const state = store.getState();

  assert.equal(state.activeProfileId, 'default');
  assert.deepEqual(state.activeProfile.instances.map(({ type, dock, order }) => [type, dock, order]), [
    ['feed', 'left', 0],
    ['sessions', 'right', 0],
    ['timeline', 'bottom-left', 0],
  ]);
  assert.equal(state.error, null);
  assert.equal(state.dirty, false);
});

test('profile CRUD, selection and layout reset round-trip only validated configuration', () => {
  const storage = new MemoryStorage();
  const store = createWorkspaceStore({ storage, createId: () => 'profile-custom' });
  const instances = defaultInstances();
  instances[0].config.categories = ['read', 'edit'];
  instances[0].dock = 'right';
  instances[0].order = 1;
  instances[1].order = 0;

  assert.equal(store.setInstances(instances).ok, true);
  assert.equal(store.createProfile('Focused', instances).ok, true);
  assert.equal(store.getState().activeProfileId, 'profile-custom');
  assert.equal(store.renameProfile('profile-custom', 'Daily view').ok, true);
  assert.equal(store.selectProfile('default').ok, true);
  assert.equal(store.selectProfile('profile-custom').ok, true);

  const reloaded = createWorkspaceStore({ storage });
  assert.equal(reloaded.getState().activeProfile.name, 'Daily view');
  assert.deepEqual(reloaded.getState().activeProfile.instances, instances);
  assert.equal(reloaded.resetLayout().ok, true);
  assert.deepEqual(reloaded.getState().activeProfile.instances, defaultInstances());
  assert.equal(reloaded.deleteProfile('profile-custom').ok, true);
  assert.equal(reloaded.deleteProfile('default').ok, false);

  const persisted = JSON.parse(storage.values.get(WORKSPACE_STORAGE_KEY));
  assert.equal(persisted.version, 1);
  assert.equal(persisted.profiles.some(({ id }) => id === 'profile-custom'), false);
  assert.equal(storage.values.has('sentient-os.visual-presets.v1'), false);
});

test('lower-left placements round-trip while existing bottom-centre layouts remain unchanged', () => {
  const storage = new MemoryStorage();
  const legacy = createDefaultWorkspace();
  legacy.profiles[0].instances.find(({ type }) => type === 'timeline').dock = 'bottom';
  const raw = JSON.stringify(legacy);
  storage.values.set(WORKSPACE_STORAGE_KEY, raw);
  const store = createWorkspaceStore({ storage });
  assert.equal(store.getState().error, null);
  assert.equal(store.getState().activeProfile.instances.find(({ type }) => type === 'timeline').dock, 'bottom');
  assert.equal(storage.values.get(WORKSPACE_STORAGE_KEY), raw);
  assert.equal(storage.writes.length, 0);

  const instances = clone(store.getState().activeProfile.instances);
  instances[0].dock = 'bottom-left';
  assert.equal(store.setInstances(instances).ok, true);
  const reloaded = createWorkspaceStore({ storage });
  assert.equal(reloaded.getState().activeProfile.instances[0].dock, 'bottom-left');
  assert.equal(reloaded.getState().activeProfile.instances[2].dock, 'bottom');
  const invalid = clone(reloaded.getState().activeProfile.instances);
  invalid[0].dock = 'not-a-dock';
  const before = storage.values.get(WORKSPACE_STORAGE_KEY);
  assert.equal(reloaded.setInstances(invalid).ok, false);
  assert.equal(storage.values.get(WORKSPACE_STORAGE_KEY), before);
});

test('workspace validation rejects duplicate IDs, invalid module configuration, duplicate timelines and overflow', () => {
  const baseline = createDefaultWorkspace();
  const cases = [
    (value) => { value.profiles[0].instances[1].id = value.profiles[0].instances[0].id; },
    (value) => { value.profiles[0].instances[0].type = 'plugin'; },
    (value) => { value.profiles[0].instances[0].config.categories = ['raw-session-id']; },
    (value) => { value.profiles[0].instances[2].config.sessionFilter = 'session-123'; },
    (value) => { value.profiles[0].instances[0].config.unsupported = true; },
    (value) => {
      value.profiles[0].instances.push({
        ...clone(value.profiles[0].instances[2]),
        id: 'timeline-second',
        order: 1,
      });
    },
    (value) => {
      value.profiles[0].instances = Array.from({ length: 13 }, (_, order) => ({
        ...clone(value.profiles[0].instances[0]),
        id: `feed-${order}`,
        order,
      }));
    },
  ];

  for (const mutate of cases) {
    const candidate = clone(baseline);
    mutate(candidate);
    assert.throws(() => validateWorkspaceEnvelope(candidate));
  }
});

test('workspace validation preserves script-like names as text values and rejects invalid names', () => {
  const candidate = createDefaultWorkspace();
  const displayName = '<script>alert(1)</script>';
  candidate.profiles[0].instances[0].displayName = displayName;
  assert.equal(validateWorkspaceEnvelope(candidate).profiles[0].instances[0].displayName, displayName);

  candidate.profiles[0].instances[0].displayName = 'invalid\nname';
  assert.throws(() => validateWorkspaceEnvelope(candidate), /without control characters/);
});

test('workspace validation enforces complete dock ordering and the saved-profile limit', () => {
  const incompleteOrder = createDefaultWorkspace();
  incompleteOrder.profiles[0].instances[0].order = 2;
  assert.throws(() => validateWorkspaceEnvelope(incompleteOrder));

  const maxProfiles = createDefaultWorkspace();
  for (let index = 0; index < 10; index += 1) {
    maxProfiles.profiles.push({
      id: `profile-${index}`,
      name: `Profile ${index}`,
      instances: [],
    });
  }
  assert.equal(validateWorkspaceEnvelope(maxProfiles).profiles.length, 11);
  maxProfiles.profiles.push({ id: 'profile-over-limit', name: 'Over limit', instances: [] });
  assert.throws(() => validateWorkspaceEnvelope(maxProfiles));

  let sequence = 0;
  const store = createWorkspaceStore({ storage: new MemoryStorage(), createId: () => `profile-${sequence++}` });
  for (let index = 0; index < 10; index += 1) {
    assert.equal(store.createProfile(`Saved ${index}`).ok, true);
  }
  const beforeOverflow = store.getState().profiles.length;
  assert.equal(store.createProfile('Overflow').ok, false);
  assert.equal(store.getState().profiles.length, beforeOverflow);
});

test('invalid layout saves leave both current state and persisted bytes unchanged', () => {
  const storage = new MemoryStorage();
  const store = createWorkspaceStore({ storage });
  const before = storage.values.get(WORKSPACE_STORAGE_KEY);
  const invalid = defaultInstances();
  invalid[0].config.categories = ['reasoning', 'not-a-category'];

  const result = store.setInstances(invalid);
  assert.equal(result.ok, false);
  assert.equal(store.getState().activeProfile.instances[0].config.categories.includes('not-a-category'), false);
  assert.equal(storage.values.get(WORKSPACE_STORAGE_KEY), before);
});

test('corrupt, unsupported and oversized stored data is preserved until explicit recovery', () => {
  for (const [raw, expectedCode] of [
    ['{not json', 'WORKSPACE_CORRUPT'],
    [JSON.stringify({ ...createDefaultWorkspace(), version: 2 }), 'WORKSPACE_UNSUPPORTED'],
    ['x'.repeat(65 * 1024), 'WORKSPACE_TOO_LARGE'],
  ]) {
    const storage = new MemoryStorage();
    storage.values.set(WORKSPACE_STORAGE_KEY, raw);
    const store = createWorkspaceStore({ storage });

    assert.equal(store.getState().error.code, expectedCode);
    assert.equal(store.getState().recoveryRequired, true);
    assert.equal(storage.values.get(WORKSPACE_STORAGE_KEY), raw);
    assert.equal(store.resetLayout().ok, false);
    assert.equal(storage.values.get(WORKSPACE_STORAGE_KEY), raw);
    assert.equal(store.replaceCorruptStorage().ok, true);
    assert.equal(store.getState().recoveryRequired, false);
    assert.equal(JSON.parse(storage.values.get(WORKSPACE_STORAGE_KEY)).version, 1);
  }
});

test('denied and quota storage keeps an explicit in-memory recovery state and supports retry', () => {
  const storage = new MemoryStorage();
  const store = createWorkspaceStore({ storage });
  const previous = storage.values.get(WORKSPACE_STORAGE_KEY);
  const desired = defaultInstances();
  desired[0].config.categories = ['completion'];
  let denyWrite = true;
  const originalSetItem = storage.setItem.bind(storage);
  storage.setItem = (key, value) => {
    if (denyWrite) {
      denyWrite = false;
      const error = new Error('quota exceeded');
      error.name = 'QuotaExceededError';
      throw error;
    }
    originalSetItem(key, value);
  };

  const failed = store.setInstances(desired);
  assert.equal(failed.ok, false);
  assert.equal(failed.error.code, 'STORAGE_WRITE_FAILED');
  assert.equal(store.getState().dirty, true);
  assert.deepEqual(store.getState().activeProfile.instances, desired);
  assert.equal(storage.values.get(WORKSPACE_STORAGE_KEY), previous);

  assert.equal(store.retrySave().ok, true);
  assert.equal(store.getState().dirty, false);
  assert.deepEqual(JSON.parse(storage.values.get(WORKSPACE_STORAGE_KEY))
    .profiles[0].instances, desired);
});

test('storage access is scoped to the workspace key and never serializes observed data or visual presets', () => {
  const storage = new MemoryStorage();
  storage.values.set('sentient-os.visual-presets.v1', '{"preset":"preserve"}');
  const originalPreset = storage.values.get('sentient-os.visual-presets.v1');
  const store = createWorkspaceStore({ storage });

  assert.equal(store.setInstances(defaultInstances()).ok, true);
  assert.deepEqual(storage.reads, [WORKSPACE_STORAGE_KEY]);
  assert.deepEqual(storage.writes.map(([key]) => key), [WORKSPACE_STORAGE_KEY]);
  assert.equal(storage.values.get('sentient-os.visual-presets.v1'), originalPreset);

  const serialized = storage.values.get(WORKSPACE_STORAGE_KEY);
  for (const secretLikeValue of [
    'session-id-123',
    'C:\\Users\\private\\events.jsonl',
    'private prompt text',
    'tool argument value',
    'tool result value',
    'Library document content',
  ]) {
    assert.equal(serialized.includes(secretLikeValue), false);
  }
});

test('storage read failures require explicit recovery before overwriting unknown stored data', () => {
  const storage = new MemoryStorage();
  storage.getItem = () => { throw new Error('storage denied'); };
  const store = createWorkspaceStore({ storage });

  assert.equal(store.getState().error.code, 'STORAGE_READ_FAILED');
  assert.equal(store.getState().recoveryRequired, true);
  assert.equal(store.setInstances(defaultInstances()).error.code, 'RECOVERY_REQUIRED');
  assert.equal(store.retrySave().error.code, 'RECOVERY_REQUIRED');
  assert.equal(store.replaceCorruptStorage().ok, true);
});
