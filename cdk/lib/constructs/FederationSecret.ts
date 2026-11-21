import { RemovalPolicy, SecretValue, Validations } from "aws-cdk-lib";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";
import type { StageName } from "../config";

/** The placeholder every field holds until the owner enters the real value in the console. */
export const PENDING = "PENDING";

/** The fields of the federation secret (authn-authz.md section 3.1). */
export const FEDERATION_FIELDS = [
  "googleClientId",
  "googleClientSecret",
  "appleServicesId",
  "appleTeamId",
  "appleKeyId",
  "applePrivateKeyPem",
] as const;
export type FederationField = (typeof FEDERATION_FIELDS)[number];

export interface FederationSecretProps {
  stage: StageName;
}

/**
 * The Google and Apple sign-in credentials for one stage, `allplay/<stage>/federation`.
 * The stack creates it with placeholder values only; the owner sets the real
 * values in the console, so no credential is ever in the repository. The
 * placeholder template must never change: CloudFormation rewrites the secret's
 * value whenever its template value changes, which would erase the real values.
 * Retained on stack deletion.
 */
export class FederationSecret extends Construct {
  readonly secret: Secret;

  constructor(scope: Construct, id: string, props: FederationSecretProps) {
    super(scope, id);
    const secret = new Secret(this, "Secret", {
      secretName: `allplay/${props.stage.toLowerCase()}/federation`,
      description:
        "Google and Apple sign-in credentials for All Play. Set the values in the console; never commit them.",
      secretObjectValue: Object.fromEntries(
        FEDERATION_FIELDS.map((field) => [field, SecretValue.unsafePlainText(PENDING)]),
      ),
      removalPolicy: RemovalPolicy.RETAIN,
    });
    Validations.of(secret).acknowledge({
      id: "AwsSolutions-SMG4",
      reason:
        "Third-party credentials issued by Google and Apple; they are rotated in those consoles, not by Secrets Manager.",
    });
    this.secret = secret;
  }

  /** A field's value for CloudFormation, resolved at deploy time from the secret. */
  field(name: FederationField): SecretValue {
    return this.secret.secretValueFromJson(name);
  }
}
