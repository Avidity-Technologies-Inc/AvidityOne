import { TicketsService } from "./tickets.service";

function fixture() {
  const findFirst = jest.fn().mockResolvedValue(null);
  const service = new TicketsService({ ticket: { findFirst } } as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
  return { findFirst, match: (input: object) => (service as any).findExistingTicketForInbound({ organizationId: "org", senderEmail: "client@example.test", subject: "Re: Flyer", ...input }) };
}

describe("inbound ticket correlation", () => {
  it("uses the exact sent message before a conflicting number, quoted history or conversation", async () => {
    const f = fixture();
    f.findFirst.mockResolvedValueOnce({ id: "original" });
    expect(await f.match({ inReplyTo: "<sent@example.test>", subject: "Re: [AIT-100002] Flyer", bodyText: "AIT-100003", emailConversationId: "another-thread" })).toEqual({ id: "original" });
    expect(f.findFirst).toHaveBeenCalledTimes(1);
    expect(f.findFirst.mock.calls[0][0].where).toMatchObject({ organizationId: "org", deletedAt: null, OR: [{ messages: { some: { emailInternetMessageId: "<sent@example.test>" } } }] });
  });
  it("walks references from newest to oldest when a client changes conversation or subject", async () => {
    const f = fixture(); f.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "original" });
    expect(await f.match({ inReplyTo: "<unknown@example.test>", references: "<old@example.test> <recent@example.test>", emailConversationId: "new-thread" })).toEqual({ id: "original" });
    expect(f.findFirst.mock.calls[1][0].where.OR[0].messages.some.emailInternetMessageId).toBe("<recent@example.test>");
  });
  it("guards number-only fallback with existing participant evidence", async () => {
    const f = fixture(); f.findFirst.mockResolvedValueOnce({ id: "original" });
    expect(await f.match({ subject: "Re: [AIT-100001] Flyer" })).toEqual({ id: "original" });
    expect(f.findFirst.mock.calls[0][0].where).toMatchObject({ organizationId: "org", deletedAt: null, ticketNumber: "AIT-100001", AND: [{ OR: expect.arrayContaining([{ senderEmail: { equals: "client@example.test", mode: "insensitive" } }]) }] });
  });
  it("does not fall back to matching subjects or guessing among multiple quoted ticket numbers", async () => {
    const f = fixture();
    expect(await f.match({ bodyText: "Please compare AIT-100001 and AIT-100002" })).toBeNull();
    expect(f.findFirst).not.toHaveBeenCalled();
  });
  it("continues legacy conversations without changing closed-ticket lookup semantics", async () => {
    const f = fixture(); f.findFirst.mockResolvedValueOnce({ id: "closed", status: "CLOSED" });
    expect(await f.match({ emailConversationId: "legacy-thread" })).toMatchObject({ id: "closed" });
    expect(f.findFirst.mock.calls[0][0].where).toEqual({ organizationId: "org", deletedAt: null, messages: { some: { emailConversationId: "legacy-thread" } } });
  });
});
