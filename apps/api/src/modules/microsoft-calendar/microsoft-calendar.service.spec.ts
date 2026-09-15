import { MicrosoftCalendarService } from "./microsoft-calendar.service";

describe("MicrosoftCalendarService", () => {
  const fetchMock = jest.fn();
  const config = {
    get: jest.fn((key: string) => ({
      MICROSOFT_TENANT_ID: "tenant-1",
      MICROSOFT_CLIENT_ID: "client-1",
      MICROSOFT_CLIENT_SECRET: "secret-1"
    })[key])
  };

  beforeEach(() => {
    fetchMock.mockReset();
    config.get.mockClear();
    global.fetch = fetchMock as never;
  });

  it("creates a meeting with attendees, Teams, and the stable transaction id", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "token-1", expires_in: 3600 }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "event-1", webLink: "https://outlook.example/event-1", onlineMeeting: { joinUrl: "https://teams.example/join" } }), { status: 201, headers: { "Content-Type": "application/json" } }));
    const service = new MicrosoftCalendarService(config as never);

    await expect(service.createEvent({
      organizerEmail: "tech@example.com",
      subject: "AIT-100001 meeting",
      bodyHtml: "<p>Agenda</p>",
      startDateTime: "2026-09-04T10:00:00",
      endDateTime: "2026-09-04T10:30:00",
      timeZone: "America/Chicago",
      attendees: [{ email: "requester@example.com", name: "Requester", type: "required" }],
      isOnlineMeeting: true,
      transactionId: "11111111-1111-4111-8111-111111111111"
    })).resolves.toEqual(expect.objectContaining({ id: "event-1" }));

    const request = fetchMock.mock.calls[1][1] as RequestInit;
    const body = JSON.parse(String(request.body));
    expect(fetchMock.mock.calls[1][0]).toContain("/users/tech%40example.com/events");
    expect(body.transactionId).toBe("11111111-1111-4111-8111-111111111111");
    expect(body.attendees).toEqual([{ emailAddress: { address: "requester@example.com", name: "Requester" }, type: "required" }]);
    expect(body.isOnlineMeeting).toBe(true);
    expect(body.onlineMeetingProvider).toBe("teamsForBusiness");
  });

  it("preserves the Microsoft Teams meeting content when updating an online meeting", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "token-1", expires_in: 3600 }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "event-1", body: { content: '<!-- avidity-ticket-meeting:start --><div>Old agenda</div><!-- avidity-ticket-meeting:end --><div id="teams">Join Teams</div>' } }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "event-1", changeKey: "change-2" }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const service = new MicrosoftCalendarService(config as never);

    await service.updateEvent({
      organizerEmail: "tech@example.com",
      eventId: "event-1",
      subject: "Updated meeting",
      bodyHtml: "<!-- avidity-ticket-meeting:start --><div>New agenda</div><!-- avidity-ticket-meeting:end -->",
      startDateTime: "2026-09-04T11:00:00",
      endDateTime: "2026-09-04T11:30:00",
      timeZone: "America/Chicago",
      isOnlineMeeting: true,
      transactionId: "11111111-1111-4111-8111-111111111111"
    });

    const update = fetchMock.mock.calls[2][1] as RequestInit;
    const body = JSON.parse(String(update.body));
    expect(body.isOnlineMeeting).toBe(true);
    expect(body.onlineMeetingProvider).toBe("teamsForBusiness");
    expect(body.body.content).toContain("New agenda");
    expect(body.body.content).toContain("Join Teams");
    expect(body.body.content).not.toContain("Old agenda");
  });
  it("creates on-site reservations without Teams and deletes personal reservations idempotently", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "token-1", expires_in: 3600 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "reservation" }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "reservation", attendees: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    const service = new MicrosoftCalendarService(config as never);
    await service.createEvent({ organizerEmail: "tech@example.com", subject: "Site visit", bodyHtml: "<p>Visit</p>", startDateTime: "2026-09-16T10:00:00", endDateTime: "2026-09-16T11:00:00", timeZone: "America/Chicago", location: "Client office", attendees: [], isOnlineMeeting: false, transactionId: "visit" });
    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body.location).toEqual({ displayName: "Client office" });
    expect(body.attendees).toEqual([]); expect(body.isOnlineMeeting).toBeUndefined(); expect(body.onlineMeetingProvider).toBeUndefined();
    await service.deleteEvent({ organizerEmail: "tech@example.com", eventId: "reservation" });
    await expect(service.deleteEvent({ organizerEmail: "tech@example.com", eventId: "reservation" })).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[3][1].method).toBe("DELETE");
  });

  it("does not delete a reservation if Outlook has invitees missing from the local record", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "token-1", expires_in: 3600 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "reservation", attendees: [{ emailAddress: { address: "invited@example.invalid" } }] }), { status: 200 }));
    const service = new MicrosoftCalendarService(config as never);
    await expect(service.deleteEvent({ organizerEmail: "tech@example.com", eventId: "reservation" })).rejects.toThrow("audience");
    expect(fetchMock.mock.calls.some(([, request]) => request.method === "DELETE")).toBe(false);
  });

});
