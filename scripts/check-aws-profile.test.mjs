import { test } from "node:test";
import assert from "node:assert/strict";
import { checkCommand, commandsIn } from "./check-aws-profile.mjs";

const allowed = [
  "aws sts get-caller-identity --profile allplays",
  "aws --profile=allplays s3 ls",
  "cd cdk && npx cdk synth --quiet --profile allplays",
  "AWS_PROFILE=allplays npm run test:integration",
  "aws --version",
  "npx cdk --version",
  'git commit -m "update aws docs"',
  "npm run synth",
  'echo "AWS_PROFILE=${AWS_PROFILE:-unset}"',
  "grep -n 'AWS_ACCESS_KEY_ID=' docs/runbooks/bootstrap.md",
  "AWS_ENDPOINT_URL=https://127.0.0.1:9297 AWS_SHARED_CREDENTIALS_FILE=~/.aws/emulator/9297/emulator_credentials aws dynamodb list-tables",
  "export AWS_ENDPOINT_URL=https://127.0.0.1:9297\nunset AWS_ACCESS_KEY_ID AWS_PROFILE\naws dynamodb list-tables",
];

const blocked = [
  "aws s3 ls",
  "aws s3 ls --profile default",
  "aws s3 ls --profile nyc311",
  "aws --profile='nyc311' s3 ls",
  "AWS_PROFILE=nyc311 node scripts/seed.mjs",
  "export AWS_PROFILE=default",
  "AWS_DEFAULT_PROFILE=default aws s3 ls --profile allplays",
  "unset AWS_PROFILE && node scripts/seed.mjs",
  "env -u AWS_PROFILE node scripts/seed.mjs",
  "AWS_ACCESS_KEY_ID=AKIAEXAMPLE AWS_SECRET_ACCESS_KEY=x node scripts/seed.mjs",
  "AWS_SHARED_CREDENTIALS_FILE=/tmp/creds aws s3 ls --profile allplays",
  "cd cdk && npx cdk deploy --all",
  "./node_modules/.bin/cdk diff",
  "npm exec cdk -- ls",
  "npm run cdk -- deploy",
  "npx aws-cdk bootstrap",
  "sudo aws s3 ls",
  "ls && aws s3 ls",
  "aws sts get-caller-identity --profile allplays && aws s3 ls",
  "echo $(aws sts get-caller-identity)",
  "AWS_ENDPOINT_URL=https://127.0.0.1:9297 aws dynamodb list-tables --profile nyc311",
  "AWS_ENDPOINT_URL=https://example.com aws dynamodb list-tables",
];

for (const command of allowed) {
  test(`allows: ${command.replaceAll("\n", " / ")}`, () => {
    assert.equal(checkCommand(command), null);
  });
}

for (const command of blocked) {
  test(`blocks: ${command}`, () => {
    assert.match(checkCommand(command) ?? "", /aws-profile-guard: .*allplays/);
  });
}

test("ignores input that is not a Bash tool call", () => {
  assert.equal(checkCommand(""), null);
});

test("reads npm scripts from package.json and command lines from shell scripts", () => {
  const scripts = commandsIn("cdk/package.json", JSON.stringify({ scripts: { deploy: "cdk deploy" } }));
  assert.deepEqual(scripts, [{ where: "cdk/package.json scripts.deploy", command: "cdk deploy" }]);
  const lines = commandsIn("scripts/x.sh", "#!/bin/sh\n# note\n\naws s3 ls --profile allplays\n");
  assert.deepEqual(lines, [{ where: "scripts/x.sh:4", command: "aws s3 ls --profile allplays" }]);
  assert.deepEqual(commandsIn("package.json", "{}"), []);
});
