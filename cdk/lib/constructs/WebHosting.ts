import { Duration, RemovalPolicy, Stack, Validations } from "aws-cdk-lib";
import {
  AllowedMethods,
  CachePolicy,
  Distribution,
  Function as CloudFrontFunction,
  FunctionCode,
  FunctionEventType,
  FunctionRuntime,
  HeadersFrameOption,
  HeadersReferrerPolicy,
  HttpVersion,
  PriceClass,
  ResponseHeadersPolicy,
  ViewerProtocolPolicy,
} from "aws-cdk-lib/aws-cloudfront";
import { S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
  ObjectOwnership,
  type CfnBucket,
  type IBucket,
} from "aws-cdk-lib/aws-s3";
import { BucketDeployment, CacheControl, Source } from "aws-cdk-lib/aws-s3-deployment";
import { Construct, type IConstruct } from "constructs";
import { resourceName, type StageName } from "../config";

export interface WebHostingProps {
  stage: StageName;
  /** Directory holding the web app's production build (`index.html`, `assets/`). */
  assetPath: string;
}

/** Rewrites extensionless paths such as /spider to /index.html so direct links load the app. */
const SPA_REWRITE = `function handler(event) {
  var request = event.request;
  if (request.uri.indexOf(".") === -1) {
    request.uri = "/index.html";
  }
  return request;
}`;

const ACKNOWLEDGED = [
  [
    "AwsSolutions-S1",
    "The bucket is private and read only through CloudFront; access logs add cost without day 0 value (cdk-stacks.md section 9).",
  ],
  ["AwsSolutions-CFR1", "The game is offered worldwide; there is no geographic restriction."],
  [
    "AwsSolutions-CFR2",
    "WAF costs more than the $25 monthly budget allows at day 0 (cdk-stacks.md section 9); the API has throttling.",
  ],
  [
    "AwsSolutions-CFR3",
    "CloudFront access logs are not in the day 0 telemetry set (cdk-stacks.md section 9).",
  ],
  [
    "AwsSolutions-CFR4",
    "The default CloudFront certificate is used until a domain exists (cdk-stacks.md section 8).",
  ],
] as const;

/**
 * The upload handler is a CDK-managed singleton Lambda whose runtime, managed
 * policy and S3 wildcards CDK controls; acknowledging on its scope covers it.
 */
function acknowledgeDeploymentHandler(deployment: BucketDeployment, bucket: IBucket): void {
  /* The handler role is always created inside the singleton handler function. */
  const handler = deployment.handlerRole.node.scope as IConstruct;
  const stack = Stack.of(bucket);
  const bucketId = stack.getLogicalId(bucket.node.defaultChild as CfnBucket);
  const findings = [
    "AwsSolutions-L1",
    "AwsSolutions-IAM4[Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole]",
    ...["s3:GetObject*", "s3:GetBucket*", "s3:List*", "s3:DeleteObject*", "s3:Abort*"].map(
      (action) => `AwsSolutions-IAM5[Action::${action}]`,
    ),
    `AwsSolutions-IAM5[Resource::arn:${stack.partition}:s3:::cdk-hnb659fds-assets-<AWS::AccountId>-${stack.region}/*]`,
    `AwsSolutions-IAM5[Resource::<${bucketId}.Arn>/*]`,
    "AwsSolutions-IAM5[Resource::*]",
  ];
  const reason =
    "CDK-managed BucketDeployment handler: its runtime, basic execution policy and S3 grants on the asset and site buckets are set by aws-cdk-lib.";
  for (const id of findings) {
    Validations.of(handler).acknowledge({ id, reason });
  }
}

/**
 * Hosts the web app (cdk-stacks.md section 6): a private bucket behind
 * CloudFront with origin access control, an SPA rewrite function, security
 * headers, and price class 100. `publish` uploads the build and the stage's
 * `config.json`; hashed assets cache for a year, `index.html` and
 * `config.json` are never cached.
 */
