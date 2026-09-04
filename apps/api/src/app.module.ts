import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { ThrottlerModule } from "@nestjs/throttler";
import { AuditLogsModule } from "./modules/audit-logs/audit-logs.module";
import { AiAssistantModule } from "./modules/ai-assistant/ai-assistant.module";
import { AuthModule } from "./modules/auth/auth.module";
import { AutoRepliesModule } from "./modules/auto-replies/auto-replies.module";
import { ClientDomainsModule } from "./modules/client-domains/client-domains.module";
import { ClientsModule } from "./modules/clients/clients.module";
import { ContactsModule } from "./modules/contacts/contacts.module";
import { DashboardModule } from "./modules/dashboard/dashboard.module";
import { DevicesModule } from "./modules/devices/devices.module";
import { EventServicesModule } from "./modules/event-services/event-services.module";
import { ExternalSpecialistsModule } from "./modules/external-specialists/external-specialists.module";
import { FileStorageModule } from "./modules/file-storage/file-storage.module";
import { GroupsModule } from "./modules/groups/groups.module";
import { HealthModule } from "./modules/health/health.module";
import { KnowledgeBaseModule } from "./modules/knowledge-base/knowledge-base.module";
import { MaintenanceModule } from "./modules/maintenance/maintenance.module";
import { MailboxesModule } from "./modules/mailboxes/mailboxes.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { OperationsModule } from "./modules/operations/operations.module";
import { PermissionsModule } from "./modules/permissions/permissions.module";
import { ProfileModule } from "./modules/profile/profile.module";
import { ProjectsModule } from "./modules/projects/projects.module";
import { PrismaModule } from "./modules/prisma/prisma.module";
import { RemoteAccessModule } from "./modules/remote-access/remote-access.module";
import { ReportsModule } from "./modules/reports/reports.module";
import { RolesModule } from "./modules/roles/roles.module";
import { SignaturesModule } from "./modules/signatures/signatures.module";
import { SpamManagementModule } from "./modules/spam-management/spam-management.module";
import { SystemSettingsModule } from "./modules/system-settings/system-settings.module";
import { SystemHealthModule } from "./modules/system-health/system-health.module";
import { TicketAttachmentsModule } from "./modules/ticket-attachments/ticket-attachments.module";
import { TicketTeamsModule } from "./modules/ticket-teams/ticket-teams.module";
import { TicketMessagesModule } from "./modules/ticket-messages/ticket-messages.module";
import { TicketMeetingsModule } from "./modules/ticket-meetings/ticket-meetings.module";
import { TicketRoutingModule } from "./modules/ticket-routing/ticket-routing.module";
import { TicketWorkflowModule } from "./modules/ticket-workflow/ticket-workflow.module";
import { TicketsModule } from "./modules/tickets/tickets.module";
import { UsersModule } from "./modules/users/users.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: [".env", "../../.env"] }),
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 30
      }
    ]),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const redisUrl = new URL(config.get<string>("REDIS_URL") ?? "redis://localhost:6379");
        return {
          connection: {
            host: redisUrl.hostname,
            port: Number(redisUrl.port || 6379),
            password: redisUrl.password || undefined
          }
        };
      }
    }),
    PrismaModule,
    AuditLogsModule,
    HealthModule,
    SystemHealthModule,
    SystemSettingsModule,
    AuthModule,
    UsersModule,
    GroupsModule,
    RolesModule,
    PermissionsModule,
    ProfileModule,
    ProjectsModule,
    ClientsModule,
    ClientDomainsModule,
    ContactsModule,
    DashboardModule,
    OperationsModule,
    TicketsModule,
    TicketMessagesModule,
    TicketMeetingsModule,
    TicketTeamsModule,
    TicketRoutingModule,
    TicketWorkflowModule,
    TicketAttachmentsModule,
    FileStorageModule,
    MaintenanceModule,
    MailboxesModule,
    AutoRepliesModule,
    SignaturesModule,
    SpamManagementModule,
    AiAssistantModule,
    KnowledgeBaseModule,
    ReportsModule,
    DevicesModule,
    EventServicesModule,
    ExternalSpecialistsModule,
    RemoteAccessModule,
    NotificationsModule
  ]
})
export class AppModule {}
