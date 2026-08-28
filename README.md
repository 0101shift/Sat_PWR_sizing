# ORBIT·PWR

Local preliminary satellite solar-array sizing and telemetry replay dashboard.

**Current baseline:** Revision 0 (`0.0.0`)

## Run locally

On Windows, double-click `Start_Orbit_PWR_Dashboard.bat`. On first launch it automatically downloads the dashboard packages, reconciles the npm lockfile when an older shared copy contains a stale one, then starts the live local development server on port 3000 and opens the dashboard. An internet connection is required only for this first-time package installation. If the dashboard is already running on port 3000, the launcher opens the existing instance instead of starting a second copy.

The launcher still requires a complete Node.js 22.13-or-newer installation, including npm. Project packages under `node_modules` no longer need to be installed manually.

Run only one launcher window at a time. Development mode is used intentionally so edits can update safely without invalidating the interactive 3D viewer's JavaScript files.

For development with Node.js 22.13 or newer:

```bash
npm install
npm run dev
```

### EO satellite inventory prototype

Open `http://localhost:3000/satellite-inventory` after starting the local dashboard. The same satellite inventory and custom-build workspace are also available through the dashboard's Satellite Configuration tab.

The initial library contains three representative, non-flight-qualified EO concepts: **EO Scout 12U**, **EO Meridian 150**, and **EO Atlas 600**. Each includes editable geometry, mass, body-frame assignments, solar-array rigging, orbit defaults, cell/string configuration, load, and battery data. The procedural 3D preview supports unrestricted rotation, zoom, pan, fit/reset, body-axis display, and array deployment playback. Drafts can be duplicated, stored in browser-local storage, imported from JSON, and exported as inventory-schema v1 JSON.

STEP tessellation and interactive part/axis/joint assignment are reserved for the next inventory phase, after the default data schema and trial models are approved.

### Local satellite integration lab

Open `http://localhost:3000/satellite-integration-lab` to test an inventory spacecraft in an isolated Three.js Earth-orbit scene. The lab uses the simulator's circular-orbit and LVLH frame equations to map the configured signed velocity axis to the orbit tangent and the configured signed nadir axis to Earth center. It reports velocity, nadir, frame-orthogonality, payload-nadir, and panel-Sun angles while the spacecraft moves through the orbit.

The integration lab is deliberately separate from the root sizing simulator. It reads locally saved inventory configurations but does not change the final dashboard's spacecraft renderer, inputs, or calculations.

## Model capabilities

- LEO, SSO, and GEO orbit scenarios with semi-major-axis altitude, eccentricity, argument of perigee, true anomaly at epoch, and a minimum two-day analysis span
- Kepler propagation, secular J2 RAAN/perigee drift, analytical Sun position, Sun–Earth distance correction, and conical umbra/penumbra calculation
- fixed spacecraft-mounted array geometry, signed active-cell face, Euler mounting refinement, and configurable spacecraft attitude
- AZUR 3G30-Advanced and 4G32-Advanced 4×8/HP catalog values, EOL MPP power, string topology, packaging efficiency, constant-temperature Pmp correction, pointing uncertainty, angular response, MPPT/harness efficiency, mismatch/diode/contamination/self-shadowing losses, load, and battery sizing
- NASA Blue Marble Earth texture, Earth-fixed reference grid, scene-locked orbit/camera transforms, arcball 3D rotation, pan/zoom/reset controls, overhead racing-style Satellite Lock with +V toward the top of the view, adjustable visual orbit-radius exaggeration, illumination-coded orbit path, a tapered one-revolution trail, and interactive spacecraft-face selection
- 1×, 5×, 10×, 25×, and 50× playback with propulsion, transition/slew, green imaging beams, and blue geopointing beams
- CSV export and printable report

This is a preliminary design model. The detailed limitations and assumptions are also shown at the bottom of the dashboard.

## DIL actual-data replay

Use **Actual data replay → Upload DIL file**. Files remain in the browser and are not uploaded to a server. CSV, TSV, and JSON are supported. A valid file contains the core fields below; the final two universal panel-reference fields are recommended but may be replaced by a legacy signed-axis field or automatic inference:

```text
TIME
SATELLITE_POSITION
SOLAR_POWER_GENERATED
SPACECRAFT_OPERATION
LATITUDE
LONGITUDE
SUN_BODY
EARTH_BODY
SUNLIT_STATUS
ATTITUDE_RPY
payload_earth
payload_sun
SOLAR_PANEL_AXIS
SUN_PANEL_INCIDENCE
```

Conventions:

- `TIME`: elapsed seconds, ISO-8601, or `DD-MM-YYYY HH:mm[:ss]` using a 24-hour clock, for example `01-01-2028 05:30`. AM/PM timestamps remain supported. For minute-only timestamps, set the optional import interval to the known cadence (for example 10, 20, or 50 seconds); leave it blank to infer sub-minute spacing.
- `SATELLITE_POSITION`: Earth-centred kilometres or metres; metre-scale vectors are converted automatically and used directly for satellite location
- `LATITUDE`, `LONGITUDE`: degrees
- `SUN_BODY`, `EARTH_BODY`: body-frame XYZ vectors
- `ATTITUDE_RPY`: degrees, interpreted as ZYX roll-pitch-yaw body-to-ECI
- `SOLAR_PANEL_AXIS`: signed body normal `+X`, `-X`, `+Y`, `-Y`, `+Z`, or `-Z` represented by the imported power reference
- `SUN_PANEL_INCIDENCE`: Sun-incidence angle in degrees for that reference normal
- `SOLAR_POWER_GENERATED`: either measured watts or a 0–100 generation factor. A factor is detected when it closely follows `100 × max(0, cos(SUN_PANEL_INCIDENCE)) × SUNLIT_STATUS`; it is then converted to equivalent watts using the configured corrected EOL array rating.
- CSV vector cells must be quoted, for example `"[6928.137,0,0]"`

