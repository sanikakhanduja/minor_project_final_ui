// Renderer, lighting and post-processing per CLAUDE.md: WebGPURenderer (falls back to WebGL2 itself),
// one DirectionalLight with soft shadows + HDRI environment, ACES tone mapping, no ambient light,
// and post-processing limited to ambient occlusion and a light bloom.
import * as THREE from 'three/webgpu';
import { builtinAOContext, color, mix, mrt, normalView, pass, screenUV } from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { PAINT } from '../palette';

export const MAX_PIXEL_RATIO = 1.5;
const SUN_DIRECTION = new THREE.Vector3(-0.55, 1.0, 0.45).normalize();

export async function createRenderer(container: HTMLElement): Promise<THREE.WebGPURenderer> {
  const renderer = new THREE.WebGPURenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
  renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  await renderer.init();
  container.appendChild(renderer.domElement);
  return renderer;
}

export function applySky(scene: THREE.Scene) {
  scene.backgroundNode = mix(color(PAINT.skyTop), color(PAINT.skyHorizon), screenUV.y);
  scene.fog = new THREE.Fog(PAINT.skyHorizon, 160, 560);
  scene.environmentIntensity = 0.55;
}

/** Sun with an orthographic shadow frustum fitted tightly around the map. */
export function createSun(width: number, height: number): THREE.DirectionalLight {
  const sun = new THREE.DirectionalLight(0xfff1dc, 3.0);
  const center = new THREE.Vector3(width / 2, 0, height / 2);
  sun.position.copy(center).addScaledVector(SUN_DIRECTION, 150);
  sun.target.position.copy(center);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.radius = 1.25; // larger radii dither visibly with the 5-tap PCF filter
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.05;

  const cam = sun.shadow.camera;
  cam.position.copy(sun.position);
  cam.lookAt(center);
  cam.updateMatrixWorld(true);
  const toLight = cam.matrixWorldInverse;
  const box = new THREE.Box3();
  const p = new THREE.Vector3();
  for (const x of [-1, width + 1]) {
    for (const z of [-1, height + 1]) {
      for (const y of [0, 2]) box.expandByPoint(p.set(x, y, z).applyMatrix4(toLight));
    }
  }
  cam.left = box.min.x;
  cam.right = box.max.x;
  cam.bottom = box.min.y;
  cam.top = box.max.y;
  cam.near = Math.max(0.5, -box.max.z - 5);
  cam.far = -box.min.z + 5;
  cam.updateProjectionMatrix();
  return sun;
}

export function createPipeline(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera): THREE.RenderPipeline {
  const pipeline = new THREE.RenderPipeline(renderer);

  // GTAO needs a single-sampled depth buffer, so it reads a half-resolution depth/normal pre-pass
  // while the main pass keeps 4x MSAA. AO darkens indirect (environment) light only.
  const prePass = pass(scene, camera);
  prePass.setMRT(mrt({ output: normalView }));
  prePass.setResolutionScale(0.5);
  const aoPass = ao(prePass.getTextureNode('depth'), prePass.getTextureNode(), camera);
  aoPass.resolutionScale = 0.5;
  aoPass.radius.value = 0.5;
  aoPass.samples.value = 12;

  const scenePass = pass(scene, camera, { samples: 4 });
  scenePass.contextNode = builtinAOContext(aoPass.getTextureNode().sample(screenUV).r);
  pipeline.outputNode = scenePass.add(bloom(scenePass, 0.3, 0.35, 0.95));
  return pipeline;
}
