import type { Metadata } from "next";
import SatelliteInventory from "./SatelliteInventory";

export const metadata: Metadata = {
  title: "Satellite Inventory — Orbit·PWR",
  description: "Local inventory of configurable spacecraft for Orbit·PWR.",
};

export default function SatelliteInventoryPage() {
  return <SatelliteInventory />;
}
