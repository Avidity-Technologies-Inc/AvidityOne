export interface NavigationItem {
  label: string;
  href: string;
  permission?: string;
}

export const dashboardNavigation: NavigationItem[] = [
  { label: "Dashboard", href: "/dashboard", permission: "tickets.view" },
  { label: "Quality Control", href: "/qc", permission: "qc.view" },
  { label: "Operations", href: "/operations", permission: "operations.view" },
  { label: "Tickets", href: "/tickets", permission: "tickets.view" },
  { label: "Event & Services", href: "/event-services", permission: "event_services.view" },
  { label: "Devices", href: "/devices", permission: "devices.view" },
  { label: "Reports", href: "/reports", permission: "reports.view" },
  { label: "Clients", href: "/clients", permission: "clients.view" },
  { label: "Knowledge Base", href: "/knowledge-base", permission: "knowledge_base.view" },
  { label: "Users", href: "/users", permission: "users.create" },
  { label: "Profile", href: "/profile" },
  { label: "Settings", href: "/settings", permission: "system_settings.view" }
];
