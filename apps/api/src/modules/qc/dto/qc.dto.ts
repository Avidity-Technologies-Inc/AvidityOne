import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from "class-validator";
import { QcCriterion, QcCriterionResult, QcPolicyConfiguration, QcProgramConfiguration } from "@avidity/shared/dist";
export class QcVersionDto {
  @IsInt() @Min(0) version!: number;
}
export class QcQueryDto {
  @IsOptional() @IsInt() @Type(() => Number) @Min(1) page?: number;
  @IsOptional() @IsInt() @Type(() => Number) @Min(1) @Max(100) pageSize?: number;
  @IsOptional() @IsString() @MaxLength(100) status?: string;
  @IsOptional() @IsUUID() clientId?: string;
  @IsOptional() @IsUUID() ownerId?: string;
  @IsOptional() @IsUUID() projectId?: string;
  @IsOptional() @IsString() @MaxLength(100) ticketId?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}
export class QcProgramDto extends QcVersionDto {
  @IsObject() configuration!: QcProgramConfiguration;
  @IsBoolean() captureEnabled!: boolean;
  @IsBoolean() processingEnabled!: boolean;
  @IsBoolean() deliveryEnabled!: boolean;
  @IsString() @MaxLength(1000) reason!: string;
}
export class QcCategoryDto { @IsString() @MaxLength(100) name!: string; }
export class QcPolicyDto {
  @IsUUID() clientId!: string;
  @IsOptional() @IsUUID() projectId?: string;
  @IsOptional() @IsUUID() categoryId?: string;
  @IsString() @MaxLength(150) name!: string;
  @IsString() @MaxLength(150) agreementType!: string;
  @IsInt() @Min(1) revision!: number;
  @IsDateString() effectiveFrom!: string;
  @IsOptional() @IsDateString() effectiveUntil?: string;
  @IsObject() configuration!: QcPolicyConfiguration;
}
export class QcRubricDto {
  @IsString() @MaxLength(150) name!: string;
  @IsIn(["SERVICE", "CREATIVE"]) kind!: string;
  @IsInt() @Min(1) revision!: number;
  @IsNumber() @Min(0) @Max(100) passThreshold!: number;
  @IsInt() @Min(0) @Max(100) reinspectionCount!: number;
  @IsArray() @ArrayMaxSize(50) criteria!: QcCriterion[];
}
export class QcReviewDto {
  @IsOptional() @IsUUID() ticketId?: string;
  @IsOptional() @IsUUID() deliverableId?: string;
  @IsString() @MaxLength(1000) reason!: string;
}
export class QcAssignDto extends QcVersionDto { @IsUUID() reviewerId!: string; }
export class QcScoreDto extends QcVersionDto {
  @IsUUID() rubricId!: string;
  @IsArray() @ArrayMaxSize(50) results!: QcCriterionResult[];
}
export class QcTransitionDto extends QcVersionDto {
  @IsIn(["START", "CLOSE", "ACKNOWLEDGE"]) action!: string;
}
export class QcBulkDto {
  @IsArray() @ArrayMaxSize(100) items!: Array<{ id: string; version: number }>;
  @IsString() @MaxLength(1000) reason!: string;
}
export class QcActionDto {
  @IsUUID() reviewId!: string;
  @IsUUID() ownerId!: string;
  @IsIn(["COACHING", "CORRECTIVE", "RECOGNITION"]) kind!: string;
  @IsString() @MaxLength(200) title!: string;
  @IsString() @MaxLength(5000) note!: string;
  @IsOptional() @IsDateString() dueAt?: string;
}
export class QcActionUpdateDto extends QcVersionDto {
  @IsIn(["ACKNOWLEDGE", "COMPLETE", "VERIFY"]) action!: string;
  @IsOptional() @IsString() @MaxLength(5000) evidence?: string;
}
export class QcOverrideDto { @IsString() @MaxLength(1000) reason!: string; }
export class QcProfileDto extends QcVersionDto {
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsString() @MaxLength(10000) resolutionNote?: string;
}
export class QcTimeDto {
  @IsOptional() @IsUUID() ticketId?: string;
  @IsOptional() @IsUUID() deliverableId?: string;
  @IsDateString() startedAt!: string;
  @IsInt() @Min(1) @Max(1440) minutes!: number;
  @IsString() @MaxLength(5000) description!: string;
  @IsOptional() @IsUUID() correctionOfId?: string;
}
export class QcDeliverableDto {
  @IsUUID() projectId!: string;
  @IsOptional() @IsUUID() eventId?: string;
  @IsUUID() ownerId!: string;
  @IsString() @MaxLength(200) name!: string;
  @IsString() @MaxLength(100) kind!: string;
  @IsDateString() dueAt!: string;
}
export class QcDeliverableUpdateDto extends QcVersionDto {
  @IsIn(["PROOF_SENT", "APPROVED", "REVISION", "DELIVER", "RESCHEDULE"]) action!: string;
  @IsString() @MaxLength(5000) note!: string;
  @IsOptional() @IsDateString() dueAt?: string;
  @IsOptional() @IsUUID() knowledgeArticleId?: string;
}
