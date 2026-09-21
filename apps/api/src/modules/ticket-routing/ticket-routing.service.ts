import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { NotificationsService } from "../notifications/notifications.service";
import { PrismaService } from "../prisma/prisma.service";

export interface RouteTicketInput {
  ticketId: string;
  organizationId: string;
  mailboxId?: string | null;
  clientId?: string | null;
  senderEmail?: string | null;
  senderDomain?: string | null;
  subject: string;
  bodyText: string;
}

@Injectable()
export class TicketRoutingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService
  ) {}

  async applyInboundRules(input: RouteTicketInput) {
    const rules = await this.prisma.ticketRoutingRule.findMany({
      where: {
        organizationId: input.organizationId,
        isActive: true,
        OR: input.mailboxId ? [{ mailboxId: null }, { mailboxId: input.mailboxId }] : [{ mailboxId: null }]
      },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }]
    });
    const matchedRule = rules.find((rule) => this.matchesRule(rule, input));

    if (!matchedRule) {
      return null;
    }

    const notifyUserIds = new Set<string>(matchedRule.notifyUserIds);
    if (matchedRule.assignUserId) {
      notifyUserIds.add(matchedRule.assignUserId);
    }
    if (matchedRule.assignTeamId) {
      const teamMembers = await this.prisma.ticketTeamMember.findMany({
        where: { ticketTeamId: matchedRule.assignTeamId },
        select: { userId: true }
      });
      teamMembers.forEach((member) => notifyUserIds.add(member.userId));
    }

    await this.prisma.ticket.update({
      where: { id: input.ticketId },
      data: {
        assignedUserId: matchedRule.assignUserId,
        assignedGroupId: matchedRule.assignTeamId ? null : matchedRule.assignGroupId,
        assignedTeamId: matchedRule.assignTeamId,
        priority: matchedRule.setPriority ?? undefined,
        appliedRoutingRuleId: matchedRule.id
      }
    });
    if (matchedRule.assignUserId) {
      await this.prisma.ticketAssignee.upsert({
        where: {
          ticketId_userId: {
            ticketId: input.ticketId,
            userId: matchedRule.assignUserId
          }
        },
        update: {},
        create: {
          ticketId: input.ticketId,
          userId: matchedRule.assignUserId
        }
      });
    }

    await Promise.all(
      [...notifyUserIds].map(async (userId) => {
        await this.prisma.ticketWatcher.upsert({
          where: {
            ticketId_userId: {
              ticketId: input.ticketId,
              userId
            }
          },
          update: {},
          create: {
            ticketId: input.ticketId,
            userId,
            reason: `${matchedRule.notifyUserIds.includes(userId) ? "Routing notification subscriber" : "Routing rule"}: ${matchedRule.name}`
          }
        });
        await this.notifications.notifyUser({
          userId,
          ticketId: input.ticketId,
          title: `Ticket routed: ${input.subject}`,
          body: `Rule "${matchedRule.name}" matched this ticket.`,
          eventType: matchedRule.assignUserId === userId ? "ticketAssignedToMe" : matchedRule.assignTeamId ? "ticketAssignedToMyTeam" : "routingRuleMatched"
        });
      })
    );

    return matchedRule;
  }

  async applyRulesToExistingTickets(user: AuthenticatedUser) {
    const tickets = await this.prisma.ticket.findMany({
      where: { organizationId: user.organizationId, deletedAt: null },
      select: {
        id: true,
        mailboxId: true,
        clientId: true,
        senderEmail: true,
        senderDomain: true,
        subject: true,
        description: true,
        messages: {
          select: { bodyText: true },
          orderBy: { createdAt: "desc" },
          take: 3
        }
      },
      orderBy: { updatedAt: "desc" },
      take: 500
    });

    let matched = 0;
    for (const ticket of tickets) {
      const rule = await this.applyInboundRules({
        ticketId: ticket.id,
        organizationId: user.organizationId,
        mailboxId: ticket.mailboxId,
        clientId: ticket.clientId,
        senderEmail: ticket.senderEmail,
        senderDomain: ticket.senderDomain,
        subject: ticket.subject,
        bodyText: [ticket.description, ...ticket.messages.map((message) => message.bodyText)].filter(Boolean).join("\n\n")
      });
      if (rule) {
        matched += 1;
      }
    }

    return { scanned: tickets.length, matched };
  }

  private matchesRule(rule: Prisma.TicketRoutingRuleGetPayload<Record<string, never>>, input: RouteTicketInput) {
    const checks: boolean[] = [];
    const subject = input.subject.toLowerCase();
    const body = input.bodyText.toLowerCase();
    const senderEmail = input.senderEmail?.toLowerCase() ?? "";
    const senderDomain = input.senderDomain?.toLowerCase() ?? "";

    if (rule.subjectContains) {
      checks.push(subject.includes(rule.subjectContains.toLowerCase()));
    }

    if (rule.bodyContains) {
      checks.push(body.includes(rule.bodyContains.toLowerCase()));
    }

    if (rule.senderEmailContains) {
      checks.push(senderEmail.includes(rule.senderEmailContains.toLowerCase()));
    }

    if (rule.senderDomain) {
      checks.push(senderDomain === rule.senderDomain.toLowerCase());
    }

    if (rule.clientId) {
      checks.push(input.clientId === rule.clientId);
    }

    if (checks.length === 0) {
      return false;
    }

    return rule.conditionMatch === "ALL" ? checks.every(Boolean) : checks.some(Boolean);
  }
}
