'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const MODEL_PATH = '/models/globe.glb';
const MODEL_TARGET_SIZE = 2.2;
const CAMERA_FOV = 75;
const CAMERA_Z = 3.5;
const SPIN_SPEED = 0.4;
const COLOR = 0x6fa8ce;

type Style = {
  label: string;
  material: () => THREE.Material;
  postProcess?: (child: THREE.Mesh) => void;
};

const STYLES: Style[] = [
  {
    label: 'Flat Solid',
    material: () => new THREE.MeshBasicMaterial({ color: COLOR }),
  },
  {
    label: 'Wireframe',
    material: () => new THREE.MeshBasicMaterial({ color: COLOR, wireframe: true }),
  },
  {
    label: 'Lit Solid',
    material: () => new THREE.MeshStandardMaterial({ color: COLOR, roughness: 0.6, metalness: 0 }),
  },
  {
    label: 'Edges Only',
    material: () => new THREE.MeshBasicMaterial({ color: COLOR, transparent: true, opacity: 0 }),
    postProcess: (child) => {
      const edges = new THREE.EdgesGeometry(child.geometry, 15);
      const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: COLOR }));
      child.add(line);
    },
  },
  {
    label: 'Transparent + Edges',
    material: () => new THREE.MeshBasicMaterial({ color: COLOR, transparent: true, opacity: 0.15 }),
    postProcess: (child) => {
      const edges = new THREE.EdgesGeometry(child.geometry, 15);
      const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: COLOR }));
      child.add(line);
    },
  },
  {
    label: 'Points',
    material: () => new THREE.PointsMaterial({ color: COLOR, size: 0.02 }),
    postProcess: (child) => {
      const points = new THREE.Points(child.geometry, new THREE.PointsMaterial({ color: COLOR, size: 0.02 }));
      child.parent?.add(points);
      child.visible = false;
    },
  },
];

function ModelPanel({ style }: { style: Style }) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 1000);
    camera.position.set(0, 0, CAMERA_Z);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(1, 1, 2);
    scene.add(dirLight);

    let pivot: THREE.Group | null = null;
    let frameId: number;

    new GLTFLoader().load(MODEL_PATH, (gltf) => {
      const model = gltf.scene.clone(true);

      model.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material) {
          if (child.material.dispose) child.material.dispose();
          child.material = style.material();
          if (style.postProcess) style.postProcess(child);
        }
      });

      const box = new THREE.Box3().setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      model.position.sub(center);
      model.scale.setScalar(MODEL_TARGET_SIZE / Math.max(size.x, size.y, size.z));

      pivot = new THREE.Group();
      pivot.add(model);
      scene.add(pivot);
    });

    let lastTime = 0;
    function animate(now: number) {
      frameId = requestAnimationFrame(animate);
      const delta = lastTime ? (now - lastTime) / 1000 : 0.016;
      lastTime = now;
      if (pivot) pivot.rotation.y += delta * SPIN_SPEED;
      renderer.render(scene, camera);
    }

    function handleResize() {
      if (!mount) return;
      const s = Math.min(mount.clientWidth, mount.clientHeight);
      camera.aspect = 1;
      camera.updateProjectionMatrix();
      renderer.setSize(s, s);
    }

    window.addEventListener('resize', handleResize);
    handleResize();
    frameId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener('resize', handleResize);
      mount.removeChild(renderer.domElement);
      renderer.dispose();
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry?.dispose();
          if (Array.isArray(obj.material)) {
            obj.material.forEach((m) => m.dispose());
          } else {
            obj.material?.dispose();
          }
        }
      });
    };
  }, [style]);

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        ref={mountRef}
        className="w-full aspect-square"
        style={{ pointerEvents: 'none', maxWidth: 240 }}
      />
      <p className="text-[13px] text-ink-muted">{style.label}</p>
    </div>
  );
}

export default function LoadingPreview() {
  return (
    <main className="min-h-screen bg-bg px-4 py-8">
      <h1 className="text-center font-mono text-[18px] font-semibold uppercase tracking-[0.12em] text-ink mb-8">
        Loading Styles
      </h1>
      <div className="mx-auto max-w-5xl grid grid-cols-2 sm:grid-cols-3 gap-6">
        {STYLES.map((style) => (
          <ModelPanel key={style.label} style={style} />
        ))}
      </div>
    </main>
  );
}
