import { LayerExtension } from '@deck.gl/core';
import type { Layer, LayerContext } from '@deck.gl/core';

/**
 * Renders each building's recorded façade material procedurally on the GPU.
 *
 * Every building carries a material class taken from the exterior wall type on its DOB NOW façade
 * filing (see `scripts/prepare-buildings.mjs`), plus the storey height implied by its PLUTO floor
 * count. From those two numbers the shader synthesises brick coursing, terra-cotta and ashlar
 * blocks, cast-iron bays, curtain-wall mullions and precast panels, with window openings aligned to
 * the real storeys, a glazed ground floor, a cornice, and street-level ambient occlusion.
 *
 * Nothing is sampled from an image: there are no texture downloads and no API keys. The pattern is
 * a signed-distance field evaluated per pixel, so each feature fades out once it is smaller than a
 * pixel, which is what keeps a city of 10,000 extrusions from aliasing into noise when zoomed out.
 *
 * The risk colour arrives as `color.rgb` and is modulated, never replaced, so the Critical / High /
 * Medium / Low classification still reads at every zoom.
 */

const uniformBlock = /* glsl */ `
layout(std140) uniform facadeUniforms {
  vec4 sun;  // xyz: direction towards the sun in common space; w: night window-lighting mix
  vec4 sky;  // rgb: sky colour reflected by glazing; a: overall material detail strength
} facade;
`;

const vs = /* glsl */ `
${uniformBlock}
in vec3 facadeParams;

out vec3 facade_uv;     // metres along the wall, metres above ground, 1 on walls / 0 on roofs
out vec2 facade_plan;   // metres east/north of a local origin, for surfaces with no wall direction
out vec4 facade_info;   // material index, storey height, building height, zoom gate
out vec4 facade_light;  // sun in wall-local space (along, up, facing), plus Fresnel
`;

const fs = /* glsl */ `
${uniformBlock}
in vec3 facade_uv;
in vec2 facade_plan;
in vec4 facade_info;
in vec4 facade_light;

float facade_hash(vec2 p) {
  // Wrapped first: cell indices reach tens of thousands on a tall wall, and float32 loses the
  // fractional part that the hash depends on. Repeating every 512 cells is not perceptible.
  p = mod(p, 512.0);
  p = fract(p * vec2(443.897, 441.423));
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x);
}

/** x: 1 on the face and 0 inside the joint; y: which side of the joint, for directional relief. */
vec2 facade_groove(float x, float period, float halfWidth, float aa) {
  float f = fract(x / period) * period;
  float d = min(f, period - f);
  float mask = smoothstep(halfWidth - aa, halfWidth + aa, d);
  return vec2(mask, (1.0 - mask) * sign(period * 0.5 - f));
}

/** Fades a detail out as it approaches the size of one pixel, instead of aliasing. */
float facade_visible(float size, float metresPerPixel) {
  return 1.0 - smoothstep(size * 0.30, size * 1.5, metresPerPixel);
}
`;

