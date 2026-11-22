import { join } from "node:path";
import { RemovalPolicy, Validations, type Duration } from "aws-cdk-lib";
import { Effect, PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { ApplicationLogLevel, Architecture, LoggingFormat, Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";
import { isProd, resourceName, type StageName } from "../config";
import { BACKEND_DIR } from "../paths";

export interface AllPlayFunctionProps {
  stage: StageName;
  /** Lambda name from cdk-stacks.md section 4 without prefix or stage, for example `HealthApi`. */
  name: string;
  /** Entry file relative to `backend/src`, exporting `handler` (or the export named by `handler`). */
  entry: string;
  /** The entry file's export to run; defaults to `handler`. */
  handler?: string;
  memorySize: number;
  timeout: Duration;
  environment?: Record<string, string>;
  /** Log retention; 14 days unless the Lambda's logs are a record, as the turn log is (cdk-stacks.md section 4). */
  logRetention?: RetentionDays;
}

/**
 * Node.js Lambda with All Play defaults (cdk-stacks.md section 3): Node.js 22
 * on arm64, minified with source maps, JSON logs in an explicit log group kept
 * 14 days, a stage-suffixed name, the STAGE variable, and a role that can
 * write only to its own log group.
 */
export class AllPlayFunction extends Construct {
  readonly function: NodejsFunction;
  readonly logGroup: LogGroup;

  constructor(scope: Construct, id: string, props: AllPlayFunctionProps) {
    super(scope, id);
    const functionName = resourceName(props.name, props.stage);
    const prod = isProd(props.stage);
    this.logGroup = new LogGroup(this, "Logs", {
      logGroupName: `/aws/lambda/${functionName}`,
      retention: props.logRetention ?? RetentionDays.TWO_WEEKS,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const role = new Role(this, "Role", {
      assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
      description: `Execution role for ${functionName}`,
    });
    role.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["logs:CreateLogStream", "logs:PutLogEvents"],
        resources: [this.logGroup.logGroupArn],
      }),
    );
    this.function = new NodejsFunction(this, "Function", {
      functionName,
      entry: join(BACKEND_DIR, "src", props.entry),
      handler: props.handler ?? "handler",
      projectRoot: BACKEND_DIR,
      depsLockFilePath: join(BACKEND_DIR, "package-lock.json"),
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      memorySize: props.memorySize,
      timeout: props.timeout,
      role,
      logGroup: this.logGroup,
      loggingFormat: LoggingFormat.JSON,
      applicationLogLevelV2: prod ? ApplicationLogLevel.INFO : ApplicationLogLevel.DEBUG,
      environment: {
        STAGE: props.stage,
        LOG_LEVEL: prod ? "INFO" : "DEBUG",
        NODE_OPTIONS: "--enable-source-maps",
        ...props.environment,
      },
      bundling: {
        minify: true,
        sourceMap: true,
        target: "node22",
        format: OutputFormat.CJS,
      },
    });
    Validations.of(this.function).acknowledge({
      id: "AwsSolutions-L1",
      reason:
        "Node.js 22 matches the project toolchain (.nvmrc, cdk-stacks.md section 3); runtime upgrades are a spec change.",
    });
  }
}
