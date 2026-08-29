"use client";

import { useState } from "react";
import styles from "./layout-lab.module.css";

type StageView = "ORBIT" | "POWER";
type Theme = "TEAL" | "BLUE" | "AMBER";
type Part = { id: number; name: string; type: string; shape: string; axis: string; color: string };

const STARTER_PARTS: Part[] = [
  { id: 1, name: "EO Camera", type: "Payload", shape: "Cylinder", axis: "−Z", color: "#54c7df" },
  { id: 2, name: "X-band Dish", type: "Radio", shape: "Dish", axis: "+X", color: "#8db9cc" },
  { id: 3, name: "Deployable Array", type: "Solar panel", shape: "Panel", axis: "+Y", color: "#3276a8" },
  { id: 4, name: "Thruster Quad", type: "Propulsion", shape: "Cone", axis: "−X", color: "#d69a63" },
  { id: 5, name: "Avionics Bus", type: "Structure", shape: "Box", axis: "+Z", color: "#789097" },
];

const THEMES: Theme[] = ["TEAL", "BLUE", "AMBER"];

export default function DashboardLayoutLab() {
  const [stageView, setStageView] = useState<StageView>("ORBIT");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [theme, setTheme] = useState<Theme>("TEAL");
  const [parts, setParts] = useState<Part[]>(STARTER_PARTS);
  const [partFormOpen, setPartFormOpen] = useState(false);
  const [partName, setPartName] = useState("Custom sensor");
  const [partType, setPartType] = useState("Payload");
  const [partShape, setPartShape] = useState("Box");
  const nextTheme = () => setTheme((current) => THEMES[(THEMES.indexOf(current) + 1) % THEMES.length]);
  const addPart = () => {
    const name = partName.trim();
    if (!name) return;
    setParts((current) => [...current, {
      id: Math.max(0, ...current.map((part) => part.id)) + 1,
      name,
      type: partType,
      shape: partShape,
      axis: "+Z",
      color: "#7be0cf",
    }]);
    setPartName("Custom sensor");
    setPartFormOpen(false);
  };

  return (
    <main className={styles.lab} data-theme={theme.toLowerCase()} data-sidebar={sidebarCollapsed ? "collapsed" : "open"}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <i aria-hidden="true"><span /></i>
          <div><b>ORBIT·PWR</b><small>LAYOUT LAB · ISOLATED PROTOTYPE</small></div>
        </div>
        <nav className={styles.primaryTabs} aria-label="Prototype mode">
          <button className={styles.active}>Mission simulation</button>
          <button>Satellite configuration</button>
        </nav>
        <div className={styles.topActions}>
          <button onClick={nextTheme}>Theme · {theme}</button>
          <button className={styles.primaryAction}>Approve layout</button>
        </div>
      </header>

      <div className={styles.cockpit}>
        <aside className={styles.sidebar} aria-label="Scrollable mission configuration">
          <div className={styles.collapsedNav} aria-hidden={!sidebarCollapsed}>
            <b>M</b><b>D</b><b>S</b><b>P</b><b>R</b>
          </div>
          <div className={styles.sidebarContent}>
            <section className={styles.sideIntro}>
              <span>MISSION WORKSPACE</span>
              <h1>Solar-array sizing</h1>
              <p>Only this setup rail scrolls. The active engineering view remains fixed.</p>
            </section>

            <section className={styles.controlSection}>
              <div className={styles.sectionTitle}><span>01</span><h2>Mission</h2><em>SSO</em></div>
              <div className={styles.segmented}><button>LEO</button><button className={styles.selected}>SSO</button><button>GEO</button></div>
              <div className={styles.fieldGrid}>
                <div className={styles.displayField}><span>Altitude</span><div><b>550</b><em>km</em></div></div>
                <div className={styles.displayField}><span>Inclination</span><div><b>97.6</b><em>deg</em></div></div>
                <div className={styles.displayField}><span>LTAN</span><div><b>10.5</b><em>hr</em></div></div>
                <div className={styles.displayField}><span>Duration</span><div><b>2</b><em>days</em></div></div>
              </div>
              <div className={styles.fullField}><span>Mission epoch</span><div><b>01-01-2028 05:30:00</b></div></div>
            </section>

            <section className={styles.controlSection}>
              <div className={styles.sectionTitle}><span>02</span><h2>DIL replay</h2><em>LIVE</em></div>
              <div className={styles.fileCard}>
                <span>Orbit_Power_+Y.csv</span><b>8,651 rows · 24h 00m</b><small>Precise source timestamps · irregular cadence retained</small>
              </div>
              <div className={styles.warningCard}><i />1 duplicate event boundary retained at 05:47:10.000</div>
              <button className={styles.outlineButton}>Replace DIL file</button>
            </section>

            <section className={styles.controlSection}>
              <div className={styles.sectionTitle}><span>03</span><h2>Spacecraft parts</h2><em>{parts.length}</em></div>
              <p className={styles.sectionNote}>Visual building blocks only—mass, power and thermal specifications are intentionally omitted.</p>
              <div className={styles.partList}>
                {parts.map((part) => (
                  <button className={styles.partCard} key={part.id}>
                    <i style={{ background: part.color }} aria-hidden="true" />
                    <span><b>{part.name}</b><small>{part.type} · {part.shape}</small></span>
                    <em>{part.axis}</em>
                  </button>
                ))}
              </div>
              {partFormOpen ? (
                <div className={styles.partForm}>
                  <label><span>Part name</span><input value={partName} onChange={(event) => setPartName(event.target.value)} /></label>
                  <div>
                    <label><span>Type</span><select value={partType} onChange={(event) => setPartType(event.target.value)}><option>Payload</option><option>Radio</option><option>Solar panel</option><option>Propulsion</option><option>Structure</option></select></label>
                    <label><span>Shape</span><select value={partShape} onChange={(event) => setPartShape(event.target.value)}><option>Box</option><option>Cylinder</option><option>Dish</option><option>Panel</option><option>Cone</option></select></label>
                  </div>
                  <div className={styles.formActions}><button onClick={() => setPartFormOpen(false)}>Cancel</button><button onClick={addPart}>Add to library</button></div>
                </div>
              ) : <button className={styles.addPartButton} onClick={() => setPartFormOpen(true)}>＋ Add custom part</button>}
            </section>

            <section className={styles.controlSection}>
              <div className={styles.sectionTitle}><span>04</span><h2>Solar and battery</h2><em>EOL</em></div>
              <div className={styles.readoutList}>
                <div><span>Cell model</span><b>AZUR 3G30 4×8</b></div>
                <div><span>String configuration</span><b>19S × 24P</b></div>
                <div><span>Operating temperature</span><b>60 °C</b></div>
                <div><span>Battery capacity</span><b>1,000 Wh</b></div>
              </div>
            </section>

            <section className={styles.controlSection}>
              <div className={styles.sectionTitle}><span>05</span><h2>Compact results</h2><em>+18%</em></div>
              <div className={styles.metricGrid}><div><small>POWER NOW</small><b>542 W</b></div><div><small>ENERGY</small><b>12.8 kWh</b></div><div><small>MIN SOC</small><b>43%</b></div><div><small>INCIDENCE</small><b>4.2°</b></div></div>
            </section>
          </div>
        </aside>

        <button className={styles.collapseButton} onClick={() => setSidebarCollapsed((value) => !value)} aria-label={sidebarCollapsed ? "Expand setup rail" : "Collapse setup rail"}>{sidebarCollapsed ? "›" : "‹"}</button>

        <section className={styles.stage} aria-label="Fixed engineering view">
          <header className={styles.stageHeader}>
            <div><span>FIXED ENGINEERING STAGE</span><h2>{stageView === "ORBIT" ? "Sun–array geometry" : "Power & operations"}</h2></div>
            <nav aria-label="Engineering view">
              {(["ORBIT", "POWER"] as StageView[]).map((view) => <button key={view} className={stageView === view ? styles.activeStageTab : ""} onClick={() => setStageView(view)}>{view === "POWER" ? "Power + operations" : "Orbit"}</button>)}
            </nav>
            <div className={styles.stageStatus}><i /><span>Sunlight</span><b>100%</b></div>
          </header>

          {stageView === "ORBIT" && <OrbitStage />}
          {stageView === "POWER" && <PowerStage />}
        </section>
      </div>
    </main>
  );
}

