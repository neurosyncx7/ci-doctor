import { Canvas, useFrame } from '@react-three/fiber';
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, DataTexture, RGBAFormat, RepeatWrapping, ShaderMaterial, TextureLoader, UnsignedByteType, Vector3, type Mesh, type Points } from 'three';
import { useEffect, useMemo, useRef } from 'react';

type FlowFieldProps = { progress: number; state: string; eventCount: number };

const vertexShader = /* glsl */ `
  uniform float uTime; uniform float uDistortion;
  varying vec3 vNormal; varying vec3 vPosition; varying vec2 vUv;
  void main() {
    vUv = uv; vNormal = normal;
    float pulse = sin(position.y * 7.0 + uTime * 0.7) * sin(position.x * 5.0 - uTime * 0.48);
    vec3 displaced = position + normal * pulse * (0.09 + uDistortion * 0.34);
    vPosition = displaced;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
  }
`;
const fragmentShader = /* glsl */ `
  uniform float uTime; uniform float uScroll; uniform float uTextureReady; uniform float uRefractionRatio; uniform float uDistortionStrength;
  uniform sampler2D uDisplacement; uniform vec3 uOrange; uniform vec3 uViolet;
  varying vec3 vNormal; varying vec3 vPosition; varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
  float vortex(vec2 uv) {
    vec2 p = uv * 2.0 - 1.0; float radius = length(p); float angle = atan(p.y, p.x);
    return sin(angle * 15.0 - radius * 29.0 + uTime * 1.6 + sin(radius * 22.0)) * .5 + .5;
  }
  void main() {
    vec2 center = vUv - .5; float radius = length(center); float angle = atan(center.y, center.x);
    vec2 drift = vec2(cos(angle), sin(angle)) * (.018 + uDistortionStrength * .034) * sin(uTime + radius * 17.0);
    float map = texture2D(uDisplacement, fract(vUv + drift + vec2(uTime * .017, -uTime * .011))).r;
    float noise = mix(vortex(vUv), map, uTextureReady);
    float inner = smoothstep(.72, .05, radius);
    float bands = smoothstep(.18, .94, noise) * (1.0 - smoothstep(.76, 1.08, radius));
    float fresnel = pow(1.0 - abs(dot(normalize(vNormal), vec3(0.0, 0.0, 1.0))), 2.1);
    float lens = sin(angle * 5.0 + radius * 32.0 - uTime * 2.0) * uRefractionRatio;
    vec3 thermal = mix(uViolet, uOrange, clamp(bands + fresnel * .7 + lens * .18, 0.0, 1.0));
    vec3 whiteHot = vec3(1.0, .95, .82) * smoothstep(.72, .96, bands) * inner;
    gl_FragColor = vec4(thermal + whiteHot, .9);
  }
`;

