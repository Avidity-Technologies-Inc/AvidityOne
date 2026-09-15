import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsEnum, IsISO8601, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateNested } from "class-validator";
import { MeetingAttendeeSource, MeetingAttendeeType, TicketActivityType, TicketActivityMode } from "@prisma/client";

export class TicketMeetingAttendeeDto {
  @IsEmail()
  @MaxLength(320)
  email: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  displayName?: string | null;

  @IsOptional()
  @IsEnum(MeetingAttendeeType)
  type?: MeetingAttendeeType;

  @IsOptional()
  @IsEnum(MeetingAttendeeSource)
  source?: MeetingAttendeeSource;
}

export class CreateTicketMeetingDto {
  @IsOptional()
  @IsUUID()
  organizerUserId?: string | null;

  @IsString()
  @MinLength(1)
  @MaxLength(240)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  agenda?: string | null;

  @IsISO8601()
  startAt: string;

  @IsISO8601()
  endAt: string;

  @IsString()
  @MaxLength(80)
  timeZone: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  location?: string | null;

  @IsOptional()
  @IsEnum(TicketActivityType)
  activityType?: TicketActivityType;

  @IsOptional()
  @IsEnum(TicketActivityMode)
  modality?: TicketActivityMode;

  @IsOptional()
  @IsBoolean()
  isOnlineMeeting?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => TicketMeetingAttendeeDto)
  attendees?: TicketMeetingAttendeeDto[];
}

export class UpdateTicketMeetingDto {
  @IsOptional()
  @IsUUID()
  organizerUserId?: string | null;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  agenda?: string | null;

  @IsOptional()
  @IsISO8601()
  startAt?: string;

  @IsOptional()
  @IsISO8601()
  endAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  timeZone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  location?: string | null;

  @IsOptional()
  @IsEnum(TicketActivityType)
  activityType?: TicketActivityType;

  @IsOptional()
  @IsEnum(TicketActivityMode)
  modality?: TicketActivityMode;

  @IsOptional()
  @IsBoolean()
  isOnlineMeeting?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => TicketMeetingAttendeeDto)
  attendees?: TicketMeetingAttendeeDto[];
}

export class CancelTicketMeetingDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string | null;
}
