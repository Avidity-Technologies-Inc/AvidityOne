import { AppShell } from "@/components/layout/AppShell";
import { KnowledgeBaseWorkspace } from "@/components/knowledge-base/KnowledgeBaseWorkspace";
import { Suspense } from "react";

export default function KnowledgeBasePage() {
  return (
    <AppShell>
      <Suspense fallback={<section className="panel">Loading Knowledge Base...</section>}>
        <KnowledgeBaseWorkspace />
      </Suspense>
    </AppShell>
  );
}