function CosmicEntity({ progress, state, eventCount }: FlowFieldProps) {
  const core = useRef<Mesh>(null); const disk = useRef<Points>(null); const horizon = useRef<Mesh>(null); const stars = useRef<Points>(null);
  const material = useMemo(() => {
    const fallback = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, RGBAFormat, UnsignedByteType); fallback.needsUpdate = true;
    return new ShaderMaterial({ vertexShader, fragmentShader, transparent: true, uniforms: {
      uTime: { value: 0 }, uScroll: { value: 0 }, uTextureReady: { value: 0 }, uRefractionRatio: { value: 0 }, uDistortionStrength: { value: 0 }, uDisplacement: { value: fallback },
      uOrange: { value: new Color(state === 'BUDGET_EXHAUSTED' ? '#ff5500' : '#ff8c00') }, uViolet: { value: new Color('#493273') }
    } });
  }, [state]);
  useEffect(() => {
    let active = true;
    new TextureLoader().load('/assets/accretion-noise.jpeg', (texture) => {
      if (!active) return; texture.wrapS = texture.wrapT = RepeatWrapping; texture.colorSpace = 'srgb'; material.uniforms.uDisplacement.value = texture; material.uniforms.uTextureReady.value = 1;
    }, undefined, () => { if (active) material.uniforms.uTextureReady.value = 0; });
    return () => { active = false; };
  }, [material]);
  const dustGeometry = useMemo(() => {
    const geometry = new BufferGeometry(); const count = 640; const points = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * Math.PI * 2; const radius = 1.38 + Math.pow(Math.random(), .65) * 1.42;
      points[i * 3] = Math.cos(angle) * radius; points[i * 3 + 1] = Math.sin(angle) * radius * .42; points[i * 3 + 2] = (Math.random() - .5) * .18;
    }
    geometry.setAttribute('position', new BufferAttribute(points, 3)); return geometry;
  }, []);
  const starGeometry = useMemo(() => {
    const geometry = new BufferGeometry(); const count = 900; const points = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) { const radius = 6 + Math.random() * 21; const theta = Math.random() * Math.PI * 2; const phi = Math.acos(2 * Math.random() - 1); points[i * 3] = radius * Math.sin(phi) * Math.cos(theta); points[i * 3 + 1] = radius * Math.cos(phi); points[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta) - 9; }
    geometry.setAttribute('position', new BufferAttribute(points, 3)); return geometry;
  }, []);
  useFrame(({ clock, camera }) => {
    const time = clock.getElapsedTime();
    const states = [
      { position: new Vector3(45, 0, 100), rotation: new Vector3(0, .45, 0) },
      { position: new Vector3(30, 5, 60), rotation: new Vector3(-.1, .6, .15) },
      { position: new Vector3(0, 0, 15), rotation: new Vector3(0, 0, 0) },
      { position: new Vector3(0, -2, -40), rotation: new Vector3(.3, Math.PI, 0) }
    ];
    const segment = Math.min(2, Math.floor(progress * 3)); const local = Math.min(1, (progress * 3) - segment);
    const from = states[segment]; const to = states[Math.min(segment + 1, 3)];
    const targetPosition = from.position.clone().lerp(to.position, local); const targetRotation = from.rotation.clone().lerp(to.rotation, local);
    const warp = Math.sin(Math.min(1, progress / .4) * Math.PI) * .95; const flyThrough = Math.min(1, Math.max(0, (progress - .5) * 4)); const ambient = Math.min(1, Math.max(0, (progress - .75) * 4));
    material.uniforms.uTime.value = time; material.uniforms.uScroll.value = progress; material.uniforms.uDistortionStrength.value = warp; material.uniforms.uRefractionRatio.value = warp; material.uniforms.uDistortion.value = warp;
    if (core.current) { core.current.rotation.y = time * .2 + progress * Math.PI * 2.2; core.current.rotation.x = -.28 + progress * .42; core.current.scale.setScalar(28 * (1 + flyThrough * .26) * (1 - ambient * .72)); core.current.position.set(0, 0, 0); }
    if (disk.current) { disk.current.rotation.z = -time * (.32 + progress * 1.35); disk.current.rotation.x = 1.23; disk.current.rotation.y = -.16 + Math.sin(time * .2) * .09; disk.current.scale.setScalar(28 * (1 + flyThrough * .31) * (1 - ambient * .68)); disk.current.position.set(0, 0, 0); }
    if (horizon.current) { horizon.current.scale.setScalar(24 * (1 + flyThrough * .22) * (1 - ambient * .72)); horizon.current.position.set(0, 0, 0); }
    if (stars.current) { stars.current.rotation.y = -time * .012; stars.current.rotation.z = progress * .18; }
    camera.position.lerp(targetPosition, .045); camera.rotation.x += (targetRotation.x - camera.rotation.x) * .045; camera.rotation.y += (targetRotation.y - camera.rotation.y) * .045; camera.rotation.z += (targetRotation.z - camera.rotation.z) * .045;
  });
  return <>
    <points ref={stars} geometry={starGeometry}><pointsMaterial color="#e4d5ff" size={.017} sizeAttenuation transparent opacity={.82} blending={AdditiveBlending} depthWrite={false} /></points>
    <points ref={disk} geometry={dustGeometry} rotation={[1.23, -.16, 0]}><pointsMaterial color="#ffb06a" size={.045 + eventCount * .001} sizeAttenuation transparent opacity={.92} blending={AdditiveBlending} depthWrite={false} /></points>
    <mesh ref={core} material={material}><sphereGeometry args={[1.33, 64, 40]} /></mesh>
    <mesh ref={horizon}><sphereGeometry args={[.92, 48, 32]} /><meshBasicMaterial color="#010103" /></mesh>
    <pointLight color="#ff6b00" intensity={32} position={[2.2, .3, 4]} /><pointLight color="#7551d4" intensity={18} position={[-3, -1.5, 2]} />
  </>;
}
export function FlowField(props: FlowFieldProps) { return <div className="flow-field" aria-hidden="true"><Canvas camera={{ position: [4.5, 0, 10], fov: 45 }} dpr={1} gl={{ antialias: false, alpha: true, powerPreference: 'high-performance' }}><fog attach="fog" args={['#050508', 6, 28]} /><CosmicEntity {...props} /></Canvas></div>; }