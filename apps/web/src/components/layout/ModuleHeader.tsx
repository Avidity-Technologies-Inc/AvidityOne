"use client";

import { dashboardNavigation } from "@avidity/ui";
import { usePathname } from "next/navigation";
import { createContext, Dispatch, ReactNode, SetStateAction, useContext, useEffect, useState } from "react";

type Section = { pathname: string; label: string } | null;
const SectionContext = createContext<Section>(null);
const SectionSetter = createContext<Dispatch<SetStateAction<Section>> | null>(null);

export function ModuleHeaderProvider({ children }: { children: ReactNode }) {
  const [section, setSection] = useState<Section>(null);
  return <SectionSetter.Provider value={setSection}><SectionContext.Provider value={section}>{children}</SectionContext.Provider></SectionSetter.Provider>;
}

// Stateful workspaces publish their existing section label instead of duplicating configuration here.
export function ModuleSection({ label }: { label: string }) {
  const pathname = usePathname();
  const setSection = useContext(SectionSetter);
  useEffect(() => {
    setSection?.({ pathname, label });
    return () => setSection?.(null);
  }, [label, pathname, setSection]);
  return null;
}

const subroutes: Record<string, string> = {
  "/projects": "Projects",
  "/projects/new": "Projects / New project",
  "/event-services/calendar": "Calendar",
  "/event-services/external-specialists": "External Specialists"
};

export function ModuleHeader() {
  const pathname = usePathname();
  const section = useContext(SectionContext);
  const navigation = dashboardNavigation.find(item => pathname === item.href || pathname.startsWith(`${item.href}/`));
  const moduleTitle = pathname === "/projects" || pathname.startsWith("/projects/") ? "Operations" : navigation?.label ?? "Workspace";
  const sectionTitle = section?.pathname === pathname ? section.label : subroutes[pathname];
  // Record views retain their own meaningful H1 (ticket number, device name or event reference).
  const isRecord = /^\/(tickets|devices)\/[^/]+$/.test(pathname) || (/^\/event-services\/[^/]+$/.test(pathname) && !subroutes[pathname]);
  const Heading = isRecord ? "p" : "h1";
  return <div className="module-header">
    <Heading className="module-title">{moduleTitle}</Heading>
    {sectionTitle && sectionTitle !== moduleTitle ? <span className="module-section" title={sectionTitle}>{sectionTitle}</span> : null}
  </div>;
}
