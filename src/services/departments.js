export const COMMON_DEPARTMENT_KEY = 'common';

export const toPublicDepartment = (department) => ({
  id: department.id,
  key: department.key,
  name: department.name,
  isCommon: Boolean(department.isCommon),
  createdAt: department.createdAt,
  updatedAt: department.updatedAt
});

export const ensureCommonDepartment = async (prisma) =>
  prisma.department.upsert({
    where: { key: COMMON_DEPARTMENT_KEY },
    create: {
      key: COMMON_DEPARTMENT_KEY,
      name: 'Common',
      isCommon: true
    },
    update: {
      name: 'Common',
      isCommon: true
    }
  });

export const ensureDepartmentAssignments = async (prisma) => {
  const commonDepartment = await ensureCommonDepartment(prisma);

  await prisma.document.updateMany({
    where: {},
    data: { departmentId: commonDepartment.id }
  });

  return commonDepartment;
};

export const getCommonDepartment = async (prisma) => {
  await ensureCommonDepartment(prisma);
  return prisma.department.findUnique({ where: { key: COMMON_DEPARTMENT_KEY } });
};

export const canUserAccessDepartment = (user, department) => {
  if (!user || !department) {
    return false;
  }

  if (user.role?.key === 'admin') {
    return true;
  }

  if (!user.departmentId) {
    return true;
  }

  if (department.key === COMMON_DEPARTMENT_KEY || department.isCommon) {
    return true;
  }

  return Boolean(user.departmentId && user.departmentId === department.id);
};

export const canUserAccessDocument = (user, document) => {
  if (!user || !document) {
    return false;
  }

  if (user.role?.key === 'admin') {
    return true;
  }

  if (!user.departmentId) {
    return true;
  }

  if (document.department) {
    return canUserAccessDepartment(user, document.department);
  }

  if (!document.departmentId) {
    return true;
  }

  const commonDepartmentKey = document.departmentKey;

  if (commonDepartmentKey === COMMON_DEPARTMENT_KEY) {
    return true;
  }

  if (document.departmentId === user.departmentId) {
    return true;
  }

  return false;
};
