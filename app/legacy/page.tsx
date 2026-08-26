import type { Metadata } from "next";
import SolarSizingDashboard from "../SolarSizingDashboard";

export const metadata: Metadata = {
  title: "Orbit·PWR — Archived Dashboard Layout",
  description: "Archived local layout of the Orbit·PWR satellite solar-array sizing dashboard.",
};

export default function LegacyDashboardPage() {
  return <SolarSizingDashboard layoutVariant="legacy" />;
}
