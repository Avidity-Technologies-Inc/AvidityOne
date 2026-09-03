import { TicketPromptBuilder } from "./ticket-prompt-builder";

describe("TicketPromptBuilder", () => {
  it("redacts common secret patterns", () => {
    const builder = new TicketPromptBuilder();

    expect(builder.removeSecrets("password=super-secret token: abc123")).toContain("[redacted]");
  });

  it("uses only public messages for ticket context", () => {
    const builder = new TicketPromptBuilder();
    const context = builder.buildContext({
      subject: "VPN issue",
      messages: [
        { visibility: "INTERNAL", bodyText: "Internal-only note" },
        { visibility: "PUBLIC", bodyText: "Customer-facing text" }
      ]
    });

    expect(context).toContain("Customer-facing text");
    expect(context).not.toContain("Internal-only note");
  });

  it("omits all conversation content for grammar and paraphrase actions", () => {
    const builder = new TicketPromptBuilder();
    const input = {
      subject: "Sensitive ticket subject",
      messages: [{ visibility: "PUBLIC", direction: "INBOUND", bodyText: "Customer history that must not be rewritten" }]
    };

    expect(builder.buildTicketActionContext({ ...input, action: "fix_grammar" })).toBe(
      "Reference conversation intentionally omitted for this draft-only editing action."
    );
    expect(builder.buildTicketActionContext({ ...input, action: "paraphrase" })).not.toContain("Customer history");
  });

  it("cleans and labels reply context without quoted iPhone history or signatures", () => {
    const builder = new TicketPromptBuilder();
    const context = builder.buildTicketActionContext({
      action: "suggest_reply",
      subject: "RTCC computers",
      messages: [
        {
          visibility: "PUBLIC",
          direction: "INBOUND",
          createdAt: new Date("2026-09-03T14:00:00Z"),
          bodyText: "Please send your findings to my office.\n\nSent from my iPhone\n\n> On Sep 2, 2026, Support wrote:\n> Previous conversation"
        }
      ]
    });

    expect(context).toContain("Customer:\nPlease send your findings to my office.");
    expect(context).not.toContain("Sent from my iPhone");
    expect(context).not.toContain("Previous conversation");
  });

  it("cleans labels, signatures, and quoted content from generated replies", () => {
    const builder = new TicketPromptBuilder();
    const result = builder.cleanGeneratedReply(
      "Response: We will review the systems and send the findings.\n\nBest regards,\nTechnician\n\nConversation:\nCustomer: old content"
    );

    expect(result).toBe("We will review the systems and send the findings.");
  });

  it("flags generated output that copies multiple context lines", () => {
    const builder = new TicketPromptBuilder();
    const first = "The customer requested a complete diagnostic report for all affected workstations before the meeting.";
    const second = "The technician previously confirmed that the replacement quote expired and must be renewed by Dell.";
    const context = `Customer:\n${first}\n\nTechnician:\n${second}`;

    expect(builder.isSuspiciousGeneratedReply(`${first}\n\n${second}`, undefined, context)).toBe(true);
    expect(builder.isSuspiciousGeneratedReply("We will obtain the updated quote and report our findings.", undefined, context)).toBe(false);
  });

  it("builds an operational context without internal notes or common secrets", () => {
    const builder = new TicketPromptBuilder();
    const context = builder.buildOperationalContext({
      ticketNumber: "AIT-100001",
      subject: "Microsoft 365 access",
      description: "User cannot sign in",
      status: "NEW",
      priority: "HIGH",
      clientName: "Example Client",
      requesterName: "Alex User",
      requesterEmail: "alex@example.com",
      messages: [
        { visibility: "INTERNAL", direction: "OUTBOUND", bodyText: "Internal token=hidden-value", createdAt: new Date("2026-07-22T10:00:00Z") },
        { visibility: "PUBLIC", direction: "INBOUND", bodyText: "My password=do-not-share and sign-in is blocked", createdAt: new Date("2026-07-22T10:01:00Z") }
      ]
    });

    expect(context).toContain("AIT-100001");
    expect(context).toContain("Customer:");
    expect(context).toContain("[redacted]");
    expect(context).not.toContain("Internal token");
    expect(context).not.toContain("do-not-share");
  });

  it("prioritizes the latest customer update and removes quoted history and signatures", () => {
    const builder = new TicketPromptBuilder();
    const context = builder.buildOperationalContext({
      ticketNumber: "AIT-100285",
      subject: "Update phone carts",
      status: "WAITING_ON_CUSTOMER",
      priority: "NORMAL",
      messages: [
        {
          visibility: "PUBLIC",
          direction: "INBOUND",
          bodyText: "Please update Leslie Holmes.\n\nThank you,\nJuwanda Petty",
          createdAt: new Date("2026-07-14T12:00:00Z")
        },
        {
          visibility: "PUBLIC",
          direction: "OUTBOUND",
          bodyText: "Please provide phone numbers and extensions.\n\nBest regards,\nTechnician",
          createdAt: new Date("2026-07-20T09:43:00Z")
        },
        {
          visibility: "PUBLIC",
          direction: "INBOUND",
          bodyText: "Keep the existing numbers. Update Ashley, Juwanda, Jazlyn, and Zicshan.\n\nFrom: Avidity Support <support@example.com>\nSent: Monday, July 20, 2026\nPlease provide phone numbers and extensions.\nE-MAIL CONFIDENTIALITY NOTICE: ignored",
          createdAt: new Date("2026-07-20T09:51:00Z")
        }
      ]
    });

    expect(context).toContain("LATEST CUSTOMER UPDATE (highest priority");
    expect(context).toContain("Keep the existing numbers. Update Ashley, Juwanda, Jazlyn, and Zicshan.");
    expect(context).toContain("ORIGINAL CUSTOMER REQUEST:\nPlease update Leslie Holmes.");
    expect(context.match(/Please provide phone numbers and extensions\./g)).toHaveLength(1);
    expect(context).not.toContain("Juwanda Petty\n\n[");
    expect(context).not.toContain("CONFIDENTIALITY NOTICE");
  });

  it("uses only inbound customer content for web reference discovery", () => {
    const builder = new TicketPromptBuilder();
    const source = builder.buildWebReferenceSource({
      subject: "Website update",
      description: null,
      originalCustomerMessage: { bodyText: "Please update our website.\nBest regards,\nhttps://www.client.example/page" },
      messages: [
        { visibility: "PUBLIC", direction: "INBOUND", bodyText: "The requested page is https://www.client.example/page" },
        { visibility: "PUBLIC", direction: "OUTBOUND", bodyText: "Track this ticket at https://support.aviditytechnologies.com/" },
        { visibility: "INTERNAL", direction: "OUTBOUND", bodyText: "Reference https://internal.aviditytechnologies.com/" }
      ]
    });

    expect(source).toContain("https://www.client.example/page");
    expect(source).not.toContain("support.aviditytechnologies.com");
    expect(source).not.toContain("internal.aviditytechnologies.com");
  });
});
