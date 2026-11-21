import { Duration, RemovalPolicy, Validations } from "aws-cdk-lib";
import { AccessLogField, AccessLogFormat } from "aws-cdk-lib/aws-apigateway";
import {
  CorsHttpMethod,
  HttpApi,
  HttpMethod,
  HttpNoneAuthorizer,
  HttpRoute,
  HttpRouteKey,
  HttpStage,
  LogGroupLogDestination,
} from "aws-cdk-lib/aws-apigatewayv2";
import { HttpIamAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import type { IFunction } from "aws-cdk-lib/aws-lambda";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";
import { resourceName, type StageName } from "../config";

export interface AllPlayApiProps {
  stage: StageName;
  /** Web origins allowed by CORS, for example the stage's CloudFront URL. */
  allowedOrigins: string[];
}

/** A route from a backend route list file that needs no signature. */
export interface PublicRoute {
  method: "GET";
  path: string;
  auth: "NONE";
}

const ACCESS_LOG = AccessLogFormat.custom(
  JSON.stringify({
    requestId: AccessLogField.contextRequestId(),
    ip: AccessLogField.contextIdentitySourceIp(),
    routeKey: "$context.routeKey",
    status: AccessLogField.contextStatus(),
    latencyMs: "$context.responseLatency",
    integrationError: "$context.integrationErrorMessage",
    time: AccessLogField.contextRequestTime(),
  }),
);

/**
 * The stage's HTTP API (cdk-stacks.md section 3): AWS_IAM by default, CORS
 * for the stage's web origins, JSON access logs kept 14 days, and default
 * throttling of 20 requests per second with burst 40. It is reached at its
 * default execute-api URL until a domain exists.
 */
export class AllPlayApi extends Construct {
  readonly api: HttpApi;
  readonly stage: HttpStage;

  constructor(scope: Construct, id: string, props: AllPlayApiProps) {
    super(scope, id);
    this.api = new HttpApi(this, "Api", {
      apiName: resourceName("Api", props.stage),
      createDefaultStage: false,
      defaultAuthorizer: new HttpIamAuthorizer(),
      corsPreflight: {
        allowOrigins: props.allowedOrigins,
        allowMethods: [
          CorsHttpMethod.GET,
          CorsHttpMethod.POST,
          CorsHttpMethod.PATCH,
          CorsHttpMethod.DELETE,
        ],
        allowHeaders: [
          "authorization",
          "content-type",
          "x-amz-date",
          "x-amz-security-token",
          "x-amz-content-sha256",
        ],
        maxAge: Duration.hours(1),
      },
    });
    const logGroup = new LogGroup(this, "AccessLogs", {
      retention: RetentionDays.TWO_WEEKS,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    this.stage = new HttpStage(this, "DefaultStage", {
      httpApi: this.api,
      stageName: "$default",
      autoDeploy: true,
      throttle: { rateLimit: 20, burstLimit: 40 },
      accessLogSettings: { destination: new LogGroupLogDestination(logGroup), format: ACCESS_LOG },
    });
  }

  /** The default execute-api URL, ending in a slash. */
  get url(): string {
    return this.stage.url;
  }

  /** Adds a route that needs no signature. Only the health check is public (cdk-stacks.md section 5). */
  addPublicRoute(id: string, route: PublicRoute, handler: IFunction): HttpRoute {
    const added = new HttpRoute(this, id, {
      httpApi: this.api,
      routeKey: HttpRouteKey.with(route.path, HttpMethod[route.method]),
      integration: new HttpLambdaIntegration(`${id}Integration`, handler),
      authorizer: new HttpNoneAuthorizer(),
    });
    Validations.of(added).acknowledge({
      id: "AwsSolutions-APIG4",
      reason: `${route.method} ${route.path} is public by design and reads no data (cdk-stacks.md section 5).`,
    });
    return added;
  }

  /**
   * Adds a bundle's routes from its route list (cdk-stacks.md section 5),
   * every one behind AWS_IAM and served by the bundle's Lambda through one
   * integration. Public routes are refused here.
   */
  addBundle(
    id: string,
    routes: readonly { method: string; path: string; auth: string }[],
    handler: IFunction,
  ): HttpRoute[] {
    const integration = new HttpLambdaIntegration(`${id}Integration`, handler);
    return routes.map((route, index) => {
      if (route.auth !== "IAM")
        throw new Error(`${route.method} ${route.path} is not an IAM route.`);
      return new HttpRoute(this, `${id}Route${String(index)}`, {
        httpApi: this.api,
        routeKey: HttpRouteKey.with(
          route.path,
          HttpMethod[route.method as keyof typeof HttpMethod],
        ),
        integration,
      });
    });
  }
}
