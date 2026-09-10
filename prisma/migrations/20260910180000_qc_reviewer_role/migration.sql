-- Provision an unassigned reviewer role. Existing roles and memberships are preserved.
WITH added AS (
  INSERT INTO roles (id, "organizationId", name, description, "isSystem", "updatedAt")
  SELECT gen_random_uuid(), id, 'QC Reviewer', 'Inspect source evidence and score QC work without source ticket mutation permissions.', false, now()
  FROM organizations
  ON CONFLICT ("organizationId", name) DO NOTHING
  RETURNING id
)
INSERT INTO role_permissions (id, "roleId", "permissionId")
SELECT gen_random_uuid(), added.id, permissions.id FROM added CROSS JOIN permissions
WHERE permissions.name IN ('qc.view', 'qc.view_all', 'qc.reviews_perform')
ON CONFLICT DO NOTHING;
