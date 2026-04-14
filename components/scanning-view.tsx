'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import type { ScanResult } from '@/types/garment';

const MODEL_PATH = '/models/globe.glb';
const MODEL_TARGET_SIZE = 2.8;
const CAMERA_FOV = 75;
const CAMERA_Z = 3.5;
const SPIN_SPEED = 0.4;

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

const BLURBS = [
  'Reading garment label',
  'Analyzing fabric makeup',
  'Researching climate impact',
  'Tracing supply chain origins',
  'Calculating water footprint',
  'Estimating carbon emissions',
  'Evaluating dye toxicity',
  'Finding nearby drop-off points',
  'Checking brand sustainability',
  'Compiling your results',
];

function BlurbCycler() {
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setIndex((i) => (i + 1) % BLURBS.length);
        setVisible(true);
      }, 400);
    }, 2800);
    return () => clearInterval(interval);
  }, []);

  return (
    <p
      className="mt-6 text-[15px] text-ink-muted transition-opacity duration-400"
      style={{ opacity: visible ? 1 : 0 }}
    >
      {BLURBS[index]}...
    </p>
  );
}

type PendingData = {
  files: string[];
  hasGarmentPhoto: boolean;
};

type ScanResponse = {
  id: string;
  text: string;
  result: ScanResult;
};

function getCurrentCoords(): Promise<{ lat: number; lng: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 },
    );
  });
}

function waitForPending(maxWait = 3000): Promise<PendingData | null> {
  return new Promise((resolve) => {
    const start = Date.now();
    function check() {
      const raw = sessionStorage.getItem('scan:pending');
      if (raw) {
        sessionStorage.removeItem('scan:pending');
        resolve(JSON.parse(raw));
        return;
      }
      if (Date.now() - start > maxWait) {
        resolve(null);
        return;
      }
      setTimeout(check, 50);
    }
    check();
  });
}

function dataUrlToFile(dataUrl: string, name: string): File {
  const [header, base64] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)?.[1] ?? 'image/jpeg';
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new File([arr], name, { type: mime });
}

export function ScanningView() {
  const router = useRouter();
  const mountRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  const [modelReady, setModelReady] = useState(false);

  // ── 3D scene ───────────────────────────────────────────────────────────

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

  // ── Scan request ───────────────────────────────────────────────────────

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    async function run() {
      const [pending, coords] = await Promise.all([
        waitForPending(),
        getCurrentCoords(),
      ]);

      if (!pending) {
        router.replace('/scan');
        return;
      }

      const formData = new FormData();

      let fileIndex = 0;
      if (pending.hasGarmentPhoto) {
        formData.append('garment_photo', dataUrlToFile(pending.files[0], 'garment.jpg'));
        fileIndex = 1;
      }
      for (let i = fileIndex; i < pending.files.length; i++) {
        formData.append('photo', dataUrlToFile(pending.files[i], `tag-${i}.jpg`));
      }
      if (coords) {
        formData.append('lat', String(coords.lat));
        formData.append('lng', String(coords.lng));
      }

      try {
        const response = await fetch('/api/scan', {
          method: 'POST',
          body: formData,
        });

        const text = await response.text();
        let payload: Partial<ScanResponse> & { error?: string } = {};
        try {
          payload = JSON.parse(text);
        } catch {
          throw new Error(
            `Server error (${response.status}): ${text.slice(0, 200) || 'empty response'}`,
          );
        }

        if (!response.ok) {
          throw new Error(payload.error ?? 'Scan failed.');
        }

        if (payload.id && payload.result && typeof payload.text === 'string') {
          sessionStorage.setItem(
            `scan:${payload.id}`,
            JSON.stringify({
              text: payload.text,
              result: payload.result,
              previews: pending.files,
            }),
          );
          router.replace(`/result/${payload.id}`);
        }
      } catch (err) {
        console.error('[scanning] failed:', err);
        sessionStorage.setItem(
          'scan:error',
          err instanceof Error ? err.message : 'Scan failed.',
        );
        router.replace('/scan');
      }
    }

    void run();
  }, [router]);

  return (
    <main className="flex-1 overflow-hidden bg-bg flex flex-col items-center justify-center px-4">
      <div
        ref={mountRef}
        className="w-full transition-opacity duration-700"
        style={{ height: 260, pointerEvents: 'none', opacity: modelReady ? 1 : 0 }}
      />
      <BlurbCycler />
    </main>
  );
}
