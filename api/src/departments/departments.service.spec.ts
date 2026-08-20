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

  it("返回一级部门负责人直属主管作为最终业务审批人", async () => {
    const prisma = {
      department: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "dept-hr",
            name: "人事行政部",
            fullPath: "人事行政部",
            parentId: null,
            leaderId: "leader-yao",
            approverId: null,
            company: "fuede",
            sortOrder: 1,
            isActive: true,
            leader: {
              name: "姚瑶",
              directManagerId: "manager-guo",
              directManager: { name: "郭志浩" },
            },
            approver: null,
          },
        ]),
      },
      user: {
        groupBy: jest.fn().mockResolvedValue([
          { deptId: "dept-hr", _count: { _all: 8 } },
        ]),
      },
    };
    const service = new DepartmentsService(prisma as any);

    const result = await service.findAll({ isActive: true, flat: true });

    expect(result[0]).toMatchObject({
      effectiveApproverId: "manager-guo",
      effectiveApproverName: "郭志浩",
      effectiveApproverSource: "leader_manager",
    });
  });
});
