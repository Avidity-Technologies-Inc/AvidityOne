import { IsString, MaxLength } from "class-validator";
import { QcVersionDto } from "./qc.dto";
export class QcBillingReleaseDto extends QcVersionDto { @IsString() @MaxLength(1000) reason!: string; }
