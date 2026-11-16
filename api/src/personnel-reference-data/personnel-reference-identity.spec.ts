import { personnelReferenceFieldErrors, validatePersonnelReferences } from './personnel-reference-validation';

const educationId = '00000000-0000-4000-8000-000000000001';
const locationId = '00000000-0000-4000-8000-000000000002';
const familyId = '00000000-0000-4000-8000-000000000003';
const setup = () => {
  const rows = [
    { id: educationId, kind: 'education', name: 'Degree', isActive: true },
    { id: locationId, kind: 'work_location', name: 'North office', isActive: true },
    { id: familyId, kind: 'job_family', name: 'Engineering', isActive: true },
  ];
  const client = { personnelReferenceData: { findMany: async () => rows } } as any;
  return { rows, client };
};

describe('personnel reference identity and snapshot contract', () => {
  it('writes the selected ID and server name, ignoring forged client labels', async () => {
    const { client } = setup();
    const value = { profile: { educationId, education: 'Forged' }, employee: {
      workLocationId: locationId, workLocation: 'Forged', jobFamilyId: familyId, jobFamily: 'Forged' } };
    await validatePersonnelReferences(client, value);
    expect(value).toEqual({ profile: { educationId, education: 'Degree' }, employee: {
      workLocationId: locationId, workLocation: 'North office', jobFamilyId: familyId, jobFamily: 'Engineering' } });
  });

  it('rejects name-only new selections even if the same name exists', async () => {
    const { client } = setup();
    expect(await personnelReferenceFieldErrors(client, { profile: { education: 'Degree' },
      employee: { workLocation: 'North office', jobFamily: 'Engineering' } })).toMatchObject({
      'profile.education': expect.any(String), 'employee.workLocation': expect.any(String), 'employee.jobFamily': expect.any(String),
    });
  });

  it.each(['disabled', 'wrong-kind', 'missing'])('rejects %s IDs without falling back to names', async state => {
    const { client, rows } = setup();
    if (state === 'disabled') rows[0].isActive = false;
    if (state === 'wrong-kind') rows[0].kind = 'marital_status';
    if (state === 'missing') rows.splice(0, 1);
    await expect(validatePersonnelReferences(client, { profile: { educationId, education: 'Degree' } }))
      .rejects.toMatchObject({ response: { data: { fieldErrors: { 'profile.education': expect.any(String) } } } });
  });

  it('preserves unchanged formal names and IDs after rename or deactivation', async () => {
    const { client, rows } = setup();
    Object.assign(rows[0], { name: 'Renamed', isActive: false });
    const base = { profile: { educationId, education: 'Historical name' }, employee: { workLocation: 'Legacy location' } };
    const value = structuredClone(base);
    await validatePersonnelReferences(client, value, base);
    expect(value).toEqual(base);
  });

  it('clears both reference ID and snapshot from either explicit clear', async () => {
    const { client } = setup();
    const base = { profile: { educationId, education: 'Degree' } };
    for (const profile of [{ educationId: null }, { education: null }]) {
      const value = { profile };
      await validatePersonnelReferences(client, value, base);
      expect(value.profile).toEqual({ educationId: null, education: null });
    }
  });

  it('does not treat a draft value as a historical exemption when formal data is blank', async () => {
    const { client } = setup();
    await expect(validatePersonnelReferences(client, { profile: { education: 'Draft-only name' } }, { profile: {} }))
      .rejects.toMatchObject({ status: 400 });
  });
});