export class WebHosting extends Construct {
  /*
   * Typed as IBucket because Bucket's optional isWebsite does not satisfy
   * IBucket under exactOptionalPropertyTypes.
   */
  readonly bucket: IBucket;
  readonly distribution: Distribution;
  private readonly assetPath: string;

  constructor(scope: Construct, id: string, props: WebHostingProps) {
    super(scope, id);
    this.assetPath = props.assetPath;
    this.bucket = new Bucket(this, "Bucket", {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    }) as IBucket;
    const region = Stack.of(this).region;
    const headers = new ResponseHeadersPolicy(this, "Headers", {
      responseHeadersPolicyName: resourceName("WebHeaders", props.stage),
      securityHeadersBehavior: {
        contentSecurityPolicy: {
          contentSecurityPolicy: [
            "default-src 'self'",
            /* The API, Cognito (credentials, sign-in, the managed login token exchange), Transcribe streaming and Polly (cdk-stacks.md section 4). */
            [
              "connect-src 'self'",
              `https://*.execute-api.${region}.amazonaws.com`,
              `https://cognito-identity.${region}.amazonaws.com`,
              `https://cognito-idp.${region}.amazonaws.com`,
              `https://*.auth.${region}.amazoncognito.com`,
              `wss://transcribestreaming.${region}.amazonaws.com:8443`,
              `https://polly.${region}.amazonaws.com`,
            ].join(" "),
            "img-src 'self' data:",
            "style-src 'self' 'unsafe-inline'",
            "script-src 'self'",
            "object-src 'none'",
            "base-uri 'self'",
            "frame-ancestors 'none'",
          ].join("; "),
          override: true,
        },
        strictTransportSecurity: {
          accessControlMaxAge: Duration.days(365),
          includeSubdomains: true,
          override: true,
        },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: HeadersFrameOption.DENY, override: true },
        referrerPolicy: {
          referrerPolicy: HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true,
        },
      },
    });
    const rewrite = new CloudFrontFunction(this, "SpaRewrite", {
      functionName: resourceName("SpaRewrite", props.stage),
      code: FunctionCode.fromInline(SPA_REWRITE),
      runtime: FunctionRuntime.JS_2_0,
    });
    this.distribution = new Distribution(this, "Distribution", {
      comment: resourceName("Web", props.stage),
      defaultRootObject: "index.html",
      priceClass: PriceClass.PRICE_CLASS_100,
      httpVersion: HttpVersion.HTTP2_AND_3,
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(this.bucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: headers,
        functionAssociations: [{ function: rewrite, eventType: FunctionEventType.VIEWER_REQUEST }],
      },
    });
    for (const [rule, reason] of ACKNOWLEDGED) {
      Validations.of(this).acknowledge({ id: rule, reason });
    }
  }

  /** The stage's web origin, for API CORS. */
  get origin(): string {
    return `https://${this.distribution.distributionDomainName}`;
  }

  /** Uploads the build and the stage's config.json, then invalidates the entry files. */
  publish(config: Record<string, unknown>): void {
    const assets = new BucketDeployment(this, "Assets", {
      destinationBucket: this.bucket,
      sources: [Source.asset(this.assetPath, { exclude: ["index.html", "config.json"] })],
      cacheControl: [CacheControl.fromString("public, max-age=31536000, immutable")],
      prune: false,
      memoryLimit: 512,
    });
    const entry = new BucketDeployment(this, "Entry", {
      destinationBucket: this.bucket,
      sources: [
        Source.asset(this.assetPath, { exclude: ["*", "!index.html"] }),
        Source.jsonData("config.json", config),
      ],
      cacheControl: [CacheControl.noCache()],
      prune: false,
      memoryLimit: 512,
      distribution: this.distribution,
      distributionPaths: ["/index.html", "/config.json"],
    });
    entry.node.addDependency(assets);
    acknowledgeDeploymentHandler(assets, this.bucket);
  }
}
