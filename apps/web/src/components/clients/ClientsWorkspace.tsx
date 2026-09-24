"use client";
import Link from "next/link";
import { usePermissions } from "@/lib/use-permissions";
import { QcContextLink } from "@/components/qc/QcContextLink";

import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  Edit3,
  Globe2,
  Mail,
  Phone,
  Plus,
  RefreshCcw,
  Save,
  Trash2,
  UserPlus,
  Users,
  X
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";

type ClientStatus = "ACTIVE" | "INACTIVE";

interface ClientDomain {
  id: string;
  domain: string;
  isVerified: boolean;
  isActive: boolean;
}

interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  title: string | null;
  isAuthorizedRequester: boolean;
  isBillingContact: boolean;
  isTechnicalContact: boolean;
}

interface Client {
  id: string;
  name: string;
  shortName: string | null;
  status: ClientStatus;
  notes: string | null;
  domains: ClientDomain[];
  contacts: Contact[];
  _count?: {
    contacts: number;
  };
}

interface ClientFormState {
  name: string;
  shortName: string;
  status: ClientStatus;
  domains: string;
  notes: string;
}

interface ContactFormState {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  title: string;
  isAuthorizedRequester: boolean;
  isBillingContact: boolean;
  isTechnicalContact: boolean;
}

const emptyClientForm: ClientFormState = {
  name: "",
  shortName: "",
  status: "ACTIVE",
  domains: "",
  notes: ""
};

const emptyContactForm: ContactFormState = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  title: "",
  isAuthorizedRequester: true,
  isBillingContact: false,
  isTechnicalContact: false
};

function clientToForm(client: Client): ClientFormState {
  return {
    name: client.name,
    shortName: client.shortName ?? "",
    status: client.status,
    domains: client.domains.map((domain) => domain.domain).join("\n"),
    notes: client.notes ?? ""
  };
}

function contactToForm(contact: Contact): ContactFormState {
  return {
    firstName: contact.firstName,
    lastName: contact.lastName,
    email: contact.email,
    phone: contact.phone ?? "",
    title: contact.title ?? "",
    isAuthorizedRequester: contact.isAuthorizedRequester,
    isBillingContact: contact.isBillingContact,
    isTechnicalContact: contact.isTechnicalContact
  };
}

function compactPayload(input: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, value === "" ? undefined : value]));
}

