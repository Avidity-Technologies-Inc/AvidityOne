import { FileScanService } from "./file-scan.service";
import net from "node:net";

describe("FileScanService", () => {
  function serviceWithEnv(env: Record<string, string | undefined>) {
    return new FileScanService({
      get: jest.fn((key: string) => env[key])
    } as never);
  }

  it("uses a ClamAV socket path when configured", () => {
    const service = serviceWithEnv({ CLAMAV_SOCKET_PATH: "/var/run/clamav/clamd.ctl" });

    expect((service as unknown as { clamdConnectionOptions: () => unknown }).clamdConnectionOptions()).toEqual({
      path: "/var/run/clamav/clamd.ctl"
    });
  });

  it("falls back to ClamAV host and port", () => {
    const service = serviceWithEnv({ CLAMAV_HOST: "127.0.0.1", CLAMAV_PORT: "3310" });

    expect((service as unknown as { clamdConnectionOptions: () => unknown }).clamdConnectionOptions()).toEqual({
      host: "127.0.0.1",
      port: 3310
    });
  });

  it("streams files to clamd using the null-terminated zINSTREAM command", async () => {
    const chunks: Buffer[] = [];
    const server = net.createServer((socket) => {
      let replied = false;
      socket.on("data", (chunk) => {
        chunks.push(Buffer.from(chunk));
        if (replied) return;
        // TCP may split the command, length and payload into separate data events.
        const received = Buffer.concat(chunks);
        let offset = "zINSTREAM\0".length;
        while (offset + 4 <= received.length) {
          const size = received.readUInt32BE(offset);
          offset += 4;
          if (size === 0) {
            replied = true;
            socket.end("stream: OK\0");
            return;
          }
          if (offset + size > received.length) return;
          offset += size;
        }
      });
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      server.close();
      throw new Error("Test server did not bind to a TCP port.");
    }

    try {
      const service = serviceWithEnv({
        CLAMAV_ENABLED: "true",
        CLAMAV_HOST: "127.0.0.1",
        CLAMAV_PORT: String(address.port)
      });

      await expect(service.scanBuffer(Buffer.from("clean file"))).resolves.toEqual({
        scanStatus: "CLEAN",
        scanResult: "PASSED"
      });

      const payload = Buffer.from("clean file");
      const size = Buffer.alloc(4);
      size.writeUInt32BE(payload.length);
      expect(Buffer.concat(chunks)).toEqual(Buffer.concat([Buffer.from("zINSTREAM\0"), size, payload, Buffer.alloc(4)]));
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
