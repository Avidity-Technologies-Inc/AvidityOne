import { IsBoolean, IsInt, IsOptional, Max, Min } from "class-validator";
export class UpdateTicketEmailPolicyDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsBoolean() repliesEnabled?: boolean;
  @IsOptional() @IsBoolean() closeEnabled?: boolean;
  @IsOptional() @IsBoolean() includeHistory?: boolean;
  @IsOptional() @IsBoolean() includeAttachments?: boolean;
  @IsOptional() @IsBoolean() includeInternal?: boolean;
  @IsOptional() @IsBoolean() includeTeams?: boolean;
  @IsOptional() @IsBoolean() includeGroups?: boolean;
  @IsOptional() @IsBoolean() includeWatchers?: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(2) attachmentBudgetMb?: number;
  @IsOptional() @IsInt() @Min(5) @Max(60) confirmationMinutes?: number;
}
