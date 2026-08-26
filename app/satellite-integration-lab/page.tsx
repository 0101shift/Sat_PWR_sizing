import type { Metadata } from "next";
import SatelliteIntegrationLab from "./SatelliteIntegrationLab";

export const metadata: Metadata = {
  title: "Satellite Axis Integration Lab — Orbit·PWR",
  description: "Local experimental validation of inventory spacecraft body-axis alignment in an LVLH orbit scene.",
};

export default function SatelliteIntegrationLabPage() {
  return <SatelliteIntegrationLab />;
}
