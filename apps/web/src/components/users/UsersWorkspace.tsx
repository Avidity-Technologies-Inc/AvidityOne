"use client";

import { Edit3, KeyRound, RefreshCcw, Trash2, Plus, X, Save } from "lucide-react";
import { FormEvent, ReactNode, useEffect, useMemo, useState, useRef } from "react";
import { apiFetch } from "@/lib/api";
import { accessLabel, notifyAccessChanged, subscribeAccessRefresh } from "@/lib/access-refresh";
import { PermissionPreview } from "./PermissionPreview";
import "./access.css";

interface RoleSummary {
  id: string;
  name: string;
}

interface Permission {
  id: string;
  name: string;
  description: string | null;
}

interface UserRecord {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  forcePasswordChange: boolean;
  mfaEnabled: boolean;
  groups: Array<{
    group: {
      id: string;
      name: string;
      roles: Array<{ role: RoleSummary }>;
    };
  }>;
}

interface GroupRecord {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  users: Array<{ userId: string }>;
  roles: Array<{
    role: RoleSummary & {
      permissions: Array<{ permission: Permission }>;
    };
  }>;
}

interface RoleRecord {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  groups: Array<{ groupId: string }>;
  permissions: Array<{ permission: Permission }>;
}

const emptyUserForm = {
  id: "",
  email: "",
  firstName: "",
  lastName: "",
  password: "",
  isActive: true,
  forcePasswordChange: true,
  groupIds: [] as string[]
};

const emptyGroupForm = {
  id: "",
  name: "",
  description: "",
  roleIds: [] as string[]
};

const emptyRoleForm = {
  id: "",
  name: "",
  description: "",
  permissionIds: [] as string[]
};

type ActiveTab = "users" | "groups" | "roles";

const permissionScopeLabels: Record<string, string> = {
  qc: "Quality Control",
  ai_assistant: "AI Assistant",
  audit_logs: "Audit Logs",
  auto_replies: "Auto Replies",
  client_domains: "Client Domains",
  clients: "Clients",
  contacts: "Contacts",
  devices: "Devices",
  event_services: "Event Services",
  external_specialists: "External Specialists",
  groups: "Access Groups",
  knowledge_base: "Knowledge Base",
  mailboxes: "Mailboxes",
  maintenance: "Maintenance",
  permissions: "Permission Catalog",
  remote_access: "Remote Access",
  reports: "Reports",
  roles: "Roles",
  signatures: "Signatures",
  spam: "Spam Management",
  system_settings: "System Settings",
  ticket_attachments: "Ticket Attachments",
  ticket_messages: "Ticket Messages",
  ticket_meetings: "Scheduled Activities",
  tickets: "Tickets",
  users: "Users"
};

const permissionScopeOrder = [
  "tickets",
  "ticket_messages",
  "ticket_attachments",
  "event_services",
  "external_specialists",
  "clients",
  "contacts",
  "client_domains",
  "devices",
  "remote_access",
  "knowledge_base",
  "reports",
  "ai_assistant",
  "mailboxes",
  "auto_replies",
  "spam",
  "maintenance",
  "users",
  "groups",
  "roles",
  "permissions",
  "system_settings",
  "audit_logs",
  "signatures"
];

const permissionActionOrder = ["view", "create", "update", "assign", "reply", "close", "reopen", "merge", "upload", "download", "publish", "send", "export", "manage", "configure", "connect", "delete"];
const sensitivePermissionScopes = new Set(["users", "groups", "roles", "permissions", "system_settings", "audit_logs", "mailboxes"]);

