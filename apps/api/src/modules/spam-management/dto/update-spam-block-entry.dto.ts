import { SpamRuleAction, SpamRuleScope } from "@prisma/client";
import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength } from "class-validator";

export class UpdateSpamBlockEntryDto {
  @IsOptional()
  @IsEnum(SpamRuleAction)
  action?: SpamRuleAction;

  @IsOptional()
  @IsEnum(SpamRuleScope)
  scope?: SpamRuleScope;
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
