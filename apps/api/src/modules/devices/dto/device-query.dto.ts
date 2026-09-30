import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

export class DeviceQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(256)
  search?: string;

  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  site?: string;

  @IsOptional()
  @IsIn(["true", "false"])
  favoritesOnly?: string;

  @IsOptional()
  @IsIn(["true", "false"])
  favoritesFirst?: string;

  @IsOptional()
  @IsIn(["all", "servers", "workstations"])
  deviceTab?: "all" | "servers" | "workstations";

  @IsOptional()
  @IsIn(["name", "client", "site", "os", "status"])
  sortBy?: "name" | "client" | "site" | "os" | "status";

  @IsOptional()
  @IsIn(["asc", "desc"])
  sortDirection?: "asc" | "desc";

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000000)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn([25, 50, 100])
  pageSize?: number;
}
