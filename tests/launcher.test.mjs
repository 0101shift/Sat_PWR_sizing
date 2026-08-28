import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const launcherUrl = new URL("../Start_Orbit_PWR_Dashboard.bat", import.meta.url);

test("Windows launcher uses the recoverable first-run npm install flow", async () => {
  const launcher = await readFile(launcherUrl, "utf8");

  assert.match(launcher, /set "NODE_VERSION=24\.20\.0"/i);
  assert.match(launcher, /nodejs\.org\/dist\/v%NODE_VERSION%\/%NODE_DIST%\.zip/i);
  assert.match(launcher, /Security\.Cryptography\.SHA256/i);
  assert.match(launcher, /6cac9ffbca8f6a47091e4b5c772e0606049c3871cb67d900c0cedde630e545ba/i);
  assert.match(launcher, /31c6799744de8a54601643098040c68c3697e56c94e407d61d0e5fa5f34191d7/i);
  assert.match(launcher, /\.orbit-pwr-runtime/i);
  assert.match(launcher, /call npm\.cmd install --no-audit --no-fund/i);
  assert.doesNotMatch(launcher, /call npm\.cmd ci\b/i);
  assert.match(launcher, /set "DASHBOARD_PORT=3000"/i);
  assert.match(launcher, /vinext\.CMD" dev --port %DASHBOARD_PORT%/i);
});
