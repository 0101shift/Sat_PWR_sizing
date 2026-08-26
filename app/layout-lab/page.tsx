import type { Metadata } from "next";
import DashboardLayoutLab from "./DashboardLayoutLab";

export const metadata: Metadata = {
  title: "Dashboard Layout Lab — Orbit·PWR",
  description: "Isolated local prototype for the full-screen Orbit·PWR engineering cockpit layout.",
};

export default function DashboardLayoutLabPage() {
  return <DashboardLayoutLab />;
}
