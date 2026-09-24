import { Injectable } from "@nestjs/common";
import { EventServiceRequestStatus, EventServiceTaskStatus, ProjectDecisionStatus, ProjectHealth, ProjectMilestoneStatus, ProjectStatus, TicketPriority, TicketStatus } from "@prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";
import { SystemSettingsService } from "../system-settings/system-settings.service";

const CLOSED_TICKET_STATUSES = [TicketStatus.RESOLVED, TicketStatus.CLOSED, TicketStatus.CANCELLED, TicketStatus.MERGED];
const CLOSED_EVENT_STATUSES = [EventServiceRequestStatus.COMPLETED, EventServiceRequestStatus.CANCELLED, EventServiceRequestStatus.CONVERTED_TO_TICKET];
const CLOSED_TASK_STATUSES = [EventServiceTaskStatus.DONE, EventServiceTaskStatus.CANCELLED];
type WorkKind = "TICKET" | "EVENT" | "EVENT_TASK" | "PROJECT";
type CapacityStatus = "AVAILABLE" | "NEAR_CAPACITY" | "OVER_CAPACITY";

interface ProjectCommitment {
  ownerId?: string;
  owner: string;
  attention: boolean;
  id: string;
  kind: "PROJECT" | "MILESTONE" | "DECISION";
  title: string;
  dueAt: Date | null;
  href: string;
}

export interface OperationsWorkItem {
  id: string;
  kind: WorkKind;
  reference: string;
  title: string;
  clientName: string | null;
  status: string;
  statusDefinitionId?: string | null;
  statusDefinition?: {
    id: string;
    key: string;
    name: string;
    systemStatus: string;
    category: string;
    color: string;
    sortOrder: number;
    isDefault: boolean;
    isProtected: boolean;
    isActive: boolean;
    description: string | null;
  } | null;
  health?: ProjectHealth | null;
  priority: TicketPriority | null;
  owner: string | null;
  teamName: string | null;
  groupName?: string | null;
  dueAt: Date | null;
  updatedAt: Date;
  href: string;
  attention: boolean;
  requestId?: string;
  internalOwners: string[];
  internalOwnerIds?: string[];
}

export interface OperationsDecision {
  id: string;
  title: string;
  description: string | null;
  status: ProjectDecisionStatus;
  dueAt: Date | null;
  createdAt: Date;
  owner: string | null;
  projectId: string;
  projectName: string;
  projectHealth: ProjectHealth;
  attention: boolean;
  href: string;
}

export interface WorkloadDetail {
  id: string;
  kind: string;
  reference: string;
  title: string;
  dueAt: Date | null;
  clientName: string | null;
  status: string;
  statusDefinitionId?: string | null;
  statusDefinition?: OperationsWorkItem["statusDefinition"];
  priority: TicketPriority | null;
  updatedAt: Date;
  href: string;
  attention: boolean;
}

