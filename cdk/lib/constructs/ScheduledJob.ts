import { Duration, TimeZone, Validations } from "aws-cdk-lib";
import { Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Schedule, ScheduleExpression } from "aws-cdk-lib/aws-scheduler";
import { LambdaInvoke } from "aws-cdk-lib/aws-scheduler-targets";
import { Queue, QueueEncryption } from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";
import { resourceName, type StageName } from "../config";
import { acknowledgeGenerated } from "../nag";
import type { AllPlayFunction } from "./AllPlayFunction";

export interface ScheduledJobProps {
  stage: StageName;
  /** Name within the stage, for example `MetricsRollup`. */
  name: string;
  /** A cron expression in UTC, for example `cron(15 0 * * ? *)`. */
  cron: string;
  target: AllPlayFunction;
}

/**
 * An EventBridge Scheduler schedule invoking a Lambda, with retries and a
 * dead-letter queue for runs that still fail (cdk-stacks.md section 3).
 */
export class ScheduledJob extends Construct {
  readonly schedule: Schedule;
  readonly deadLetters: Queue;

  constructor(scope: Construct, id: string, props: ScheduledJobProps) {
    super(scope, id);
    this.deadLetters = new Queue(this, "DeadLetters", {
      queueName: resourceName(`${props.name}DeadLetters`, props.stage),
      encryption: QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      retentionPeriod: Duration.days(14),
    });
    Validations.of(this.deadLetters).acknowledge({
      id: "AwsSolutions-SQS3",
      reason: "This queue is the dead-letter queue of the schedule's target.",
    });
    const invoker = new Role(this, "Invoker", {
      assumedBy: new ServicePrincipal("scheduler.amazonaws.com"),
      description: `Invokes ${props.target.function.functionName} on its schedule.`,
    });
    this.schedule = new Schedule(this, "Schedule", {
      scheduleName: resourceName(props.name, props.stage),
      schedule: ScheduleExpression.expression(props.cron, TimeZone.ETC_UTC),
      target: new LambdaInvoke(props.target.function, {
        role: invoker,
        retryAttempts: 3,
        maxEventAge: Duration.hours(2),
        deadLetterQueue: this.deadLetters,
      }),
    });
    acknowledgeGenerated(
      invoker,
      "AwsSolutions-IAM5[Resource::<",
      "CDK grants the invoker the function and its versions (ARN:*); it can invoke only this function.",
    );
  }
}