const inject = {
  'vs:DECKGL_FILTER_COLOR': /* glsl */ `
    // The extruded side normal and the projected elevation are both available at this hook.
    vec2 facade_nxy = geometry.normal.xy;
    float facade_nlen = length(facade_nxy);
    float facade_wall = 1.0 - step(0.5, abs(geometry.normal.z));
    vec3 facade_n = facade_nlen > 1e-5 ? vec3(facade_nxy / facade_nlen, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 facade_t = vec3(-facade_n.y, facade_n.x, 0.0);

    // Local metres from a fixed origin, projected onto the wall direction, so the coursing runs
    // continuously around a corner instead of restarting on each face.
    vec2 facade_local = vec2(
      (geometry.worldPosition.x + 74.02) * 84300.0,
      (geometry.worldPosition.y - 40.70) * 111320.0
    );
    float facade_along = dot(facade_local, facade_t.xy);
    float facade_up = geometry.position.z / project.commonUnitsPerMeter.z;

    vec3 facade_view = normalize(project.cameraPosition - geometry.position.xyz);

    facade_uv = vec3(facade_along, facade_up, facade_wall);
    facade_plan = facade_local;
    facade_info = vec4(facadeParams.x, facadeParams.y, facadeParams.z, smoothstep(11.0, 12.6, log2(project.scale)));
    facade_light = vec4(
      dot(facade.sun.xyz, facade_t),
      facade.sun.z,
      dot(facade.sun.xyz, facade_n),
      pow(1.0 - clamp(dot(facade_n, facade_view), 0.0, 1.0), 4.0)
    );
  `,
  'fs:DECKGL_FILTER_COLOR': /* glsl */ `
    float facade_strength = facade.sky.a * facade_info.w;
    if (facade_strength > 0.001) {
      int facade_m = int(facade_info.x + 0.5);
      float storey = max(facade_info.y, 2.2);
      float top = max(facade_info.z, storey);
      float along = facade_uv.x;
      float up = facade_uv.y;
      float mpp = max(max(fwidth(along), fwidth(up)), 1e-4);

      // Defaults describe NYC common brick; each class below overrides what differs.
      vec2 unit = vec2(0.205, 0.072);  // masonry unit including its joint, in metres
      float joint = 0.009;
      float relief = 1.0;
      float glazing = 0.40;            // share of a structural bay taken by the window
      float gloss = 0.04;
      float mottle = 0.13;
      float bay = 3.0;
      vec3 tint = vec3(1.03, 0.96, 0.91);

      if (facade_m == 1) {            // terra cotta: large pale blocks, fine joints
        unit = vec2(0.46, 0.30); joint = 0.006; relief = 0.8; glazing = 0.40;
        mottle = 0.05; bay = 2.9; tint = vec3(1.04, 1.01, 0.95);
      } else if (facade_m == 2) {     // stone: deep-jointed ashlar courses
        unit = vec2(1.05, 0.52); joint = 0.014; relief = 1.25; glazing = 0.34;
        mottle = 0.04; bay = 3.4; tint = vec3(1.0, 1.0, 0.99);
      } else if (facade_m == 3) {     // cast iron: narrow columned bays, mostly window
        unit = vec2(0.0, 0.0); joint = 0.0; relief = 1.4; glazing = 0.60; gloss = 0.12;
        mottle = 0.03; bay = 1.95; tint = vec3(0.95, 0.98, 1.0);
      } else if (facade_m == 4) {     // curtain wall: 5 ft mullion module, almost fully glazed
        unit = vec2(0.0, 0.0); joint = 0.0; relief = 0.35; glazing = 0.86; gloss = 0.95;
        mottle = 0.0; bay = 1.52; tint = vec3(0.93, 0.96, 1.0);
      } else if (facade_m == 5) {     // metal panel
        unit = vec2(1.20, 0.0); joint = 0.010; relief = 0.5; glazing = 0.50; gloss = 0.45;
        mottle = 0.05; bay = 1.85; tint = vec3(0.97, 0.98, 1.0);
      } else if (facade_m == 6) {     // concrete / precast panels
        unit = vec2(2.40, 0.0); joint = 0.016; relief = 0.85; glazing = 0.36;
        mottle = 0.03; bay = 2.4; tint = vec3(0.98, 0.98, 0.97);
      } else if (facade_m == 7) {     // stucco: no coursing, just surface mottling
        unit = vec2(0.0, 0.0); joint = 0.0; relief = 0.2; glazing = 0.38;
        mottle = 0.18; bay = 3.0; tint = vec3(1.02, 1.0, 0.96);
      }

      float sunU = facade_light.x;
      float sunV = facade_light.y;
      float facing = clamp(facade_light.z + 0.4, 0.0, 1.4);

      if (facade_uv.z > 0.5) {
        float bandVis = facade_visible(storey, mpp);
        float bayVis = facade_visible(bay, mpp);

        // A taller, more glazed ground floor is the strongest cue that these are real streets.
        float groundTop = min(storey * 1.35, max(top - 1.0, storey));
        float isGround = 1.0 - smoothstep(groundTop - 0.3, groundTop + 0.3, up);

        float sy = fract((up - groundTop) / storey);
        float halfH = 0.5 * glazing;
        float winY = 1.0 - smoothstep(halfH - mpp / storey, halfH + mpp / storey, abs(sy - 0.52));

        float gy = clamp(up / max(groundTop, 0.1), 0.0, 1.0);
        float shopY = 1.0 - smoothstep(0.30, 0.34, abs(gy - 0.55));

        float sx = fract(along / bay);
        float halfW = 0.5 * mix(glazing, min(glazing + 0.34, 0.90), isGround);
        float winX = 1.0 - smoothstep(halfW - mpp / bay, halfW + mpp / bay, abs(sx - 0.5));

        float window = mix(winY, shopY, isGround) * winX * bayVis * bandVis;

        // --- solid wall: coursing, mottling and directional relief in the joints
        float course = 1.0;
        vec2 slope = vec2(0.0);
        if (unit.x > 0.0) {
          float courseVis = facade_visible(max(unit.y, unit.x * 0.4), mpp);
          float row = unit.y > 0.0 ? floor(up / unit.y) : floor(up / storey);
          float offset = unit.y > 0.0 ? mod(row, 2.0) * 0.5 * unit.x : 0.0;
          vec2 gh = facade_groove(along + offset, unit.x, joint, mpp);
          vec2 gv = unit.y > 0.0 ? facade_groove(up, unit.y, joint, mpp) : vec2(1.0, 0.0);
          course = mix(1.0, min(gh.x, gv.x), courseVis);
          slope = vec2(gh.y, gv.y) * courseVis;
          float h = facade_hash(vec2(floor((along + offset) / unit.x), row));
          course *= 1.0 + (h - 0.5) * mottle * courseVis;
        } else if (mottle > 0.0) {
          float h = facade_hash(floor(vec2(along, up) * 3.0));
          course *= 1.0 + (h - 0.5) * mottle * facade_visible(0.33, mpp);
        }

        float jointShade = mix(0.74, 1.05, clamp(course, 0.0, 1.4));
        jointShade *= 1.0 + (slope.x * sunU + slope.y * sunV) * relief * 0.30 * facing;

        // Sun-side highlight on the sill course directly beneath each opening.
        float sillLine = (1.0 - smoothstep(0.0, 0.05, abs(sy - 0.52 + halfH))) * winX * bandVis * (1.0 - isGround);

        float ao = mix(0.84, 1.02, smoothstep(0.0, 13.0, up));
        float capVis = facade_visible(1.0, mpp);
        float cap = 1.0 - smoothstep(0.85, 1.35, top - up);        // the cornice itself
        float capUnder = smoothstep(2.1, 1.4, top - up) * (1.0 - cap); // its shadow
        float cornice = 1.0 + (cap * 0.22 * facing - capUnder * 0.26) * capVis;

        vec3 solid = color.rgb * tint * jointShade * ao * cornice * (1.0 + sillLine * 0.18 * facing);

        // --- glazing: interior darkness varies per pane, with a sky reflection over it
        vec2 paneId = vec2(floor(along / bay), floor((up - groundTop) / storey));
        float pane = facade_hash(paneId);
        float oy = (sy - 0.52) / max(halfH, 0.01);
        float blind = step(0.70, facade_hash(paneId + 11.3));
        // Glazing covers most of a curtain wall, so its mean brightness sets the colour the legend
        // has to match. It stays near 1 on purpose: the material must modulate the risk colour.
        float interior = mix(0.62, 0.96, pane);
        interior = mix(interior, 1.06, blind * smoothstep(-0.2, 0.9, oy));
        interior *= 1.0 - 0.18 * smoothstep(0.45, 1.0, oy);  // shadow under the lintel

        float fres = facade_light.w;
        vec3 reflection = facade.sky.rgb * gloss * (0.10 + 0.55 * fres);
        vec3 glass = color.rgb * interior + reflection;

        // At dusk a share of the panes are lit from inside; sun.w drives how many.
        float lit = step(1.0 - facade.sun.w * 0.5, pane);
        glass = mix(glass, vec3(1.0, 0.84, 0.58), lit * facade.sun.w * 0.7);

        vec3 shaded = mix(solid, glass, window);
        color.rgb = mix(color.rgb, shaded, facade_strength);
      } else {
        // Roofs: ballast, patched membrane and the odd bulkhead, so they do not read as poured
        // plastic from above. The plan coordinate is the only axis pair a flat roof has.
        float roofMpp = max(max(fwidth(facade_plan.x), fwidth(facade_plan.y)), 1e-4);
        // 'patch' is a reserved word in GLSL, hence 'membrane'.
        float membrane = facade_hash(floor(facade_plan / 2.6));
        float ballast = facade_hash(floor(facade_plan / 0.4) + 7.1);
        float roof = mix(0.82, 0.96, membrane);
        roof *= 1.0 + (ballast - 0.5) * 0.14 * facade_visible(0.4, roofMpp);
        color.rgb = mix(color.rgb, color.rgb * roof, facade_strength * facade_visible(2.6, roofMpp));
      }
    }
  `,
};