@Injectable()
export class OperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly systemSettings: SystemSettingsService
  ) {}

  async overview(user: AuthenticatedUser) {
    const now = new Date();
    const settings = await this.systemSettings.getOperationsSettings(user);
    const nextWeek = new Date(now);
    nextWeek.setDate(nextWeek.getDate() + settings.dueSoonDays);

    const [tickets, requests, tasks, projects] = await Promise.all([
      user.permissions.includes("tickets.view") ? this.prisma.ticket.findMany({
        where: { organizationId: user.organizationId, deletedAt: null, status: { notIn: CLOSED_TICKET_STATUSES } },
        select: {
          id: true,
          ticketNumber: true,
          subject: true,
          status: true,
          statusDefinitionId: true,
          statusDefinition: true,
          priority: true,
          targetDate: true,
          updatedAt: true,
          client: { select: { name: true } },
          assignedUser: { select: { id: true, firstName: true, lastName: true } },
          assignedTeam: { select: { name: true } },
          assignedGroup: { select: { name: true } },
          assignees: { select: { user: { select: { id: true, firstName: true, lastName: true } } } }
        },
        orderBy: { updatedAt: "desc" }
      }) : Promise.resolve([]),
      user.permissions.includes("event_services.view") ? this.prisma.eventServiceRequest.findMany({
        where: { organizationId: user.organizationId, deletedAt: null, status: { notIn: CLOSED_EVENT_STATUSES } },
        select: {
          id: true,
          trackingNumber: true,
          eventName: true,
          eventDate: true,
          status: true,
          priority: true,
          updatedAt: true,
          client: { select: { name: true } },
          assignedTeam: { select: { name: true } },
          assignees: { select: { user: { select: { id: true, firstName: true, lastName: true } } } }
        },
        orderBy: [{ eventDate: "asc" }, { updatedAt: "desc" }]
      }) : Promise.resolve([]),
      user.permissions.includes("event_services.view") ? this.prisma.eventServiceTask.findMany({
        where: {
          status: { notIn: CLOSED_TASK_STATUSES },
          request: { organizationId: user.organizationId, deletedAt: null, status: { notIn: CLOSED_EVENT_STATUSES } }
        },
        select: {
          id: true,
          title: true,
          status: true,
          dueAt: true,
          updatedAt: true,
          assignedUser: { select: { id: true, firstName: true, lastName: true } },
          externalSpecialist: { select: { name: true } },
          request: { select: { id: true, trackingNumber: true, eventName: true, priority: true, client: { select: { name: true } }, assignedTeam: { select: { name: true } } } }
        },
        orderBy: [{ dueAt: "asc" }, { updatedAt: "desc" }]
      }) : Promise.resolve([]),
      user.permissions.includes("projects.view")
        ? this.prisma.project.findMany({
            where: { organizationId: user.organizationId, deletedAt: null, status: { notIn: [ProjectStatus.COMPLETED, ProjectStatus.CANCELLED] } },
            select: {
              id: true,
              name: true,
              status: true,
              health: true,
              targetDate: true,
              updatedAt: true,
              client: { select: { name: true } },
              owner: { select: { id: true, firstName: true, lastName: true } },
              milestones: {
                where: { status: { not: ProjectMilestoneStatus.COMPLETED } },
                select: {
                  id: true,
                  title: true,
                  status: true,
                  dueAt: true,
                  assignedUser: { select: { id: true, firstName: true, lastName: true } }
                }
              },
              decisions: {
                where: { status: { notIn: [ProjectDecisionStatus.RESOLVED, ProjectDecisionStatus.CANCELLED] } },
                select: {
                  id: true,
                  title: true,
                  description: true,
                  status: true,
                  dueAt: true,
                  createdAt: true,
                  owner: { select: { id: true, firstName: true, lastName: true } }
                }
              },
              dependencies: { where: { dependsOnProject: { status: { not: ProjectStatus.COMPLETED } } }, select: { id: true } }
            },
            orderBy: [{ targetDate: "asc" }, { updatedAt: "desc" }]
          })
        : Promise.resolve([])
    ]);

    const ticketItems: OperationsWorkItem[] = tickets.map((ticket) => {
      const specialists = [...new Map([ticket.assignedUser, ...ticket.assignees.map((assignment) => assignment.user)]
        .filter((assignee): assignee is { id: string; firstName: string; lastName: string } => Boolean(assignee))
        .map((assignee) => [assignee.id, assignee])).values()];
      const owners = specialists.map((assignee) => this.userName(assignee));
      const overdue = ticket.targetDate !== null && ticket.targetDate < now;
      const dueSoon = ticket.targetDate !== null && ticket.targetDate <= nextWeek;
      const attention = (!owners.length && !ticket.assignedTeam && !ticket.assignedGroup) || ticket.priority === TicketPriority.CRITICAL || ticket.priority === TicketPriority.URGENT || overdue || dueSoon;
      return {
        id: ticket.id,
        kind: "TICKET",
        reference: ticket.ticketNumber,
        title: ticket.subject,
        clientName: ticket.client?.name ?? null,
        status: ticket.status,
        statusDefinitionId: ticket.statusDefinitionId,
        statusDefinition: ticket.statusDefinition,
        priority: ticket.priority,
        owner: this.uniqueNames(owners),
        teamName: ticket.assignedTeam?.name ?? null,
        groupName: ticket.assignedGroup?.name ?? null,
        dueAt: ticket.targetDate,
        updatedAt: ticket.updatedAt,
        href: `/tickets/${ticket.ticketNumber}`,
        attention,
        internalOwners: owners,
        internalOwnerIds: specialists.map((specialist) => specialist.id)
      };
    });

    const requestItems: OperationsWorkItem[] = requests.map((request) => {
      const owners = request.assignees.map((assignment) => this.userName(assignment.user));
      const dueSoon = request.eventDate !== null && request.eventDate <= nextWeek;
      const overdue = request.eventDate !== null && request.eventDate < now;
      return {
        id: request.id,
        kind: "EVENT",
        reference: request.trackingNumber,
        title: request.eventName,
        clientName: request.client?.name ?? null,
        status: request.status,
        priority: request.priority,
        owner: this.uniqueNames(owners),
        teamName: request.assignedTeam?.name ?? null,
        dueAt: request.eventDate,
        updatedAt: request.updatedAt,
        href: `/event-services/${request.trackingNumber}`,
        attention: (!owners.length && !request.assignedTeam) || overdue || dueSoon,
        internalOwners: request.assignees.map((a) => this.userName(a.user)),
        internalOwnerIds: request.assignees.map((a) => a.user.id)
      };
    });

    const taskItems: OperationsWorkItem[] = tasks.map((task) => {
      const owner = task.assignedUser ? this.userName(task.assignedUser) : task.externalSpecialist?.name ?? null;
      const overdue = task.dueAt !== null && task.dueAt < now;
      return {
        id: task.id,
        kind: "EVENT_TASK",
        reference: task.request.trackingNumber,
        title: task.title,
        clientName: task.request.client?.name ?? null,
        status: task.status,
        priority: task.request.priority,
        owner,
        teamName: task.request.assignedTeam?.name ?? null,
        dueAt: task.dueAt,
        updatedAt: task.updatedAt,
        href: `/event-services/${task.request.trackingNumber}`,
        attention: task.status === EventServiceTaskStatus.BLOCKED || overdue || !owner,
        requestId: task.request.id,
        internalOwners: task.assignedUser ? [this.userName(task.assignedUser)] : [],
        internalOwnerIds: task.assignedUser ? [task.assignedUser.id] : []
      };
    });

    const projectCommitments: ProjectCommitment[] = [];
    let unassignedProjectCommitments = 0;
    const projectItems: OperationsWorkItem[] = projects.map((project) => {
      const overdue = project.targetDate !== null && project.targetDate < now;
      const blockedMilestones = project.milestones.filter((milestone) => milestone.status === ProjectMilestoneStatus.BLOCKED).length;
      const blockedDependencies = project.dependencies.length;
      const attention = project.health !== ProjectHealth.ON_TRACK || overdue || blockedMilestones > 0 || blockedDependencies > 0;

      if (project.owner) {
        projectCommitments.push({ ownerId: project.owner.id, owner: this.userName(project.owner), attention, id: `project-${project.id}`, kind: "PROJECT", title: project.name, dueAt: project.targetDate, href: `/projects?project=${project.id}` });
      } else {
        unassignedProjectCommitments += 1;
      }

      for (const milestone of project.milestones) {
        if (!milestone.assignedUser) {
          unassignedProjectCommitments += 1;
          continue;
        }
        projectCommitments.push({ ownerId: milestone.assignedUser.id, owner: this.userName(milestone.assignedUser), attention: milestone.status === ProjectMilestoneStatus.BLOCKED || (milestone.dueAt !== null && milestone.dueAt < now), id: `milestone-${milestone.id}`, kind: "MILESTONE", title: `${project.name}: ${milestone.title}`, dueAt: milestone.dueAt, href: `/projects?project=${project.id}` });
      }

      for (const decision of project.decisions) {
        if (!decision.owner) {
          unassignedProjectCommitments += 1;
          continue;
        }
        projectCommitments.push({ ownerId: decision.owner.id, owner: this.userName(decision.owner), attention: decision.status === ProjectDecisionStatus.OPEN || (decision.dueAt !== null && decision.dueAt < now), id: `decision-${decision.id}`, kind: "DECISION", title: `${project.name}: ${decision.title}`, dueAt: decision.dueAt, href: `/projects?project=${project.id}` });
      }

      return {
        id: project.id,
        kind: "PROJECT",
        reference: "Project",
        title: project.name,
        clientName: project.client?.name ?? null,
        status: project.status,
        health: project.health,
        priority: null,
        owner: project.owner ? this.userName(project.owner) : null,
        teamName: null,
        dueAt: project.targetDate,
        updatedAt: project.updatedAt,
        href: "/projects",
        attention,
        internalOwners: []
      };
    });
    const decisions: OperationsDecision[] = projects
      .flatMap((project) => project.decisions.map((decision) => {
        const overdue = decision.dueAt !== null && decision.dueAt < now;
        return {
          id: decision.id,
          title: decision.title,
          description: decision.description,
          status: decision.status,
          dueAt: decision.dueAt,
          createdAt: decision.createdAt,
          owner: decision.owner ? this.userName(decision.owner) : null,
          projectId: project.id,
          projectName: project.name,
          projectHealth: project.health,
          attention: decision.status === ProjectDecisionStatus.OPEN || overdue || !decision.owner || project.health !== ProjectHealth.ON_TRACK,
          href: `/projects?project=${project.id}`
        };
      }))
      .sort((left, right) => Number(right.attention) - Number(left.attention) || this.dateRank(left.dueAt, left.createdAt) - this.dateRank(right.dueAt, right.createdAt));

    const allItems = [...ticketItems, ...requestItems, ...taskItems, ...projectItems];
    const items = allItems
      .sort((left, right) => Number(right.attention) - Number(left.attention) || this.priorityRank(right.priority) - this.priorityRank(left.priority) || this.dateRank(left.dueAt, left.updatedAt) - this.dateRank(right.dueAt, right.updatedAt));
    const workload = this.workload(allItems, settings.capacityBaseline, settings.capacityWarningPercent, projectCommitments);
    const forecast = this.forecast(allItems, projectCommitments, settings.capacityBaseline, now);

    const agendaEnd = new Date(now.getTime() + 28 * 86400000);
    const agenda = user.permissions.includes("tickets.view") && user.permissions.includes("ticket_meetings.view")
      ? await this.prisma.ticketMeeting.findMany({
          where: { organizationId: user.organizationId, status: "SCHEDULED", endAt: { gte: now }, startAt: { lt: agendaEnd }, ticket: { deletedAt: null, status: { not: TicketStatus.MERGED } } },
          select: { id: true, title: true, startAt: true, endAt: true, timeZone: true, activityType: true, modality: true, location: true, syncStatus: true,
            organizer: { select: { id: true, firstName: true, lastName: true } },
            attendees: { where: { userId: { not: null } }, select: { userId: true } },
            ticket: { select: { ticketNumber: true, status: true, client: { select: { name: true } } } } },
          orderBy: [{ startAt: "asc" }, { id: "asc" }]
        }) : [];

    return {
      currentUserId: user.id,
      sources: { tickets: user.permissions.includes("tickets.view"), events: user.permissions.includes("event_services.view"), projects: user.permissions.includes("projects.view") },
      agenda,
      agendaEnd,
      generatedAt: now,
      summary: {
        activeTickets: ticketItems.length,
        unassignedTickets: ticketItems.filter((item) => !item.owner && !item.teamName && !item.groupName).length,
        activeEvents: requestItems.length,
        upcomingEvents: requestItems.filter((item) => item.dueAt && item.dueAt >= now && item.dueAt <= nextWeek).length,
        activeProjects: projectItems.length,
        atRiskProjects: projectItems.filter((item) => item.attention).length,
        openProjectDecisions: decisions.length,
        projectCommitments: projectCommitments.length,
        unassignedProjectCommitments,
        blockedTasks: taskItems.filter((item) => item.status === EventServiceTaskStatus.BLOCKED).length,
        attentionItems: allItems.filter((item) => item.attention).length,
        overdueItems: allItems.filter((item) => item.dueAt && item.dueAt < now).length,
        overCapacity: workload.filter((entry) => entry.capacityStatus === "OVER_CAPACITY").length,
        nearCapacity: workload.filter((entry) => entry.capacityStatus === "NEAR_CAPACITY").length,
        capacityBaseline: settings.capacityBaseline,
        capacityWarningPercent: settings.capacityWarningPercent,
        dueSoonDays: settings.dueSoonDays
      },
      capabilities: {
        updateTicketStatus: user.permissions.includes("tickets.update"),
        closeTickets: user.permissions.includes("tickets.close"),
        reopenTickets: user.permissions.includes("tickets.reopen"),
        updateEventStatus: user.permissions.includes("event_services.update"),
        exportProjectReports: user.permissions.includes("reports.export"),
        scheduleProjectReports: user.permissions.includes("reports.manage")
      },
      items,
      decisions,
      workload,
      forecast
    };
  }

  private userName(user: { firstName: string; lastName: string }) {
    return `${user.firstName} ${user.lastName}`.trim();
  }

  private uniqueNames(names: string[]) {
    const value = [...new Set(names.filter(Boolean))].join(", ");
    return value || null;
  }

  private priorityRank(priority: TicketPriority | null) {
    return priority === TicketPriority.CRITICAL ? 5 : priority === TicketPriority.URGENT ? 4 : priority === TicketPriority.HIGH ? 3 : priority === TicketPriority.NORMAL ? 2 : priority === TicketPriority.LOW ? 1 : 0;
  }

  private dateRank(dueAt: Date | null, updatedAt: Date) {
    return (dueAt ?? updatedAt).getTime();
  }

  private workload(items: OperationsWorkItem[], capacityBaseline: number, capacityWarningPercent: number, projectCommitments: ProjectCommitment[] = []) {
    const work = new Map<string, { ownerId: string; owner: string; operational: number; projectCommitments: number; total: number; attention: number; details: WorkloadDetail[] }>();
    for (const item of items) {
      for (const [index, owner] of item.internalOwners.entries()) {
        const ownerId = item.internalOwnerIds?.[index] ?? owner;
        const current = work.get(ownerId) ?? { ownerId, owner, operational: 0, projectCommitments: 0, total: 0, attention: 0, details: [] };
        current.operational += 1;
        current.total += 1;
        if (item.attention) current.attention += 1;
        current.details.push({ id: `${item.kind}-${item.id}`, kind: item.kind, reference: item.reference, title: item.title, dueAt: item.dueAt, clientName: item.clientName, status: item.status, statusDefinitionId: item.statusDefinitionId, statusDefinition: item.statusDefinition, priority: item.priority, updatedAt: item.updatedAt, href: item.href, attention: item.attention });
        work.set(ownerId, current);
      }
    }
    for (const commitment of projectCommitments) {
      const ownerId = commitment.ownerId ?? commitment.owner;
      const current = work.get(ownerId) ?? { ownerId, owner: commitment.owner, operational: 0, projectCommitments: 0, total: 0, attention: 0, details: [] };
      current.projectCommitments += 1;
      current.total += 1;
      if (commitment.attention) current.attention += 1;
      current.details.push({ id: commitment.id, kind: commitment.kind, reference: "Project", title: commitment.title, dueAt: commitment.dueAt, clientName: null, status: "OPEN", priority: null, updatedAt: new Date(0), href: commitment.href, attention: commitment.attention });
      work.set(ownerId, current);
    }
    return [...work.values()]
      .map((entry) => {
        const warningThreshold = Math.ceil(capacityBaseline * (capacityWarningPercent / 100));
        const capacityStatus: CapacityStatus = entry.total >= capacityBaseline ? "OVER_CAPACITY" : entry.total >= warningThreshold ? "NEAR_CAPACITY" : "AVAILABLE";
        return { ...entry, details: entry.details.sort((left, right) => this.dateRank(left.dueAt, left.updatedAt) - this.dateRank(right.dueAt, right.updatedAt)), capacityPercent: Math.round((entry.total / capacityBaseline) * 100), capacityStatus };
      })
      .sort((left, right) => this.capacityRank(right.capacityStatus) - this.capacityRank(left.capacityStatus) || right.attention - left.attention || right.total - left.total || left.owner.localeCompare(right.owner));
  }

  private forecast(items: OperationsWorkItem[], commitments: ProjectCommitment[], capacityBaseline: number, now: Date) {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    const weeks = Array.from({ length: 4 }, (_, index) => {
      const startAt = new Date(start);
      startAt.setDate(start.getDate() + index * 7);
      const endAt = new Date(startAt);
      endAt.setDate(startAt.getDate() + 7);
      return { startAt, endAt, label: startAt.toLocaleDateString("en-US", { month: "short", day: "numeric" }) };
    });
    const owners = new Map<string, { ownerId: string; owner: string; weeks: number[]; unscheduled: number }>();
    const add = (ownerId: string, owner: string, dueAt: Date | null) => {
      const row = owners.get(ownerId) ?? { ownerId, owner, weeks: [0, 0, 0, 0], unscheduled: 0 };
      if (!dueAt) row.unscheduled += 1;
      else {
        const index = weeks.findIndex((week) => dueAt >= week.startAt && dueAt < week.endAt);
        if (index >= 0) row.weeks[index] += 1;
      }
      owners.set(ownerId, row);
    };
    for (const item of items) item.internalOwners.forEach((owner, index) => add(item.internalOwnerIds?.[index] ?? owner, owner, item.dueAt));
    for (const commitment of commitments) add(commitment.ownerId ?? commitment.owner, commitment.owner, commitment.dueAt);
    return { weeks, owners: [...owners.values()].map((entry) => ({ ...entry, totalPlanned: entry.weeks.reduce((sum, value) => sum + value, 0), capacityBaseline })).sort((left, right) => right.totalPlanned - left.totalPlanned || left.owner.localeCompare(right.owner)) };
  }

  private capacityRank(status: CapacityStatus) {
    return status === "OVER_CAPACITY" ? 3 : status === "NEAR_CAPACITY" ? 2 : 1;
  }
}