`SOLAR_PANEL_AXIS` and `SUN_PANEL_INCIDENCE` are the recommended universal fields rather than hard-coding +Y. Existing signed legacy columns such as `sun_+Y_panels`, `sun_-X_panels`, and `sun_+Z_panels` remain supported. If no panel-axis field is present and `SOLAR_POWER_GENERATED` is a 0–100 factor, Auto mode compares all six body normals against `SUN_BODY` and selects the best-correlated reference axis. The import control also provides a manual signed-axis override for ambiguous legacy data.

For an explicitly declared reference axis with zero mounting rotation, its imported `SUN_PANEL_INCIDENCE` history is authoritative for that axis. The importer independently compares those angles with the incidence reconstructed from `SUN_BODY` and reports mean error plus the percentage of samples differing by more than 5°. When they conflict, the declared reference axis can still be replayed, but other-axis comparisons based on `SUN_BODY` are flagged as physically inconsistent. A 0–100 `SOLAR_POWER_GENERATED` column is converted as a generation factor only when it correlates with the declared incidence history; otherwise it remains interpreted as watts and a diagnostic warning is shown.

The replay maps `SATELLITE_POSITION` into a fixed Earth-centred scene. The Earth and Sun markers stay locked; only the satellite changes position. `SUN_BODY`, `EARTH_BODY`, and the spacecraft axes use the `ATTITUDE_RPY` transformation. The transformed Sun direction updates illumination, the terminator, and shadow cone without moving the Sun or Earth markers.

DIL power analysis has three deliberately separate results:

- **Modeled power/energy:** the selected and mounted signed body normal (`±X`, `±Y`, or `±Z`) intersected with each row's body-frame `SUN_BODY`, gated by `SUNLIT_STATUS`, then corrected with the configured EOL cell/string, solar-distance, temperature, pointing uncertainty, MPPT/harness, optical, mismatch, diode, self-shadowing, and system losses
- **DIL-derived or measured power/energy:** an axis-independent imported reference associated with the declared, detected, or overridden reference axis. A detected 0–100 `SOLAR_POWER_GENERATED` factor is scaled by the corrected unshadowed EOL array rating; otherwise the imported value is retained directly as measured watts.
- **Perfect-pointing ceiling:** the same EOL and loss model with zero attitude-incidence loss, while retaining the recorded eclipse/penumbra history

Energy is trapezoid-integrated over every original DIL row and its actual timestamp interval before replay display decimation. This handles 10/20/50-second and irregular intervals without treating the reduced graphics samples as the energy record. Battery SOC is derived from the modeled operation-constrained power and configured load. The operation table attributes modeled, measured, and ceiling energy to the exact `SPACECRAFT_OPERATION` values, which makes imaging, GS pointing, propulsion, transition, and other attitude regimes directly comparable. Velocity is reconstructed from adjacent replay positions for visualization.

When a DIL is loaded, the six-axis sweep recomputes the full imported `SUN_BODY` and illumination history independently for every signed cell-normal axis. Selecting an axis updates the modeled power, integrated energy, battery profile, operation breakdown, and current incidence. The DIL-derived reference remains fixed at its imported reference axis, allowing any selected-axis result to be compared against the attitude history for which the DIL was generated.

The analytical Sun and shadow direction are initialized from mission epoch and held fixed in the inertial scene; LTAN determines the SSO orbital-plane orientation relative to that Sun. For DIL replay, the first absolute `TIME` initializes the same global Sun direction, so attitude changes during `GSPOINTING_X`, `IMAGING_X`, or `TRANSITION` cannot move the Earth shadow. The Earth texture is initialized from GMST and rotates at the sidereal rate while the satellite propagates through the fixed illumination geometry. Earth-fixed reference curves and the propagated orbit use the same camera transform, so orbit rotation and pan remain locked to the globe as one scene.

Every operation whose name begins with `GSPOINTING` uses a blue animated Earth-directed beam, regardless of its suffix; for example `GSPOINTING_X`, `GSPOINTING_PAYLOAD`, and `GSPOINTING_123`. `IMAGING_X` uses a green beam. Operation effects crossfade over 520 ms when replay changes state. The Orbit radius control exaggerates displayed altitude only; it does not change the configured orbital altitude or any orbital/power calculation.

Large files are reduced to a maximum baseline of 60,000 graphical replay samples so multi-day playback remains responsive. This reduction does not affect energy totals. Spacecraft-operation and illumination transitions are prioritized during reduction, while chart and orbit paths use an additional display-only decimation. Use **Download template** in the dashboard for a ready-to-fill sample file.

## Verification

```bash
npm run lint
npm test
```

The test suite covers orbital-period references, eclipse discrimination, power/battery bounds, DIL parsing, DIL attitude geometry, dense timestamp-aware modeled/measured/ceiling energy integration, operation attribution, measured-power preservation, and server rendering.
