import { personnelReferenceFieldErrors, validatePersonnelReferences } from './personnel-reference-validation';

const fixture = () => {
  const options = [{ kind: 'education', name: 'Degree', isActive: true },
    { kind: 'political_status', name: 'Inactive', isActive: false }];
  const client = { personnelReferenceData: { findMany: jest.fn(async ({ where }) => options.filter(option =>
    option.isActive === where.isActive && where.OR.some((query: any) => query.kind === option.kind && query.name === option.name))) } };
  return { client, options };
};

describe('shared personnel directory validation', () => {
  it('matches trimmed names within their kind, without rewriting caller data', async () => {
    const { client } = fixture();
    const input = { profile: { education: ' Degree ', politicalStatus: 'Degree', maritalStatus: 'Inactive' } };
    const before = structuredClone(input);
    const errors = await personnelReferenceFieldErrors(client as any, input);
    expect(errors).toEqual({ 'profile.politicalStatus': expect.any(String), 'profile.maritalStatus': expect.any(String) });
    expect(input).toEqual(before);
    expect(client.personnelReferenceData.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ isActive: true }), select: { kind: true, name: true },
    }));
  });

  it('does not query optional blanks, suggestions, or unchanged overlong historical values', async () => {
    const { client } = fixture();
    const input = { employee: { jobGrade: 'H'.repeat(70) }, profile: {
      education: undefined, maritalStatus: null, politicalStatus: '', householdType: ' ',
      bankName: 'Unlisted bank', emergencyContactRelation: null,
    } };
    await expect(validatePersonnelReferences(client as any, input, { employee: { jobGrade: 'H'.repeat(70) } })).resolves.toBeUndefined();
    expect(client.personnelReferenceData.findMany).not.toHaveBeenCalled();
  });

  it('rejects invalid new value types and per-field lengths before querying', async () => {
    const { client } = fixture();
    const errors = await personnelReferenceFieldErrors(client as any, { employee: { jobGrade: 'G'.repeat(31) },
      profile: { education: 42, maritalStatus: 'M'.repeat(31), politicalStatus: false,
        householdType: 'H'.repeat(51), emergencyContactRelation: ['invalid'] } });
    expect(Object.keys(errors).sort()).toEqual(['employee.jobGrade', 'profile.education', 'profile.emergencyContactRelation',
      'profile.householdType', 'profile.maritalStatus', 'profile.politicalStatus']);
    expect(client.personnelReferenceData.findMany).not.toHaveBeenCalled();
  });

  it('rechecks disabled or renamed selections while retaining the formal historical name', async () => {
    const { client, options } = fixture();
    options[0].isActive = false;
    await expect(validatePersonnelReferences(client as any, { profile: { education: 'Degree' } })).rejects.toMatchObject({ status: 400 });
    options[0].isActive = true;
    options[0].name = 'Renamed';
    await expect(validatePersonnelReferences(client as any, { profile: { education: 'Degree' } })).rejects.toMatchObject({ status: 400 });
    await expect(validatePersonnelReferences(client as any, { profile: { education: 'Degree' } }, { profile: { education: 'Degree' } }))
      .resolves.toBeUndefined();
  });
});
