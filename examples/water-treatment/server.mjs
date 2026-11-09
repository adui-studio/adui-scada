import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { TagStore, WaterTreatmentSimulator, renderSvgPage } from "../../packages/core/src/index.ts";
import { demoDocument } from "./project.mjs";

// One repository-root .env; Docker passes explicit process environment values.
const envPath = fileURLToPath(new URL("../../.env", import.meta.url));
if (existsSync(envPath)) loadEnvFile(envPath);

// Diagnostic harness only. Default to localhost; 0.0.0.0 is allowed
// solely for an isolated Docker demo bridge without host port publication.
const host = process.env.SCADA_DEMO_HOST ?? process.env.DEMO_HOST ?? "127.0.0.1";
if (host !== "127.0.0.1" && host !== "0.0.0.0") {
  throw new Error("SCADA_DEMO_HOST must be 127.0.0.1 or 0.0.0.0");
}
const port = Number(process.env.SCADA_DEMO_PORT ?? process.env.DEMO_PORT ?? "4178");
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("SCADA_DEMO_PORT must be an integer between 1 and 65535");
}
const index = readFileSync(new URL("./public/index.html", import.meta.url));
const script = readFileSync(new URL("./public/client.js", import.meta.url));
const style = readFileSync(new URL("./public/style.css", import.meta.url));
const tags = new TagStore();
const simulator = new WaterTreatmentSimulator();
const clients = new Set();

function headers(type) {
  return {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy":
      "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'",
  };
}

function sendEvent(response, change) {
  if (!response.destroyed) response.write(`data: ${JSON.stringify(change)}\n\n`);
}

tags.subscribe((change) => {
  for (const client of clients) sendEvent(client, change);
});

tags.apply(simulator.next());
let tick = 0;
const interval = setInterval(() => {
  tick++;
  // Intentional outage 8 seconds out of every 30 to test STALE visibility.
  if (tick % 30 >= 22) {
    tags.markStale(Date.now(), 2500);
    return;
  }
  const sequences = new Map(tags.snapshot().map((tag) => [tag.tagId, tag.sequence]));
  simulator.resumeAfter(sequences);
  tags.apply(simulator.next());
}, 1000);

const server = createServer((request, response) => {
  if (request.method !== "GET") {
    response.writeHead(405, { Allow: "GET" });
    response.end();
    return;
  }
  // Fixed routes only: never turn an untrusted path into a filesystem path.
  const route = (request.url ?? "/").split("?")[0];
  if (route === "/") {
    response.writeHead(200, headers("text/html; charset=utf-8"));
    response.end(index);
  } else if (route === "/client.js") {
    response.writeHead(200, headers("text/javascript; charset=utf-8"));
    response.end(script);
  } else if (route === "/style.css") {
    response.writeHead(200, headers("text/css; charset=utf-8"));
    response.end(style);
  } else if (route === "/project") {
    response.writeHead(200, headers("application/json; charset=utf-8"));
    response.end(JSON.stringify(demoDocument));
  } else if (route === "/snapshot.svg") {
    const snapshot = new Map(tags.snapshot().map((tag) => [tag.tagId, tag]));
    response.writeHead(200, headers("image/svg+xml; charset=utf-8"));
    response.end(renderSvgPage(demoDocument, "main", snapshot));
  } else if (route === "/events") {
    response.writeHead(200, {
      ...headers("text/event-stream; charset=utf-8"),
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    clients.add(response);
    sendEvent(response, { kind: "snapshot", values: tags.snapshot() });
    request.on("close", () => {
      clients.delete(response);
    });
  } else {
    response.writeHead(404, headers("text/plain; charset=utf-8"));
    response.end("Not Found");
  }
});

server.listen(port, host, () => {
  console.log(`V0.1 simulation: http://${host}:${port}`);
  console.log("No PLC/gateway connection. Automatic disconnection simulates STALE quality.");
});

function shutdown() {
  clearInterval(interval);
  for (const client of clients) client.end();
  server.close();
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
