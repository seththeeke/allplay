import { Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { AwsSolutionsChecks } from "cdk-nag";
import { describe, expect, it } from "vitest";
import { WebHosting } from "../../lib/constructs/WebHosting";
import { WEB_FIXTURE, testApp } from "../testApp";

function synth(publish = true) {
  const app = testApp();
  const stack = new Stack(app, "WebStack", { env: { region: "us-east-1" } });
  const web = new WebHosting(stack, "Web", { stage: "Test", assetPath: WEB_FIXTURE });
  if (publish) web.publish({ stage: "TEST", dataMode: "MEMORY" });
  return { stack, web, template: Template.fromStack(stack) };
}

describe("WebHosting", () => {
  it("keeps the bucket private, encrypted and TLS only", () => {
    const { template } = synth();
    template.hasResourceProperties("AWS::S3::Bucket", {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      BucketEncryption: Match.anyValue(),
    });
    template.hasResourceProperties("AWS::S3::BucketPolicy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: "Deny",
            Condition: { Bool: { "aws:SecureTransport": "false" } },
          }),
        ]),
      },
    });
  });

  it("serves through CloudFront with origin access control and price class 100", () => {
    const { template } = synth();
    template.resourceCountIs("AWS::CloudFront::OriginAccessControl", 1);
    template.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({
        DefaultRootObject: "index.html",
        PriceClass: "PriceClass_100",
        DefaultCacheBehavior: Match.objectLike({
          ViewerProtocolPolicy: "redirect-to-https",
          FunctionAssociations: [Match.objectLike({ EventType: "viewer-request" })],
        }),
      }),
    });
  });

  it("rewrites extensionless paths to index.html", () => {
    const { template } = synth();
    template.hasResourceProperties("AWS::CloudFront::Function", {
      Name: "AllPlay-SpaRewrite-Test",
      FunctionCode: Match.stringLikeRegexp('request.uri = "/index.html"'),
    });
  });

  it("lets the page reach Cognito, Transcribe streaming and Polly as well as the API", () => {
    const { template } = synth();
    const policy = JSON.stringify(template.findResources("AWS::CloudFront::ResponseHeadersPolicy"));
    for (const host of [
      "https://cognito-identity.us-east-1.amazonaws.com",
      "https://cognito-idp.us-east-1.amazonaws.com",
      "https://*.auth.us-east-1.amazoncognito.com",
      "wss://transcribestreaming.us-east-1.amazonaws.com:8443",
      "https://polly.us-east-1.amazonaws.com",
    ])
      expect(policy).toContain(host);
  });

  it("lets the page play the Polly replies it holds as blob URLs", () => {
    const { template } = synth();
    const policy = JSON.stringify(template.findResources("AWS::CloudFront::ResponseHeadersPolicy"));
    expect(policy).toContain("media-src 'self' blob:");
  });

  it("sets security headers with a CSP that allows the stage API", () => {
    const { template } = synth();
    template.hasResourceProperties("AWS::CloudFront::ResponseHeadersPolicy", {
      ResponseHeadersPolicyConfig: Match.objectLike({
        Name: "AllPlay-WebHeaders-Test",
        SecurityHeadersConfig: Match.objectLike({
          ContentSecurityPolicy: {
            ContentSecurityPolicy: Match.stringLikeRegexp(
              "connect-src 'self' https://\\*\\.execute-api\\.us-east-1\\.amazonaws\\.com",
            ),
            Override: true,
          },
          StrictTransportSecurity: Match.objectLike({ AccessControlMaxAgeSec: 31536000 }),
        }),
      }),
    });
  });

  it("uploads hashed assets immutable and the entry files uncached with an invalidation", () => {
    const { template } = synth();
    template.hasResourceProperties("Custom::CDKBucketDeployment", {
      SystemMetadata: { "cache-control": "public, max-age=31536000, immutable" },
      Prune: false,
    });
    template.hasResourceProperties("Custom::CDKBucketDeployment", {
      SystemMetadata: { "cache-control": "no-cache" },
      DistributionPaths: ["/index.html", "/config.json"],
    });
  });

  it("exposes its HTTPS origin", () => {
    const { web, stack } = synth(false);
    expect(JSON.stringify(stack.resolve(web.origin))).toMatch(
      /^\{"Fn::Join":\["",\["https:\/\/",\{"Fn::GetAtt":\["WebDistribution\w+","DomainName"\]\}\]\]/,
    );
  });

  it("passes cdk-nag with its acknowledged findings", () => {
    const { stack } = synth();
    expect(new AwsSolutionsChecks().validateScope(stack).violations).toEqual([]);
  });
});
