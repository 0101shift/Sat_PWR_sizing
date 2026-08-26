import type { Metadata } from "next";
import SatelliteInventory from "./SatelliteInventory";

export const metadata: Metadata = {
  title: "EO Satellite Inventory — Orbit·PWR",
  description: "Local trial inventory of configurable Earth-observation spacecraft for Orbit·PWR.",
};

export default function SatelliteInventoryPage() {
  return <SatelliteInventory />;
}
