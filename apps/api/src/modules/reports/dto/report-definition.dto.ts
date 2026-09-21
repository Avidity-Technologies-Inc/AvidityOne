import { ReportPresentationDto } from "./ticket-report-query.dto";
import { ArrayNotEmpty, IsArray, IsBoolean, IsEmail, IsIn, IsNotEmpty, IsObject, IsOptional, IsString, IsUUID, MaxLength } from "class-validator";

export class CreateReportDefinitionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  @IsIn(["ticket-report", "event-service-report", "project-executive-report"])
  @MaxLength(80)
  reportType?: string;

  @IsObject()
  filters!: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  isShared?: boolean;
}

export class UpdateReportDefinitionDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsObject()
  filters?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  isShared?: boolean;
}

export class SendReportDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsEmail({}, { each: true })
  recipientEmails!: string[];

  @IsOptional()
  @IsIn(["csv", "xlsx", "pdf"])
  format?: "csv" | "xlsx" | "pdf";

  @IsOptional()
  @IsString()
  @MaxLength(160)
  subject?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  message?: string;
}

export class CreateReportScheduleDto {
  @IsOptional() @IsObject() timing?: { timeZone: string; time: string; weekDay: number; monthDay: number };
  @IsUUID("4")
  definitionId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsIn(["daily", "weekly", "monthly"])
  frequency!: "daily" | "weekly" | "monthly";

  @IsIn(["csv", "xlsx", "pdf"])
  format!: "csv" | "xlsx" | "pdf";

  @IsArray()
  @ArrayNotEmpty()
  @IsEmail({}, { each: true })
  recipientEmails!: string[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateReportScheduleDto {
  @IsOptional() @IsObject() timing?: { timeZone: string; time: string; weekDay: number; monthDay: number };
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsIn(["daily", "weekly", "monthly"])
  frequency?: "daily" | "weekly" | "monthly";

  @IsOptional()
  @IsIn(["csv", "xlsx", "pdf"])
  format?: "csv" | "xlsx" | "pdf";

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsEmail({}, { each: true })
  recipientEmails?: string[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ExecutiveProjectReportQueryDto extends ReportPresentationDto {
  @IsOptional()
  @IsIn(["csv", "xlsx", "pdf"])
  format?: "csv" | "xlsx" | "pdf";
}
