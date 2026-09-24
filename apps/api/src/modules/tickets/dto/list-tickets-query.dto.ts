import { TicketPriority, TicketSource, TicketStatus } from "@prisma/client";
import { IsDateString, IsEnum, IsIn, IsOptional, IsString, IsUUID, MaxLength } from "class-validator";

export class ListTicketsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  search?: string;

  @IsOptional()
  @IsUUID("4")
  clientId?: string;

  @IsOptional()
  @IsIn(["all", "assigned_to_me", "my_teams", "unassigned"])
  scope?: "all" | "assigned_to_me" | "my_teams" | "unassigned";

  @IsOptional()
  @IsUUID("4")
  assignedUserId?: string;

  @IsOptional()
  @IsUUID("4")
  assignedTeamId?: string;

  @IsOptional()
  @IsUUID("4")
  externalSpecialistId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  requester?: string;

  @IsOptional()
  @IsEnum(TicketStatus)
  status?: TicketStatus;

  @IsOptional()
  @IsString()
  statuses?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  statusDefinitionIds?: string;

  @IsOptional()
  @IsDateString()
  updatedBefore?: string;

  @IsOptional()
  @IsIn(["true"])
  highPriority?: string;

  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;

  @IsOptional()
  @IsEnum(TicketSource)
  source?: TicketSource;

  @IsOptional()
  @IsIn(["ticketNumber", "subject", "client", "status", "priority", "source", "createdAt", "updatedAt"])
  sortBy?: "ticketNumber" | "subject" | "client" | "status" | "priority" | "source" | "createdAt" | "updatedAt";

  @IsOptional()
  @IsIn(["asc", "desc"])
  sortDirection?: "asc" | "desc";

  @IsOptional()
  @IsIn(["active", "deleted"])
  deletedScope?: "active" | "deleted";

  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsIn(["20", "50", "100", "all"])
  pageSize?: "20" | "50" | "100" | "all";
}
