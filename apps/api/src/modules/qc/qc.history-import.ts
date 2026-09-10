import { Prisma, QcProgram } from "@prisma/client";
import { qcJson } from "./qc.service";

/** Reconstruct only retained facts. Missing historical ownership, pauses and cycles stay explicit. */
export async function importHistoricalBatch(tx: Prisma.TransactionClient, program: QcProgram) {
  if (!program.startedAt) return;
  const tickets = await tx.ticket.findMany({ where: { organizationId: program.organizationId, deletedAt: null, createdAt: { lt: program.startedAt }, qcWorkEvents: { none: { kind: "HISTORICAL_IMPORT" } } }, orderBy: { createdAt: "asc" }, take: 20, include: { messages: { where: { createdAt: { lt: program.startedAt } }, orderBy: { createdAt: "asc" } } } });
  for (const ticket of tickets) {
    const baseline = { clientId: ticket.clientId, priority: ticket.priority, assignedUserId: ticket.assignedUserId, historicalAttribution: "Current retained source record; historical assignment and pause history are unavailable" };
    const inputs: Prisma.QcWorkEventCreateManyInput[] = [{ organizationId: program.organizationId, ticketId: ticket.id, sourceId: `${ticket.id}:created`, kind: "CREATED", origin: "HISTORICAL", occurredAt: ticket.createdAt, snapshot: qcJson({ ...baseline, status: "NEW", category: "NEW" }) }];
    for (const message of ticket.messages) {
      const kind = message.direction === "INBOUND" ? "CUSTOMER_MESSAGE" : message.authorUserId && message.direction === "OUTBOUND" && message.visibility === "PUBLIC" && message.mailDeliveryStatus === "ACCEPTED" ? "PUBLIC_RESPONSE" : message.authorUserId && message.direction === "INTERNAL" ? "TECHNICAL_TOUCH" : null;
      if (!kind) continue;
      inputs.push({ organizationId: program.organizationId, ticketId: ticket.id, actorId: message.authorUserId, kind, origin: "HISTORICAL", sourceId: message.id, occurredAt: kind === "PUBLIC_RESPONSE" ? message.mailDeliveryAcceptedAt ?? message.createdAt : message.createdAt, snapshot: qcJson({ messageId: message.id, sourceCreatedAt: message.createdAt, deliveryAcceptedAt: message.mailDeliveryAcceptedAt, timeBasis: kind === "PUBLIC_RESPONSE" && message.mailDeliveryAcceptedAt ? "PROVIDER_ACCEPTANCE" : "RETAINED_MESSAGE_TIMESTAMP" }) });
    }
    for (const [kind, date] of [["RESOLVED", ticket.resolvedAt], ["CLOSED", ticket.closedAt]] as const) if (date && date >= ticket.createdAt && date < program.startedAt) inputs.push({ organizationId: program.organizationId, ticketId: ticket.id, sourceId: `${ticket.id}:${kind}`, kind: "TICKET_CHANGED", origin: "HISTORICAL", occurredAt: date, snapshot: qcJson({ ...baseline, category: kind, status: kind, historicalCyclesUnavailable: true }) });
    inputs.push({ organizationId: program.organizationId, ticketId: ticket.id, sourceId: `${ticket.id}:import`, kind: "HISTORICAL_IMPORT", origin: "HISTORICAL", occurredAt: new Date(), snapshot: qcJson({ importedMessages: ticket.messages.length, captureStartedAt: program.startedAt, firstResponseAt: ticket.firstResponseAt, resolvedAt: ticket.resolvedAt, closedAt: ticket.closedAt, reopenedAt: ticket.reopenedAt, limitations: ["No historical ownership or status transition history", "Retained timestamp fields are evidence, not proof of a complete SLA cycle"] }) });
    await tx.qcWorkEvent.createMany({ data: inputs, skipDuplicates: true });
  }
}