function OrbitStage() {
  return (
    <div className={styles.orbitView}>
      <div className={styles.starfield} />
      <div className={styles.sun}><i /></div>
      <div className={styles.earth}><i /></div>
      <div className={styles.orbitRing} />
      <div className={styles.satellite} aria-label="Dummy EO spacecraft">
        <div className={styles.panelLeft}><i /><i /><i /></div>
        <div className={styles.bus}><i /><span /></div>
        <div className={styles.panelRight}><i /><i /><i /></div>
        <div className={styles.velocityVector}><span>+V</span></div>
        <div className={styles.panelVector}><span>CELL +N</span></div>
      </div>
      <div className={styles.cameraTools}><button>−</button><b>2.4×</b><button>＋</button><button>Reset view</button><button>Pan</button><button className={styles.toolActive}>Orbit follow</button><button>3D rotate</button></div>
      <div className={styles.liveStrip}><span><i /> SUNLIGHT 100%</span><span>β −6.3°</span><span>PANEL +Y · θ 4.2°</span><span>SUN / SHADOW LOCKED</span><b>IMAGING_TIR</b></div>
      <div className={styles.timeline}><button>Ⅱ</button><button>10×</button><div><i style={{ width: "46%" }} /><span style={{ left: "46%" }} /></div><time>01-01-2028 12:18:40.000</time></div>
      <div className={styles.orbitLegend}><span><i />Sunlight</span><span><i />Penumbra</span><span><i />Umbra</span><small>Earth: NASA Blue Marble</small></div>
    </div>
  );
}

