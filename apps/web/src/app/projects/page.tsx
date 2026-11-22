import type { Metadata } from "next";
import { ProjectsBoard } from "@/components/projects-board";

export const metadata: Metadata = { title: "Projects · Skippy OS" };

export default function Page() {
  return <ProjectsBoard />;
}
