'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const MODEL_PATH = '/models/globe.glb';
const MODEL_TARGET_SIZE = 2.8;
const CAMERA_FOV = 75;
const CAMERA_Z = 3.5;
const SPIN_SPEED = 0.4;

const DEFAULT_BLURBS = ['Just a moment', 'Loading', 'One moment please'];

function mergePositions(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let total = 0;
  for (const g of geometries) {
    const pos = g.getAttribute('position');
    if (pos) total += pos.count;
  }
  const merged = new Float32Array(total * 3);
  let offset = 0;
  for (const g of geometries) {
    const pos = g.getAttribute('position');
    if (!pos) continue;
    for (let i = 0; i < pos.count; i++) {
      merged[offset++] = pos.getX(i);
      merged[offset++] = pos.getY(i);
      merged[offset++] = pos.getZ(i);
    }
  }
  const buf = new THREE.BufferGeometry();
  buf.setAttribute('position', new THREE.Float32BufferAttribute(merged, 3));
  return buf;
}

function BlurbCycler({ blurbs }: { blurbs: string[] }) {
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (blurbs.length <= 1) return;
    const interval = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setIndex((i) => (i + 1) % blurbs.length);
        setVisible(true);
      }, 400);
    }, 2800);
    return () => clearInterval(interval);
  }, [blurbs.length]);

  return (
    <p
      className="mt-6 text-[15px] text-ink-muted transition-opacity duration-400"
      style={{ opacity: visible ? 1 : 0 }}
    >
      {blurbs[index]}...
    </p>
  );
}

type LoadingScreenProps = {
  blurbs?: string[];
  fullscreen?: boolean;
};

export function LoadingScreen({ blurbs = DEFAULT_BLURBS, fullscreen = true }: LoadingScreenProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [modelReady, setModelReady] = useState(false);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const mobile = window.innerWidth <= 768;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      CAMERA_FOV,
      mount.clientWidth / mount.clientHeight,
      0.1,
      100,
    );
    camera.position.z = CAMERA_Z;

    const renderer = new THREE.WebGLRenderer({
      antialias: !mobile,
      alpha: true,
      powerPreference: mobile ? 'default' : 'high-performance',
      stencil: false,
      depth: false,
    });
    renderer.setPixelRatio(mobile ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = false;
    mount.appendChild(renderer.domElement);

    const pointsMat = new THREE.PointsMaterial({ color: 0x6fa8ce, size: 0.02 });
    let pivot: THREE.Group | null = null;
    let frameId: number;

    new GLTFLoader().load(MODEL_PATH, (gltf) => {
      const model = gltf.scene;
      const geometries: THREE.BufferGeometry[] = [];

      model.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.material?.dispose();
          const cloned = child.geometry.clone();
          cloned.applyMatrix4(child.matrixWorld);
          geometries.push(cloned);
        }
      });

      const merged = mergePositions(geometries);
      const box = new THREE.Box3().setFromBufferAttribute(
        merged.getAttribute('position') as THREE.BufferAttribute,
      );
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const scale = MODEL_TARGET_SIZE / Math.max(size.x, size.y, size.z);

      merged.translate(-center.x, -center.y, -center.z);

      const points = new THREE.Points(merged, pointsMat);
      points.scale.setScalar(scale);

      pivot = new THREE.Group();
      pivot.add(points);
      scene.add(pivot);

      geometries.forEach((g) => g.dispose());
      setModelReady(true);
    });

    let lastTime = 0;
    const frameInterval = 1000 / (mobile ? 30 : 60);

    function animate(now: number) {
      frameId = requestAnimationFrame(animate);
      if (now - lastTime < frameInterval) return;
      const delta = lastTime ? (now - lastTime) / 1000 : 0.016;
      lastTime = now;

      if (pivot) pivot.rotation.y += delta * SPIN_SPEED;
      renderer.render(scene, camera);
    }

    function handleResize() {
      if (!mount) return;
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    }

    window.addEventListener('resize', handleResize);
    frameId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener('resize', handleResize);
      mount.removeChild(renderer.domElement);
      renderer.dispose();
      pointsMat.dispose();
      scene.traverse((obj) => {
        if (obj instanceof THREE.Points || obj instanceof THREE.Mesh) {
          obj.geometry?.dispose();
        }
      });
    };
  }, []);

  const wrapperClass = fullscreen
    ? 'fixed inset-0 z-40 bg-bg flex flex-col items-center justify-center px-4'
    : 'flex-1 overflow-hidden bg-bg flex flex-col items-center justify-center px-4';

  return (
    <div className={wrapperClass}>
      <div
        ref={mountRef}
        className="w-full transition-opacity duration-700"
        style={{ height: 260, maxWidth: 480, pointerEvents: 'none', opacity: modelReady ? 1 : 0 }}
      />
      <BlurbCycler blurbs={blurbs} />
    </div>
  );
}
