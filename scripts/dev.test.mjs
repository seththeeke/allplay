import { test } from "node:test";
import assert from "node:assert/strict";
import { selectAllPlayProcesses, serverEnv } from "./dev.mjs";

test("passes the preset to the servers, with the allplays profile for local-aws", () => {
  assert.deepEqual(serverEnv(["node", "dev.mjs"], { HOME: "/h" }), { HOME: "/h" });
  assert.deepEqual(serverEnv(["node", "dev.mjs", "--preset", "continuous-integration"], {}), {
    ALLPLAY_PRESET: "continuous-integration",
  });
  assert.equal(serverEnv(["node", "dev.mjs", "--preset", "local-aws"], {}).AWS_PROFILE, "allplays");
});

const root = "/work/allplay";

test("stops only this checkout's local server and Vite processes", () => {
  const psLines = [
    "  101 node /work/allplay/web-app/node_modules/.bin/vite",
    "  102 node /work/allplay/backend/node_modules/.bin/tsx src/local/start.ts",
    "  103 node /work/other/web/node_modules/.bin/vite preview --port 4317",
    "  104 node /work/allplay/backend/node_modules/.bin/vitest run",
    "  105 node /work/allplay-copy/web-app/node_modules/.bin/vite",
    "  106 npm run dev:server /work/allplay",
    "  107 /work/allplay/backend/.local/kokoro/venv/bin/python /work/allplay/backend/src/local/kokoro/worker.py m v",
    "garbage line",
  ];
  assert.deepEqual(selectAllPlayProcesses({ psLines, root, self: 106 }), [101, 102, 107]);
});

test("adds port listeners whose working directory is inside the checkout", () => {
  const cwd = { 201: "/work/allplay/backend", 202: "/work/other", 203: "/work/allplay" };
  assert.deepEqual(
    selectAllPlayProcesses({
      psLines: [],
      root,
      portPids: [201, 202, 203, 204],
      cwdOf: (pid) => cwd[pid] ?? null,
      self: 1,
    }),
    [201, 203],
  );
});

test("builds the local-aws-auth override and server variables from the Test config", async () => {
  const { cognitoTestSetup, serverEnv: env } = await import("./dev.mjs");
  const setup = cognitoTestSetup({
    stage: "TEST",
    region: "us-east-1",
    userPoolId: "us-east-1_pool",
    userPoolClientId: "client",
    identityPoolId: "us-east-1:pool",
    oauthDomain: "allplay-test-x.auth.us-east-1.amazoncognito.com",
  });
  assert.equal(setup.webOverride.localAuth, "COGNITO_TEST");
  assert.equal(setup.webOverride.stage, undefined);
  assert.deepEqual(setup.env, {
    ALLPLAY_AUTH_REGION: "us-east-1",
    ALLPLAY_AUTH_USER_POOL_ID: "us-east-1_pool",
    ALLPLAY_AUTH_CLIENT_ID: "client",
  });
  assert.throws(() => cognitoTestSetup({ region: "us-east-1" }), /deploy AA-1 and AA-4 first/);
  assert.equal(env(["node", "dev.mjs", "--preset", "local-aws-auth"], {}).AWS_PROFILE, "allplays");
});
