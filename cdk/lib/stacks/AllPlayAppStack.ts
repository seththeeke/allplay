import { CfnOutput, Duration, Stack, type StackProps } from "aws-cdk-lib";
import type { UserPoolClient } from "aws-cdk-lib/aws-cognito";
import type { Construct } from "constructs";
import { healthRoutes } from "../../../backend/src/controller/web-api/health/healthRoutes";
import { resourceName, type StageName } from "../config";
import { AllPlayApi } from "../constructs/AllPlayApi";
import { AllPlayFunction } from "../constructs/AllPlayFunction";
import { WebHosting } from "../constructs/WebHosting";
import type { AllPlayStatefulStack } from "./AllPlayStatefulStack";

export interface AllPlayAppStackProps extends StackProps {
  stage: StageName;
  stateful: AllPlayStatefulStack;
  /** Directory holding the web app's production build. */
  webAssetPath: string;
}

/**
 * The replaceable application: API, Lambdas, scheduled jobs and web hosting
 * (cdk-stacks.md section 2). It depends on the stateful stack, never the
 * reverse. The walking skeleton holds the web app and the health route.
 */
export class AllPlayAppStack extends Stack {
  readonly stage: StageName;
  readonly web: WebHosting;
  readonly api: AllPlayApi;
  readonly apiUrl: CfnOutput;
  readonly webUrl: CfnOutput;
  /** The stage's config.json content (cdk-stacks.md section 6). */
  readonly webConfig: Record<string, unknown>;
  readonly webClient: UserPoolClient;
  readonly iosClient: UserPoolClient;

  constructor(scope: Construct, id: string, props: AllPlayAppStackProps) {
    super(scope, id, props);
    this.stage = props.stage;
    this.addStackDependency(props.stateful);
    this.web = new WebHosting(this, "Web", { stage: props.stage, assetPath: props.webAssetPath });
    this.api = new AllPlayApi(this, "Api", {
      stage: props.stage,
      allowedOrigins: [this.web.origin],
    });
    const health = new AllPlayFunction(this, "HealthApi", {
      stage: props.stage,
      name: "HealthApi",
      entry: "controller/web-api/health/handler.ts",
      memorySize: 256,
      timeout: Duration.seconds(5),
    });
    const [healthRoute] = healthRoutes;
    this.api.addPublicRoute("HealthRoute", healthRoute, health.function);
    /* App clients live here because the web client's URLs name this stack's CloudFront origin. */
    const users = props.stateful.users;
    const webUrls = [
      `${this.web.origin}/`,
      ...(props.stage === "Test" ? ["http://localhost:5173/"] : []),
    ];
    this.webClient = users.appClient(this, "WebClient", resourceName("Web", props.stage), {
      urls: webUrls,
    });
    this.iosClient = users.appClient(this, "IosClient", resourceName("iOS", props.stage), {
      urls: ["allplay://auth/"],
    });
    this.webConfig = {
      stage: props.stage.toUpperCase(),
      dataMode: "MEMORY",
      region: this.region,
      apiUrl: this.api.url,
      userPoolId: users.userPool.userPoolId,
      userPoolClientId: this.webClient.userPoolClientId,
      oauthDomain: users.domain.baseUrl().replace("https://", ""),
    };
    this.web.publish(this.webConfig);
    this.apiUrl = new CfnOutput(this, "ApiUrl", { value: this.api.url });
    this.webUrl = new CfnOutput(this, "WebUrl", { value: this.web.origin });
  }
}
