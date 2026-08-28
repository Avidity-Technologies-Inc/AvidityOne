import { BlockedInboundEmailStatus } from "@prisma/client";
import { IsEnum, IsOptional, IsString, MaxLength } from "class-validator";

export class SpamQuarantineQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsEnum(BlockedInboundEmailStatus)
  status?: BlockedInboundEmailStatus;

  @IsOptional()
  @IsString()
  @MaxLength(5)
  page?: string;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  pageSize?: string;
}
