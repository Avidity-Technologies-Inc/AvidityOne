import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { QcWorkspace } from "@/components/qc/QcWorkspace";
import "@/components/qc/qc.css";
export default async function QcPage({ params, searchParams }: { params: Promise<{ section?: string[] }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { section = [] } = await params;
  if (section.length > 2 || section.length === 2 && section[0] !== "reviews" || section[0] && !["overview", "reviews", "actions", "creative", "scorecards", "clients", "deliveries", "work", "settings"].includes(section[0])) notFound();
  const query = await searchParams;
  const filters = Object.fromEntries(["clientId", "projectId", "ticketId", "scope"].filter(key => typeof query[key] === "string").map(key => [key, query[key] as string]));
  return <AppShell><QcWorkspace initialFilters={filters} section={section} /></AppShell>;
}
