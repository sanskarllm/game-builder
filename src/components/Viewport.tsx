import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Grid, OrbitControls } from '@react-three/drei';
import { useEffect, useRef, type ReactNode } from 'react';
import { Box3, PMREMGenerator, Sphere, Vector3, type Group, type Object3D, type PerspectiveCamera } from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/** Offline studio lighting so metals and glass read correctly without fetching an HDRI. */
function StudioEnvironment() {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pmrem = new PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = 0.6;
    return () => {
      scene.environment = null;
      env.dispose();
      pmrem.dispose();
    };
  }, [gl, scene]);
  return null;
}

export function Viewport(props: { children: ReactNode; camera?: [number, number, number]; target?: [number, number, number] }) {
  const { camera = [2.6, 1.8, 3.6], target = [0, 0.9, 0] } = props;
  return (
    <Canvas shadows camera={{ position: camera, fov: 45, near: 0.05, far: 200 }} gl={{ preserveDrawingBuffer: true }}>
      <color attach="background" args={['#12141b']} />
      <StudioEnvironment />
      <hemisphereLight args={['#dfe6ff', '#2a2420', 0.6]} />
      <directionalLight position={[4, 7, 5]} intensity={1.6} castShadow shadow-mapSize={[2048, 2048]} />
      <directionalLight position={[-5, 3, -4]} intensity={0.4} />
      <mesh rotation-x={-Math.PI / 2} receiveShadow position={[0, -0.001, 0]}>
        <planeGeometry args={[40, 40]} />
        <shadowMaterial opacity={0.35} />
      </mesh>
      <Grid infiniteGrid cellSize={0.25} sectionSize={1} cellColor="#232838" sectionColor="#343b52" fadeDistance={22} />
      <OrbitControls target={target} makeDefault enableDamping />
      {props.children}
    </Canvas>
  );
}

/** Re-frames the camera around `object` whenever it changes. */
export function FitCamera({ object }: { object: Object3D }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as { target: Vector3; update(): void } | null;
  useEffect(() => {
    const sphere = new Box3().setFromObject(object).getBoundingSphere(new Sphere());
    if (!isFinite(sphere.radius) || sphere.radius <= 0) return;
    const fov = ((camera as PerspectiveCamera).fov ?? 45) * (Math.PI / 180);
    const dist = (sphere.radius / Math.sin(fov / 2)) * 1.1;
    const dir = new Vector3(0.55, 0.42, 1).normalize();
    camera.position.copy(sphere.center).addScaledVector(dir, dist);
    camera.near = dist / 100;
    camera.far = dist * 20;
    camera.updateProjectionMatrix();
    if (controls) {
      controls.target.copy(sphere.center);
      controls.update();
    } else {
      camera.lookAt(sphere.center);
    }
  }, [object, camera, controls]);
  return null;
}

/** Slowly rotates its children when enabled. */
export function Turntable(props: { enabled: boolean; children: ReactNode }) {
  const ref = useRef<Group>(null);
  useFrame((_, dt) => {
    if (props.enabled && ref.current) ref.current.rotation.y += dt * 0.5;
  });
  return <group ref={ref}>{props.children}</group>;
}
