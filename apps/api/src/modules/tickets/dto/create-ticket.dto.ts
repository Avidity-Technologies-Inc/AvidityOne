import { TicketPriority, TicketSource } from "@prisma/client";
import { IsArray, IsEnum, IsOptional, IsString, IsUUID, MinLength } from "class-validator";

export class CreateTicketDto {
  @IsString()
  @MinLength(3)
  subject: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsUUID()
  clientId?: string;

  @IsOptional()
  @IsUUID()
  contactId?: string;

  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;

  @IsOptional()
  @IsEnum(TicketSource)
  source?: TicketSource;

  @IsOptional()
  @IsUUID()
  statusDefinitionId?: string;

  @IsOptional()
  @IsArray()
  @IsUUID("4", { each: true })
  assignedUserIds?: string[];

  @IsOptional()
  @IsUUID()
  assignedTeamId?: string;
}
