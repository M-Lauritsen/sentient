import { CATEGORIES } from './activity-colors.mjs';

export const WORKSPACE_STORAGE_KEY = 'sentient-os.workspaces.v1';
export const WORKSPACE_LIMITS = Object.freeze({
  savedProfiles: 10,
  instancesPerProfile: 12,
  nameLength: 48,
  payloadBytes: 64 * 1024,
});

const PROFILE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const INSTANCE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;
const DOCKS = new Set(['left', 'right', 'bottom']);
const SIZES = new Set(['compact', 'standard', 'large']);
const DENSITIES = new Set(['compact', 'comfortable']);
const CATEGORY_SET = new Set(CATEGORIES);
const EMPTY_CONFIG = Object.freeze({});

export const WORKSPACE_MODULES = Object.freeze({
  feed: Object.freeze({
    label: 'Activity feed',
    defaultDock: 'left',
    defaultConfig: Object.freeze({
      categories: Object.freeze([...CATEGORIES]),
      density: 'comfortable',
      showLegend: true,
    }),
  }),
  sessions: Object.freeze({
    label: 'Active sessions',
    defaultDock: 'right',
    defaultConfig: Object.freeze({ filter: 'all', density: 'comfortable' }),
  }),
  timeline: Object.freeze({
    label: 'Timeline',
    defaultDock: 'bottom',
    defaultConfig: EMPTY_CONFIG,
  }),
  totals: Object.freeze({
    label: 'Activity totals',
    defaultDock: 'right',
    defaultConfig: Object.freeze({
      categories: Object.freeze([...CATEGORIES]),
      presentation: 'compact',
    }),
  }),
  legend: Object.freeze({
    label: 'Legend',
    defaultDock: 'left',
    defaultConfig: EMPTY_CONFIG,
  }),
});

export class WorkspaceValidationError extends Error {
  constructor(message, code = 'WORKSPACE_INVALID') {
    super(message);
    this.name = 'WorkspaceValidationError';
    this.code = code;
  }
}

function invalid(message, code) {
  throw new WorkspaceValidationError(message, code);
}

