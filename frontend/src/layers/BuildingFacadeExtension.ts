import { LayerExtension } from '@deck.gl/core';

/** Illustrative window bays, shaded on the GPU; no extra city geometry or React animation. */
export class BuildingFacadeExtension extends LayerExtension {
  static extensionName = 'BuildingFacadeExtension';

  getShaders() {
    return { inject: {
      'vs:#decl': 'out vec2 facadeUV; out float facadeDetail;',
      'vs:DECKGL_FILTER_COLOR': `
        // At this hook the extruded side normal and projected elevation are available.
        float alongWall = abs(geometry.normal.x) > abs(geometry.normal.y)
          ? (geometry.worldPosition.y - 40.7) * 111320.0
          : (geometry.worldPosition.x + 74.02) * 84300.0;
        facadeUV = vec2(alongWall / 3.2, geometry.position.z / project.commonUnitsPerMeter.z / 3.6);
        facadeDetail = (1.0 - step(0.5, abs(geometry.normal.z)))
          * smoothstep(14.8, 16.4, log2(project.scale));
      `,
      'fs:#decl': 'in vec2 facadeUV; in float facadeDetail;',
      'fs:DECKGL_FILTER_COLOR': `
        if (facadeDetail > 0.0) {
          vec2 derivative = max(fwidth(facadeUV), vec2(0.0001));
          vec2 edge = min(fract(facadeUV), 1.0 - fract(facadeUV));
          vec2 pane = smoothstep(vec2(0.07) - derivative, vec2(0.07) + derivative, edge);
          float clarity = 1.0 - smoothstep(0.22, 0.65, max(derivative.x, derivative.y));
          color.rgb *= mix(1.0, mix(0.57, 1.06, pane.x * pane.y), facadeDetail * clarity);
        }
      `,
    } };
  }
}

export const BUILDING_FACADE = new BuildingFacadeExtension();
