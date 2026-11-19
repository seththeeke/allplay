# Bootstrap Runbook

How the `allplays` AWS account was prepared for the All Play pipeline (`cdk-stacks.md` Section 10). Every command uses the `allplays` profile in `us-east-1`. Run CDK commands from `cdk/`.

## 1. One-time account steps

1. Bootstrap CDK:

   ```
   npx cdk bootstrap --profile allplays --tags Project=AllPlay
   ```

2. Create the GitHub connection and store its ARN in SSM, so the public repository never holds the account id:

   ```
   aws codeconnections create-connection --provider-type GitHub --connection-name AllPlay-GitHub --profile allplays --region us-east-1
   aws ssm put-parameter --name /allplay/github-connection-arn --type String --value <connection-arn> --profile allplays --region us-east-1
   ```

3. Authorize the connection by hand: AWS console, Developer Tools, Settings, Connections, `AllPlay-GitHub`, Update pending connection, then install the AWS Connector for GitHub app on the `seththeeke/allplay` repository. The connection status must read Available.

4. CloudFront account verification. A new account cannot create CloudFront distributions until AWS Support verifies it; adding MFA to the root user does not do it. The first deploy fails with `Your account must be verified before you can add new CloudFront resources`; open a Support case (Account and billing) quoting that message and wait for the confirmation.

## 2. First pipeline deploy

1. Build the web app, because the stages publish `web-app/dist`:

   ```
   npm ci --prefix ../backend && npm ci --prefix ../web-app && npm run build --prefix ../web-app
   ```

2. Deploy the pipeline stack. After this, the pipeline deploys itself and both stages:

   ```
   npx cdk deploy AllPlayPipeline --profile allplays --require-approval never
   ```

3. Confirm the `AllPlay-Alerts` email subscription from the link AWS sends to the alert address (`ALERT_EMAIL` in `cdk/lib/stacks/AllPlayPipelineStack.ts`).

## 3. Operating the pipeline

- Pushes do not start the pipeline. It runs daily at 10:00 UTC, or on demand:

  ```
  aws codepipeline start-pipeline-execution --name AllPlay --profile allplays --region us-east-1
  ```

- A stage can be deployed by hand while debugging (the pipeline remains the normal path):

  ```
  npx cdk deploy "AllPlayPipeline/Test/*" --profile allplays --require-approval never
  ```

- Each stage's outputs `ApiUrl` and `WebUrl` are on the `AllPlayApp-<Stage>` stack. The site's `/health` page calls `GET /v1/health` on `ApiUrl`.

- A stack that failed on first creation is left in `ROLLBACK_COMPLETE` and must be deleted before the next deploy:

  ```
  aws cloudformation delete-stack --stack-name AllPlayApp-Test --profile allplays --region us-east-1
  ```