function parseDomains(value: string): string[] {
  return value
    .split(/[\n,;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function activeDomainLabels(client: Client): string {
  const activeDomains = client.domains.filter((item) => item.isActive).map((item) => item.domain);
  return activeDomains.length ? activeDomains.join(", ") : "No routing domains";
}

function requesterCount(client: Client): number {
  return client._count?.contacts ?? client.contacts.length;
}

export function ClientsWorkspace() {
  const permissions = usePermissions();
  const [clientSearch, setClientSearch] = useState("");
  const [clientOrder, setClientOrder] = useState("asc");
  const [clientPage, setClientPage] = useState(1);
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClientContacts, setSelectedClientContacts] = useState<Contact[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [clientForm, setClientForm] = useState<ClientFormState>(emptyClientForm);
  const [contactForm, setContactForm] = useState<ContactFormState>(emptyContactForm);
  const [clientModalMode, setClientModalMode] = useState<"create" | "edit" | null>(null);
  const [contactModalMode, setContactModalMode] = useState<"create" | "edit" | null>(null);
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [activeClientTab, setActiveClientTab] = useState<"overview" | "domains" | "requesters">("overview");
  const [requesterSearch, setRequesterSearch] = useState("");
  const [domain, setDomain] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const matchingClients = useMemo(() => clients.filter(client => [client.name, client.shortName, ...client.domains.map(d => d.domain)].filter(Boolean).join(" ").toLowerCase().includes(clientSearch.trim().toLowerCase())).sort((a, b) => (clientOrder === "asc" ? 1 : -1) * a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })), [clients, clientSearch, clientOrder]);
  const clientPages = Math.max(1, Math.ceil(matchingClients.length / 25));
  const visibleClients = matchingClients.slice((Math.min(clientPage, clientPages) - 1) * 25, Math.min(clientPage, clientPages) * 25);
  const selectedClient = useMemo(
    () => clients.find((client) => client.id === selectedClientId) ?? null,
    [clients, selectedClientId]
  );
  const selectedClientRequesterCount = selectedClientContacts.length || (selectedClient ? requesterCount(selectedClient) : 0);
  const activeClientCount = clients.filter((client) => client.status === "ACTIVE").length;
  const activeDomainCount = clients.reduce((total, client) => total + client.domains.filter((item) => item.isActive).length, 0);
  const totalRequesterCount = clients.reduce((total, client) => total + requesterCount(client), 0);
  const filteredRequesters = useMemo(() => {
    const query = requesterSearch.trim().toLowerCase();
    if (!query) {
      return selectedClientContacts;
    }

    return selectedClientContacts.filter((contact) =>
      [
        contact.firstName,
        contact.lastName,
        contact.email,
        contact.phone ?? "",
        contact.title ?? "",
        contact.isAuthorizedRequester ? "authorized" : "",
        contact.isTechnicalContact ? "technical" : "",
        contact.isBillingContact ? "billing" : ""
      ]
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [requesterSearch, selectedClientContacts]);

  useEffect(() => {
    void loadClients();
  }, []);

  useEffect(() => {
    setDomain("");
    setEditingContactId(null);
    setContactForm(emptyContactForm);
    setRequesterSearch("");
    if (selectedClient?.id) {
      void loadClientContacts(selectedClient.id);
    } else {
      setSelectedClientContacts([]);
    }
  }, [selectedClient?.id]);

  async function loadClients() {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<Client[]>("/clients");
      setClients(data);
      setSelectedClientId((current) => (current && data.some((client) => client.id === current) ? current : null));
    } catch {
      setError("Unable to load clients.");
    } finally {
      setLoading(false);
    }
  }

  async function loadClientContacts(clientId: string) {
    setLoadingContacts(true);
    setError(null);
    try {
      const contacts = await apiFetch<Contact[]>(`/clients/${clientId}/contacts`);
      setSelectedClientContacts(contacts);
    } catch {
      setError("Unable to load requesters.");
      setSelectedClientContacts([]);
    } finally {
      setLoadingContacts(false);
    }
  }

  function openCreateClient() {
    setClientForm(emptyClientForm);
    setClientModalMode("create");
  }

  function openEditClient(client: Client) {
    setSelectedClientId(client.id);
    setClientForm(clientToForm(client));
    setClientModalMode("edit");
  }

  function openClientDetail(client: Client) {
    setSelectedClientId(client.id);
    setActiveClientTab("overview");
  }

  function closeClientDetail() {
    setSelectedClientId(null);
    setSelectedClientContacts([]);
    setRequesterSearch("");
    setDomain("");
  }

  function closeClientModal() {
    setClientModalMode(null);
    setClientForm(emptyClientForm);
  }

  function openCreateContact() {
    setContactForm(emptyContactForm);
    setEditingContactId(null);
    setContactModalMode("create");
  }

  function openEditContact(contact: Contact) {
    setContactForm(contactToForm(contact));
    setEditingContactId(contact.id);
    setContactModalMode("edit");
  }

  function closeContactModal() {
    setContactModalMode(null);
    setEditingContactId(null);
    setContactForm(emptyContactForm);
  }

  async function saveClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const payload =
        clientModalMode === "create"
          ? { ...compactPayload(clientForm), domains: parseDomains(clientForm.domains) }
          : compactPayload({ name: clientForm.name, shortName: clientForm.shortName, status: clientForm.status, notes: clientForm.notes });

      if (clientModalMode === "edit" && selectedClient) {
        await apiFetch<Client>(`/clients/${selectedClient.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload)
        });
        await loadClients();
        setSelectedClientId(selectedClient.id);
      } else {
        const created = await apiFetch<Client>("/clients", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        await loadClients();
        setSelectedClientId(created.id);
      }
      closeClientModal();
    } catch {
      setError("Unable to save client. Check required fields and duplicate data.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteClient(client: Client) {
    setSaving(true);
    setError(null);

    try {
      await apiFetch(`/clients/${client.id}`, { method: "DELETE" });
      if (selectedClientId === client.id) {
        setSelectedClientId(null);
      }
      await loadClients();
    } catch {
      setError("Unable to deactivate client.");
    } finally {
      setSaving(false);
    }
  }

  async function addDomain(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedClient) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await apiFetch<ClientDomain>(`/clients/${selectedClient.id}/domains`, {
        method: "POST",
        body: JSON.stringify({ domain, isActive: true })
      });
      setDomain("");
      await loadClients();
      setSelectedClientId(selectedClient.id);
    } catch {
      setError("Unable to add domain. It may already belong to another active client.");
    } finally {
      setSaving(false);
    }
  }

  async function updateDomain(clientDomain: ClientDomain, input: Partial<Pick<ClientDomain, "isActive" | "isVerified">>) {
    setSaving(true);
    setError(null);

    try {
      await apiFetch<ClientDomain>(`/client-domains/${clientDomain.id}`, {
        method: "PATCH",
        body: JSON.stringify(input)
      });
      await loadClients();
      setSelectedClientId(selectedClient?.id ?? null);
    } catch {
      setError("Unable to update domain.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteDomain(clientDomain: ClientDomain) {
    setSaving(true);
    setError(null);

    try {
      await apiFetch(`/client-domains/${clientDomain.id}`, { method: "DELETE" });
      await loadClients();
      setSelectedClientId(selectedClient?.id ?? null);
    } catch {
      setError("Unable to deactivate domain.");
    } finally {
      setSaving(false);
    }
  }

  async function saveContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedClient) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const endpoint = editingContactId ? `/contacts/${editingContactId}` : `/clients/${selectedClient.id}/contacts`;
      await apiFetch<Contact>(endpoint, {
        method: editingContactId ? "PATCH" : "POST",
        body: JSON.stringify(compactPayload(contactForm))
      });
      closeContactModal();
      await loadClients();
      setSelectedClientId(selectedClient.id);
      await loadClientContacts(selectedClient.id);
    } catch {
      setError("Unable to save contact. Check required fields and duplicate email.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteContact(contact: Contact) {
    setSaving(true);
    setError(null);

    try {
      await apiFetch(`/contacts/${contact.id}`, { method: "DELETE" });
      await loadClients();
      setSelectedClientId(selectedClient?.id ?? null);
      if (selectedClient?.id) {
        await loadClientContacts(selectedClient.id);
      }
    } catch {
      setError("Unable to delete contact.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="compact-page-header clients-page-header">
        <div className="clients-page-title">
          <span className="page-eyebrow">Client Directory</span>
          <h1>Clients</h1>
          <p className="muted">Manage institution profiles, routing domains, and authorized requesters.</p>
        </div>
        <div className="form-actions clients-header-actions">
          <button className="button secondary" type="button" onClick={loadClients} disabled={loading || saving}>
            <RefreshCcw size={16} aria-hidden="true" />
            <span>Refresh</span>
          </button>
          <button className="button" type="button" disabled={!permissions.includes("clients.create")} onClick={openCreateClient}>
            <Plus size={16} aria-hidden="true" />
            <span>Add Institution</span>
          </button>
        </div>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      <section className="clients-summary-grid" aria-label="Client summary">
        <div className="client-summary-card">
          <span>Institutions</span>
          <strong>{clients.length}</strong>
          <small>{activeClientCount} active</small>
        </div>
        <div className="client-summary-card">
          <span>Routing domains</span>
          <strong>{activeDomainCount}</strong>
          <small>Active email domains</small>
        </div>
        <div className="client-summary-card">
          <span>Requesters</span>
          <strong>{totalRequesterCount}</strong>
          <small>Directory contacts</small>
        </div>
      </section>

      <section className={selectedClient ? "client-detail-workspace" : "clients-workspace"}>
        {!selectedClient ? (
        <div className="panel clients-table-panel">
          <div className="section-heading">
            <div>
              <h2>Client Directory</h2>
              <p className="muted">Open an institution to review domains and requesters.</p>
            </div>
            <span className="status-pill">{clients.length} total</span>
          </div>

          <div className="audit-table-toolbar"><label>Search clients<input className="input" value={clientSearch} onChange={event => { setClientSearch(event.target.value); setClientPage(1); }} placeholder="Name or routing domain" /></label><label>Order<select className="input" value={clientOrder} onChange={event => { setClientOrder(event.target.value); setClientPage(1); }}><option value="asc">Name A–Z</option><option value="desc">Name Z–A</option></select></label><span>{matchingClients.length} matching clients</span></div>
          <div className="client-table-wrap">
            <table className="client-table">
              <thead>
                <tr>
                  <th>Institution</th>
                  <th>Email Domains</th>
                  <th>Requesters</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td className="client-table-state" colSpan={5}>Loading clients...</td>
                  </tr>
                ) : null}
                {!loading && matchingClients.length === 0 ? (
                  <tr>
                    <td className="client-table-state" colSpan={5}>No matching clients. Adjust the search or add an institution if you have permission.</td>
                  </tr>
                ) : null}
                {visibleClients.map((client) => (
                  <tr key={client.id}>
                    <td>
                      <button className="client-name-button" type="button" onClick={() => openClientDetail(client)}>
                        <span className="client-initial">{client.name.slice(0, 1).toUpperCase()}</span>
                        <span>
                          <strong>{client.name}</strong>
                          <small>{client.shortName || "No short name"}</small>
                        </span>
                      </button>
                    </td>
                    <td>
                      <div className="table-cell-stack">
                        <strong>{client.domains.filter((item) => item.isActive).length} active</strong>
                        <span>{activeDomainLabels(client)}</span>
                      </div>
                    </td>
                    <td>
                      <span className="client-count-pill">{requesterCount(client)}</span>
                    </td>
                    <td>
                      <span className={`status-pill ${client.status === "ACTIVE" ? "success" : "muted-pill"}`}>
                        {client.status === "ACTIVE" ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td>
                      <div className="row-actions">
                        <button className="icon-button" type="button" title="Open institution" aria-label="Open institution" onClick={() => openClientDetail(client)}>
                          <Building2 size={16} aria-hidden="true" />
                        </button>
                        <button className="icon-button" type="button" title="Edit institution" aria-label="Edit institution" disabled={!permissions.includes("clients.update")} onClick={() => openEditClient(client)}>
                          <Edit3 size={16} aria-hidden="true" />
                        </button>
                        <button className="icon-button danger-icon" type="button" title="Deactivate institution" aria-label="Deactivate institution" onClick={() => deleteClient(client)} disabled={saving || !permissions.includes("clients.delete")}>
                          <Trash2 size={16} aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="audit-table-pagination"><button className="button secondary" type="button" disabled={clientPage <= 1} onClick={() => setClientPage(p => p - 1)}>Previous</button><span>Page {Math.min(clientPage, clientPages)} of {clientPages}</span><button className="button secondary" type="button" disabled={clientPage >= clientPages} onClick={() => setClientPage(p => p + 1)}>Next</button></div>
        </div>
        ) : null}

        {selectedClient ? (
          <div className="client-detail-view">
              <section className="panel client-profile-panel">
                <div className="client-profile-header">
                  <div className="client-profile-title">
                    <span className="client-profile-mark">{selectedClient.name.slice(0, 1).toUpperCase()}</span>
                    <div>
                      <span className={`status-pill ${selectedClient.status === "ACTIVE" ? "success" : "muted-pill"}`}>
                        {selectedClient.status === "ACTIVE" ? "Active" : "Inactive"}
                      </span>
                      <h2>{selectedClient.name}</h2><QcContextLink href={`/qc/clients?clientId=${selectedClient.id}`} label="Service quality" />
                      <p className="muted">{selectedClient.shortName || "No short name"}</p>
                    </div>
                  </div>
                  <div className="form-actions">
                    <button className="button secondary" type="button" onClick={closeClientDetail}>
                      <ArrowLeft size={16} aria-hidden="true" />
                      <span>Client Directory</span>
                    </button>
                    <button className="button secondary" type="button" disabled={!permissions.includes("clients.update")} onClick={() => openEditClient(selectedClient)}>
                      <Edit3 size={16} aria-hidden="true" />
                      <span>Edit Institution</span>
                    </button>
                  </div>
                </div>
                <nav className="audit-context-links" aria-label="Related client work">{permissions.includes("tickets.view") && <Link className="button secondary" href={`/tickets?clientId=${selectedClient.id}`}>Tickets</Link>}{permissions.includes("devices.view") && <Link className="button secondary" href={`/devices?clientId=${selectedClient.id}`}>Devices</Link>}{permissions.includes("projects.view") && <Link className="button secondary" href={`/projects?clientId=${selectedClient.id}`}>Projects</Link>}</nav>
                <div className="client-detail-grid">
                  <button type="button" onClick={() => setActiveClientTab("domains")}>
                    <span>Routing domains</span>
                    <strong>{selectedClient.domains.filter((item) => item.isActive).length}</strong>
                  </button>
                  <button type="button" onClick={() => setActiveClientTab("requesters")}>
                    <span>Requesters</span>
                    <strong>{selectedClientRequesterCount}</strong>
                  </button>
                  <div>
                    <span>Main domain</span>
                    <strong>{selectedClient.domains.find((item) => item.isActive)?.domain ?? "Not set"}</strong>
                  </div>
                  <div>
                    <span>Status</span>
                    <strong>{selectedClient.status === "ACTIVE" ? "Active" : "Inactive"}</strong>
                  </div>
                </div>
                {selectedClient.notes ? <p className="client-notes">{selectedClient.notes}</p> : null}
              </section>

              <section className="panel client-detail-panel">
                <div className="client-detail-tabs" role="tablist" aria-label="Client detail sections">
                  <button className={activeClientTab === "overview" ? "active" : ""} type="button" onClick={() => setActiveClientTab("overview")}>
                    <Building2 size={16} aria-hidden="true" />
                    <span>Overview</span>
                  </button>
                  <button className={activeClientTab === "domains" ? "active" : ""} type="button" onClick={() => setActiveClientTab("domains")}>
                    <Globe2 size={16} aria-hidden="true" />
                    <span>Domains</span>
                  </button>
                  <button className={activeClientTab === "requesters" ? "active" : ""} type="button" onClick={() => setActiveClientTab("requesters")}>
                    <Users size={16} aria-hidden="true" />
                    <span>Requesters</span>
                  </button>
                </div>

                {activeClientTab === "overview" ? (
                  <div className="client-overview-grid">
                    <section>
                      <h3>Routing Summary</h3>
                      <p className="muted">{activeDomainLabels(selectedClient)}</p>
                      <button className="button secondary" type="button" onClick={() => setActiveClientTab("domains")}>
                        <Globe2 size={16} aria-hidden="true" />
                        <span>Manage Domains</span>
                      </button>
                    </section>
                    <section>
                      <h3>Requester Directory</h3>
                      <p className="muted">
                        {selectedClientRequesterCount} requester{selectedClientRequesterCount === 1 ? "" : "s"} assigned to this institution.
                      </p>
                      <button className="button secondary" type="button" onClick={() => setActiveClientTab("requesters")}>
                        <Users size={16} aria-hidden="true" />
                        <span>View Requesters</span>
                      </button>
                    </section>
                  </div>
                ) : null}

                {activeClientTab === "domains" ? (
                  <div className="client-tab-content">
                    <div className="section-heading">
                      <div>
                        <h2>Domains</h2>
                        <p className="muted">Domains used to route inbound email requesters to this institution.</p>
                      </div>
                      <Globe2 size={18} aria-hidden="true" />
                    </div>
                    <form className="inline-form" onSubmit={addDomain} aria-label="Add routing domain">
                      <input className="input" placeholder="example.com" value={domain} onChange={(event) => setDomain(event.target.value)} required />
                      <button className="button" type="submit" disabled={saving || !permissions.includes("client_domains.create")}>
                        <Plus size={16} aria-hidden="true" />
                        <span>Add Domain</span>
                      </button>
                    </form>
                    <div className="stack-list compact">
                      {selectedClient.domains.length === 0 ? <p className="muted">No domains added.</p> : null}
                      {selectedClient.domains.map((clientDomain) => (
                        <div className="stack-row compact" key={clientDomain.id}>
                          <div>
                            <strong>{clientDomain.domain}</strong>
                            <span className="muted">
                              {clientDomain.isActive ? "Active" : "Inactive"} - {clientDomain.isVerified ? "Verified" : "Unverified"}
                            </span>
                          </div>
                          <div className="row-actions">
                            <button className="icon-button" type="button" title="Toggle verification" aria-label="Toggle verification" disabled={!permissions.includes("client_domains.update")} onClick={() => updateDomain(clientDomain, { isVerified: !clientDomain.isVerified })}>
                              <CheckCircle2 size={16} aria-hidden="true" />
                            </button>
                            <button className="icon-button danger-icon" type="button" title="Deactivate domain" aria-label="Deactivate domain" disabled={!permissions.includes("client_domains.delete")} onClick={() => deleteDomain(clientDomain)}>
                              <Trash2 size={16} aria-hidden="true" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {activeClientTab === "requesters" ? (
                  <div className="client-tab-content">
                    <div className="section-heading">
                      <div>
                        <h2>Requesters</h2>
                        <p className="muted">Full requester list for {selectedClient.name}.</p>
                      </div>
                      <button className="button secondary" type="button" disabled={!permissions.includes("contacts.create")} onClick={openCreateContact}>
                        <UserPlus size={16} aria-hidden="true" />
                        <span>Add Requester</span>
                      </button>
                    </div>
                    <div className="client-requester-toolbar">
                      <div className="input-with-icon">
                        <Users size={16} aria-hidden="true" />
                        <input value={requesterSearch} onChange={(event) => setRequesterSearch(event.target.value)} placeholder="Search requesters by name, email, phone, title, or role" />
                      </div>
                      <span className="status-pill">
                        {filteredRequesters.length} of {selectedClientRequesterCount}
                      </span>
                    </div>
                    <div className="client-table-wrap requesters-table-wrap">
                      <table className="client-table requesters-table">
                        <thead>
                          <tr>
                            <th>Requester</th>
                            <th>Email</th>
                            <th>Phone</th>
                            <th>Title</th>
                            <th>Roles</th>
                            <th>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {loadingContacts ? (
                            <tr>
                              <td colSpan={6}>Loading requesters...</td>
                            </tr>
                          ) : null}
                          {!loadingContacts && filteredRequesters.length === 0 ? (
                            <tr>
                              <td colSpan={6}>{requesterSearch ? "No requesters match the current search." : "No requesters added."}</td>
                            </tr>
                          ) : null}
                          {filteredRequesters.map((contact) => (
                            <tr key={contact.id}>
                              <td>
                                <strong>
                                  {contact.firstName} {contact.lastName}
                                </strong>
                              </td>
                              <td>{contact.email}</td>
                              <td>{contact.phone ?? "Not set"}</td>
                              <td>{contact.title ?? "Not set"}</td>
                              <td>
                                <div className="requester-role-list">
                                  {contact.isAuthorizedRequester ? <span className="status-pill success">Authorized</span> : null}
                                  {contact.isTechnicalContact ? <span className="status-pill">Technical</span> : null}
                                  {contact.isBillingContact ? <span className="status-pill muted-pill">Billing</span> : null}
                                  {!contact.isAuthorizedRequester && !contact.isTechnicalContact && !contact.isBillingContact ? <span className="muted">None</span> : null}
                                </div>
                              </td>
                              <td>
                                <div className="row-actions">
                                  <button className="icon-button" type="button" title="Edit requester" aria-label="Edit requester" disabled={!permissions.includes("contacts.update")} onClick={() => openEditContact(contact)}>
                                    <Edit3 size={16} aria-hidden="true" />
                                  </button>
                                  <button className="icon-button danger-icon" type="button" title="Delete requester" aria-label="Delete requester" disabled={!permissions.includes("contacts.delete")} onClick={() => deleteContact(contact)}>
                                    <Trash2 size={16} aria-hidden="true" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}
              </section>
          </div>
        ) : null}
      </section>

      {clientModalMode ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="client-modal-title">
            <div className="modal-header">
              <div>
                <h2 id="client-modal-title">{clientModalMode === "edit" ? "Edit Institution" : "Add Institution"}</h2>
                <p className="muted">Institution profile used for ticket ownership, email domain routing, and reporting.</p>
              </div>
              <button className="icon-button" type="button" title="Close" aria-label="Close" onClick={closeClientModal}>
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <form className="form client-form-grid" onSubmit={saveClient}>
              <label className="field">
                <span>Institution Name</span>
                <input className="input" value={clientForm.name} onChange={(event) => setClientForm((current) => ({ ...current, name: event.target.value }))} required />
              </label>
              <label className="field">
                <span>Short Name</span>
                <input className="input" value={clientForm.shortName} onChange={(event) => setClientForm((current) => ({ ...current, shortName: event.target.value }))} />
              </label>
              <label className="field">
                <span>Status</span>
                <select className="input" value={clientForm.status} onChange={(event) => setClientForm((current) => ({ ...current, status: event.target.value as ClientStatus }))}>
                  <option value="ACTIVE">Active</option>
                  <option value="INACTIVE">Inactive</option>
                </select>
              </label>
              {clientModalMode === "create" ? (
                <label className="field full-span">
                  <span>Email Routing Domains</span>
                  <textarea
                    className="textarea compact-textarea"
                    placeholder="cityofharveyil.gov&#10;example.org"
                    value={clientForm.domains}
                    onChange={(event) => setClientForm((current) => ({ ...current, domains: event.target.value }))}
                  />
                  <small className="field-help">One domain per line, comma, or semicolon. Incoming requesters from these domains will be associated to this institution.</small>
                </label>
              ) : null}
              <label className="field full-span">
                <span>Notes</span>
                <textarea className="textarea" value={clientForm.notes} onChange={(event) => setClientForm((current) => ({ ...current, notes: event.target.value }))} />
              </label>
              <div className="modal-actions full-span">
                <button className="button secondary" type="button" onClick={closeClientModal}>
                  Cancel
                </button>
                <button className="button" type="submit" disabled={saving}>
                  <Save size={16} aria-hidden="true" />
                  <span>{clientModalMode === "edit" ? "Save Changes" : "Create Institution"}</span>
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {contactModalMode && selectedClient ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel compact-modal" role="dialog" aria-modal="true" aria-labelledby="contact-modal-title">
            <div className="modal-header">
              <div>
                <h2 id="contact-modal-title">{contactModalMode === "edit" ? "Edit Requester" : "Add Requester"}</h2>
                <p className="muted">{selectedClient.name}</p>
              </div>
              <button className="icon-button" type="button" title="Close" aria-label="Close" onClick={closeContactModal}>
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <form className="form" onSubmit={saveContact}>
              <div className="client-form-grid">
                <input className="input" placeholder="First name" value={contactForm.firstName} onChange={(event) => setContactForm((current) => ({ ...current, firstName: event.target.value }))} required />
                <input className="input" placeholder="Last name" value={contactForm.lastName} onChange={(event) => setContactForm((current) => ({ ...current, lastName: event.target.value }))} required />
                <div className="input-with-icon full-span">
                  <Mail size={16} aria-hidden="true" />
                  <input placeholder="email@example.com" type="email" value={contactForm.email} onChange={(event) => setContactForm((current) => ({ ...current, email: event.target.value }))} required />
                </div>
                <div className="input-with-icon">
                  <Phone size={16} aria-hidden="true" />
                  <input placeholder="Phone" value={contactForm.phone} onChange={(event) => setContactForm((current) => ({ ...current, phone: event.target.value }))} />
                </div>
                <input className="input" placeholder="Title" value={contactForm.title} onChange={(event) => setContactForm((current) => ({ ...current, title: event.target.value }))} />
              </div>
              <div className="checkbox-row">
                <label>
                  <input type="checkbox" checked={contactForm.isAuthorizedRequester} onChange={(event) => setContactForm((current) => ({ ...current, isAuthorizedRequester: event.target.checked }))} />
                  Authorized
                </label>
                <label>
                  <input type="checkbox" checked={contactForm.isTechnicalContact} onChange={(event) => setContactForm((current) => ({ ...current, isTechnicalContact: event.target.checked }))} />
                  Technical
                </label>
                <label>
                  <input type="checkbox" checked={contactForm.isBillingContact} onChange={(event) => setContactForm((current) => ({ ...current, isBillingContact: event.target.checked }))} />
                  Billing
                </label>
              </div>
              <div className="modal-actions">
                <button className="button secondary" type="button" onClick={closeContactModal}>
                  Cancel
                </button>
                <button className="button" type="submit" disabled={saving}>
                  <Save size={16} aria-hidden="true" />
                  <span>{contactModalMode === "edit" ? "Save Requester" : "Add Requester"}</span>
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}
