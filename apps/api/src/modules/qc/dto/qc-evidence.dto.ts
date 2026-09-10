import { IsDateString, IsString, IsUUID, MaxLength } from "class-validator";
import { QcVersionDto } from "./qc.dto";
export class QcRmmLinkDto extends QcVersionDto {
  @IsUUID() deviceId!: string;
  @IsString() @MaxLength(200) alertReference!: string;
  @IsDateString() triggeredAt!: string;
  @IsString() @MaxLength(1000) reason!: string;
}
export class QcHoldDto {
  @IsDateString() until!: string;
  @IsString() @MaxLength(1000) reason!: string;
}
export class QcResumeDto { @IsUUID() holdId!: string; @IsString() @MaxLength(1000) reason!: string; }
