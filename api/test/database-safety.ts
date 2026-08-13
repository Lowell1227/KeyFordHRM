export const EXTERNAL_E2E_DISPOSABLE_MARKER =
  "I_ACKNOWLEDGE_THIS_EXTERNAL_E2E_DATABASE_IS_DISPOSABLE";

export function prepareExternalE2EDatabase(
  databaseUrl: string,
  env: Record<string, string | undefined>,
  migrateAndSeed: (databaseUrl: string) => void,
): void {
  if (env.E2E_EXTERNAL_DATABASE_DISPOSABLE !== EXTERNAL_E2E_DISPOSABLE_MARKER) {
    throw new Error(
      `External E2E database rejected before migration/seed. Set E2E_EXTERNAL_DATABASE_DISPOSABLE=${EXTERNAL_E2E_DISPOSABLE_MARKER} only for a disposable database.`,
    );
  }
  migrateAndSeed(databaseUrl);
}
