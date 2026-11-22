import { Stack } from "aws-cdk-lib";
import {
  Alarm,
  ComparisonOperator,
  TreatMissingData,
  type IMetric,
} from "aws-cdk-lib/aws-cloudwatch";
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions";
import { Topic } from "aws-cdk-lib/aws-sns";
import { Construct } from "constructs";
import { PROJECT_NAME, resourceName, type StageName } from "../config";

export interface AllPlayAlarmProps {
  stage: StageName;
  /** Name within the stage, for example `DecisionApiErrors`. */
  name: string;
  metric: IMetric;
  /** Alarms at or above this value in one evaluation period. */
  threshold: number;
  description: string;
}

/**
 * A CloudWatch alarm on the alert topic (cdk-stacks.md section 9.1). The
 * topic lives in the pipeline stack, so it is named rather than referenced,
 * and missing data is not a breach.
 */
export class AllPlayAlarm extends Construct {
  readonly alarm: Alarm;

  constructor(scope: Construct, id: string, props: AllPlayAlarmProps) {
    super(scope, id);
    this.alarm = new Alarm(this, "Alarm", {
      alarmName: resourceName(props.name, props.stage),
      alarmDescription: props.description,
      metric: props.metric,
      threshold: props.threshold,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });
    const topic = Topic.fromTopicArn(
      this,
      "Alerts",
      Stack.of(this).formatArn({ service: "sns", resource: `${PROJECT_NAME}-Alerts` }),
    );
    this.alarm.addAlarmAction(new SnsAction(topic));
  }
}
