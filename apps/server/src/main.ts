import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";

async function bootstrap(): Promise<void> {
  const rawPort = process.env.PORT;
  const port = rawPort === undefined ? 3001 : Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  // V0.1 development-only; no public binding and no PLC connections.
  const app = await NestFactory.create(AppModule, { cors: false });
  app.enableShutdownHooks();
  await app.listen(port, "127.0.0.1");
}

void bootstrap().catch((error: unknown) => {
  console.error("ADui SCADA server could not start:", error);
  process.exitCode = 1;
});
