import { Canvas } from '@react-three/fiber';
import { Float, MeshDistortMaterial, OrbitControls, Sparkles } from '@react-three/drei';

export function IncidentCore() {
  return (
    <Canvas camera={{ position: [0, 0, 5.4], fov: 42 }} dpr={[1, 1.5]}>
      <ambientLight intensity={0.72} />
      <pointLight position={[3, 2, 4]} intensity={22} color="#4ee6c1" />
      <pointLight position={[-4, -2, 2]} intensity={14} color="#8b7cff" />
      <Float speed={2.2} rotationIntensity={0.5} floatIntensity={0.85}>
        <mesh>
          <icosahedronGeometry args={[1.25, 6]} />
          <MeshDistortMaterial color="#80f5d2" roughness={0.19} metalness={0.37} distort={0.24} speed={1.9} transparent opacity={0.82} />
        </mesh>
      </Float>
      <mesh rotation={[0.85, 0.25, 0.3]}><torusGeometry args={[1.73, 0.019, 12, 110]} /><meshBasicMaterial color="#b8fff0" transparent opacity={0.65} /></mesh>
      <mesh rotation={[-0.45, 0.9, -0.4]}><torusGeometry args={[2.08, 0.012, 10, 110]} /><meshBasicMaterial color="#8f7cff" transparent opacity={0.45} /></mesh>
      <Sparkles count={72} scale={5.1} size={2.1} speed={0.25} color="#cefff3" />
      <OrbitControls enablePan={false} enableZoom={false} autoRotate autoRotateSpeed={0.65} />
    </Canvas>
  );
}
