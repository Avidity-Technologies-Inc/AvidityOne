import { IsArray, IsBoolean, IsEmail, IsIn, IsOptional, IsString, IsUUID, MinLength } from "class-validator";

export class CreateTicketMessageDto {
  @IsIn(["public", "internal"])
  visibility: "public" | "internal";

  @IsString()
  @MinLength(1)
  bodyText: string;

  @IsOptional()
  @IsString()
  bodyHtml?: string;

  @IsOptional()
  @IsArray()
  @IsUUID("4", { each: true })
  attachmentIds?: string[];

  @IsOptional()
  @IsBoolean()
  includeSignature?: boolean;

  @IsOptional()
  @IsArray()
  @IsUUID("4", { each: true })
  notifyUserIds?: string[];

  @IsOptional()
  @IsArray()
  @IsEmail({}, { each: true })
  ccEmails?: string[];

  @IsOptional()
  @IsArray()
  @IsUUID("4", { each: true })
  ccUserIds?: string[];

  @IsOptional()
  @IsArray()
  @IsUUID("4", { each: true })
  followUserIds?: string[];

  @IsOptional()
  @IsBoolean()
  persistCc?: boolean;

  @IsOptional()
  @IsBoolean()
  includePersistentCc?: boolean;

  @IsOptional()
  @IsIn(["send", "send_and_close", "save_note", "send_note", "send_note_and_close"])
  action?: "send" | "send_and_close" | "save_note" | "send_note" | "send_note_and_close";
}
