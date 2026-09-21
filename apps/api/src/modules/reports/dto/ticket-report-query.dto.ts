import { TicketPriority, TicketSource } from "@prisma/client";
import { IsEnum, IsIn, IsNumberString, IsOptional, IsString, IsUUID, MaxLength } from "class-validator";

export class ReportPresentationDto {
  @IsOptional() @IsString() @MaxLength(100) timeZone?: string;
  @IsOptional() @IsIn(["custom", "last30", "last7", "previousMonth", "currentMonth", "previousWeek"]) period?: string;
  @IsOptional() @IsIn(["createdAt", "resolvedAt", "closedAt", "eventDate"]) dateBasis?: string;
  @IsOptional() @IsString() @MaxLength(1000) columns?: string;
  @IsOptional() @IsString() @MaxLength(2000) sections?: string;
  @IsOptional() @IsString() @MaxLength(120) title?: string;
  @IsOptional() @IsIn(["LETTER", "A4"]) paper?: "LETTER" | "A4";
  @IsOptional() @IsIn(["landscape", "portrait"]) orientation?: "landscape" | "portrait";
  @IsOptional() @IsIn(["all", "page"]) scope?: "all" | "page";
  @IsOptional() @IsString() @MaxLength(3) currency?: string;
  @IsOptional() @IsString() @MaxLength(80) sortBy?: string;
  @IsOptional() @IsIn(["asc", "desc"]) sortDirection?: "asc" | "desc";
  @IsOptional() @IsString() @MaxLength(3700) excludedIds?: string;
  @IsOptional() @IsString() @MaxLength(200) search?: string;
}

export class TicketReportQueryDto extends ReportPresentationDto {
  @IsOptional() @IsUUID("4") statusDefinitionId?: string;
  @IsOptional()
  @IsString()
  @MaxLength(40)
  startDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  endDate?: string;

  @IsOptional()
  @IsIn(["day", "week", "month", "year"])
  groupBy?: "day" | "week" | "month" | "year";

  @IsOptional()
  @IsUUID("4")
  clientId?: string;

  @IsOptional()
  @IsUUID("4")
  assignedUserId?: string;

  @IsOptional()
  @IsUUID("4")
  assignedTeamId?: string;

  @IsOptional()
  @IsString()
  statuses?: string;

  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;

  @IsOptional()
  @IsEnum(TicketSource)
  source?: TicketSource;

  @IsOptional()
  @IsIn(["all", "with", "without"])
  attachments?: "all" | "with" | "without";

  @IsOptional()
  @IsIn(["none", "perTicket"])
  estimateMode?: "none" | "perTicket";

  @IsOptional()
  @IsNumberString()
  valuePerTicket?: string;

  @IsOptional()
  @IsNumberString()
  page?: string;

  @IsOptional()
  @IsNumberString()
  pageSize?: string;
}

export class TicketReportExportQueryDto extends TicketReportQueryDto {
  @IsOptional()
  @IsIn(["csv", "xlsx", "pdf"])
  format?: "csv" | "xlsx" | "pdf";
}

export class EventServiceReportQueryDto extends ReportPresentationDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  startDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  endDate?: string;

  @IsOptional()
  @IsIn(["day", "week", "month", "year"])
  groupBy?: "day" | "week" | "month" | "year";

  @IsOptional()
  @IsUUID("4")
  clientId?: string;

  @IsOptional()
  @IsUUID("4")
  assignedUserId?: string;

  @IsOptional()
  @IsUUID("4")
  serviceId?: string;

  @IsOptional()
  @IsString()
  statuses?: string;

  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;

  @IsOptional()
  @IsNumberString()
  page?: string;

  @IsOptional()
  @IsNumberString()
  pageSize?: string;
}

export class EventServiceReportExportQueryDto extends EventServiceReportQueryDto {
  @IsOptional()
  @IsIn(["csv", "xlsx", "pdf"])
  format?: "csv" | "xlsx" | "pdf";
}
