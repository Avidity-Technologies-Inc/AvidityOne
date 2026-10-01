import { AppShell } from "@/components/layout/AppShell";
import { KnowledgeBaseWorkspace } from "@/components/knowledge-base/KnowledgeBaseWorkspace";
import { Suspense } from "react";

interface KnowledgeArticlePageProps {
  params: Promise<{ articleId: string }>;
}

export default async function KnowledgeArticlePage({ params }: KnowledgeArticlePageProps) {
  const { articleId } = await params;

  return (
    <AppShell>
      <Suspense fallback={<section className="panel">Loading article...</section>}>
        <KnowledgeBaseWorkspace articleId={articleId} />
      </Suspense>
    </AppShell>
  );
}
