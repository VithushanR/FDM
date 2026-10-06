import type { About, Hotspot, Schema } from "../api/endpoints";
import hotspotsAllFixture from "./fixtures/hotspots_all_all_times.json";
import hotspotsSevereFixture from "./fixtures/hotspots_severe_all_times.json";
import aboutFixture from "./fixtures/about.json";
import schemaFixture from "./fixtures/schema.json";

// The JSON fixtures are captured from the live backend. The bundler types them loosely, so they are
// typed here once, against the generated API types. The backend contract is checked by openapi.ts.
export const schema = schemaFixture.body as unknown as Schema;
export const about = aboutFixture.body as unknown as About;

// Live hotspot lists for "All times", captured with limit=1000 and min_collisions=1.
export const severeHotspots = hotspotsSevereFixture.body.hotspots as unknown as Hotspot[];
export const allHotspots = hotspotsAllFixture.body.hotspots as unknown as Hotspot[];
