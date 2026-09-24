import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsDateString,
  ValidateIf,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested
} from "class-validator";

export class TicketViewStateDto {
  @IsOptional()
  @ValidateIf((state) => state.updatedBefore !== "")
  @IsDateString()
  updatedBefore?: string;

  @IsOptional()
  @IsBoolean()
  highPriority?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  version?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  search?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  clientId?: string;

  @IsOptional()
  @IsIn(["all", "assigned_to_me", "my_teams", "unassigned"])
  scope?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  assignedUserId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  assignedTeamId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  externalSpecialistId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(320)
  requester?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  statuses?: string[];

  @IsOptional()
  @IsIn(["", "LOW", "NORMAL", "HIGH", "URGENT", "CRITICAL"])
  priority?: string;

  @IsOptional()
  @IsIn(["", "MANUAL", "EMAIL", "PORTAL", "API", "SYSTEM"])
  source?: string;

  @IsOptional()
  @IsIn(["ticketNumber", "subject", "client", "status", "priority", "source", "createdAt", "updatedAt"])
  sortBy?: string;

  @IsOptional()
  @IsIn(["asc", "desc"])
  sortDirection?: string;

  @IsOptional()
  @IsIn(["20", "50", "100", "all"])
  pageSize?: string;

  @IsOptional()
  @IsIn(["compact", "comfortable"])
  density?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  columnOrder?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  visibleColumns?: string[];

  @IsOptional()
  @IsObject()
  columnWidths?: Record<string, number>;

  @IsOptional()
  @IsBoolean()
  trashMode?: boolean;
}

export class UpsertTicketViewDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name: string;

  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => TicketViewStateDto)
  state: TicketViewStateDto;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