const facadeModule = {
  name: 'facade',
  vs,
  fs,
  inject,
  uniformTypes: { sun: 'vec4<f32>', sky: 'vec4<f32>' } as const,
};

export interface FacadeMaterialProps {
  /** Per building: [material index, storey height in metres, building height in metres]. */
  getFacadeParams?: unknown;
  /** Direction towards the sun in common space (z up). */
  facadeSun?: [number, number, number];
  /** 0 by day, 1 at night: how many panes are lit from inside. */
  facadeNight?: number;
  /** Sky colour reflected by glazing. */
  facadeSky?: [number, number, number];
  /** 0 disables all material detail and restores flat category colours. */
  facadeDetail?: number;
}

export class FacadeMaterialExtension extends LayerExtension {
  static extensionName = 'FacadeMaterialExtension';

  static defaultProps = {
    getFacadeParams: { type: 'accessor', value: [0, 3.2, 20] },
    facadeSun: [-0.42, -0.62, 0.66],
    facadeNight: 0,
    facadeSky: [0.42, 0.52, 0.68],
    facadeDetail: 1,
  };

  getShaders() {
    return { modules: [facadeModule] };
  }

  initializeState(this: Layer<FacadeMaterialProps>, _context: LayerContext) {
    this.getAttributeManager()?.add({
      facadeParams: { size: 3, type: 'float32', stepMode: 'dynamic', accessor: 'getFacadeParams' },
    });
  }

  draw(this: Layer<Required<FacadeMaterialProps>>) {
    const { facadeSun, facadeNight, facadeSky, facadeDetail } = this.props;
    this.setShaderModuleProps({
      facade: {
        sun: [...facadeSun, facadeNight],
        sky: [...facadeSky, facadeDetail],
      },
    });
  }
}

export const FACADE_MATERIAL = new FacadeMaterialExtension();