function PowerStage() {
  const bars = [42, 56, 72, 88, 94, 78, 52, 0, 0, 18, 64, 91, 86, 58, 34, 0, 12, 46, 77, 96, 81, 60, 28, 0, 8, 49, 79, 90, 68, 40, 12, 0, 32, 69, 93, 84, 58, 23];
  const axisSweep = [
    ["−X", 142, 71], ["−Y", 0, 0], ["−Z", 201, 100],
    ["+X", 142, 71], ["+Y", 167, 83], ["+Z", 19, 9],
  ] as const;
  const designMetrics = [
    ["Effective RAAN", "124.65°"], ["Perigee / apogee", "550 / 550 km"], ["J2 RAAN drift", "0.987°/day"],
    ["Beta range", "−23.5° to −21.6°"], ["Energy margin", "+2.1 kWh"], ["Peak array power", "612 W"],
    ["Total generated energy", "12.8 kWh"], ["BOL array rating", "680 W"], ["EOL array rating", "612 W"],
    ["Cell / packaged area", "1.38 / 1.53 m²"], ["Cell efficiency", "29.2%"], ["Radiation retention", "92.9%"],
    ["Temperature / electrical", "97.4 / 88.0%"], ["Optical retention", "100.0%"], ["Analysis span", "2.0 d / 30.1 orbits"],
  ] as const;
  const rows = [
    ["SUNLIT", "09:18:20", "71.4%", "4.8°", "4.21 kWh"],
    ["ECLIPSE", "08:42:10", "0.0%", "90.0°", "0.00 kWh"],
    ["IMAGING_TIR", "02:18:40", "92.0%", "18.7°", "0.94 kWh"],
    ["GSPOINTING_Svalbard", "01:44:10", "84.5%", "24.1°", "0.61 kWh"],
    ["TRANSITION", "01:12:30", "66.8%", "42.6°", "0.29 kWh"],
    ["PROPULSION_TRIM", "00:44:10", "51.2%", "58.4°", "0.12 kWh"],
    ["PAYLOAD_CAL", "00:31:20", "88.1%", "29.3°", "0.17 kWh"],
    ["SAFE_HOLD", "00:18:50", "43.0%", "61.8°", "0.04 kWh"],
  ];
  return (
    <div className={styles.analysisStage}>
      <section className={styles.powerPane} aria-labelledby="power-pane-title">
        <header className={styles.paneTitle}><div><span>POWER PROFILE</span><h3 id="power-pane-title">Generation, design sweep & sizing results</h3></div><em>DUMMY DATA</em></header>
        <div className={styles.dataHeading}><div><span>DIL MODELED POWER</span><b>542 W</b><small>Corrected EOL MPP · payload constrained</small></div><div><span>AVERAGE</span><b>368 W</b><small>+18% above average load</small></div><div><span>GENERATED ENERGY</span><b>12.8 kWh</b><small>24-hour replay</small></div></div>
        <div className={styles.powerWorkspace}>
          <div className={styles.chartPanel}>
            <div className={styles.powerChart}><div className={styles.chartGrid} />{bars.map((height, index) => <i key={index} style={{ height: `${height}%` }} className={height === 0 ? styles.eclipseBar : ""} />)}<strong>Power / W</strong><small>Elapsed mission time →</small></div>
            <div className={styles.dataFooter}><span><i className={styles.modeledDot} />Modeled EOL</span><span><i className={styles.measuredDot} />DIL measured</span><span><i className={styles.ceilingDot} />Perfect-pointing ceiling</span></div>
          </div>
          <aside className={styles.designSweep} aria-label="Sun-facing cell-normal design sweep">
            <header><div><span>DESIGN SWEEP</span><h4>Sun-facing cell normal</h4></div><b>BEST · −Z</b></header>
            <div className={styles.sweepRows}>{axisSweep.map(([axis, energy, score]) => <div key={axis}><strong>{axis}</strong><i><span style={{ width: `${score}%` }} /></i><b>{energy} Wh</b></div>)}</div>
            <p><b>−Z</b> produces the highest modeled energy for this mission and attitude profile.</p>
          </aside>
        </div>
        <div className={styles.designMetrics}>{designMetrics.map(([label, value]) => <div key={label}><small>{label}</small><b>{value}</b></div>)}</div>
      </section>

      <section className={styles.operationsPane} aria-labelledby="operations-pane-title">
        <header className={styles.paneTitle}><div><span>DIL OPERATIONS</span><h3 id="operations-pane-title">Operation energy breakdown</h3></div><em>VERTICAL SPLIT</em></header>
        <div className={styles.operationBody}>
          <div className={styles.operationSummary}><div><small>OPERATION STATES</small><b>18</b></div><div><small>TRANSITIONS</small><b>31</b></div><div><small>IMAGING WINDOWS</small><b>7</b></div><div><small>DOWNLINK WINDOWS</small><b>5</b></div></div>
          <div className={styles.operationTable} role="region" aria-label="Scrollable operation-energy table"><div className={styles.tableHeader}><span>Operation</span><span>Duration</span><span>Sunlit</span><span>Average θ</span><span>Energy</span></div>{rows.map((row) => <div key={row[0]}>{row.map((cell, index) => <span key={`${row[0]}-${index}`} className={index === 0 ? styles.operationName : ""}>{cell}</span>)}</div>)}</div>
        </div>
        <div className={styles.operationTimeline}>{rows.map((row, index) => <i key={row[0]} style={{ flex: index === 0 ? 5 : index === 1 ? 4 : 1, opacity: 1 - index * 0.1 }} title={row[0]} />)}</div>
      </section>
    </div>
  );
}
