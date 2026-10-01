import { AppShell } from "@/components/layout/AppShell";
import { ProjectsWorkspace } from "@/components/projects/ProjectsWorkspace";
import { Suspense } from "react";

export default function ProjectsPage() {
  return (
    <AppShell>
      <Suspense fallback={null}><ProjectsWorkspace /></Suspense>
    </AppShell>
  );
}
