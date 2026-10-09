import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

export class UpdateRmmSettingsDto {
  @IsOptional()
  @IsBoolean()
  identityAutoLink?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  identityInactiveDays?: number;

  @IsBoolean()
  enabled!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  providerName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  apiBaseUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  apiKeyReference?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  agentsPath?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  dashboardUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  deviceUrlTemplate?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  controlUrlTemplate?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  backgroundUrlTemplate?: string | null;

  @IsOptional()
  @IsBoolean()
  autoSyncEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(1440)
  autoSyncIntervalMinutes?: number | null;
}
