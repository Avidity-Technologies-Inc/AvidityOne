import { SpamReleaseAction } from "@prisma/client";
import { IsEnum } from "class-validator";

export class ReleaseQuarantinedEmailDto {
  @IsEnum(SpamReleaseAction)
  action!: SpamReleaseAction;
}
