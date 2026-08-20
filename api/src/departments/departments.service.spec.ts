import { DepartmentsService } from "./departments.service";

describe("DepartmentsService", () => {
  it("正式组织人数只统计员工账号，不把测试或服务账号算入花名册组织", async () => {
    const prisma = {
      department: { findMany: jest.fn().mockResolvedValue([]) },
      user: { groupBy: jest.fn().mockResolvedValue([]) },
    };
    const service = new DepartmentsService(prisma as any);

    await service.findAll({ isActive: true });

    expect(prisma.user.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ accountType: "employee" }),
      }),
    );
  });
});
