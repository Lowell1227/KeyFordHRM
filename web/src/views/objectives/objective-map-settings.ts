export interface ObjectiveMapDisplayOptions {
  showCompany: boolean;
  showDepartment: boolean;
  showOwner: boolean;
  showProgress: boolean;
  showConnections: boolean;
}

export const OBJECTIVE_MAP_DISPLAY_STORAGE_KEY = 'kayford.objectiveMap.display.v1';

export const DEFAULT_OBJECTIVE_MAP_DISPLAY: Readonly<ObjectiveMapDisplayOptions> = Object.freeze({
  showCompany: true,
  showDepartment: true,
  showOwner: true,
  showProgress: true,
  showConnections: true,
});

const displayKeys = [
  'showCompany',
  'showDepartment',
  'showOwner',
  'showProgress',
  'showConnections',
] as const;

function defaultDisplay(): ObjectiveMapDisplayOptions {
  return { ...DEFAULT_OBJECTIVE_MAP_DISPLAY };
}

export function parseObjectiveMapDisplay(raw: string | null): ObjectiveMapDisplayOptions {
  if (!raw) return defaultDisplay();

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return defaultDisplay();
    const record = parsed as Record<string, unknown>;
    if (!displayKeys.every((key) => typeof record[key] === 'boolean')) return defaultDisplay();
    return {
      showCompany: record.showCompany as boolean,
      showDepartment: record.showDepartment as boolean,
      showOwner: record.showOwner as boolean,
      showProgress: record.showProgress as boolean,
      showConnections: record.showConnections as boolean,
    };
  } catch {
    return defaultDisplay();
  }
}

export function saveObjectiveMapDisplay(
  value: ObjectiveMapDisplayOptions,
  storage?: Pick<Storage, 'setItem'>,
): void {
  const target = storage ?? (typeof window === 'undefined' ? undefined : window.localStorage);
  if (!target) return;
  target.setItem(OBJECTIVE_MAP_DISPLAY_STORAGE_KEY, JSON.stringify({
    showCompany: value.showCompany,
    showDepartment: value.showDepartment,
    showOwner: value.showOwner,
    showProgress: value.showProgress,
    showConnections: value.showConnections,
  }));
}