function permissionScopeLabel(scope: string) {
  return permissionScopeLabels[scope] ?? scope.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function permissionActionRank(permissionName: string) {
  const action = permissionName.split(".")[1] ?? "";
  const index = permissionActionOrder.indexOf(action);
  return index === -1 ? permissionActionOrder.length : index;
}

export function UsersWorkspace() {
  const [grants, setGrants] = useState<string[]>([]);
  const [loaded, setLoaded] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [permissionSearch, setPermissionSearch] = useState("");
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [baseline, setBaseline] = useState("");
  const can = (permission: string) => grants.includes(permission);
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [groups, setGroups] = useState<GroupRecord[]>([]);
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [activeTab, setActiveTab] = useState<ActiveTab>("users");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showUserForm, setShowUserForm] = useState(false);
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [showRoleForm, setShowRoleForm] = useState(false);
  const [userForm, setUserForm] = useState(emptyUserForm);
  const [groupForm, setGroupForm] = useState(emptyGroupForm);
  const [roleForm, setRoleForm] = useState(emptyRoleForm);

  const permissionGroups = useMemo(() => {
    const grouped = new Map<string, Permission[]>();
    for (const permission of permissions) {
      const [scope] = permission.name.split(".");
      grouped.set(scope, [...(grouped.get(scope) ?? []), permission]);
    }
    return [...grouped.entries()]
      .map(([scope, scopePermissions]) => ({
        scope,
        label: permissionScopeLabel(scope),
        isSensitive: sensitivePermissionScopes.has(scope),
        permissions: [...scopePermissions].sort((a, b) => permissionActionRank(a.name) - permissionActionRank(b.name) || a.name.localeCompare(b.name))
      }))
      .sort((a, b) => {
        const scopeA = permissionScopeOrder.indexOf(a.scope);
        const scopeB = permissionScopeOrder.indexOf(b.scope);
        const rankA = scopeA === -1 ? permissionScopeOrder.length : scopeA;
        const rankB = scopeB === -1 ? permissionScopeOrder.length : scopeB;
        return rankA - rankB || a.label.localeCompare(b.label);
      });
  }, [permissions]);
  const permissionIds = useMemo(() => new Set(permissions.map((permission) => permission.id)), [permissions]);
  const permissionIdByName = useMemo(() => new Map(permissions.map((permission) => [permission.name, permission.id])), [permissions]);
  const selectedRolePermissionCount = new Set(roleForm.permissionIds).size;
  function assignmentChanged(key: string, values: string[]) {
    const initial = baseline ? JSON.parse(baseline) as Record<string, unknown> : {};
    return formSnapshot(values) !== formSnapshot(initial[key] as object ?? []);
  }

  async function loadAccessData() {
    setLoading(true);
    setError(null);
    try {
      const { user } = await apiFetch<{ user: { permissions: string[] } }>("/auth/me");
      setGrants(user.permissions);
      const resources = ["users", "groups", "roles", "permissions"] as const;
      const results = await Promise.allSettled(resources.map(resource => user.permissions.includes(`${resource}.view`) ? apiFetch<unknown[]>(`/${resource}`) : Promise.resolve([])));
      const data = results.map(result => result.status === "fulfilled" ? result.value : []);
      setUsers(data[0] as UserRecord[]);
      setGroups(data[1] as GroupRecord[]);
      setRoles(data[2] as RoleRecord[]);
      setPermissions(data[3] as Permission[]);
      setLoaded(resources.filter((resource, index) => user.permissions.includes(`${resource}.view`) && results[index].status === "fulfilled"));
      const failed = resources.filter((_, index) => results[index].status === "rejected");
      if (failed.length) setError(`Unable to load ${failed.join(", ")}. Related assignment fields are disabled. Refresh to try again.`);
      setActiveTab(current => user.permissions.includes(`${current}.view`) ? current : resources.find(resource => resource !== "permissions" && user.permissions.includes(`${resource}.view`)) as ActiveTab ?? "users");
    } catch (requestError) {
      const detail = requestError instanceof Error ? requestError.message : "";
      setError(`Unable to load user access data.${detail ? ` ${detail}` : ""}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAccessData();
    let mounted = true;
    const unsubscribe = subscribeAccessRefresh(() => {
      void apiFetch<{ user: { permissions: string[] } }>("/auth/me").then(({ user }) => {
        if (mounted) setGrants(user.permissions);
      }).catch(() => { /* Keep the current view during a transient connection failure. */ });
    });
    return () => { mounted = false; unsubscribe(); };
  }, []);

  async function saveUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const isEditing = Boolean(userForm.id);
      await apiFetch(isEditing ? `/users/${userForm.id}` : "/users", {
        method: isEditing ? "PATCH" : "POST",
        body: JSON.stringify({
          email: userForm.email,
          firstName: userForm.firstName,
          lastName: userForm.lastName,
          password: userForm.password || undefined,
          isActive: userForm.isActive,
          forcePasswordChange: userForm.forcePasswordChange,
          groupIds: loaded.includes("groups") && (!userForm.id || assignmentChanged("groupIds", userForm.groupIds)) ? userForm.groupIds : undefined
        })
      });
      setNotice(isEditing ? "User updated." : "User created.");
      closeUserForm();
      notifyAccessChanged();
      await loadAccessData();
    } catch (requestError) {
      const detail = requestError instanceof Error ? requestError.message : "";
      setError(`Unable to save user.${detail ? ` ${detail}` : ""}`);
    } finally {
      setSaving(false);
    }
  }

  async function deleteUser(user: UserRecord) {
    if (!window.confirm(`Delete ${user.firstName} ${user.lastName}? Existing ticket history will remain.`)) {
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await apiFetch(`/users/${user.id}`, { method: "DELETE" });
      setNotice("User deleted.");
      notifyAccessChanged();
      await loadAccessData();
    } catch (requestError) {
      const detail = requestError instanceof Error ? requestError.message : "";
      setError(`Unable to delete user.${detail ? ` ${detail}` : ""}`);
    } finally {
      setSaving(false);
    }
  }

  async function resetUserMfa(user: UserRecord) {
    if (!window.confirm(`Reset two-factor authentication for ${user.firstName} ${user.lastName}? The user will need to set it up again.`)) {
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await apiFetch(`/users/${user.id}/reset-mfa`, { method: "POST" });
      setNotice("Two-factor authentication reset.");
      notifyAccessChanged();
      await loadAccessData();
    } catch (requestError) {
      const detail = requestError instanceof Error ? requestError.message : "";
      setError(`Unable to reset MFA.${detail ? ` ${detail}` : ""}`);
    } finally {
      setSaving(false);
    }
  }

  async function saveGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const isEditing = Boolean(groupForm.id);
      await apiFetch(isEditing ? `/groups/${groupForm.id}` : "/groups", {
        method: isEditing ? "PATCH" : "POST",
        body: JSON.stringify({
          name: groupForm.name,
          description: groupForm.description || null,
          roleIds: loaded.includes("roles") && (!groupForm.id || assignmentChanged("roleIds", groupForm.roleIds)) ? groupForm.roleIds : undefined
        })
      });
      setNotice(isEditing ? "Group updated." : "Group created.");
      closeGroupForm();
      notifyAccessChanged();
      await loadAccessData();
    } catch (requestError) {
      const detail = requestError instanceof Error ? requestError.message : "";
      setError(`Unable to save group.${detail ? ` ${detail}` : ""}`);
    } finally {
      setSaving(false);
    }
  }

  async function deleteGroup(group: GroupRecord) {
    if (!window.confirm(`Delete group ${group.name}? Its ${group.users.length} members will lose permissions inherited only through this group. Assigned tickets and rules will be unassigned from this group.`)) {
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await apiFetch(`/groups/${group.id}`, { method: "DELETE" });
      setNotice("Group deleted.");
      notifyAccessChanged();
      await loadAccessData();
    } catch (requestError) {
      const detail = requestError instanceof Error ? requestError.message : "";
      setError(`Unable to delete group.${detail ? ` ${detail}` : ""}`);
    } finally {
      setSaving(false);
    }
  }

  async function saveRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const isEditing = Boolean(roleForm.id);
      const normalizedPermissionIds = normalizeRolePermissionIds(roleForm.permissionIds);
      if (loaded.includes("permissions") && normalizedPermissionIds.invalidValues.length > 0) {
        setRoleForm((current) => ({ ...current, permissionIds: normalizedPermissionIds.permissionIds }));
        setError("Unable to save role. One or more selected permissions are no longer valid. Review the selection and try again.");
        return;
      }
      await apiFetch(isEditing ? `/roles/${roleForm.id}` : "/roles", {
        method: isEditing ? "PATCH" : "POST",
        body: JSON.stringify({
          name: roleForm.name,
          description: roleForm.description || null,
          permissionIds: loaded.includes("permissions") && (!roleForm.id || assignmentChanged("permissionIds", roleForm.permissionIds)) ? normalizedPermissionIds.permissionIds : undefined
        })
      });
      setNotice(isEditing ? "Role updated." : "Role created.");
      closeRoleForm();
      notifyAccessChanged();
      await loadAccessData();
    } catch (requestError) {
      const detail = requestError instanceof Error ? requestError.message : "";
      setError(`Unable to save role.${detail ? ` ${detail}` : ""}`);
    } finally {
      setSaving(false);
    }
  }

  async function deleteRole(role: RoleRecord) {
    if (!window.confirm(`Delete role ${role.name}? Its ${role.groups.length} assigned groups will lose permissions inherited only through this role.`)) {
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await apiFetch(`/roles/${role.id}`, { method: "DELETE" });
      setNotice("Role deleted.");
      notifyAccessChanged();
      await loadAccessData();
    } catch (requestError) {
      const detail = requestError instanceof Error ? requestError.message : "";
      setError(`Unable to delete role.${detail ? ` ${detail}` : ""}`);
    } finally {
      setSaving(false);
    }
  }

  function editUser(user: UserRecord) {
    const form = {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      password: "",
      isActive: user.isActive,
      forcePasswordChange: user.forcePasswordChange,
      groupIds: user.groups.map((item) => item.group.id)
    };
    setUserForm(form);
    setBaseline(formSnapshot(form));
    setError(null);
    setNotice(null);
    setShowUserForm(true);
    setActiveTab("users");
  }

  function editGroup(group: GroupRecord) {
    const form = {
      id: group.id,
      name: group.name,
      description: group.description ?? "",
      roleIds: group.roles.map((item) => item.role.id)
    };
    setGroupForm(form);
    setBaseline(formSnapshot(form));
    setError(null);
    setNotice(null);
    setShowGroupForm(true);
    setActiveTab("groups");
  }

  function editRole(role: RoleRecord) {
    const form = {
      id: role.id,
      name: role.name,
      description: role.description ?? "",
      permissionIds: role.permissions.map((item) => item.permission.id)
    };
    setRoleForm(form);
    setBaseline(formSnapshot(form));
    setPermissionSearch("");
    setSelectedOnly(false);
    setError(null);
    setNotice(null);
    setShowRoleForm(true);
    setActiveTab("roles");
  }

  function closeUserForm() {
    setShowUserForm(false);
    setUserForm(emptyUserForm);
  }

  function closeGroupForm() {
    setShowGroupForm(false);
    setGroupForm(emptyGroupForm);
  }

  function closeRoleForm() {
    setShowRoleForm(false);
    setRoleForm(emptyRoleForm);
  }

  function toggleUserGroup(groupId: string, checked: boolean) {
    setUserForm((current) => ({ ...current, groupIds: checked ? [...new Set([...current.groupIds, groupId])] : current.groupIds.filter((id) => id !== groupId) }));
  }

  function toggleGroupRole(roleId: string, checked: boolean) {
    setGroupForm((current) => ({ ...current, roleIds: checked ? [...new Set([...current.roleIds, roleId])] : current.roleIds.filter((id) => id !== roleId) }));
  }

  function toggleRolePermission(permissionId: string, checked: boolean) {
    setRoleForm((current) => ({
      ...current,
      permissionIds: checked ? [...new Set([...current.permissionIds, permissionId])] : current.permissionIds.filter((id) => id !== permissionId)
    }));
  }

  function toggleRolePermissionScope(scopePermissionIds: string[], checked: boolean) {
    setRoleForm((current) => ({
      ...current,
      permissionIds: checked
        ? [...new Set([...current.permissionIds, ...scopePermissionIds])]
        : current.permissionIds.filter((id) => !scopePermissionIds.includes(id))
    }));
  }

  function openNewRoleForm() {
    setRoleForm(emptyRoleForm);
    setBaseline(formSnapshot(emptyRoleForm));
    setPermissionSearch("");
    setSelectedOnly(false);
    setShowRoleForm(true);
    setActiveTab("roles");
  }

  function normalizeRolePermissionIds(values: string[]) {
    const nextIds: string[] = [];
    const invalidValues: string[] = [];
    for (const value of values) {
      if (permissionIds.has(value)) {
        nextIds.push(value);
        continue;
      }
      const permissionId = permissionIdByName.get(value);
      if (permissionId) {
        nextIds.push(permissionId);
        continue;
      }
      invalidValues.push(value);
    }
    return { permissionIds: [...new Set(nextIds)], invalidValues };
  }

  function userRoleNames(user: UserRecord) {
    return [...new Set(user.groups.flatMap((item) => item.group.roles.map((groupRole) => groupRole.role.name)))].join(", ") || "No roles";
  }

  const matches = (values: string[]) => values.join(" ").toLowerCase().includes(search.trim().toLowerCase());
  const visibleUsers = users.filter(user => matches([user.firstName, user.lastName, user.email, userRoleNames(user), ...user.groups.map(item => item.group.name)]));
  const visibleGroups = groups.filter(group => matches([group.name, group.description ?? "", ...group.roles.map(item => item.role.name)]));
  const visibleRoles = roles.filter(role => matches([role.name, role.description ?? ""]));
  const selectedGroups = groups.filter(group => userForm.groupIds.includes(group.id));
  const selectedRoles = roles.filter(role => groupForm.roleIds.includes(role.id));
  const affectedGroups = groups.filter(group => group.roles.some(item => item.role.id === roleForm.id));
  const affectedUserIds = new Set(affectedGroups.flatMap(group => group.users.map(item => item.userId)));
  const groupMembers = users.filter(user => user.groups.some(item => item.group.id === groupForm.id));
  const tabs: Array<{ key: ActiveTab; label: string; count: number }> = [
    { key: "users", label: "Users", count: users.length },
    { key: "groups", label: "Groups", count: groups.length },
    { key: "roles", label: "Roles & Permissions", count: roles.length }
  ];
  function openNew() {
    setError(null); setNotice(null);
    if (activeTab === "users") { setUserForm(emptyUserForm); setBaseline(formSnapshot(emptyUserForm)); setShowUserForm(true); }
    if (activeTab === "groups") { setGroupForm(emptyGroupForm); setBaseline(formSnapshot(emptyGroupForm)); setShowGroupForm(true); }
    if (activeTab === "roles") openNewRoleForm();
  }
  const singular = activeTab === "users" ? "User" : activeTab === "groups" ? "Group" : "Role";
  const filteredPermissionGroups = permissionGroups.map(group => ({ ...group, permissions: group.permissions.filter(permission =>
    (!selectedOnly || roleForm.permissionIds.includes(permission.id)) &&
    `${group.label} ${permission.name} ${accessLabel(permission.name)} ${permission.description ?? ""}`.toLowerCase().includes(permissionSearch.trim().toLowerCase())
  ) })).filter(group => group.permissions.length);

  return (
    <section className="access-workspace">
      <div className="compact-page-header">
        <div><h1>People & Access</h1><p className="muted">Users belong to groups. Groups receive roles. Roles define permissions.</p></div>
        <button className="button secondary" type="button" onClick={loadAccessData} disabled={loading || saving}><RefreshCcw size={16} />Refresh</button>
      </div>
      {error && !showUserForm && !showGroupForm && !showRoleForm ? <div className="error-banner" role="alert">{error}</div> : null}
      {notice ? <div className="success-banner" role="status">{notice}</div> : null}
      <nav className="access-tabs" aria-label="Access management sections">
        {tabs.filter(tab => can(`${tab.key}.view`)).map(tab => <button type="button" key={tab.key} aria-current={activeTab === tab.key ? "page" : undefined} className={activeTab === tab.key ? "active" : ""} onClick={() => { setActiveTab(tab.key); setSearch(""); setNotice(null); }}>{tab.label}<span>{tab.count}</span></button>)}
      </nav>
      <section className="panel">
        <div className="section-heading">
          <div><h2>{tabs.find(tab => tab.key === activeTab)?.label}</h2><p className="muted">{activeTab === "users" ? "Manage accounts and group membership. Access combines permissions from every assigned group." : activeTab === "groups" ? "Assign roles to groups; all members inherit their permissions. Access groups can also be used for ticket assignment." : "Create reusable permission sets and assign them through groups. System roles can be edited but cannot be deleted."}</p></div>
          {can(`${activeTab}.create`) ? <button className="button" type="button" onClick={openNew} disabled={loading || saving}><Plus size={16} />Add {singular}</button> : null}
        </div>
        <label className="access-search">Search {activeTab}<input className="input" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={activeTab === "users" ? "Name, email, group or role" : "Name or description"} /></label>
        {activeTab === "users" && users.length >= 250 ? <p className="muted">Showing the first 250 users returned by the server.</p> : null}
        {loading ? <p role="status">Loading access data…</p> : !can(`${activeTab}.view`) ? <p>You do not have permission to view this section.</p> : <AccessTable>
          {activeTab === "users" ? <><thead><tr><th>User</th><th>Groups / inherited roles</th><th>Status</th><th>Actions</th></tr></thead><tbody>
            {!visibleUsers.length ? <tr><td colSpan={4}>No users match this search.</td></tr> : null}
            {visibleUsers.map(user => <tr key={user.id}>
              <td><strong>{user.firstName} {user.lastName}</strong><span className="muted">{user.email}</span></td>
              <td>{user.groups.map(item => item.group.name).join(", ") || "No groups"}<small className="access-secondary">{userRoleNames(user)}</small></td>
              <td><span className={`status-pill ${user.isActive ? "success" : "muted-pill"}`}>{user.isActive ? "Active" : "Inactive"}</span><small className="access-secondary">MFA {user.mfaEnabled ? "enabled" : "off"}</small></td>
              <td><div className="access-row-actions">
                {can("users.update") ? <><button className="button secondary" type="button" onClick={() => editUser(user)} disabled={saving}><Edit3 size={14} />Edit</button><button className="icon-button" type="button" title="Reset MFA" aria-label={`Reset MFA for ${user.email}`} onClick={() => resetUserMfa(user)} disabled={saving || !user.mfaEnabled}><KeyRound size={16} /></button></> : null}
                {can("users.delete") ? <button className="icon-button danger-icon" type="button" title="Delete user" aria-label={`Delete ${user.email}`} onClick={() => deleteUser(user)} disabled={saving}><Trash2 size={16} /></button> : null}
                {!can("users.update") ? <button className="button secondary" type="button" onClick={() => editUser(user)} disabled={saving}>View</button> : null}
              </div></td>
            </tr>)}
          </tbody></> : null}
          {activeTab === "groups" ? <><thead><tr><th>Group</th><th>Assigned roles</th><th>Members</th><th>Actions</th></tr></thead><tbody>
            {!visibleGroups.length ? <tr><td colSpan={4}>No groups match this search.</td></tr> : null}
            {visibleGroups.map(group => <tr key={group.id}>
              <td><strong>{group.name}</strong><span className="muted">{group.description || "No description"}</span>{group.isSystem ? <small>System group · deletion protected</small> : null}</td>
              <td>{group.roles.map(item => item.role.name).join(", ") || "No roles"}</td><td>{group.users.length}</td>
              <td><div className="access-row-actions">
                {can("groups.update") ? <button className="button secondary" type="button" onClick={() => editGroup(group)} disabled={saving}><Edit3 size={14} />Edit</button> : <button className="button secondary" type="button" onClick={() => editGroup(group)} disabled={saving}>View</button>}
                {can("groups.delete") ? <button className="icon-button danger-icon" type="button" title={group.isSystem ? "System groups cannot be deleted" : "Delete group"} aria-label={`Delete ${group.name}`} onClick={() => deleteGroup(group)} disabled={saving || group.isSystem}><Trash2 size={16} /></button> : null}
              </div></td>
            </tr>)}
          </tbody></> : null}
          {activeTab === "roles" ? <><thead><tr><th>Role</th><th>Permissions</th><th>Groups</th><th>Actions</th></tr></thead><tbody>
            {!visibleRoles.length ? <tr><td colSpan={4}>No roles match this search.</td></tr> : null}
            {visibleRoles.map(role => <tr key={role.id}>
              <td><strong>{role.name}</strong><span className="muted">{role.description || "No description"}</span>{role.isSystem ? <small>System role · deletion protected</small> : null}</td>
              <td>{role.permissions.length}</td><td>{role.groups.length}</td><td><div className="access-row-actions">
                {can("roles.update") ? <button className="button secondary" type="button" onClick={() => editRole(role)} disabled={saving}><Edit3 size={14} />Edit</button> : <button className="button secondary" type="button" onClick={() => editRole(role)} disabled={saving}>View</button>}
                {can("roles.delete") ? <button className="icon-button danger-icon" type="button" title={role.isSystem ? "System roles cannot be deleted" : "Delete role"} aria-label={`Delete ${role.name}`} onClick={() => deleteRole(role)} disabled={saving || role.isSystem}><Trash2 size={16} /></button> : null}
              </div></td>
            </tr>)}
          </tbody></> : null}
        </AccessTable>}
      </section>

      {showUserForm ? <AccessEditor title={userForm.id ? "Edit User" : "New User"} saveLabel={userForm.id ? "Save User" : "Create User"} dirty={formSnapshot(userForm) !== baseline} saving={saving} allowed={can(userForm.id ? "users.update" : "users.create")} error={error} onClose={closeUserForm} onSubmit={saveUser}>
        <div className="access-fields">
          <label>First name<input className="input" value={userForm.firstName} onChange={event => setUserForm(current => ({ ...current, firstName: event.target.value }))} required /></label>
          <label>Last name<input className="input" value={userForm.lastName} onChange={event => setUserForm(current => ({ ...current, lastName: event.target.value }))} required /></label>
          <label>Email<input className="input" type="email" autoComplete="off" value={userForm.email} onChange={event => setUserForm(current => ({ ...current, email: event.target.value }))} required /></label>
          <label>{userForm.id ? "New password (optional)" : "Temporary password"}<input className="input" type="password" autoComplete="new-password" minLength={10} value={userForm.password} onChange={event => setUserForm(current => ({ ...current, password: event.target.value }))} required={!userForm.id} /><small className="muted">At least 10 characters.{userForm.id ? " Leave blank to keep the current password." : ""}</small></label>
          <label className="checkbox-row"><input type="checkbox" checked={userForm.isActive} onChange={event => setUserForm(current => ({ ...current, isActive: event.target.checked }))} />Active account</label>
          <label className="checkbox-row"><input type="checkbox" checked={userForm.forcePasswordChange} onChange={event => setUserForm(current => ({ ...current, forcePasswordChange: event.target.checked }))} />Require password change at next login</label>
        </div>
        <h3>Group membership</h3><p className="muted">Select the groups this user belongs to. Removing one group does not remove permissions also granted by another group.</p>
        {!loaded.includes("groups") ? <p className="muted">Group assignment is unavailable. Existing memberships will be preserved.</p> : <div className="access-choices">{groups.map(group => <label className="access-choice" key={group.id}><input type="checkbox" checked={userForm.groupIds.includes(group.id)} onChange={event => toggleUserGroup(group.id, event.target.checked)} /><span><strong>{group.name}</strong><small>{group.roles.map(item => item.role.name).join(", ") || "No roles assigned"}</small></span></label>)}{!groups.length ? <p>Create a group in the Groups tab before assigning membership.</p> : null}</div>}
        {loaded.includes("groups") ? <PermissionPreview title="Resulting access after saving" permissions={selectedGroups.flatMap(group => group.roles.flatMap(item => item.role.permissions.map(entry => entry.permission.name)))} /> : null}
        {!userForm.isActive ? <p className="muted">This account is inactive and cannot sign in, regardless of its assigned permissions.</p> : null}
      </AccessEditor> : null}

      {showGroupForm ? <AccessEditor title={groupForm.id ? "Edit Group" : "New Group"} saveLabel={groupForm.id ? "Save Group" : "Create Group"} dirty={formSnapshot(groupForm) !== baseline} saving={saving} allowed={can(groupForm.id ? "groups.update" : "groups.create")} error={error} onClose={closeGroupForm} onSubmit={saveGroup}>
        <div className="access-fields"><label>Group name<input className="input" value={groupForm.name} onChange={event => setGroupForm(current => ({ ...current, name: event.target.value }))} required /></label><label>Description<input className="input" value={groupForm.description} onChange={event => setGroupForm(current => ({ ...current, description: event.target.value }))} /></label></div>
        <h3>Assigned roles</h3><p className="muted">Members receive the combined permissions of the selected roles.</p>
        {!loaded.includes("roles") ? <p className="muted">Role assignment is unavailable. Existing assignments will be preserved.</p> : <div className="access-choices">{roles.map(role => <label className="access-choice" key={role.id}><input type="checkbox" checked={groupForm.roleIds.includes(role.id)} onChange={event => toggleGroupRole(role.id, event.target.checked)} /><span><strong>{role.name}</strong><small>{role.permissions.length} permissions · {role.description || "No description"}</small></span></label>)}{!roles.length ? <p>Create a role in Roles & Permissions first.</p> : null}</div>}
        {loaded.includes("roles") ? <PermissionPreview title="Permissions inherited by members after saving" permissions={selectedRoles.flatMap(role => role.permissions.map(item => item.permission.name))} /> : null}
        {groupForm.id ? <div className="access-impact"><h3>Members affected by role changes: {groups.find(group => group.id === groupForm.id)?.users.length ?? 0}</h3><p className="muted">Manage membership from Users → Edit → Group membership. Save or cancel this group edit first.</p>{loaded.includes("users") ? <p>{groupMembers.map(user => `${user.firstName} ${user.lastName}`).join(", ") || "No members in the loaded user list."}</p> : null}</div> : null}
      </AccessEditor> : null}

      {showRoleForm ? <AccessEditor title={roleForm.id ? "Edit Role" : "New Role"} saveLabel={roleForm.id ? "Save Role" : "Create Role"} dirty={formSnapshot(roleForm) !== baseline} saving={saving} allowed={can(roleForm.id ? "roles.update" : "roles.create")} error={error} onClose={closeRoleForm} onSubmit={saveRole}>
        <div className="access-fields"><label>Role name<input className="input" value={roleForm.name} onChange={event => setRoleForm(current => ({ ...current, name: event.target.value }))} required /></label><label>Description<input className="input" value={roleForm.description} onChange={event => setRoleForm(current => ({ ...current, description: event.target.value }))} /></label></div>
        {roleForm.id ? <div className="access-impact"><strong>Impact: {roles.find(role => role.id === roleForm.id)?.groups.length ?? 0} assigned groups{loaded.includes("groups") ? ` · ${affectedUserIds.size} member accounts` : ""}</strong><p>{loaded.includes("groups") ? affectedGroups.map(group => group.name).join(", ") || "This role is not assigned to a group yet." : "Group details are unavailable."}</p><small>Changes apply to every member of these groups, including your own account if assigned.</small></div> : <p className="muted">After creating this role, assign it to a group to grant access to members.</p>}
        <div className="access-permission-tools"><label className="access-search">Search permissions<input className="input" type="search" placeholder="Module, action or permission key" value={permissionSearch} onChange={event => setPermissionSearch(event.target.value)} /></label><label className="checkbox-row"><input type="checkbox" checked={selectedOnly} onChange={event => setSelectedOnly(event.target.checked)} />Selected only</label><strong>{selectedRolePermissionCount} selected</strong></div>
        {!loaded.includes("permissions") ? <><p className="muted">Permission editing is unavailable. Existing permissions will be preserved.</p><PermissionPreview title="Current assigned permissions" permissions={roles.find(role => role.id === roleForm.id)?.permissions.map(item => item.permission.name) ?? []} /></> : <div className="access-permission-list">{filteredPermissionGroups.map(group => {
          const ids = group.permissions.map(permission => permission.id);
          const selected = ids.filter(id => roleForm.permissionIds.includes(id)).length;
          return <details className="access-permission-module" key={group.scope} open={permissionSearch.trim() ? true : undefined}>
            <summary><strong>{group.label}</strong><span>{selected}/{ids.length} selected{group.isSensitive ? " · Sensitive" : ""}</span></summary>
            <label className="checkbox-row access-select-visible"><input type="checkbox" checked={selected === ids.length} ref={input => { if (input) input.indeterminate = selected > 0 && selected < ids.length; }} onChange={event => toggleRolePermissionScope(ids, event.target.checked)} />Select all {permissionSearch || selectedOnly ? "shown " : ""}permissions in {group.label}</label>
            <div className="access-choices">{group.permissions.map(permission => <label className="access-choice" key={permission.id}><input type="checkbox" checked={roleForm.permissionIds.includes(permission.id)} onChange={event => toggleRolePermission(permission.id, event.target.checked)} /><span><strong>{accessLabel(permission.name.split(".").slice(1).join("."))}</strong>{permission.description ? <small>{permission.description}</small> : null}<code>{permission.name}</code></span></label>)}</div>
          </details>;
        })}{!filteredPermissionGroups.length ? <p className="muted">No permissions match these filters.</p> : null}</div>}
      </AccessEditor> : null}
    </section>
  );
}

function formSnapshot(form: object) {
  return JSON.stringify(form, (_key, value: unknown) => Array.isArray(value) ? [...value].sort() : value);
}

function AccessEditor({ title, saveLabel, dirty, saving, allowed, error, onClose, onSubmit, children }: {
  title: string; saveLabel: string; dirty: boolean; saving: boolean; allowed: boolean; error: string | null;
  onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [initiallyAllowed] = useState(allowed);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); };
  }, []);
  useEffect(() => {
    if (!dirty && !saving) return;
    const preventLoss = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", preventLoss);
    return () => window.removeEventListener("beforeunload", preventLoss);
  }, [dirty, saving]);
  function close() { if (!saving && (!dirty || window.confirm("Discard unsaved changes?"))) onClose(); }
  return <dialog ref={dialog} className="access-editor" aria-labelledby="access-editor-title" onCancel={event => { event.preventDefault(); close(); }}>
    <form onSubmit={event => { if (saving || !allowed || !dirty) event.preventDefault(); else onSubmit(event); }}>
      <header><div><h2 id="access-editor-title">{allowed ? title : title.replace(/^Edit/, "View")}</h2><span className={dirty ? "access-unsaved" : "muted"}>{saving ? "Saving changes…" : dirty ? "Unsaved changes" : "No pending changes"}</span></div><button type="button" className="icon-button" aria-label="Close editor" onClick={close} disabled={saving}><X size={18} /></button></header>
      {error ? <div className="error-banner" role="alert">{error}</div> : null}
      {!allowed ? initiallyAllowed ? <div className="error-banner" role="alert">Your access has changed. You no longer have permission to save this record.</div> : <p className="muted access-read-only">Read-only access. An administrator with update permission can change this record.</p> : null}
      <div className="access-editor-body"><fieldset disabled={saving || !allowed}>{children}</fieldset></div>
      <footer><span className="muted">Changes take effect only after saving.</span><div className="access-row-actions"><button type="button" className="button secondary" onClick={close} disabled={saving}>Cancel</button>{initiallyAllowed ? <button className="button" type="submit" disabled={saving || !dirty || !allowed}><Save size={16} />{saving ? "Saving…" : saveLabel}</button> : null}</div></footer>
    </form>
  </dialog>;
}


function AccessTable({ children }: { children: ReactNode }) {
  return <div className="table-scroll settings-section"><table className="table access-table">{children}</table></div>;
}
