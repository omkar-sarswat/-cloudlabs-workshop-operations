import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import express from "express";
import { dashboardConfig } from "../shared/config.ts";
import { createApi } from "./api.ts";
import { createDriftController } from "./drift.ts";
import { seedEnvironments } from "./domain.ts";

const port = Number(process.env.API_PORT ?? dashboardConfig.apiPort);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("API_PORT must be an integer between 1 and 65535.");
}

const environments = new Map(seedEnvironments(new Date()).map((environment) => [environment.id, environment]));
const app = createApi({ environments });
const staticRoot = fileURLToPath(new URL("../../dist/", import.meta.url));
const indexFile = fileURLToPath(new URL("../../dist/index.html", import.meta.url));

if (existsSync(indexFile)) {
  app.use(express.static(staticRoot, { index: false }));
  app.get(/.*/, (_request, response, next) => {
    response.sendFile(indexFile, (error) => {
      if (error) next(error);
    });
  });
}

const server = createServer(app);
const drift = createDriftController(environments);
drift.start();

server.listen(port, "127.0.0.1", () => {
  console.log(`Workshop API listening on http://127.0.0.1:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    drift.stop();
    server.close(() => process.exit(0));
  });
}
