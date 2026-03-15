export const CAPABILITIES = {
  DOCUMENTS_READ: 'documents.read',
  DOCUMENTS_WRITE: 'documents.write',
  DOCUMENTS_EXPORT: 'documents.export',
  BRANDING_MANAGE: 'branding.manage',
  USERS_MANAGE: 'users.manage',
  ROLES_MANAGE: 'roles.manage',
  DEPARTMENTS_MANAGE: 'departments.manage'
};

export const DEFAULT_ROLE_DEFINITIONS = [
  {
    key: 'admin',
    name: 'Admin',
    description: 'Full access to documents, users, roles, and branding settings.',
    capabilities: Object.values(CAPABILITIES)
  },
  {
    key: 'editor',
    name: 'Editor',
    description: 'Can view, edit, and export all shared documents.',
    capabilities: [
      CAPABILITIES.DOCUMENTS_READ,
      CAPABILITIES.DOCUMENTS_WRITE,
      CAPABILITIES.DOCUMENTS_EXPORT
    ]
  },
  {
    key: 'viewer',
    name: 'Viewer',
    description: 'Can view and export shared documents.',
    capabilities: [CAPABILITIES.DOCUMENTS_READ, CAPABILITIES.DOCUMENTS_EXPORT]
  }
];

const defaultCapabilitiesByRoleKey = Object.fromEntries(
  DEFAULT_ROLE_DEFINITIONS.map((roleDefinition) => [roleDefinition.key, roleDefinition.capabilities])
);

export const resolveRoleCapabilities = (role) => {
  if (!role) {
    return [];
  }

  if (Array.isArray(role.capabilities) && role.capabilities.length > 0) {
    return role.capabilities;
  }

  return defaultCapabilitiesByRoleKey[role.key] || [];
};

export const ensureDefaultRoles = async (prisma) => {
  const roles = [];

  for (const roleDefinition of DEFAULT_ROLE_DEFINITIONS) {
    const role = await prisma.role.upsert({
      where: { key: roleDefinition.key },
      create: roleDefinition,
      update: {
        name: roleDefinition.name,
        description: roleDefinition.description,
        capabilities: roleDefinition.capabilities
      }
    });

    roles.push(role);
  }

  return roles;
};

export const getRoleByKey = async (prisma, key) => {
  await ensureDefaultRoles(prisma);
  return prisma.role.findUnique({ where: { key } });
};

export const ensureUserRoleAssignments = async (prisma) => {
  const roles = await ensureDefaultRoles(prisma);
  const adminRole = roles.find((role) => role.key === 'admin');
  const editorRole = roles.find((role) => role.key === 'editor');

  if (!adminRole || !editorRole) {
    return;
  }

  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'asc' }
  });

  if (!users.length) {
    return;
  }

  const hasAdmin = users.some((user) => user.roleId === adminRole.id);

  if (!hasAdmin) {
    const firstUserWithoutAdmin = users[0];
    await prisma.user.update({
      where: { id: firstUserWithoutAdmin.id },
      data: { roleId: adminRole.id }
    });
  }

  const refreshedUsers = await prisma.user.findMany({
    orderBy: { createdAt: 'asc' }
  });

  for (const user of refreshedUsers) {
    if (!user.roleId) {
      await prisma.user.update({
        where: { id: user.id },
        data: { roleId: editorRole.id }
      });
    }
  }
};

export const toPublicRole = (role) => ({
  id: role.id,
  key: role.key,
  name: role.name,
  description: role.description,
  capabilities: resolveRoleCapabilities(role)
});
