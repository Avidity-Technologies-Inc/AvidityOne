import { SpamBlockType, SpamRuleAction, SpamRuleScope } from "@prisma/client";
import { IsEnum, IsOptional, IsString, MaxLength } from "class-validator";

export class CreateSpamBlockEntryDto {
  @IsEnum(SpamBlockType)
  type!: SpamBlockType;

  @IsOptional()
  @IsEnum(SpamRuleAction)
  action?: SpamRuleAction;

  @IsOptional()
  @IsEnum(SpamRuleScope)
  scope?: SpamRuleScope;

  @IsString()
  @MaxLength(255)
  value!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
