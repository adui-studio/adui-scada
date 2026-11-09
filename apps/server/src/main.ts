import "reflect-metadata";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";

// The only local .env lives at repository root (also reachable from dist/main.js).
// Docker injects its isolated network host through process.env instead.
const envPath = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(envPath)) loadEnvFile(envPath);

async function bootstrap(): Promise<void> {
  const rawPort = process.env.SCADA_SERVER_PORT ?? process.env.PORT;
  const port = rawPort === undefined ? 3001 : Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SCADA_SERVER_PORT must be an integer between 1 and 65535");
  }
  // Default: loopback only. Docker demo may explicitly opt into binding its container network.
  // This service is NOT a production API and must not be published without authentication.
  const host = process.env.SCADA_SERVER_HOST ?? process.env.HOST ?? "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "0.0.0.0") {
    throw new Error("SCADA_SERVER_HOST must be 127.0.0.1 or 0.0.0.0");
  }
  const app = await NestFactory.create(AppModule, { cors: false });
  app.enableShutdownHooks();
  await app.listen(port, host);
}

void bootstrap().catch((error: unknown) => {
  console.error("ADui SCADA server could not start:", error);
  process.exitCode = 1;
});