function readRecord(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    invalid(`${label} must be a plain object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    invalid(`${label} must be a plain object.`);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') invalid(`${label} has unsupported properties.`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      invalid(`${label} must contain only enumerable data properties.`);
    }
  }
  return value;
}

function readArray(value, label) {
  if (!Array.isArray(value)) invalid(`${label} must be an array.`);
  for (const key of Reflect.ownKeys(value)) {
    if (key === 'length') continue;
    if (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) ||
        Number(key) >= value.length) {
      invalid(`${label} has unsupported entries.`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      invalid(`${label} must contain only data entries.`);
    }
  }
  if (Object.keys(value).length !== value.length) invalid(`${label} cannot contain empty entries.`);
  return value;
}

function exactKeys(record, expected, label) {
  const keys = Object.keys(record);
  if (keys.length !== expected.length || expected.some((key) => !Object.hasOwn(record, key))) {
    invalid(`${label} has missing or unsupported properties.`);
  }
}

function validateName(value, label) {
  if (typeof value !== 'string' || value !== value.trim() ||
      Array.from(value).length < 1 ||
      Array.from(value).length > WORKSPACE_LIMITS.nameLength ||
      CONTROL_CHARACTERS.test(value)) {
    invalid(`${label} must be 1-${WORKSPACE_LIMITS.nameLength} trimmed characters without control characters.`);
  }
  return value;
}

function validateId(value, label, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    invalid(`${label} must be a stable lowercase identifier.`);
  }
  return value;
}

function validateCategories(value, label) {
  readArray(value, label);
  const seen = new Set();
  const categories = value.map((category) => {
    if (typeof category !== 'string' || !CATEGORY_SET.has(category) || seen.has(category)) {
      invalid(`${label} contains an unsupported or duplicate category.`);
    }
    seen.add(category);
    return category;
  });
  return categories;
}

function validateConfig(type, value) {
  const config = readRecord(value, 'Module configuration');
  switch (type) {
    case 'feed':
      exactKeys(config, ['categories', 'density', 'showLegend'], 'Activity feed configuration');
      if (!DENSITIES.has(config.density) || typeof config.showLegend !== 'boolean') {
        invalid('Activity feed configuration is invalid.');
      }
      return {
        categories: validateCategories(config.categories, 'Activity feed categories'),
        density: config.density,
        showLegend: config.showLegend,
      };
    case 'sessions':
      exactKeys(config, ['filter', 'density'], 'Active sessions configuration');
      if (!['all', 'running', 'waiting'].includes(config.filter) || !DENSITIES.has(config.density)) {
        invalid('Active sessions configuration is invalid.');
      }
      return { filter: config.filter, density: config.density };
    case 'timeline':
    case 'legend':
      exactKeys(config, [], `${WORKSPACE_MODULES[type].label} configuration`);
      return {};
    case 'totals':
      exactKeys(config, ['categories', 'presentation'], 'Activity totals configuration');
      if (!['compact', 'list'].includes(config.presentation)) {
        invalid('Activity totals configuration is invalid.');
      }
      return {
        categories: validateCategories(config.categories, 'Activity totals categories'),
        presentation: config.presentation,
      };
    default:
      invalid('Module type is not supported.');
  }
}

function validateInstance(value) {
  const instance = readRecord(value, 'Module instance');
  exactKeys(instance, ['id', 'type', 'displayName', 'dock', 'order', 'size', 'config'], 'Module instance');
  const id = validateId(instance.id, 'Instance ID', INSTANCE_ID_PATTERN);
  if (typeof instance.type !== 'string' || !Object.hasOwn(WORKSPACE_MODULES, instance.type)) {
    invalid('Module type is not supported.');
  }
  const displayName = validateName(instance.displayName, 'Module display name');
  if (typeof instance.dock !== 'string' || !DOCKS.has(instance.dock)) invalid('Module dock is invalid.');
  if (!Number.isSafeInteger(instance.order) || instance.order < 0) invalid('Module order is invalid.');
  if (typeof instance.size !== 'string' || !SIZES.has(instance.size)) invalid('Module size is invalid.');
  return {
    id,
    type: instance.type,
    displayName,
    dock: instance.dock,
    order: instance.order,
    size: instance.size,
    config: validateConfig(instance.type, instance.config),
  };
}

function validateProfile(value) {
  const profile = readRecord(value, 'Workspace profile');
  exactKeys(profile, ['id', 'name', 'instances'], 'Workspace profile');
  const id = validateId(profile.id, 'Profile ID', PROFILE_ID_PATTERN);
  const name = validateName(profile.name, 'Profile name');
  readArray(profile.instances, 'Profile instances');
  if (profile.instances.length > WORKSPACE_LIMITS.instancesPerProfile) {
    invalid(`A profile can contain at most ${WORKSPACE_LIMITS.instancesPerProfile} modules.`);
  }
  const instances = profile.instances.map(validateInstance);
  const ids = new Set();
  const dockOrders = new Map();
  let timelineCount = 0;
  for (const instance of instances) {
    if (ids.has(instance.id)) invalid('Module instance IDs must be unique within a profile.');
    ids.add(instance.id);
    if (instance.type === 'timeline') timelineCount += 1;
    if (!dockOrders.has(instance.dock)) dockOrders.set(instance.dock, []);
    dockOrders.get(instance.dock).push(instance.order);
  }
  if (timelineCount > 1) invalid('A workspace profile can contain only one timeline.');
  for (const orders of dockOrders.values()) {
    orders.sort((a, b) => a - b);
    if (orders.some((order, index) => order !== index)) {
      invalid('Module order must be complete and unique within each dock.');
    }
  }
  if (id === 'default' && name !== 'Default') invalid('The default profile name cannot be changed.');
  return { id, name, instances };
}

function serializedBytes(value) {
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    invalid('Workspace data cannot be serialized.');
  }
  return { serialized, bytes: new TextEncoder().encode(serialized).byteLength };
}

export function validateWorkspaceEnvelope(value) {
  const envelope = readRecord(value, 'Workspace data');
  exactKeys(envelope, ['version', 'activeProfileId', 'profiles'], 'Workspace data');
  if (envelope.version !== 1) {
    invalid('This workspace data version is not supported.', 'WORKSPACE_UNSUPPORTED');
  }
  readArray(envelope.profiles, 'Workspace profiles');
  if (!envelope.profiles.length || envelope.profiles.length > WORKSPACE_LIMITS.savedProfiles + 1) {
    invalid('Workspace profile count is invalid.');
  }
  const profiles = envelope.profiles.map(validateProfile);
  const profileIds = new Set();
  for (const profile of profiles) {
    if (profileIds.has(profile.id)) invalid('Workspace profile IDs must be unique.');
    profileIds.add(profile.id);
  }
  if (!profileIds.has('default')) invalid('Workspace data must include the default profile.');
  if (typeof envelope.activeProfileId !== 'string' || !profileIds.has(envelope.activeProfileId)) {
    invalid('The active workspace profile does not exist.');
  }
  const result = { version: 1, activeProfileId: envelope.activeProfileId, profiles };
  const { bytes } = serializedBytes(result);
  if (bytes > WORKSPACE_LIMITS.payloadBytes) {
    invalid('Workspace data exceeds the 64 KiB storage limit.', 'WORKSPACE_TOO_LARGE');
  }
  return result;
}

function defaultInstances() {
  return [
    {
      id: 'activity-feed',
      type: 'feed',
      displayName: WORKSPACE_MODULES.feed.label,
      dock: 'left',
      order: 0,
      size: 'standard',
      config: {
        categories: [...CATEGORIES],
        density: 'comfortable',
        showLegend: true,
      },
    },
    {
      id: 'active-sessions',
      type: 'sessions',
      displayName: WORKSPACE_MODULES.sessions.label,
      dock: 'right',
      order: 0,
      size: 'standard',
      config: { filter: 'all', density: 'comfortable' },
    },
    {
      id: 'timeline',
      type: 'timeline',
      displayName: WORKSPACE_MODULES.timeline.label,
      dock: 'bottom',
      order: 0,
      size: 'standard',
      config: {},
    },
  ];
}

export function createDefaultWorkspace() {
  return {
    version: 1,
    activeProfileId: 'default',
    profiles: [{ id: 'default', name: 'Default', instances: defaultInstances() }],
  };
}

function errorInfo(code, message) {
  return { code, message };
}

function failureFrom(error) {
  if (error instanceof WorkspaceValidationError) {
    return errorInfo(error.code, error.message);
  }
  return errorInfo('WORKSPACE_INVALID', 'Workspace data is invalid.');
}

export function createWorkspaceStore({ storage = null, createId } = {}) {
  let workspace = createDefaultWorkspace();
  let storageStatus = storage ? 'available' : 'memory-only';
  let error = null;
  let dirty = false;
  let recoveryRequired = false;
  let idSequence = 0;
  const makeId = createId ?? (() => {
    if (!globalThis.crypto?.randomUUID) {
      throw new Error('A secure profile ID generator is unavailable.');
    }
    return `profile-${globalThis.crypto.randomUUID()}`;
  });

  if (storage) {
    try {
      const raw = storage.getItem(WORKSPACE_STORAGE_KEY);
      if (raw !== null && raw !== undefined) {
        if (typeof raw !== 'string') invalid('Stored workspace data is not text.', 'WORKSPACE_CORRUPT');
        if (raw.length > WORKSPACE_LIMITS.payloadBytes ||
            new TextEncoder().encode(raw).byteLength > WORKSPACE_LIMITS.payloadBytes) {
          invalid('Stored workspace data exceeds the 64 KiB storage limit.', 'WORKSPACE_TOO_LARGE');
        }
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch {
          invalid('Stored workspace data is malformed.', 'WORKSPACE_CORRUPT');
        }
        workspace = validateWorkspaceEnvelope(parsed);
      }
    } catch (caught) {
      recoveryRequired = true;
      dirty = true;
      storageStatus = 'recovery';
      error = caught instanceof WorkspaceValidationError
        ? errorInfo(caught.code, caught.message)
        : errorInfo('STORAGE_READ_FAILED', 'Workspace storage could not be read. Temporary defaults are in use.');
    }
  }

  function getState() {
    const snapshot = structuredClone(workspace);
    return {
      ...snapshot,
      activeProfile: snapshot.profiles.find(({ id }) => id === snapshot.activeProfileId),
      storageStatus,
      dirty,
      recoveryRequired,
      error: error ? { ...error } : null,
    };
  }

  function finishSave(candidate, { replaceRecovery = false } = {}) {
    let validated;
    let serialized;
    try {
      validated = validateWorkspaceEnvelope(candidate);
      ({ serialized } = serializedBytes(validated));
    } catch (caught) {
      return { ok: false, error: failureFrom(caught), state: getState() };
    }

    workspace = validated;
    dirty = true;
    if (recoveryRequired && !replaceRecovery) {
      error = errorInfo('RECOVERY_REQUIRED', 'Temporary changes are not saved. Explicitly replace the invalid stored workspace to save them.');
      return { ok: false, error: { ...error }, state: getState() };
    }
    if (!storage) {
      storageStatus = 'memory-only';
      error = errorInfo('STORAGE_UNAVAILABLE', 'Workspace changes are in memory only because browser storage is unavailable.');
      return { ok: false, error: { ...error }, state: getState() };
    }
    try {
      storage.setItem(WORKSPACE_STORAGE_KEY, serialized);
      recoveryRequired = false;
      dirty = false;
      storageStatus = 'available';
      error = null;
      return { ok: true, state: getState() };
    } catch {
      storageStatus = 'not-saved';
      error = errorInfo('STORAGE_WRITE_FAILED', 'Workspace changes are in memory but were not saved. Retry when browser storage is available.');
      return { ok: false, error: { ...error }, state: getState() };
    }
  }

  function activeProfile(candidate = workspace) {
    return candidate.profiles.find(({ id }) => id === candidate.activeProfileId);
  }

  function updateProfile(id, updates) {
    return runMutation((candidate) => {
      validateId(id, 'Profile ID', PROFILE_ID_PATTERN);
      const update = readRecord(updates, 'Profile updates');
      const keys = Object.keys(update);
      if (!keys.length || keys.some((key) => !['name', 'instances'].includes(key))) {
        invalid('Profile updates must include a name or module instances only.');
      }
      const profile = candidate.profiles.find((entry) => entry.id === id);
      if (!profile) invalid('Workspace profile does not exist.');
      if (id === 'default' && Object.hasOwn(update, 'name') && update.name !== 'Default') {
        invalid('The default profile name cannot be changed.');
      }
      if (Object.hasOwn(update, 'name')) profile.name = update.name;
      if (Object.hasOwn(update, 'instances')) profile.instances = update.instances;
      const validated = validateProfile(profile);
      candidate.profiles[candidate.profiles.indexOf(profile)] = validated;
    });
  }

  function runMutation(change) {
    let candidate;
    try {
      candidate = structuredClone(workspace);
      change(candidate);
    } catch (caught) {
      return { ok: false, error: failureFrom(caught), state: getState() };
    }
    return finishSave(candidate);
  }

  return Object.freeze({
    getState,

    setInstances(instances) {
      return runMutation((candidate) => {
        activeProfile(candidate).instances = instances;
      });
    },

    createProfile(name, instances = activeProfile().instances) {
      return runMutation((candidate) => {
        const currentProfiles = candidate.profiles;
        if (currentProfiles.filter(({ id }) => id !== 'default').length >= WORKSPACE_LIMITS.savedProfiles) {
          invalid(`You can save at most ${WORKSPACE_LIMITS.savedProfiles} workspace profiles.`);
        }
        let id = makeId();
        if (id === undefined || id === null || id === '') {
          idSequence += 1;
          id = `profile-${idSequence}`;
        }
        validateId(id, 'Profile ID', PROFILE_ID_PATTERN);
        if (currentProfiles.some((profile) => profile.id === id)) invalid('Profile ID already exists.');
        const profile = validateProfile({ id, name, instances });
        currentProfiles.push(profile);
        candidate.activeProfileId = profile.id;
      });
    },

    updateProfile,

    renameProfile(id, name) {
      return updateProfile(id, { name });
    },

    selectProfile(id) {
      return runMutation((candidate) => {
        validateId(id, 'Profile ID', PROFILE_ID_PATTERN);
        if (!candidate.profiles.some((profile) => profile.id === id)) {
          invalid('Workspace profile does not exist.');
        }
        candidate.activeProfileId = id;
      });
    },

    deleteProfile(id) {
      return runMutation((candidate) => {
        validateId(id, 'Profile ID', PROFILE_ID_PATTERN);
        if (id === 'default') invalid('The default workspace profile cannot be deleted.');
        const index = candidate.profiles.findIndex((profile) => profile.id === id);
        if (index < 0) invalid('Workspace profile does not exist.');
        candidate.profiles.splice(index, 1);
        if (candidate.activeProfileId === id) candidate.activeProfileId = 'default';
      });
    },

    resetLayout() {
      return runMutation((candidate) => {
        activeProfile(candidate).instances = defaultInstances();
      });
    },

    retrySave() {
      if (recoveryRequired) {
        error = errorInfo('RECOVERY_REQUIRED', 'Temporary changes are not saved. Explicitly replace the invalid stored workspace to save them.');
        return { ok: false, error: { ...error }, state: getState() };
      }
      return finishSave(workspace);
    },

    replaceCorruptStorage() {
      return finishSave(workspace, { replaceRecovery: true });
    },
  });
}
