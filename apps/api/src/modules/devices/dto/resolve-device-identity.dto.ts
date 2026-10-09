import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from "class-validator";

export class ResolveDeviceIdentityDto {
  @IsIn(["separate", "historical", "current"])
  action!: "separate" | "historical" | "current";

  @IsOptional()
  @IsUUID()
  deviceId?: string;

  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  reason!: string;
}
