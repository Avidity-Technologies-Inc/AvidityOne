export const QC_FLAG_CODES = ["UNDOCUMENTED_CLOSE", "REOPENED_TICKET", "OWNERSHIP_CHURN", "STALLED_TICKET", "TIME_ENTRY_VARIANCE", "UNVERIFIED_RMM_CLOSE", "SILENT_AGING"] as const;
export const QC_REVIEW_STATES = ["PENDING", "IN_REVIEW", "PASSED", "FAILED", "COACHING_ISSUED", "CLOSED", "BULK_CLEARED"] as const;
export const QC_NOTIFICATION_EVENTS = ["SLA_WARNING", "SLA_BREACH", "HIGH_FLAG", "REVIEW_FAILED", "ACTION_OVERDUE", "CREATIVE_OVERDUE", "DAILY_DIGEST", "WEEKLY_DIGEST", "QUEUE_AGING"] as const;
export interface QcCalendar {
  timeZone: string;
  weekly: Array<{ day: number; startMinute: number; endMinute: number }>;
  holidays: string[];
}
export interface QcPolicyConfiguration {
  calendar: QcCalendar;
  priority: string | null;
  firstResponseMetric: "PUBLIC_RESPONSE" | "TECHNICAL_TOUCH";
  firstResponseMinutes: number;
  resolutionMinutes: number;
  subsequentResponseMinutes: number | null;
  warningPercent: number;
  pauseStatusIds: string[];
  pauseScheduledWork: boolean;
  pauseClockKinds: Array<"FIRST_RESPONSE" | "RESOLUTION" | "SUBSEQUENT_RESPONSE">;
}
export interface QcCriterion {
  id: string; label: string; weight: number; critical: boolean; allowNotApplicable: boolean;
}
export interface QcCriterionResult { criterionId: string; outcome: "PASS" | "FAIL" | "NA"; comment: string; }
export interface QcFlagRule { code: typeof QC_FLAG_CODES[number]; enabled: boolean; severity: "HIGH" | "MEDIUM" | "LOW"; threshold: number | null; }
export interface QcNotificationRoute {
  event: typeof QC_NOTIFICATION_EVENTS[number]; channel: "IN_APP" | "OUTLOOK" | "TEAMS" | "TEAMS_DIRECT";
  audiences: Array<"TECHNICIAN" | "QC_OWNER" | "LEADERSHIP">;
  delayMinutes: number;
  stopOnAcknowledgment?: boolean;
}
export interface QcProgramConfiguration {
  ownerId: string | null;
  leadershipIds: string[];
  anchorClientIds: string[];
  samplingPercent: number | null;
  samplingPeriodDays: number | null;
  samplingMinimum: number | null;
  samplingDimensions: Array<"TECHNICIAN" | "CLIENT" | "CATEGORY">;
  queueAgingMinutes: number | null;
  laborThresholdMinutes: number | null;
  flags: QcFlagRule[];
  serviceRubricId: string | null;
  creativeRubricId: string | null;
  routes: QcNotificationRoute[];
  deliveryCalendar: QcCalendar | null;
  dailyDigestMinute: number | null;
  weeklyDigestDay: number | null;
  urgentOutsideHours: boolean;
  maxNotificationsPerHour: number | null;
  mailboxId: string | null;
  teamsTenantId: string | null;
  teamsAppId: string | null;
  teamsSecretReference: string | null;
  teamsTeamId: string | null;
  teamsChannelId: string | null;
  teamsChannelIncludeWorkDetails: boolean;
  failureConsequence: "COACHING" | "BILLING_HOLD" | null;
  historicalMeasurement: "FORWARD_ONLY" | "INCLUDE_HISTORY" | null;
  rmmVerificationMode: "CHECK_IN" | "ALERT_CLEAR" | null;
  rmmEvidenceFreshnessMinutes: number | null;
  rmmClearedStatuses: string[];
  varianceBaselineMinimum: number | null;
  varianceThresholdPercent: number | null;
  creativeCheckpoints: Array<"PROOF_SENT" | "DELIVER">;
}
export const emptyQcConfiguration = (): QcProgramConfiguration => ({
  ownerId: null, leadershipIds: [], anchorClientIds: [], samplingPercent: null,
  samplingPeriodDays: null, samplingMinimum: null, samplingDimensions: [], queueAgingMinutes: null,
  laborThresholdMinutes: null, flags: [], serviceRubricId: null, creativeRubricId: null,
  routes: [], deliveryCalendar: null, dailyDigestMinute: null, weeklyDigestDay: null,
  urgentOutsideHours: false, maxNotificationsPerHour: null, mailboxId: null,
  teamsTenantId: null, teamsAppId: null, teamsSecretReference: null, teamsTeamId: null, teamsChannelId: null, teamsChannelIncludeWorkDetails: false, failureConsequence: null, historicalMeasurement: null, creativeCheckpoints: [], rmmVerificationMode: null, rmmEvidenceFreshnessMinutes: null, rmmClearedStatuses: [], varianceBaselineMinimum: null, varianceThresholdPercent: null
});
