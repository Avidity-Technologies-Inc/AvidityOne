import { generateKeyPairSync, sign } from "node:crypto";
import { validateConnectorToken, teamsServiceUrl, TeamsActivity } from "./qc.teams.service";
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const key = { ...pair.publicKey.export({ format: "jwk" }), kid: "synthetic-key", endorsements: ["msteams"] };
const activity: TeamsActivity = { channelId: "msteams", serviceUrl: "https://smba.trafficmanager.net/amer/" };
const now = Date.parse("2026-09-10T14:00:00Z");
const claims = { iss: "https://api.botframework.com", aud: "synthetic-app-id", exp: now / 1000 + 600, nbf: now / 1000 - 60, serviceurl: activity.serviceUrl };
function token(payload = claims, header = { alg: "RS256", kid: key.kid, typ: "JWT" }) {
  const unsigned = `${Buffer.from(JSON.stringify(header)).toString("base64url")}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
  return `${unsigned}.${sign("RSA-SHA256", Buffer.from(unsigned), pair.privateKey).toString("base64url")}`;
}
describe("QC Teams connector boundary", () => {
  it("accepts a signed endorsed connector token for the exact configured app and service URL", () => {
    expect(() => validateConnectorToken(token(), activity, "synthetic-app-id", [key], now)).not.toThrow();
  });
  it("rejects altered audience, issuer, lifetime, URL, channel and endorsement", () => {
    for (const payload of [{ ...claims, aud: "another-app" }, { ...claims, iss: "https://attacker.invalid" }, { ...claims, exp: now / 1000 - 1 }, { ...claims, nbf: now / 1000 + 301 }, { ...claims, serviceurl: "https://attacker.invalid" }]) expect(() => validateConnectorToken(token(payload), activity, "synthetic-app-id", [key], now)).toThrow();
    expect(() => validateConnectorToken(token(), { ...activity, channelId: "emulator" }, "synthetic-app-id", [key], now)).toThrow();
    expect(() => validateConnectorToken(token(), activity, "synthetic-app-id", [{ ...key, endorsements: [] }], now)).toThrow();
    expect(() => validateConnectorToken(`${token()}corrupt`, activity, "synthetic-app-id", [key], now)).toThrow();
  });
  it("never forwards the bot bearer token to an arbitrary or insecure service URL", () => {
    for (const url of ["http://smba.trafficmanager.net/amer", "https://smba.trafficmanager.net.attacker.invalid/", "https://user:pass@smba.trafficmanager.net/", "https://127.0.0.1/", "https://smba.trafficmanager.net:444/", "https://smba.trafficmanager.net/?redirect=elsewhere"]) expect(() => teamsServiceUrl(url)).toThrow();
    expect(teamsServiceUrl("https://smba.trafficmanager.net/amer/")).toBe("https://smba.trafficmanager.net/amer");
  });
});
