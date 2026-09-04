"use client";

import { ArrowDown, ArrowUp, Eye, Plus, Save, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useBranding } from "@/components/providers/BrandingProvider";
import { apiFetch } from "@/lib/api";

interface UserOption {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

interface EventServiceCatalogItem {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  sortOrder: number;
  isActive: boolean;
  defaultUserIds: string[];
}

interface EventFormField {
  id: string;
  label: string;
  fieldKey: string;
  type: string;
  placeholder: string | null;
  helpText: string | null;
  options: string[];
  isRequired: boolean;
  sortOrder: number;
  isActive: boolean;
}

interface EventForm {
  id: string;
  name: string;
  introText: string | null;
  fields: EventFormField[];
}

interface EventTurnstileSettings {
  eventTurnstileEnabled: boolean;
  eventTurnstileSiteKey: string | null;
  eventTurnstileSecretReference: string | null;
}

interface EventPortalSettings {
  eventPortalBrowserTitle: string;
}

interface EventCalendarSettings {
  eventCalendarSyncEnabled: boolean;
  eventCalendarTenantId: string | null;
  eventCalendarClientId: string | null;
  eventCalendarClientSecretReference: string | null;
  eventCalendarDefaultTimeZone: string | null;
  eventExternalInviteSubjectTemplate: string | null;
  eventExternalInviteBodyTemplate: string | null;
}

const fieldTypes = ["TEXT", "TEXTAREA", "EMAIL", "PHONE", "DATE", "TIME", "SELECT", "MULTI_SELECT", "CHECKBOX", "RADIO", "NUMBER"];
const optionFieldTypes = new Set(["SELECT", "MULTI_SELECT", "CHECKBOX", "RADIO"]);

function label(value: string) {
  return value.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function displayUser(user: UserOption) {
  return `${user.firstName} ${user.lastName}`.trim() || user.email;
}

function makeFieldKey(value: string) {
  const normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_([a-zA-Z0-9])/g, (_, character: string) => character.toUpperCase());
  const camel = normalized.slice(0, 1).toLowerCase() + normalized.slice(1);
  return /^[a-z]/.test(camel) ? camel : `field${camel}`;
}

function optionsToText(options?: string[]) {
  return (options ?? []).join("\n");
}

function textToOptions(value: string) {
  return value.split(/\r?\n/).map((option) => option.trim()).filter(Boolean);
}

type ServiceDraft = {
  name: string;
  description: string;
  icon: string;
  sortOrder: number;
  isActive: boolean;
  defaultUserIds: string[];
};

type FieldDraft = {
  label: string;
  fieldKey: string;
  type: string;
  placeholder: string;
  helpText: string;
  optionsText: string;
  isRequired: boolean;
  sortOrder: number;
  isActive: boolean;
};

const blankServiceDraft: ServiceDraft = { name: "", description: "", icon: "", sortOrder: 100, isActive: true, defaultUserIds: [] };
const blankFieldDraft: FieldDraft = { label: "", fieldKey: "", type: "TEXT", placeholder: "", helpText: "", optionsText: "", isRequired: false, sortOrder: 100, isActive: true };

function serviceToDraft(service: EventServiceCatalogItem): ServiceDraft {
  return {
    name: service.name,
    description: service.description ?? "",
    icon: service.icon ?? "",
    sortOrder: service.sortOrder,
    isActive: service.isActive,
    defaultUserIds: service.defaultUserIds ?? []
  };
}

function fieldToDraft(field: EventFormField): FieldDraft {
  return {
    label: field.label,
    fieldKey: field.fieldKey,
    type: field.type,
    placeholder: field.placeholder ?? "",
    helpText: field.helpText ?? "",
    optionsText: optionsToText(field.options),
    isRequired: field.isRequired,
    sortOrder: field.sortOrder,
    isActive: field.isActive
  };
}

export function EventServicesConfigPanel() {
  const branding = useBranding();
  const [activeTab, setActiveTab] = useState<"form" | "preview" | "turnstile" | "calendar">("form");
  const [services, setServices] = useState<EventServiceCatalogItem[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [form, setForm] = useState<EventForm | null>(null);
  const [turnstile, setTurnstile] = useState<EventTurnstileSettings>({
    eventTurnstileEnabled: false,
    eventTurnstileSiteKey: "",
    eventTurnstileSecretReference: "env:EVENT_TURNSTILE_SECRET_KEY"
  });
  const [portalSettings, setPortalSettings] = useState<EventPortalSettings>({
    eventPortalBrowserTitle: "Schedule Event Support"
  });
  const [calendarSettings, setCalendarSettings] = useState<EventCalendarSettings>({
    eventCalendarSyncEnabled: false,
    eventCalendarTenantId: "",
    eventCalendarClientId: "",
    eventCalendarClientSecretReference: "env:MICROSOFT_CLIENT_SECRET",
    eventCalendarDefaultTimeZone: "America/Chicago",
    eventExternalInviteSubjectTemplate: "{{trackingNumber}}: {{taskTitle}}",
    eventExternalInviteBodyTemplate: "Hello {{specialistName}},\n\nYou have been assigned an event service task.\n\nTask: {{taskTitle}}\nEvent: {{eventName}}\nTracking: {{trackingNumber}}\nDate/time: {{dateTime}}\nLocation: {{location}}\nNotes: {{notes}}\n\nGoogle Calendar: {{googleCalendarLink}}\nOutlook Calendar: {{outlookCalendarLink}}\n\nA calendar file is attached."
  });
  const [serviceDraft, setServiceDraft] = useState<ServiceDraft>(blankServiceDraft);
  const [serviceEdits, setServiceEdits] = useState<Record<string, ServiceDraft>>({});
  const [editingServiceId, setEditingServiceId] = useState<string | null>(null);
  const [showServiceCreate, setShowServiceCreate] = useState(false);
  const [fieldDraft, setFieldDraft] = useState<FieldDraft>(blankFieldDraft);
  const [fieldEdits, setFieldEdits] = useState<Record<string, FieldDraft>>({});
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [showFieldCreate, setShowFieldCreate] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const nextServiceOrder = useMemo(() => Math.max(0, ...services.map((service) => service.sortOrder)) + 10, [services]);
  const nextFieldOrder = useMemo(() => Math.max(0, ...(form?.fields.map((field) => field.sortOrder) ?? [])) + 10, [form?.fields]);

  async function loadConfig() {
    setError(null);
    try {
      const [serviceData, formData, portalData, turnstileData, calendarData, userData] = await Promise.all([
        apiFetch<EventServiceCatalogItem[]>("/event-services/services"),
        apiFetch<EventForm>("/event-services/form"),
        apiFetch<EventPortalSettings>("/event-services/config/portal"),
        apiFetch<EventTurnstileSettings>("/event-services/config/turnstile"),
        apiFetch<EventCalendarSettings>("/event-services/config/calendar"),
        apiFetch<UserOption[]>("/users")
      ]);
      setServices(serviceData);
      setForm(formData);
      setUsers(userData);
      setPortalSettings({
        eventPortalBrowserTitle: portalData.eventPortalBrowserTitle || "Schedule Event Support"
      });
      setTurnstile({
        eventTurnstileEnabled: turnstileData.eventTurnstileEnabled,
        eventTurnstileSiteKey: turnstileData.eventTurnstileSiteKey ?? "",
        eventTurnstileSecretReference: turnstileData.eventTurnstileSecretReference ?? "env:EVENT_TURNSTILE_SECRET_KEY"
      });
      setCalendarSettings({
        eventCalendarSyncEnabled: calendarData.eventCalendarSyncEnabled,
        eventCalendarTenantId: calendarData.eventCalendarTenantId ?? "",
        eventCalendarClientId: calendarData.eventCalendarClientId ?? "",
        eventCalendarClientSecretReference: calendarData.eventCalendarClientSecretReference ?? "env:MICROSOFT_CLIENT_SECRET",
        eventCalendarDefaultTimeZone: calendarData.eventCalendarDefaultTimeZone ?? "America/Chicago",
        eventExternalInviteSubjectTemplate: calendarData.eventExternalInviteSubjectTemplate ?? "{{trackingNumber}}: {{taskTitle}}",
        eventExternalInviteBodyTemplate: calendarData.eventExternalInviteBodyTemplate ?? "Hello {{specialistName}},\n\nYou have been assigned an event service task.\n\nTask: {{taskTitle}}\nEvent: {{eventName}}\nTracking: {{trackingNumber}}\nDate/time: {{dateTime}}\nLocation: {{location}}\nNotes: {{notes}}\n\nGoogle Calendar: {{googleCalendarLink}}\nOutlook Calendar: {{outlookCalendarLink}}\n\nA calendar file is attached."
      });
      setServiceDraft((current) => ({ ...current, sortOrder: Math.max(10, Math.max(0, ...serviceData.map((service) => service.sortOrder)) + 10) }));
      setFieldDraft((current) => ({ ...current, sortOrder: Math.max(10, Math.max(0, ...formData.fields.map((field) => field.sortOrder)) + 10) }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load event configuration.");
    }
  }

  useEffect(() => {
    void loadConfig();
  }, []);

  function servicePayload(draft: ServiceDraft) {
    return {
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      icon: draft.icon.trim() || null,
      sortOrder: draft.sortOrder,
      isActive: draft.isActive,
      defaultUserIds: draft.defaultUserIds
    };
  }

  function fieldPayload(draft: FieldDraft) {
    return {
      type: draft.type,
      label: draft.label.trim(),
      fieldKey: draft.fieldKey.trim(),
      placeholder: draft.placeholder.trim() || null,
      helpText: draft.helpText.trim() || null,
      options: optionFieldTypes.has(draft.type) ? textToOptions(draft.optionsText) : [],
      sortOrder: draft.sortOrder,
      isRequired: draft.isRequired,
      isActive: draft.isActive
    };
  }

  async function createService() {
    if (!serviceDraft.name.trim()) return;
    setBusy("service");
    setError(null);
    try {
      await apiFetch("/event-services/services", { method: "POST", body: JSON.stringify(servicePayload(serviceDraft)) });
      setServiceDraft({ ...blankServiceDraft, sortOrder: nextServiceOrder + 10 });
      setShowServiceCreate(false);
      setNotice("Event service added.");
      await loadConfig();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create service.");
    } finally {
      setBusy(null);
    }
  }

  async function saveService(serviceId: string, draft: ServiceDraft) {
    if (!draft.name.trim()) return;
    setBusy(`service:${serviceId}`);
    setError(null);
    try {
      await apiFetch(`/event-services/services/${serviceId}`, { method: "PATCH", body: JSON.stringify(servicePayload(draft)) });
      setNotice("Event service saved.");
      setEditingServiceId(null);
      await loadConfig();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save service.");
    } finally {
      setBusy(null);
    }
  }

  async function toggleService(service: EventServiceCatalogItem) {
    await saveService(service.id, { ...serviceToDraft(service), isActive: !service.isActive });
  }

  async function moveService(service: EventServiceCatalogItem, direction: -1 | 1) {
    await saveService(service.id, { ...serviceToDraft(service), sortOrder: Math.max(0, service.sortOrder + direction * 10) });
  }

  async function createField() {
    if (!fieldDraft.label.trim() || !fieldDraft.fieldKey.trim()) return;
    setBusy("field");
    setError(null);
    try {
      await apiFetch("/event-services/form/fields", { method: "POST", body: JSON.stringify(fieldPayload(fieldDraft)) });
      setFieldDraft({ ...blankFieldDraft, sortOrder: nextFieldOrder + 10 });
      setShowFieldCreate(false);
      setNotice("Event form field added.");
      await loadConfig();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create form field.");
    } finally {
      setBusy(null);
    }
  }

  async function saveField(fieldId: string, draft: FieldDraft) {
    if (!draft.label.trim() || !draft.fieldKey.trim()) return;
    setBusy(`field:${fieldId}`);
    setError(null);
    try {
      await apiFetch(`/event-services/form/fields/${fieldId}`, { method: "PATCH", body: JSON.stringify(fieldPayload(draft)) });
      setNotice("Event form field saved.");
      setEditingFieldId(null);
      await loadConfig();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save form field.");
    } finally {
      setBusy(null);
    }
  }

  async function toggleField(field: EventFormField) {
    await saveField(field.id, { ...fieldToDraft(field), isActive: !field.isActive });
  }

  async function moveField(field: EventFormField, direction: -1 | 1) {
    await saveField(field.id, { ...fieldToDraft(field), sortOrder: Math.max(0, field.sortOrder + direction * 10) });
  }

  async function saveTurnstile() {
    setBusy("turnstile");
    setError(null);
    try {
      const saved = await apiFetch<EventTurnstileSettings>("/event-services/config/turnstile", {
        method: "PATCH",
        body: JSON.stringify(turnstile)
      });
      setTurnstile({
        eventTurnstileEnabled: saved.eventTurnstileEnabled,
        eventTurnstileSiteKey: saved.eventTurnstileSiteKey ?? "",
        eventTurnstileSecretReference: saved.eventTurnstileSecretReference ?? "env:EVENT_TURNSTILE_SECRET_KEY"
      });
      setNotice("Event Turnstile settings saved.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save event Turnstile settings.");
    } finally {
      setBusy(null);
    }
  }

  async function savePortalSettings() {
    setBusy("portal");
    setError(null);
    try {
      const saved = await apiFetch<EventPortalSettings>("/event-services/config/portal", {
        method: "PATCH",
        body: JSON.stringify(portalSettings)
      });
      setPortalSettings({
        eventPortalBrowserTitle: saved.eventPortalBrowserTitle || "Schedule Event Support"
      });
      setNotice("Event portal settings saved.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save event portal settings.");
    } finally {
      setBusy(null);
    }
  }

  async function saveCalendarSettings() {
    setBusy("calendar");
    setError(null);
    try {
      const saved = await apiFetch<EventCalendarSettings>("/event-services/config/calendar", {
        method: "PATCH",
        body: JSON.stringify(calendarSettings)
      });
      setCalendarSettings({
        eventCalendarSyncEnabled: saved.eventCalendarSyncEnabled,
        eventCalendarTenantId: saved.eventCalendarTenantId ?? "",
        eventCalendarClientId: saved.eventCalendarClientId ?? "",
        eventCalendarClientSecretReference: saved.eventCalendarClientSecretReference ?? "env:MICROSOFT_CLIENT_SECRET",
        eventCalendarDefaultTimeZone: saved.eventCalendarDefaultTimeZone ?? "America/Chicago",
        eventExternalInviteSubjectTemplate: saved.eventExternalInviteSubjectTemplate ?? "",
        eventExternalInviteBodyTemplate: saved.eventExternalInviteBodyTemplate ?? ""
      });
      setNotice("Event calendar sync settings saved.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save event calendar sync settings.");
    } finally {
      setBusy(null);
    }
  }

  function updateServiceEdit(serviceId: string, patch: Partial<ServiceDraft>) {
    setServiceEdits((current) => ({ ...current, [serviceId]: { ...(current[serviceId] ?? blankServiceDraft), ...patch } }));
  }

  function updateFieldEdit(fieldId: string, patch: Partial<FieldDraft>) {
    setFieldEdits((current) => ({ ...current, [fieldId]: { ...(current[fieldId] ?? blankFieldDraft), ...patch } }));
  }

  function startServiceEdit(service: EventServiceCatalogItem) {
    setEditingServiceId(service.id);
    setServiceEdits((current) => ({ ...current, [service.id]: serviceToDraft(service) }));
  }

  function startFieldEdit(field: EventFormField) {
    setEditingFieldId(field.id);
    setFieldEdits((current) => ({ ...current, [field.id]: fieldToDraft(field) }));
  }

  function renderFieldPreview(field: EventFormField) {
    const common = { className: "input", placeholder: field.placeholder ?? "", disabled: true };
    if (field.type === "TEXTAREA") return <textarea {...common} />;
    if (field.type === "SELECT" || field.type === "RADIO") {
      return (
        <select {...common}>
          <option>{field.placeholder || "Select..."}</option>
          {field.options.map((option) => <option key={option}>{option}</option>)}
        </select>
      );
    }
    if (field.type === "MULTI_SELECT") {
      return (
        <select {...common} multiple>
          {field.options.map((option) => <option key={option}>{option}</option>)}
        </select>
      );
    }
    if (field.type === "CHECKBOX") {
      return (
        <div className="event-option-preview">
          {field.options.map((option) => <label key={option}><input type="checkbox" disabled /> {option}</label>)}
        </div>
      );
    }
    const inputType = field.type === "NUMBER" ? "number" : field.type === "DATE" ? "date" : field.type === "TIME" ? "time" : field.type === "EMAIL" ? "email" : "text";
    return <input {...common} type={inputType} />;
  }

  return (
    <section className="panel event-config-panel">
      <div className="section-heading">
        <div>
          <h2>Events Config</h2>
          <p className="muted">Configure the public Event & Services form, service defaults, and dedicated Cloudflare Turnstile protection.</p>
        </div>
      </div>

      {error ? <div className="alert error">{error}</div> : null}
      {notice ? <div className="alert success">{notice}</div> : null}

      <div className="settings-subtabs" role="tablist" aria-label="Event configuration sections">
        <button className={activeTab === "form" ? "active" : ""} type="button" onClick={() => setActiveTab("form")}>
          <SlidersHorizontal size={16} aria-hidden="true" />
          Public Form
        </button>
        <button className={activeTab === "preview" ? "active" : ""} type="button" onClick={() => setActiveTab("preview")}>
          <Eye size={16} aria-hidden="true" />
          Preview
        </button>
        <button className={activeTab === "turnstile" ? "active" : ""} type="button" onClick={() => setActiveTab("turnstile")}>
          <ShieldCheck size={16} aria-hidden="true" />
          Cloudflare Turnstile
        </button>
        <button className={activeTab === "calendar" ? "active" : ""} type="button" onClick={() => setActiveTab("calendar")}>
          <SlidersHorizontal size={16} aria-hidden="true" />
          Calendar Sync
        </button>
      </div>

      {activeTab === "form" ? (
        <div className="event-admin-grid settings-section">
          <div className="nested-panel event-config-list-panel span-2">
            <h3>Public Portal</h3>
            <p className="muted">Set browser presentation for the public Event & Services portal.</p>
            <div className="grid columns-2">
              <label className="field">
                <span>Browser title</span>
                <input className="input" value={portalSettings.eventPortalBrowserTitle} onChange={(event) => setPortalSettings({ eventPortalBrowserTitle: event.target.value })} />
              </label>
              <div className="field">
                <span>Browser tab preview</span>
                <input className="input" readOnly value={`${branding.applicationName} - ${portalSettings.eventPortalBrowserTitle || "Schedule Event Support"}`} />
              </div>
            </div>
            <button className="button" type="button" onClick={savePortalSettings} disabled={busy === "portal"}><Save size={15} /> Save Portal Settings</button>
          </div>
          <div className="nested-panel event-config-list-panel">
            <div className="section-heading compact-heading"><div><h3>Services</h3><p className="muted">Public choices and default specialist assignment.</p></div><button className="button secondary compact-button" type="button" onClick={() => setShowServiceCreate((open) => !open)}><Plus size={15} /> Add Service</button></div>
            {showServiceCreate ? <div className="event-config-create-grid settings-create-panel">
              <input className="input" placeholder="Service name" value={serviceDraft.name} onChange={(event) => setServiceDraft((current) => ({ ...current, name: event.target.value }))} />
              <input className="input" placeholder="Description" value={serviceDraft.description} onChange={(event) => setServiceDraft((current) => ({ ...current, description: event.target.value }))} />
              <input className="input" placeholder="Icon label" value={serviceDraft.icon} onChange={(event) => setServiceDraft((current) => ({ ...current, icon: event.target.value }))} />
              <input className="input" type="number" min={0} value={serviceDraft.sortOrder} onChange={(event) => setServiceDraft((current) => ({ ...current, sortOrder: Number(event.target.value) }))} />
              <div className="button-row"><button className="button secondary" type="button" onClick={() => setShowServiceCreate(false)}>Cancel</button><button className="button" type="button" onClick={createService} disabled={busy === "service"}>Add Service</button></div>
            </div> : null}
            <div className="event-config-list">
              {services.map((service) => {
                const draft = serviceEdits[service.id] ?? serviceToDraft(service);
                const editing = editingServiceId === service.id;
                return (
                  <article className="event-config-item" key={service.id}>
                    {editing ? (
                      <div className="event-config-edit-grid">
                        <input className="input" value={draft.name} onChange={(event) => updateServiceEdit(service.id, { name: event.target.value })} />
                        <input className="input" value={draft.description} placeholder="Description" onChange={(event) => updateServiceEdit(service.id, { description: event.target.value })} />
                        <input className="input" value={draft.icon} placeholder="Icon label" onChange={(event) => updateServiceEdit(service.id, { icon: event.target.value })} />
                        <input className="input" type="number" min={0} value={draft.sortOrder} onChange={(event) => updateServiceEdit(service.id, { sortOrder: Number(event.target.value) })} />
                        <div className="event-config-checkbox-grid">
                          {users.map((user) => (
                            <label key={user.id}>
                              <input
                                type="checkbox"
                                checked={draft.defaultUserIds.includes(user.id)}
                                onChange={(event) => updateServiceEdit(service.id, { defaultUserIds: event.target.checked ? [...draft.defaultUserIds, user.id] : draft.defaultUserIds.filter((id) => id !== user.id) })}
                              />
                              {displayUser(user)}
                            </label>
                          ))}
                        </div>
                        <label className="checkbox-row"><input type="checkbox" checked={draft.isActive} onChange={(event) => updateServiceEdit(service.id, { isActive: event.target.checked })} /> Active</label>
                        <div className="button-row">
                          <button className="button secondary" type="button" onClick={() => setEditingServiceId(null)}>Cancel</button>
                          <button className="button" type="button" onClick={() => saveService(service.id, draft)} disabled={busy === `service:${service.id}`}><Save size={15} /> Save</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div>
                          <strong>{service.name}</strong>
                          <span className="muted">{service.description || "No description"}</span>
                          <small>{service.defaultUserIds.length} default specialist{service.defaultUserIds.length === 1 ? "" : "s"}</small>
                        </div>
                        <span className="status-pill">{service.isActive ? "Active" : "Inactive"}</span>
                        <div className="event-config-actions">
                          <button className="button icon-button" type="button" title="Move up" aria-label={`Move ${service.name} service up`} onClick={() => moveService(service, -1)}><ArrowUp size={15} /></button>
                          <button className="button icon-button" type="button" title="Move down" aria-label={`Move ${service.name} service down`} onClick={() => moveService(service, 1)}><ArrowDown size={15} /></button>
                          <button className="button secondary" type="button" onClick={() => startServiceEdit(service)}>Edit</button>
                          <button className="button secondary" type="button" onClick={() => toggleService(service)}>{service.isActive ? "Deactivate" : "Activate"}</button>
                        </div>
                      </>
                    )}
                  </article>
                );
              })}
            </div>
          </div>
          <div className="nested-panel event-config-list-panel">
            <div className="section-heading compact-heading"><div><h3>Form Fields</h3><p className="muted">Fields, options, help text, and ordering.</p></div><button className="button secondary compact-button" type="button" onClick={() => setShowFieldCreate((open) => !open)}><Plus size={15} /> Add Field</button></div>
            {showFieldCreate ? <div className="event-config-create-grid field-create settings-create-panel">
              <input className="input" placeholder="Label" value={fieldDraft.label} onChange={(event) => setFieldDraft((current) => ({ ...current, label: event.target.value, fieldKey: current.fieldKey || makeFieldKey(event.target.value) }))} />
              <input className="input" placeholder="fieldKey" value={fieldDraft.fieldKey} onChange={(event) => setFieldDraft((current) => ({ ...current, fieldKey: event.target.value }))} />
              <select className="input" value={fieldDraft.type} onChange={(event) => setFieldDraft((current) => ({ ...current, type: event.target.value }))}>
                {fieldTypes.map((type) => <option key={type} value={type}>{label(type)}</option>)}
              </select>
              <input className="input" type="number" min={0} value={fieldDraft.sortOrder} onChange={(event) => setFieldDraft((current) => ({ ...current, sortOrder: Number(event.target.value) }))} />
              <input className="input" placeholder="Placeholder" value={fieldDraft.placeholder} onChange={(event) => setFieldDraft((current) => ({ ...current, placeholder: event.target.value }))} />
              <input className="input" placeholder="Help text" value={fieldDraft.helpText} onChange={(event) => setFieldDraft((current) => ({ ...current, helpText: event.target.value }))} />
              {optionFieldTypes.has(fieldDraft.type) ? <textarea className="input" placeholder="Options, one per line" value={fieldDraft.optionsText} onChange={(event) => setFieldDraft((current) => ({ ...current, optionsText: event.target.value }))} /> : null}
              <label className="checkbox-row"><input type="checkbox" checked={fieldDraft.isRequired} onChange={(event) => setFieldDraft((current) => ({ ...current, isRequired: event.target.checked }))} /> Required</label>
              <div className="button-row"><button className="button secondary" type="button" onClick={() => setShowFieldCreate(false)}>Cancel</button><button className="button" type="button" onClick={createField} disabled={busy === "field"}>Add Field</button></div>
            </div> : null}
            <div className="event-config-list">
              {form?.fields.map((field) => {
                const draft = fieldEdits[field.id] ?? fieldToDraft(field);
                const editing = editingFieldId === field.id;
                return (
                  <article className="event-config-item" key={field.id}>
                    {editing ? (
                      <div className="event-config-edit-grid">
                        <input className="input" value={draft.label} onChange={(event) => updateFieldEdit(field.id, { label: event.target.value })} />
                        <input className="input" value={draft.fieldKey} onChange={(event) => updateFieldEdit(field.id, { fieldKey: event.target.value })} />
                        <select className="input" value={draft.type} onChange={(event) => updateFieldEdit(field.id, { type: event.target.value })}>
                          {fieldTypes.map((type) => <option key={type} value={type}>{label(type)}</option>)}
                        </select>
                        <input className="input" type="number" min={0} value={draft.sortOrder} onChange={(event) => updateFieldEdit(field.id, { sortOrder: Number(event.target.value) })} />
                        <input className="input" placeholder="Placeholder" value={draft.placeholder} onChange={(event) => updateFieldEdit(field.id, { placeholder: event.target.value })} />
                        <input className="input" placeholder="Help text" value={draft.helpText} onChange={(event) => updateFieldEdit(field.id, { helpText: event.target.value })} />
                        {optionFieldTypes.has(draft.type) ? <textarea className="input" placeholder="Options, one per line" value={draft.optionsText} onChange={(event) => updateFieldEdit(field.id, { optionsText: event.target.value })} /> : null}
                        <label className="checkbox-row"><input type="checkbox" checked={draft.isRequired} onChange={(event) => updateFieldEdit(field.id, { isRequired: event.target.checked })} /> Required</label>
                        <label className="checkbox-row"><input type="checkbox" checked={draft.isActive} onChange={(event) => updateFieldEdit(field.id, { isActive: event.target.checked })} /> Active</label>
                        <div className="button-row">
                          <button className="button secondary" type="button" onClick={() => setEditingFieldId(null)}>Cancel</button>
                          <button className="button" type="button" onClick={() => saveField(field.id, draft)} disabled={busy === `field:${field.id}`}><Save size={15} /> Save</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div>
                          <strong>{field.label}</strong>
                          <span className="muted">{field.fieldKey} · {label(field.type)} · {field.isRequired ? "Required" : "Optional"}</span>
                          {field.helpText ? <small>{field.helpText}</small> : null}
                        </div>
                        <span className="status-pill">{field.isActive ? "Active" : "Inactive"}</span>
                        <div className="event-config-actions">
                          <button className="button icon-button" type="button" title="Move up" aria-label={`Move ${field.label} field up`} onClick={() => moveField(field, -1)}><ArrowUp size={15} /></button>
                          <button className="button icon-button" type="button" title="Move down" aria-label={`Move ${field.label} field down`} onClick={() => moveField(field, 1)}><ArrowDown size={15} /></button>
                          <button className="button secondary" type="button" onClick={() => startFieldEdit(field)}>Edit</button>
                          <button className="button secondary" type="button" onClick={() => toggleField(field)}>{field.isActive ? "Deactivate" : "Activate"}</button>
                        </div>
                      </>
                    )}
                  </article>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === "preview" ? (
        <div className="nested-panel settings-section event-form-preview">
          <h3>{form?.name ?? "Default Event Scheduling Request"}</h3>
          <p className="muted">{form?.introText ?? "Preview of the active public form fields."}</p>
          <div className="event-preview-grid">
            {form?.fields.filter((field) => field.isActive).map((field) => (
              <label className={field.type === "TEXTAREA" ? "span-2" : ""} key={field.id}>
                {field.label}{field.isRequired ? " *" : ""}
                {renderFieldPreview(field)}
                {field.helpText ? <small>{field.helpText}</small> : null}
              </label>
            ))}
          </div>
          <h4>Services</h4>
          <div className="event-preview-services">
            {services.filter((service) => service.isActive).map((service) => <span key={service.id}>{service.name}</span>)}
          </div>
        </div>
      ) : null}

      {activeTab === "turnstile" ? (
        <div className="nested-panel settings-section">
          <div className="section-heading">
            <div>
              <h3>Public Event Form Turnstile</h3>
              <p className="muted">Use separate Cloudflare keys for events. Store the real secret in the server environment and save only its reference here.</p>
            </div>
            <span className="status-pill">{turnstile.eventTurnstileEnabled ? "Enabled" : "Disabled"}</span>
          </div>
          <label className="checkbox-row">
            <input type="checkbox" checked={turnstile.eventTurnstileEnabled} onChange={(event) => setTurnstile((current) => ({ ...current, eventTurnstileEnabled: event.target.checked }))} />
            Enable Turnstile on the public event form
          </label>
          <div className="grid columns-2">
            <label className="field">
              <span>Site key</span>
              <input className="input" value={turnstile.eventTurnstileSiteKey ?? ""} onChange={(event) => setTurnstile((current) => ({ ...current, eventTurnstileSiteKey: event.target.value }))} />
            </label>
            <label className="field">
              <span>Secret reference</span>
              <input className="input" placeholder="env:EVENT_TURNSTILE_SECRET_KEY" value={turnstile.eventTurnstileSecretReference ?? ""} onChange={(event) => setTurnstile((current) => ({ ...current, eventTurnstileSecretReference: event.target.value }))} />
            </label>
          </div>
          <p className="muted">Production example: add EVENT_TURNSTILE_SECRET_KEY to .env.production, then save env:EVENT_TURNSTILE_SECRET_KEY here.</p>
          <button className="button" type="button" onClick={saveTurnstile} disabled={busy === "turnstile"}>Save Events Turnstile</button>
        </div>
      ) : null}

      {activeTab === "calendar" ? (
        <div className="nested-panel settings-section">
          <div className="section-heading">
            <div>
              <h3>Microsoft Calendar & Ticket Meetings</h3>
              <p className="muted">Shared Microsoft 365 connection for event tasks and ticket meetings. Calendar writes happen only after an explicit user action.</p>
            </div>
            <span className="status-pill">{calendarSettings.eventCalendarSyncEnabled ? "Enabled" : "Disabled"}</span>
          </div>
          <label className="checkbox-row">
            <input type="checkbox" checked={calendarSettings.eventCalendarSyncEnabled} onChange={(event) => setCalendarSettings((current) => ({ ...current, eventCalendarSyncEnabled: event.target.checked }))} />
            Enable Microsoft calendar sync and ticket meeting invitations
          </label>
          <div className="grid columns-2">
            <label className="field">
              <span>Tenant ID</span>
              <input className="input" value={calendarSettings.eventCalendarTenantId ?? ""} onChange={(event) => setCalendarSettings((current) => ({ ...current, eventCalendarTenantId: event.target.value }))} />
            </label>
            <label className="field">
              <span>Client ID</span>
              <input className="input" value={calendarSettings.eventCalendarClientId ?? ""} onChange={(event) => setCalendarSettings((current) => ({ ...current, eventCalendarClientId: event.target.value }))} />
            </label>
            <label className="field">
              <span>Client secret reference</span>
              <input className="input" placeholder="env:MICROSOFT_CLIENT_SECRET" value={calendarSettings.eventCalendarClientSecretReference ?? ""} onChange={(event) => setCalendarSettings((current) => ({ ...current, eventCalendarClientSecretReference: event.target.value }))} />
            </label>
            <label className="field">
              <span>Default timezone</span>
              <input className="input" value={calendarSettings.eventCalendarDefaultTimeZone ?? "America/Chicago"} onChange={(event) => setCalendarSettings((current) => ({ ...current, eventCalendarDefaultTimeZone: event.target.value }))} />
            </label>
          </div>
          <div className="settings-section">
            <div className="section-heading compact-heading">
              <div>
                <h3>External Invite Template</h3>
                <p className="muted">Used when an event task is sent to an external specialist.</p>
              </div>
            </div>
            <label className="field">
              <span>Subject</span>
              <input className="input" value={calendarSettings.eventExternalInviteSubjectTemplate ?? ""} onChange={(event) => setCalendarSettings((current) => ({ ...current, eventExternalInviteSubjectTemplate: event.target.value }))} />
            </label>
            <label className="field">
              <span>Body</span>
              <textarea className="input" value={calendarSettings.eventExternalInviteBodyTemplate ?? ""} onChange={(event) => setCalendarSettings((current) => ({ ...current, eventExternalInviteBodyTemplate: event.target.value }))} />
            </label>
            <p className="muted">Available placeholders: {"{{specialistName}}"}, {"{{taskTitle}}"}, {"{{eventName}}"}, {"{{trackingNumber}}"}, {"{{dateTime}}"}, {"{{location}}"}, {"{{notes}}"}, {"{{googleCalendarLink}}"}, {"{{outlookCalendarLink}}"}.</p>
          </div>
          <p className="muted">Use environment variable references for secrets. Microsoft Graph requires Calendars.ReadWrite application permission with administrator consent; scope the app to approved organizer mailboxes.</p>
          <button className="button" type="button" onClick={saveCalendarSettings} disabled={busy === "calendar"}>Save Calendar Sync</button>
        </div>
      ) : null}
    </section>
  );
}
