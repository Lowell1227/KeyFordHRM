import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { TalentFilesService } from './talent-files.service';
import { TALENT_FILE_LIMIT } from './talent.constants';
import type { AuthUser } from '@/common/types/auth.types';

/** 简历附件规则（T3）：白名单类型、talent-resume/ 前缀、每候选人最多 3 个（第 4 个 409）。 */

const HR: AuthUser = {
  id: 'hr-1', name: 'HR', sysRole: 'hr' as never,
  deptId: null, isAssessorOnly: false, canViewAll: false,
};

const VALID_INPUT = {
  objectKey: 'talent-resume/2026/11/09/resume.pdf',
  fileName: '简历.pdf',
  mimeType: 'application/pdf',
  fileSize: 1024,
};

function setup(count: number) {
  const talents = {
    findActive: jest.fn().mockResolvedValue({ id: 'cand-1' }),
    countFiles: jest.fn().mockResolvedValue(count),
    createFileRecord: jest.fn().mockResolvedValue({ id: 'file-1' }),
    findFile: jest.fn(),
    deleteFileRecord: jest.fn(),
  };
  const storage = { statObject: jest.fn().mockResolvedValue({ size: 2048, metaData: { 'content-type': 'application/pdf' } }) };
  const sut = new TalentFilesService(talents as never, storage as never);
  return { sut, talents, storage };
}

describe('TalentFilesService 绑定简历', () => {
  it('第 4 个文件 → 409 且 data.reason=TALENT_FILE_LIMIT，不写记录', async () => {
    const { sut, talents } = setup(3);
    await expect(sut.bind('cand-1', VALID_INPUT as never, HR)).rejects.toMatchObject({
      response: expect.objectContaining({
        message: '简历文件最多 3 个，请先移除不需要的文件',
        data: { reason: TALENT_FILE_LIMIT },
      }),
    });
    await expect(sut.bind('cand-1', VALID_INPUT as never, HR)).rejects.toBeInstanceOf(ConflictException);
    expect(talents.createFileRecord).not.toHaveBeenCalled();
  });

  it('对象键必须是 talent-resume/ 前缀，禁止绑定任意 key', async () => {
    const { sut, talents } = setup(0);
    await expect(sut.bind('cand-1', { ...VALID_INPUT, objectKey: 'employee-contracts/x.pdf' } as never, HR))
      .rejects.toThrow(BadRequestException);
    await expect(sut.bind('cand-1', { ...VALID_INPUT, objectKey: 'talent-resume' } as never, HR))
      .rejects.toThrow('简历对象键无效');
    await expect(sut.bind('cand-1', { ...VALID_INPUT, objectKey: '' } as never, HR))
      .rejects.toThrow('简历对象键无效');
    expect(talents.createFileRecord).not.toHaveBeenCalled();
  });

  it.each(['exe', 'txt', 'xlsx', 'gif'])('扩展名 .%s 被拒绝', async (ext) => {
    const { sut, talents } = setup(0);
    await expect(sut.bind('cand-1', { ...VALID_INPUT, fileName: `简历.${ext}` } as never, HR))
      .rejects.toThrow('简历仅支持 PDF、DOC、DOCX、JPG、PNG');
    expect(talents.createFileRecord).not.toHaveBeenCalled();
  });

  it('pdf/doc/docx/jpg/jpeg/png 均允许', async () => {
    for (const ext of ['pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png']) {
      const { sut, talents } = setup(0);
      await sut.bind('cand-1', { ...VALID_INPUT, fileName: `简历.${ext}` } as never, HR);
      expect(talents.createFileRecord).toHaveBeenCalledTimes(1);
    }
  });

  it('文件大小以对象存储 statObject 实际值为准，sortOrder 用当前数量', async () => {
    const { sut, talents } = setup(1);
    await sut.bind('cand-1', VALID_INPUT as never, HR);
    expect(talents.createFileRecord).toHaveBeenCalledWith('cand-1', expect.objectContaining({
      fileSize: 2048,
      mimeType: 'application/pdf',
      sortOrder: 1,
      uploadedById: 'hr-1',
    }));
  });

  it('statObject 取不到时拒绝入库，不信任前端值', async () => {
    const storage = { statObject: jest.fn().mockRejectedValue(new Error('no such object')) };
    const talents = {
      findActive: jest.fn().mockResolvedValue({ id: 'cand-1' }),
      countFiles: jest.fn().mockResolvedValue(0),
      createFileRecord: jest.fn(),
    };
    const sut = new TalentFilesService(talents as never, storage as never);
    await expect(sut.bind('cand-1', VALID_INPUT as never, HR)).rejects.toThrow(BadRequestException);
    expect(talents.createFileRecord).not.toHaveBeenCalled();
    await expect(sut.bind('cand-1', { ...VALID_INPUT, fileSize: 0 } as never, HR))
      .rejects.toThrow('无法核验简历文件');
  });
});

describe('TalentFilesService 解绑简历', () => {
  it('文件不存在 → 404；存在则删记录（不碰对象存储）并留审计', async () => {
    const { sut, talents } = setup(0);
    talents.findFile.mockResolvedValue(null);
    await expect(sut.unbind('cand-1', 'file-x', HR)).rejects.toThrow(NotFoundException);

    talents.findFile.mockResolvedValue({ id: 'file-1' });
    const result = await sut.unbind('cand-1', 'file-1', HR);
    expect(result).toEqual({ id: 'file-1', removed: true });
    expect(talents.deleteFileRecord).toHaveBeenCalledWith('file-1', HR);
  });
});
