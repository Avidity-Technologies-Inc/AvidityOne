export type ReportKind = "ticket-report" | "event-service-report" | "project-executive-report";
export type ReportColumn = { key: string; label: string; type?: "date" | "dateOnly" | "number" | "currency"; width?: number };
export const REPORT_COLUMNS: Record<ReportKind, ReportColumn[]> = {
  "ticket-report": [
    { key: "ticketNumber", label: "Ticket", width: 18 }, { key: "subject", label: "Subject", width: 48 },
    { key: "clientName", label: "Client", width: 28 }, { key: "requester", label: "Requester", width: 28 },
    { key: "status", label: "Status", width: 24 }, { key: "priority", label: "Priority" }, { key: "source", label: "Source" },
    { key: "assignedTo", label: "Assigned technicians", width: 32 }, { key: "team", label: "Team", width: 22 },
    { key: "createdAt", label: "Created", type: "date" }, { key: "updatedAt", label: "Updated", type: "date" },
    { key: "resolvedAt", label: "Resolved", type: "date" }, { key: "closedAt", label: "Closed", type: "date" },
    { key: "attachmentCount", label: "Files", type: "number" }, { key: "estimatedValue", label: "Estimate", type: "currency" }
  ],
  "event-service-report": [
    { key: "trackingNumber", label: "Request", width: 20 }, { key: "eventName", label: "Event", width: 42 },
    { key: "clientName", label: "Client", width: 28 }, { key: "requester", label: "Requester", width: 28 },
    { key: "requesterEmail", label: "Requester email", width: 34 }, { key: "eventDate", label: "Event date", type: "dateOnly" },
    { key: "time", label: "Event time", width: 22 }, { key: "services", label: "Services", width: 32 },
    { key: "status", label: "Status", width: 24 }, { key: "priority", label: "Priority" },
    { key: "assignedTo", label: "Assigned technicians", width: 32 }, { key: "taskCount", label: "Tasks", type: "number" },
    { key: "completedTaskCount", label: "Completed tasks", type: "number" },
    { key: "createdAt", label: "Created", type: "date" }, { key: "updatedAt", label: "Updated", type: "date" }
  ],
  "project-executive-report": [
    { key: "projectName", label: "Project", width: 42 }, { key: "clientName", label: "Client", width: 28 },
    { key: "owner", label: "Owner", width: 28 }, { key: "status", label: "Status" }, { key: "health", label: "Health" },
    { key: "targetDate", label: "Target date", type: "date" }, { key: "overdueMilestones", label: "Overdue milestones", type: "number" },
    { key: "openDecisions", label: "Open decisions", type: "number" }, { key: "overdueDecisions", label: "Overdue decisions", type: "number" },
    { key: "unassignedDecisions", label: "Unassigned decisions", type: "number" }, { key: "risk", label: "Delivery signal", width: 24 }
  ]
};
export const REPORT_DEFAULT_COLUMNS: Record<ReportKind, string[]> = {
  "ticket-report": ["ticketNumber", "subject", "clientName", "status", "priority", "assignedTo", "createdAt", "attachmentCount"],
  "event-service-report": ["trackingNumber", "eventName", "clientName", "eventDate", "status", "assignedTo", "taskCount"],
  "project-executive-report": ["projectName", "clientName", "owner", "health", "targetDate", "overdueMilestones", "openDecisions"]
};
export const REPORT_PERIODS = [
  { value: "custom", label: "Custom dates" }, { value: "last30", label: "Last 30 days" },
  { value: "last7", label: "Last 7 days" }, { value: "previousMonth", label: "Previous calendar month" },
  { value: "currentMonth", label: "Current month to date" }, { value: "previousWeek", label: "Previous week (Monday–Sunday)" }
] as const;
