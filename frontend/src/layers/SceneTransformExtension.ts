import { LayerExtension, type Layer } from '@deck.gl/core';
import type { SceneTransform } from '../motion/sceneMotion';

const module = {
  name: 'sceneTransform',
  vs: `layout(std140) uniform sceneTransformUniforms { vec2 transform; } sceneTransform;`,
  uniformTypes: { transform: 'vec2<f32>' } as const,
  inject: {
    // Shift clip space by a common-space delta, retaining each layer's path/point offsets.
    // This flat NYC scene uses sea-level z=0; no terrain coordinate transform is assumed.
    'vs:DECKGL_FILTER_GL_POSITION': `
      float dz = (sceneTransform.transform.x - 1.0) * geometry.position.z
        + project_size(sceneTransform.transform.y);
      position += project.viewProjectionMatrix * vec4(0.0, 0.0, dz, 0.0);
    `,
  },
};

/** A shared mutable uniform: animate buildings without rebuilding geometry or React every frame. */
export class SceneTransformExtension extends LayerExtension {
  static extensionName = 'SceneTransformExtension';
  static defaultProps = { sceneTransform: { type: 'object', value: { scale: 1, offset: 0 }, compare: false } };
  getShaders() { return { modules: [module] }; }
  draw(this: Layer<{ sceneTransform: SceneTransform }>) {
    const { scale, offset } = this.props.sceneTransform;
    this.setShaderModuleProps({ sceneTransform: { transform: [scale, offset] } });
  }
}
export const SCENE_TRANSFORM = new SceneTransformExtension();
