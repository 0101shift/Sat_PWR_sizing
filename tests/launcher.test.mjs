import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const launcherUrl = new URL("../Start_Orbit_PWR_Dashboard.bat", import.meta.url);

test("Windows launcher uses the recoverable first-run npm install flow", async () => {
  const launcher = await readFile(launcherUrl, "utf8");

  assert.match(launcher, /call npm\.cmd install --no-audit --no-fund/i);
  assert.doesNotMatch(launcher, /call npm\.cmd ci\b/i);
  assert.match(launcher, /set "DASHBOARD_PORT=3000"/i);
  assert.match(launcher, /vinext\.CMD" dev --port %DASHBOARD_PORT%/i);
});
