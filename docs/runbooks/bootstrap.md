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

5. CodeBuild concurrency. A new account starts with an applied quota of 0 concurrent builds, so the pipeline's Build step fails with `Cannot have more than 0 builds in queue for the account`. The pipeline uses only ARM small builds; request quota `L-5ED1D25B` (Concurrently running builds for ARM/Small environment) of 2:

   ```
   aws service-quotas request-service-quota-increase --service-code codebuild --quota-code L-5ED1D25B --desired-value 2 --profile allplays --region us-east-1
   ```

6. Bedrock inference quotas (`transcribe-polly-bedrock.md` Section 7.1). A new account starts with every Bedrock inference quota applied at 0, so the first Converse call fails with `ThrottlingException: Too many tokens per day`. The daily token quota (`L-D2912E70` for Amazon Nova Micro) is not adjustable through Service Quotas; open a Support case (Service limit increase, Bedrock, `us-east-1`) asking for the default on-demand and cross-region inference quotas for Amazon Nova Micro and Anthropic Claude Haiku 5.5. Check the applied values with:

   ```
   aws service-quotas list-service-quotas --service-code bedrock --profile allplays --region us-east-1 --query "Quotas[?contains(QuotaName, 'Nova Micro')].[QuotaName,Value]" --output text
   ```

   Transcribe streaming and Polly need no request; they worked on the account's defaults.

7. Google and Apple sign-in credentials (`authn-authz.md` Section 3.1). The stateful stack creates `allplay/test/federation` and `allplay/prod/federation` with every field `PENDING`. Once the credentials exist, open each secret in the Secrets Manager console (US East, N. Virginia), choose Retrieve secret value, Edit, and replace the six values:

   | Field | Where it comes from |
   |---|---|
   | `googleClientId`, `googleClientSecret` | Google Cloud Console, APIs and Services, Credentials, an OAuth client of type Web application whose authorized redirect URI is the stage's Cognito domain followed by `/oauth2/idpresponse` |
   | `appleServicesId` | Apple Developer, Identifiers, the Services ID with Sign in with Apple enabled, whose return URL is the same Cognito address |
   | `appleTeamId` | Apple Developer, Membership details |
   | `appleKeyId`, `applePrivateKeyPem` | Apple Developer, Keys, a key with Sign in with Apple enabled; the PEM is the whole downloaded `.p8` file, including its BEGIN and END lines |

   Do not edit the secret through CloudFormation or CDK. The next pipeline run after AA-3 picks up the values.

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

## 4. Recorded green run (SK-3)

On 2026-11-20, pipeline execution `16c934e5-b26e-47e0-891a-d5a42d5b6044` passed every stage: Source, Build, UpdatePipeline, Assets, Test (with `VerifyTest`) and Prod (with `VerifyProd`). On both stages, `/health` reports a 200 from `GET /v1/health`.

| Stage | Web | API |
|---|---|---|
| Test | https://d1ylknv7q5yxkl.cloudfront.net | https://pdxqi22s34.execute-api.us-east-1.amazonaws.com/ |
| Prod | https://d1tiopw128rbb6.cloudfront.net | https://6w0ay61gug.execute-api.us-east-1.amazonaws.com/ |

What the first runs taught:

1. A new account cannot create CloudFront distributions until AWS Support verifies it (step 1.4). Adding MFA to the root user does not count as verification.
2. A new account starts with 0 concurrent CodeBuild builds (step 1.5). The increase was applied while its Support case was still open.
3. The CodeConnections source is a zip without `.git`, so repository checks must not depend on git. `scripts/repo-files.mjs` falls back to walking the tree.
4. A stack that fails on first create is left in `ROLLBACK_COMPLETE` and must be deleted before the next deploy.
