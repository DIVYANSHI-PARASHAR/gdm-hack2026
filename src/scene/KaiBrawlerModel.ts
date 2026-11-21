import * as THREE from 'three';

export function createGucciGGCanvasTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    // Classic Gucci Beige & Ebony canvas base
    ctx.fillStyle = '#c8b496';
    ctx.fillRect(0, 0, 256, 256);

    // Fine woven canvas crosshatch grain
    ctx.strokeStyle = 'rgba(74, 56, 40, 0.14)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 256; i += 4) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 256);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(256, i);
      ctx.stroke();
    }

    // Diamond lattice + interlocking GG monogram pattern
    const step = 42;
    ctx.strokeStyle = '#3b2d22';
    ctx.lineWidth = 1.6;
    ctx.setLineDash([3, 3]);
    for (let x = -256; x < 512; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 256, 256);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + 256, 0);
      ctx.lineTo(x, 256);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    ctx.fillStyle = '#36281e';
    ctx.font = 'bold 13px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let row = 0; row <= 6; row++) {
      for (let col = 0; col <= 6; col++) {
        const cx = col * step + (row % 2 === 1 ? step * 0.5 : 0);
        const cy = row * step * 0.5;
        ctx.fillText('GG', cx, cy);
      }
    }

    // Signature Gucci Green-Red-Green Web stripe accent band across trim
    ctx.fillStyle = '#185a37';
    ctx.fillRect(0, 212, 256, 14);
    ctx.fillStyle = '#b82228';
    ctx.fillRect(0, 226, 256, 14);
    ctx.fillStyle = '#185a37';
    ctx.fillRect(0, 240, 256, 16);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2.2, 2.2);
  return tex;
}

export interface KaiArmRig {
  shoulder: THREE.Group;
  elbow: THREE.Group;
  wrist: THREE.Group;
  telegraphRing: THREE.Mesh;
}

export interface KaiLegRig {
  hip: THREE.Group;
  knee: THREE.Group;
  ankle: THREE.Group;
}

export interface KaiBrawlerRig {
  root: THREE.Group;
  pelvis: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  screenLeftArm: KaiArmRig; // Located at x < 0 (Kai's anatomical right arm)
  screenRightArm: KaiArmRig; // Located at x > 0 (Kai's anatomical left arm)
  screenLeftLeg: KaiLegRig; // Located at x < 0 (Kai's anatomical right leg)
  screenRightLeg: KaiLegRig; // Located at x > 0 (Kai's anatomical left leg)
  cyberConduitMat: THREE.MeshStandardMaterial;
  knuckleStudMat: THREE.MeshStandardMaterial;
  honeycombMat: THREE.MeshStandardMaterial;
  faceImplantMat: THREE.MeshStandardMaterial;
  cyberGlowLight: THREE.PointLight;
  flashableMaterials: THREE.MeshStandardMaterial[];
}

export interface PlayerHandRig {
  group: THREE.Group;
  conduitMat: THREE.MeshStandardMaterial;
  knuckleStudMat: THREE.MeshStandardMaterial;
  honeycombMat: THREE.MeshStandardMaterial;
}

interface SharedBrawlerTextures {
  wrapTex: THREE.CanvasTexture;
  brushedMetalTex: THREE.CanvasTexture;
  tacticalFabricTex: THREE.CanvasTexture;
  honeycombTex: THREE.CanvasTexture;
}

let cachedTextures: SharedBrawlerTextures | null = null;

function getSharedTextures(): SharedBrawlerTextures {
  if (cachedTextures) return cachedTextures;

  cachedTextures = {
    wrapTex: createWrapFabricTexture(),
    brushedMetalTex: createBrushedMetalTexture(),
    tacticalFabricTex: createTacticalFabricTexture(),
    honeycombTex: createHoneycombGlowTexture(),
  };
  return cachedTextures;
}

function createWrapFabricTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    ctx.fillStyle = '#7e7260';
    ctx.fillRect(0, 0, 256, 256);

    // Layered bandage wrap strips with weathered edges
    const bandCount = 8;
    const bandH = 256 / bandCount;
    for (let i = 0; i < bandCount; i++) {
      const y = i * bandH;
      const tones = ['#877b68', '#776b59', '#817563', '#6f6453'];
      ctx.fillStyle = tones[i % tones.length];
      ctx.fillRect(0, y, 256, bandH);

      // Overlap shadow & highlight crease
      ctx.fillStyle = 'rgba(28, 22, 16, 0.42)';
      ctx.fillRect(0, y, 256, 3);
      ctx.fillStyle = 'rgba(215, 200, 178, 0.22)';
      ctx.fillRect(0, y + 3, 256, 2);
    }

    // Fine cotton gauze cross-weave grain
    ctx.strokeStyle = 'rgba(42, 35, 27, 0.18)';
    ctx.lineWidth = 1;
    for (let x = 0; x < 256; x += 4) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 8, 256);
      ctx.stroke();
    }
    for (let y = 0; y < 256; y += 3) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(256, y);
      ctx.stroke();
    }

    // Subtle combat sweat/scuff weathering
    for (let s = 0; s < 140; s++) {
      const rx = (s * 73) % 256;
      const ry = (s * 139) % 256;
      ctx.fillStyle = s % 2 === 0 ? 'rgba(35,28,20,0.14)' : 'rgba(210,196,172,0.1)';
      ctx.fillRect(rx, ry, 3, 2);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

function createBrushedMetalTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    const grad = ctx.createLinearGradient(0, 0, 256, 0);
    grad.addColorStop(0, '#7c8490');
    grad.addColorStop(0.35, '#a8b1bd');
    grad.addColorStop(0.68, '#858e9b');
    grad.addColorStop(1, '#757d89');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);

    // Anisotropic brushed titanium micro-scratches
    for (let i = 0; i < 220; i++) {
      const y = (i * 19) % 256;
      ctx.strokeStyle =
        i % 3 === 0 ? 'rgba(255,255,255,0.14)' : 'rgba(20,26,36,0.16)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(256, y + ((i % 5) - 2));
      ctx.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

function createTacticalFabricTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    ctx.fillStyle = '#3a4437'; // Tactical Olive nylon
    ctx.fillRect(0, 0, 128, 128);

    // Quilted puffer baffle horizontal channels
    const baffleHeight = 32;
    for (let y = 0; y < 128; y += baffleHeight) {
      // Puffer gradient swell (rounded down-filled baffle)
      const grad = ctx.createLinearGradient(0, y, 0, y + baffleHeight);
      grad.addColorStop(0, '#2b3329'); // Top seam shadow
      grad.addColorStop(0.2, '#4a5746'); // Upper highlight ridge
      grad.addColorStop(0.5, '#404c3d'); // Mid body
      grad.addColorStop(0.85, '#353e32'); // Lower contour
      grad.addColorStop(1, '#20261e'); // Bottom seam crease
      ctx.fillStyle = grad;
      ctx.fillRect(0, y, 128, baffleHeight);

      // Horizontal baffle stitch line
      ctx.strokeStyle = '#181d17';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(128, y);
      ctx.stroke();

      // Stitch thread dashed highlight
      ctx.strokeStyle = '#5a6955';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(0, y + 2);
      ctx.lineTo(128, y + 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Micro ripstop nylon weave
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 128; i += 8) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 128);
      ctx.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 4);
  return tex;
}

function createHoneycombGlowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    ctx.fillStyle = '#140c08';
    ctx.fillRect(0, 0, 128, 128);

    const radGrad = ctx.createRadialGradient(64, 64, 6, 64, 64, 58);
    radGrad.addColorStop(0, 'rgba(255, 165, 40, 0.95)');
    radGrad.addColorStop(0.65, 'rgba(255, 82, 0, 0.75)');
    radGrad.addColorStop(1, 'rgba(30, 12, 6, 0.0)');
    ctx.fillStyle = radGrad;
    ctx.beginPath();
    ctx.arc(64, 64, 58, 0, Math.PI * 2);
    ctx.fill();

    // Draw hexagonal honeycomb cells
    const r = 9;
    const dx = r * 1.75;
    const dy = r * 1.52;
    for (let row = -3; row <= 3; row++) {
      for (let col = -3; col <= 3; col++) {
        const cx = 64 + col * dx + (Math.abs(row) % 2 === 1 ? dx * 0.5 : 0);
        const cy = 64 + row * dy;
        if (Math.hypot(cx - 64, cy - 64) > 46) continue;

        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
          const ang = (k / 6) * Math.PI * 2 + Math.PI / 6;
          const hx = cx + Math.cos(ang) * (r - 1.8);
          const hy = cy + Math.sin(ang) * (r - 1.8);
          if (k === 0) ctx.moveTo(hx, hy);
          else ctx.lineTo(hx, hy);
        }
        ctx.closePath();
        ctx.fillStyle = '#ffb338';
        ctx.fill();
        ctx.strokeStyle = '#291208';
        ctx.lineWidth = 2.2;
        ctx.stroke();
      }
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  return tex;
}

/**
 * Builds the 3D Three.js character model for KAI_THE_BRAWLER based on turnaround sheet:
 * - Sculpted brawler head with shaved undercut mohawk & glowing right-cheek cybernetic implant
 * - High-collar segmented gunmetal tactical vest + glowing orange spinal vertebrae column
 * - Brushed titanium-chrome bionic arms with glowing orange shoulder/elbow rings, muscle seams & forearm honeycomb vents
 * - Weathered khaki Muay-Thai hand wraps with 4 glowing amber knuckle studs & fingerless curled cyber-fists
 * - Tactical cargo trousers with thigh straps, ribbed side armor pouches, beveled knee pads & laced combat boots
 */
export function buildKaiBrawler(): KaiBrawlerRig {
  const textures = getSharedTextures();

  const root = new THREE.Group();
  const pelvis = new THREE.Group();
  const torso = new THREE.Group();
  const head = new THREE.Group();

  // Core PBR Materials
  const skinMat = new THREE.MeshStandardMaterial({
    color: 0xc28664,
    roughness: 0.58,
    metalness: 0.06,
  });
  const stubbleMat = new THREE.MeshStandardMaterial({
    color: 0x433b37,
    roughness: 0.88,
    metalness: 0.04,
  });
  const hairMat = new THREE.MeshStandardMaterial({
    color: 0x181a1f,
    roughness: 0.85,
    metalness: 0.08,
  });
  const lipMat = new THREE.MeshStandardMaterial({
    color: 0x9b624a,
    roughness: 0.52,
    metalness: 0.04,
  });

  const ggTex = createGucciGGCanvasTexture() ?? textures.tacticalFabricTex;
  const vestFabricMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, // Gucci Beige & Ebony Reversible GG Canvas Bomber
    map: ggTex,
    roughness: 0.62,
    metalness: 0.08,
  });
  const vestPlateMat = new THREE.MeshStandardMaterial({
    color: 0x222226, // Reversible black technical poplin & web trim
    map: textures.tacticalFabricTex,
    roughness: 0.44,
    metalness: 0.24,
  });
  const darkCyberMat = new THREE.MeshStandardMaterial({
    color: 0x1b1f26,
    roughness: 0.42,
    metalness: 0.78,
  });
  const bionicChromeMat = new THREE.MeshStandardMaterial({
    color: 0x9aa3b0,
    map: textures.brushedMetalTex,
    roughness: 0.23,
    metalness: 0.89,
  });
  const pantsMat = new THREE.MeshStandardMaterial({
    color: 0x35342f,
    map: textures.tacticalFabricTex,
    roughness: 0.86,
    metalness: 0.08,
  });
  const strapMat = new THREE.MeshStandardMaterial({
    color: 0x1f2024,
    roughness: 0.76,
    metalness: 0.22,
  });
  const bootLeatherMat = new THREE.MeshStandardMaterial({
    color: 0x2c2823,
    roughness: 0.72,
    metalness: 0.16,
  });
  const bootSoleMat = new THREE.MeshStandardMaterial({
    color: 0x141518,
    roughness: 0.92,
    metalness: 0.08,
  });
  const wrapMat = new THREE.MeshStandardMaterial({
    color: 0x9e907b,
    map: textures.wrapTex,
    bumpMap: textures.wrapTex,
    bumpScale: 0.008,
    roughness: 0.88,
    metalness: 0.04,
  });
  const brassRingMat = new THREE.MeshStandardMaterial({
    color: 0xc28a3e,
    roughness: 0.3,
    metalness: 0.82,
  });

  // Dynamic Emissive Cybernetic Materials
  const cyberConduitMat = new THREE.MeshStandardMaterial({
    color: 0xff6200,
    emissive: 0xff5500,
    emissiveIntensity: 2.6,
    roughness: 0.2,
    metalness: 0.2,
  });
  const knuckleStudMat = new THREE.MeshStandardMaterial({
    color: 0xffb326,
    emissive: 0xff8c00,
    emissiveIntensity: 2.8,
    roughness: 0.18,
    metalness: 0.35,
  });
  const honeycombMat = new THREE.MeshStandardMaterial({
    color: 0xff9426,
    map: textures.honeycombTex,
    emissive: 0xff6600,
    emissiveMap: textures.honeycombTex,
    emissiveIntensity: 2.5,
    roughness: 0.25,
    metalness: 0.3,
  });
  const faceImplantMat = new THREE.MeshStandardMaterial({
    color: 0xff6a1a,
    emissive: 0xff5200,
    emissiveIntensity: 2.2,
    roughness: 0.25,
    metalness: 0.3,
  });

  const flashableMaterials: THREE.MeshStandardMaterial[] = [
    vestPlateMat,
    vestFabricMat,
    bionicChromeMat,
    darkCyberMat,
    pantsMat,
  ];

  // =========================================================================
  // 1. PELVIS & TACTICAL UTILITY BELT (y = 0.96 above ring floor)
  // =========================================================================
  pelvis.position.set(0, 0.96, 0);
  root.add(pelvis);

  const pelvisCore = new THREE.Mesh(
    new THREE.CylinderGeometry(0.185, 0.165, 0.17, 16),
    pantsMat
  );
  pelvisCore.scale.set(1.18, 1, 0.82);
  pelvisCore.position.set(0, -0.01, 0);
  pelvis.add(pelvisCore);

  const gluteSeat = new THREE.Mesh(
    new THREE.SphereGeometry(0.165, 14, 12),
    pantsMat
  );
  gluteSeat.scale.set(1.22, 0.72, 0.88);
  gluteSeat.position.set(0, -0.03, -0.02);
  pelvis.add(gluteSeat);

  // Heavy tactical belt + center gunmetal buckle
  const beltBand = new THREE.Mesh(
    new THREE.CylinderGeometry(0.194, 0.194, 0.056, 20),
    strapMat
  );
  beltBand.scale.set(1.18, 1, 0.84);
  beltBand.position.set(0, 0.052, 0);
  pelvis.add(beltBand);

  const beltBuckle = new THREE.Mesh(
    new THREE.BoxGeometry(0.075, 0.064, 0.032),
    vestPlateMat
  );
  beltBuckle.position.set(0, 0.052, 0.162);
  pelvis.add(beltBuckle);

  const bucklePin = new THREE.Mesh(
    new THREE.BoxGeometry(0.026, 0.044, 0.038),
    darkCyberMat
  );
  bucklePin.position.set(0, 0.052, 0.165);
  pelvis.add(bucklePin);

  [-0.14, -0.07, 0.07, 0.14].forEach((bx) => {
    const loop = new THREE.Mesh(
      new THREE.BoxGeometry(0.018, 0.066, 0.024),
      strapMat
    );
    loop.position.set(bx, 0.052, 0.152 - Math.abs(bx) * 0.18);
    pelvis.add(loop);
  });

  // =========================================================================
  // 2. LEGS: CARGO PANTS, RIBBED SIDE POUCHES, KNEE PADS & COMBAT BOOTS
  // =========================================================================
  const screenLeftLeg = createKaiLeg(-1, pantsMat, strapMat, vestPlateMat, darkCyberMat, bootLeatherMat, bootSoleMat);
  const screenRightLeg = createKaiLeg(1, pantsMat, strapMat, vestPlateMat, darkCyberMat, bootLeatherMat, bootSoleMat);
  pelvis.add(screenLeftLeg.hip);
  pelvis.add(screenRightLeg.hip);

  // =========================================================================
  // 3. TORSO: SEGMENTED ARMORED VEST, COLLAR & GLOWING SPINE
  // =========================================================================
  torso.position.set(0, 0.08, 0);
  pelvis.add(torso);

  // Lower abdominal ballistic core
  const lowerTorso = new THREE.Mesh(
    new THREE.CylinderGeometry(0.215, 0.182, 0.28, 18),
    vestFabricMat
  );
  lowerTorso.scale.set(1.18, 1, 0.8);
  lowerTorso.position.set(0, 0.14, 0);
  torso.add(lowerTorso);

  // Broad athletic V-taper chest/lats core
  const upperTorso = new THREE.Mesh(
    new THREE.CylinderGeometry(0.258, 0.212, 0.31, 18),
    vestFabricMat
  );
  upperTorso.scale.set(1.24, 1, 0.85);
  upperTorso.position.set(0, 0.39, 0);
  torso.add(upperTorso);

  // Trapezius slope into neck
  const traps = new THREE.Mesh(
    new THREE.CylinderGeometry(0.145, 0.245, 0.11, 16),
    vestFabricMat
  );
  traps.scale.set(1.22, 1, 0.84);
  traps.position.set(0, 0.54, -0.01);
  torso.add(traps);

  // Sculpted Left & Right Pectoral Armor Plates
  [-1, 1].forEach((side) => {
    const pecGroup = new THREE.Group();
    pecGroup.position.set(side * 0.112, 0.4, 0.172);
    pecGroup.rotation.y = side * -0.14;
    pecGroup.rotation.x = -0.08;
    torso.add(pecGroup);

    const pecMain = new THREE.Mesh(
      new THREE.BoxGeometry(0.185, 0.175, 0.048),
      vestPlateMat
    );
    pecGroup.add(pecMain);

    const pecUpperBevel = new THREE.Mesh(
      new THREE.BoxGeometry(0.155, 0.055, 0.054),
      vestPlateMat
    );
    pecUpperBevel.position.set(side * 0.01, 0.068, -0.004);
    pecUpperBevel.rotation.z = side * -0.18;
    pecGroup.add(pecUpperBevel);

    // Shoulder harness buckle port on upper chest
    const buckle = new THREE.Mesh(
      new THREE.BoxGeometry(0.052, 0.068, 0.036),
      darkCyberMat
    );
    buckle.position.set(side * 0.038, 0.105, -0.012);
    buckle.rotation.z = side * -0.22;
    pecGroup.add(buckle);
  });

  // 3x2 Segmented Abdominal Armor Plates ("6-pack" tactical vest)
  const abRows = [
    { y: 0.258, w: 0.104, h: 0.068, z: 0.168 },
    { y: 0.174, w: 0.098, h: 0.066, z: 0.162 },
    { y: 0.092, w: 0.09, h: 0.062, z: 0.154 },
  ];
  abRows.forEach((row) => {
    [-1, 1].forEach((side) => {
      const abPlate = new THREE.Mesh(
        new THREE.BoxGeometry(row.w, row.h, 0.038),
        vestPlateMat
      );
      abPlate.position.set(side * (row.w * 0.56), row.y, row.z);
      abPlate.rotation.y = side * -0.08;
      torso.add(abPlate);
    });
  });

  // Lateral Oblique / Rib Armor Panels
  [-1, 1].forEach((side) => {
    [0.26, 0.16].forEach((ry, idx) => {
      const ribPlate = new THREE.Mesh(
        new THREE.BoxGeometry(0.045, 0.078, 0.155 - idx * 0.015),
        vestPlateMat
      );
      ribPlate.position.set(side * (0.225 - idx * 0.015), ry, 0.03);
      ribPlate.rotation.z = side * 0.12;
      ribPlate.rotation.y = side * 0.35;
      torso.add(ribPlate);
    });
  });

  // High Padded Tactical Collar (open V-front around neck)
  const collarGroup = new THREE.Group();
  collarGroup.position.set(0, 0.555, -0.012);
  torso.add(collarGroup);

  const collarSegments = 9;
  for (let i = 0; i < collarSegments; i++) {
    // Span from +0.62*PI around back (-Z) to +2.38*PI, leaving front (+Z) open
    const frac = i / (collarSegments - 1);
    const angle = Math.PI * 0.68 + frac * Math.PI * 1.64;
    const seg = new THREE.Mesh(
      new THREE.BoxGeometry(0.062, 0.105, 0.044),
      vestPlateMat
    );
    const rx = Math.sin(angle) * 0.148;
    const rz = Math.cos(angle) * 0.132;
    seg.position.set(rx, 0, rz);
    seg.rotation.y = angle;
    seg.rotation.x = -0.1;
    collarGroup.add(seg);
  }

  // Back Scapula Armor & Glowing Orange Cyber-Spine Column
  [-1, 1].forEach((side) => {
    const backPlate = new THREE.Mesh(
      new THREE.BoxGeometry(0.145, 0.22, 0.042),
      vestPlateMat
    );
    backPlate.position.set(side * 0.128, 0.38, -0.172);
    backPlate.rotation.y = side * 0.16;
    backPlate.rotation.z = side * -0.08;
    torso.add(backPlate);
  });

  const spineTrack = new THREE.Mesh(
    new THREE.BoxGeometry(0.076, 0.44, 0.036),
    darkCyberMat
  );
  spineTrack.position.set(0, 0.29, -0.178);
  torso.add(spineTrack);

  // 7 glowing orange upper-spine vertebrae nodes + 4 lower metallic chevrons
  for (let v = 0; v < 7; v++) {
    const node = new THREE.Mesh(
      new THREE.BoxGeometry(0.036, 0.022, 0.024),
      cyberConduitMat
    );
    node.position.set(0, 0.485 - v * 0.032, -0.194);
    torso.add(node);
  }
  for (let c = 0; c < 4; c++) {
    const chevron = new THREE.Mesh(
      new THREE.BoxGeometry(0.064 - c * 0.006, 0.03, 0.028),
      vestPlateMat
    );
    chevron.position.set(0, 0.24 - c * 0.044, -0.188);
    torso.add(chevron);
  }

  // Subtle warm point light radiating from Kai's superheated bionic arms/torso
  const cyberGlowLight = new THREE.PointLight(0xff6200, 2.6, 5.5);
  cyberGlowLight.position.set(0, 0.38, 0.48);
  torso.add(cyberGlowLight);

  // =========================================================================
  // 4. HEAD: RUGGED FACE, UNDERCUT MOHAWK & GLOWING CYBER IMPLANTS
  // =========================================================================
  head.position.set(0, 0.555, 0.015);
  torso.add(head);
  populateKaiHead(
    head,
    skinMat,
    stubbleMat,
    hairMat,
    lipMat,
    darkCyberMat,
    faceImplantMat
  );

  // =========================================================================
  // 5. CYBERNETIC BIONIC ARMS & WRAPPED BRAWLER FISTS
  // =========================================================================
  const screenLeftArm = createKaiBionicArm(
    -1,
    bionicChromeMat,
    darkCyberMat,
    cyberConduitMat,
    honeycombMat,
    wrapMat,
    knuckleStudMat,
    skinMat,
    brassRingMat
  );
  const screenRightArm = createKaiBionicArm(
    1,
    bionicChromeMat,
    darkCyberMat,
    cyberConduitMat,
    honeycombMat,
    wrapMat,
    knuckleStudMat,
    skinMat,
    brassRingMat
  );
  torso.add(screenLeftArm.shoulder);
  torso.add(screenRightArm.shoulder);

  return {
    root,
    pelvis,
    torso,
    head,
    screenLeftArm,
    screenRightArm,
    screenLeftLeg,
    screenRightLeg,
    cyberConduitMat,
    knuckleStudMat,
    honeycombMat,
    faceImplantMat,
    cyberGlowLight,
    flashableMaterials,
  };
}

function populateKaiHead(
  head: THREE.Group,
  skinMat: THREE.MeshStandardMaterial,
  stubbleMat: THREE.MeshStandardMaterial,
  hairMat: THREE.MeshStandardMaterial,
  lipMat: THREE.MeshStandardMaterial,
  darkCyberMat: THREE.MeshStandardMaterial,
  faceImplantMat: THREE.MeshStandardMaterial
): void {
  // Muscular Neck + Sternocleidomastoid tendons + Rear Cyber Spine Port
  const neck = new THREE.Mesh(
    new THREE.CylinderGeometry(0.072, 0.086, 0.135, 16),
    skinMat
  );
  neck.position.set(0, 0.035, -0.008);
  head.add(neck);

  [-1, 1].forEach((side) => {
    const tendon = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.022, 0.12, 8),
      skinMat
    );
    tendon.position.set(side * 0.036, 0.03, 0.048);
    tendon.rotation.z = side * 0.18;
    tendon.rotation.x = 0.14;
    head.add(tendon);
  });

  const neckPort = new THREE.Mesh(
    new THREE.BoxGeometry(0.032, 0.11, 0.022),
    darkCyberMat
  );
  neckPort.position.set(0, 0.045, -0.076);
  head.add(neckPort);

  // Cranial Dome
  const cranium = new THREE.Mesh(
    new THREE.SphereGeometry(0.112, 24, 20),
    skinMat
  );
  cranium.scale.set(0.92, 1.06, 1.02);
  cranium.position.set(0, 0.182, 0.002);
  head.add(cranium);

  // Shaved Undercut Side-Fade Cap
  const shavedSides = new THREE.Mesh(
    new THREE.SphereGeometry(0.1135, 22, 16, 0, Math.PI * 2, 0, Math.PI * 0.56),
    stubbleMat
  );
  shavedSides.scale.set(0.925, 1.05, 1.025);
  shavedSides.position.set(0, 0.184, -0.004);
  shavedSides.rotation.x = -0.18;
  head.add(shavedSides);

  // Textured Dark Mohawk Hair Strip (front hairline over crown to back)
  for (let m = 0; m < 9; m++) {
    const t = m / 8;
    const angle = -0.62 + t * 1.85;
    const tuft = new THREE.Mesh(
      new THREE.BoxGeometry(
        0.078 - Math.abs(t - 0.35) * 0.022,
        0.038,
        0.048
      ),
      hairMat
    );
    tuft.position.set(
      0,
      0.185 + Math.cos(angle) * 0.118,
      0.004 - Math.sin(angle) * 0.112
    );
    tuft.rotation.x = angle;
    head.add(tuft);
  }

  // Strong Square Brawler Jawline & Chin
  const jawBlock = new THREE.Mesh(
    new THREE.CylinderGeometry(0.088, 0.064, 0.105, 12),
    skinMat
  );
  jawBlock.scale.set(0.96, 1, 1.04);
  jawBlock.position.set(0, 0.122, 0.022);
  head.add(jawBlock);

  const chin = new THREE.Mesh(
    new THREE.SphereGeometry(0.038, 12, 10),
    skinMat
  );
  chin.scale.set(1.18, 0.78, 0.95);
  chin.position.set(0, 0.082, 0.076);
  head.add(chin);

  // Cheekbones
  [-1, 1].forEach((side) => {
    const cheek = new THREE.Mesh(
      new THREE.SphereGeometry(0.042, 12, 10),
      skinMat
    );
    cheek.scale.set(0.88, 0.76, 0.95);
    cheek.position.set(side * 0.062, 0.152, 0.072);
    head.add(cheek);
  });

  // Prominent Furrowed Brow Ridge
  const browRidge = new THREE.Mesh(
    new THREE.BoxGeometry(0.128, 0.026, 0.044),
    skinMat
  );
  browRidge.position.set(0, 0.198, 0.092);
  browRidge.rotation.x = 0.12;
  head.add(browRidge);

  // Nose Bridge & Tip
  const noseBridge = new THREE.Mesh(
    new THREE.BoxGeometry(0.024, 0.048, 0.034),
    skinMat
  );
  noseBridge.position.set(0, 0.168, 0.106);
  noseBridge.rotation.x = -0.22;
  head.add(noseBridge);

  const noseTip = new THREE.Mesh(
    new THREE.SphereGeometry(0.017, 10, 10),
    skinMat
  );
  noseTip.scale.set(1.15, 0.88, 1.1);
  noseTip.position.set(0, 0.146, 0.12);
  head.add(noseTip);

  // Stern Set Mouth / Lips
  const upperLip = new THREE.Mesh(
    new THREE.BoxGeometry(0.052, 0.009, 0.018),
    lipMat
  );
  upperLip.position.set(0, 0.119, 0.102);
  head.add(upperLip);

  const lowerLip = new THREE.Mesh(
    new THREE.BoxGeometry(0.046, 0.01, 0.018),
    lipMat
  );
  lowerLip.position.set(0, 0.109, 0.1);
  head.add(lowerLip);

  // Deep-Set Eyes & Angled Scowling Eyebrows
  const scleraMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    roughness: 0.25,
  });
  const irisMat = new THREE.MeshStandardMaterial({
    color: 0x3b2416,
    roughness: 0.18,
  });
  const pupilMat = new THREE.MeshBasicMaterial({ color: 0x090b10 });

  [-1, 1].forEach((side) => {
    const eyeX = side * 0.038;
    const eyeY = 0.18;
    const eyeZ = 0.094;

    const eyeball = new THREE.Mesh(
      new THREE.SphereGeometry(0.014, 12, 10),
      scleraMat
    );
    eyeball.scale.set(1.15, 0.78, 0.7);
    eyeball.position.set(eyeX, eyeY, eyeZ);
    head.add(eyeball);

    const iris = new THREE.Mesh(
      new THREE.CircleGeometry(0.0072, 12),
      irisMat
    );
    iris.position.set(eyeX, eyeY, eyeZ + 0.0102);
    head.add(iris);

    const pupil = new THREE.Mesh(
      new THREE.CircleGeometry(0.0036, 10),
      pupilMat
    );
    pupil.position.set(eyeX, eyeY, eyeZ + 0.0106);
    head.add(pupil);

    const eyebrow = new THREE.Mesh(
      new THREE.BoxGeometry(0.044, 0.01, 0.016),
      hairMat
    );
    eyebrow.position.set(side * 0.04, 0.198, 0.108);
    eyebrow.rotation.z = side * 0.18; // Angled inward in fierce glare
    eyebrow.rotation.y = side * -0.18;
    head.add(eyebrow);
  });

  // Ears & Dark Cybernetic Jaw-Hinge Trim Plates (visible in both profiles)
  [-1, 1].forEach((side) => {
    const ear = new THREE.Mesh(
      new THREE.BoxGeometry(0.018, 0.046, 0.028),
      skinMat
    );
    ear.position.set(side * 0.102, 0.166, -0.006);
    ear.rotation.z = side * -0.08;
    head.add(ear);

    const jawCyberTrim = new THREE.Mesh(
      new THREE.BoxGeometry(0.016, 0.056, 0.036),
      darkCyberMat
    );
    jawCyberTrim.position.set(side * 0.088, 0.125, 0.018);
    jawCyberTrim.rotation.z = side * 0.24;
    jawCyberTrim.rotation.y = side * 0.28;
    head.add(jawCyberTrim);
  });

  // Signature Glowing Orange Cybernetic Implant on Kai's Right Cheek/Eye (x < 0)
  const rightCheekTrace1 = new THREE.Mesh(
    new THREE.BoxGeometry(0.046, 0.007, 0.012),
    faceImplantMat
  );
  rightCheekTrace1.position.set(-0.056, 0.156, 0.094);
  rightCheekTrace1.rotation.y = -0.52;
  rightCheekTrace1.rotation.z = 0.24;
  head.add(rightCheekTrace1);

  const rightCheekTrace2 = new THREE.Mesh(
    new THREE.BoxGeometry(0.042, 0.006, 0.01),
    faceImplantMat
  );
  rightCheekTrace2.position.set(-0.084, 0.168, 0.056);
  rightCheekTrace2.rotation.y = -1.18;
  rightCheekTrace2.rotation.z = -0.18;
  head.add(rightCheekTrace2);

  const rightTempleNode = new THREE.Mesh(
    new THREE.CylinderGeometry(0.008, 0.008, 0.008, 10),
    faceImplantMat
  );
  rightTempleNode.rotation.x = Math.PI / 2;
  rightTempleNode.position.set(-0.048, 0.222, 0.098);
  head.add(rightTempleNode);

  // Subtle dark cyber-port node above Left Eyebrow (x > 0, matches Front/Left Profile)
  const leftBrowNode = new THREE.Mesh(
    new THREE.CylinderGeometry(0.008, 0.008, 0.008, 10),
    darkCyberMat
  );
  leftBrowNode.rotation.x = Math.PI / 2;
  leftBrowNode.position.set(0.052, 0.222, 0.096);
  head.add(leftBrowNode);
}

function createKaiBionicArm(
  sideSign: -1 | 1,
  chromeMat: THREE.MeshStandardMaterial,
  darkCyberMat: THREE.MeshStandardMaterial,
  conduitMat: THREE.MeshStandardMaterial,
  honeycombMat: THREE.MeshStandardMaterial,
  wrapMat: THREE.MeshStandardMaterial,
  knuckleStudMat: THREE.MeshStandardMaterial,
  skinMat: THREE.MeshStandardMaterial,
  brassRingMat: THREE.MeshStandardMaterial
): KaiArmRig {
  // Anatomical arm extending along -Y in rest pose:
  // +Z = Anterior (Bicep / Thumb side), -Z = Posterior (Tricep / Pinky side)
  // +sideSign * X = Lateral / Dorsal back-of-hand, -sideSign * X = Medial / Palm
  const shoulder = new THREE.Group();
  shoulder.position.set(sideSign * 0.315, 0.455, 0.0);

  // Dark inner mechanical shoulder ball socket
  const socket = new THREE.Mesh(
    new THREE.SphereGeometry(0.078, 16, 14),
    darkCyberMat
  );
  shoulder.add(socket);

  // Sculpted Chrome-Titanium Deltoid Cap
  const deltoid = new THREE.Mesh(
    new THREE.SphereGeometry(0.092, 18, 16),
    chromeMat
  );
  deltoid.scale.set(0.95, 1.28, 0.98);
  deltoid.position.set(sideSign * 0.024, -0.042, 0);
  shoulder.add(deltoid);

  // Iconic Glowing Orange Circular Lateral Shoulder Ring
  const shoulderRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.044, 0.0075, 10, 24),
    conduitMat
  );
  shoulderRing.rotation.y = Math.PI / 2;
  shoulderRing.position.set(sideSign * 0.106, -0.036, 0);
  shoulder.add(shoulderRing);

  // Glowing Orange Deltoid-to-Bicep Seam Conduit
  const deltoidSeam = new THREE.Mesh(
    new THREE.TorusGeometry(0.074, 0.007, 8, 20),
    conduitMat
  );
  deltoidSeam.rotation.x = Math.PI / 2;
  deltoidSeam.rotation.y = sideSign * 0.32;
  deltoidSeam.position.set(sideSign * 0.02, -0.125, 0);
  shoulder.add(deltoidSeam);

  // Upper Arm Dark Chassis + Chrome Bicep & Tricep Plates
  const upperCore = new THREE.Mesh(
    new THREE.CylinderGeometry(0.064, 0.056, 0.24, 14),
    darkCyberMat
  );
  upperCore.position.set(sideSign * 0.02, -0.19, 0);
  shoulder.add(upperCore);

  const bicepPlate = new THREE.Mesh(
    new THREE.SphereGeometry(0.068, 14, 12),
    chromeMat
  );
  bicepPlate.scale.set(0.9, 1.65, 0.92);
  bicepPlate.position.set(sideSign * 0.018, -0.195, 0.022);
  shoulder.add(bicepPlate);

  const tricepPlate = new THREE.Mesh(
    new THREE.SphereGeometry(0.066, 14, 12),
    chromeMat
  );
  tricepPlate.scale.set(0.92, 1.68, 0.88);
  tricepPlate.position.set(sideSign * 0.022, -0.185, -0.022);
  shoulder.add(tricepPlate);

  // Glowing Orange Lateral & Medial Upper-Arm Energy Channels
  [-1, 1].forEach((s) => {
    const seam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0065, 0.0065, 0.165, 8),
      conduitMat
    );
    seam.position.set(sideSign * 0.02 + s * 0.058, -0.2, 0);
    shoulder.add(seam);
  });

  // =========================================================================
  // ELBOW PIVOT & BIONIC FOREARM
  // =========================================================================
  const elbow = new THREE.Group();
  elbow.position.set(sideSign * 0.022, -0.305, 0);
  shoulder.add(elbow);

  const elbowCore = new THREE.Mesh(
    new THREE.SphereGeometry(0.058, 14, 12),
    darkCyberMat
  );
  elbow.add(elbowCore);

  // Glowing Orange Circular Lateral Elbow Ring
  const elbowRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.033, 0.0065, 10, 20),
    conduitMat
  );
  elbowRing.rotation.y = Math.PI / 2;
  elbowRing.position.set(sideSign * 0.056, 0, -0.004);
  elbow.add(elbowRing);

  // Wrist / Forearm Twist Group (enables realistic pronation during punches)
  const wrist = new THREE.Group();
  elbow.add(wrist);

  // Upper Metallic Forearm Plates (y = -0.02 down to -0.16)
  const forearmCore = new THREE.Mesh(
    new THREE.CylinderGeometry(0.064, 0.048, 0.17, 14),
    chromeMat
  );
  forearmCore.scale.set(0.95, 1, 1.06);
  forearmCore.position.set(0, -0.088, 0);
  wrist.add(forearmCore);

  // Glowing Orange Forearm Energy Conduits & Wrist Cuff Seam
  [-0.042, 0.042].forEach((fz) => {
    const fSeam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0058, 0.0046, 0.148, 8),
      conduitMat
    );
    fSeam.position.set(sideSign * 0.048, -0.088, fz);
    wrist.add(fSeam);
  });

  const forearmCuffRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.051, 0.0055, 8, 20),
    conduitMat
  );
  forearmCuffRing.rotation.x = Math.PI / 2;
  forearmCuffRing.position.set(0, -0.15, 0);
  wrist.add(forearmCuffRing);

  // Glowing Orange Hexagonal Honeycomb Vent on Anterior/Inner Forearm
  const ventBezel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.032, 0.032, 0.01, 6),
    darkCyberMat
  );
  ventBezel.rotation.x = Math.PI / 2;
  ventBezel.position.set(-sideSign * 0.014, -0.095, 0.052);
  wrist.add(ventBezel);

  const honeycombDisc = new THREE.Mesh(
    new THREE.CircleGeometry(0.027, 6),
    honeycombMat
  );
  honeycombDisc.position.set(-sideSign * 0.014, -0.095, 0.058);
  wrist.add(honeycombDisc);

  // =========================================================================
  // WEATHERED CLOTH HAND WRAPS, 4 GLOWING KNUCKLE STUDS & BRAWLER FIST
  // =========================================================================
  // Layered overlapping wrist wrap bands (y = -0.155 down to -0.25)
  for (let w = 0; w < 5; w++) {
    const rTop = 0.052 - w * 0.0018;
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(rTop, rTop * 0.98, 0.025, 14),
      wrapMat
    );
    band.scale.set(0.9, 1, 1.12);
    band.position.set(0, -0.162 - w * 0.02, 0);
    band.rotation.z = (w % 2 === 0 ? 1 : -1) * 0.07;
    band.rotation.x = (w % 2 === 0 ? -1 : 1) * 0.05;
    wrist.add(band);
  }

  // Wrapped Metacarpal Hand Body
  const wrappedPalm = new THREE.Mesh(
    new THREE.BoxGeometry(0.068, 0.086, 0.096),
    wrapMat
  );
  wrappedPalm.position.set(0, -0.285, 0.002);
  wrist.add(wrappedPalm);

  // Diagonal criss-cross cloth strap across dorsal hand
  const crossWrap = new THREE.Mesh(
    new THREE.BoxGeometry(0.073, 0.026, 0.098),
    wrapMat
  );
  crossWrap.position.set(0, -0.282, 0.002);
  crossWrap.rotation.x = 0.35;
  wrist.add(crossWrap);

  // 4 Curled Cyber-Tactical Fingers + 4 Glowing Golden-Amber Knuckle Studs
  const fingerZOffsets = [-0.034, -0.011, 0.012, 0.035]; // Pinky (-Z) to Index (+Z)
  fingerZOffsets.forEach((fz) => {
    // Glowing Amber Knuckle Stud on Dorsal-Distal Knuckle Crest
    const bezel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.01, 0.011, 0.008, 10),
      darkCyberMat
    );
    bezel.rotation.z = Math.PI / 2;
    bezel.position.set(sideSign * 0.033, -0.322, fz);
    wrist.add(bezel);

    const stud = new THREE.Mesh(
      new THREE.SphereGeometry(0.0082, 10, 8),
      knuckleStudMat
    );
    stud.position.set(sideSign * 0.036, -0.324, fz);
    wrist.add(stud);

    // Proximal Finger Segment + Brass Cyber Ring
    const prox = new THREE.Mesh(
      new THREE.BoxGeometry(0.024, 0.038, 0.02),
      darkCyberMat
    );
    prox.position.set(sideSign * 0.012, -0.342, fz);
    wrist.add(prox);

    const brassBand = new THREE.Mesh(
      new THREE.BoxGeometry(0.026, 0.01, 0.021),
      brassRingMat
    );
    brassBand.position.set(sideSign * 0.012, -0.336, fz);
    wrist.add(brassBand);

    // Curled Middle/Distal Finger Segment tucked into palm (-sideSign * X)
    const curledTip = new THREE.Mesh(
      new THREE.BoxGeometry(0.034, 0.022, 0.019),
      skinMat
    );
    curledTip.position.set(-sideSign * 0.012, -0.346, fz);
    wrist.add(curledTip);
  });

  // Clamped Thumb across Front/Palmar Side (+Z / -sideSign * X)
  const thumbBase = new THREE.Mesh(
    new THREE.BoxGeometry(0.034, 0.048, 0.032),
    wrapMat
  );
  thumbBase.position.set(-sideSign * 0.016, -0.285, 0.052);
  thumbBase.rotation.x = 0.28;
  wrist.add(thumbBase);

  const thumbTip = new THREE.Mesh(
    new THREE.BoxGeometry(0.028, 0.038, 0.026),
    skinMat
  );
  thumbTip.position.set(-sideSign * 0.022, -0.322, 0.038);
  thumbTip.rotation.x = -0.55;
  wrist.add(thumbTip);

  // Expanding Holographic Telegraph Ring around the Striking Fist
  const telegraphRing = new THREE.Mesh(
    new THREE.RingGeometry(0.16, 0.22, 28),
    new THREE.MeshBasicMaterial({
      color: 0xff3b30,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
    })
  );
  telegraphRing.rotation.x = Math.PI / 2;
  telegraphRing.position.set(0, -0.355, 0);
  wrist.add(telegraphRing);

  return {
    shoulder,
    elbow,
    wrist,
    telegraphRing,
  };
}

function createKaiLeg(
  sideSign: -1 | 1,
  pantsMat: THREE.MeshStandardMaterial,
  strapMat: THREE.MeshStandardMaterial,
  armorPlateMat: THREE.MeshStandardMaterial,
  darkCyberMat: THREE.MeshStandardMaterial,
  bootLeatherMat: THREE.MeshStandardMaterial,
  bootSoleMat: THREE.MeshStandardMaterial
): KaiLegRig {
  const hip = new THREE.Group();
  hip.position.set(sideSign * 0.152, -0.03, 0);

  // Muscular Cargo Thigh (0 down to -0.44)
  const thigh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.116, 0.094, 0.44, 16),
    pantsMat
  );
  thigh.scale.set(1.04, 1, 1.02);
  thigh.position.set(0, -0.22, 0);
  hip.add(thigh);

  // Dual Horizontal Tactical Thigh Webbing Straps
  [-0.14, -0.26].forEach((sy) => {
    const thighStrap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.112, 0.108, 0.028, 16),
      strapMat
    );
    thighStrap.position.set(0, sy, 0);
    hip.add(thighStrap);
  });

  // Bulky Ribbed Side Thigh Cargo Armor Pouch (Outer Thigh)
  const pouchGroup = new THREE.Group();
  pouchGroup.position.set(sideSign * 0.114, -0.2, 0.008);
  pouchGroup.rotation.z = sideSign * -0.05;
  hip.add(pouchGroup);

  const pouchBody = new THREE.Mesh(
    new THREE.BoxGeometry(0.048, 0.175, 0.138),
    pantsMat
  );
  pouchGroup.add(pouchBody);

  for (let r = 0; r < 4; r++) {
    const rib = new THREE.Mesh(
      new THREE.BoxGeometry(0.054, 0.026, 0.126),
      armorPlateMat
    );
    rib.position.set(sideSign * 0.004, 0.058 - r * 0.039, 0);
    pouchGroup.add(rib);
  }

  // Knee Pivot (y = -0.44)
  const knee = new THREE.Group();
  knee.position.set(0, -0.44, 0);
  hip.add(knee);

  // Hard-Shell Beveled Tactical Knee Pad (+Z) + Elastic Straps
  const kneeCushion = new THREE.Mesh(
    new THREE.BoxGeometry(0.125, 0.145, 0.048),
    strapMat
  );
  kneeCushion.position.set(0, 0.005, 0.082);
  knee.add(kneeCushion);

  const kneeCap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.068, 0.068, 0.032, 8),
    armorPlateMat
  );
  kneeCap.rotation.x = Math.PI / 2;
  kneeCap.rotation.z = Math.PI / 8;
  kneeCap.scale.set(0.95, 1, 1.15);
  kneeCap.position.set(0, 0.005, 0.1);
  knee.add(kneeCap);

  [0.045, -0.038].forEach((ky) => {
    const kStrap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.094, 0.092, 0.022, 14),
      strapMat
    );
    kStrap.position.set(0, ky, 0);
    knee.add(kStrap);
  });

  // Lower Pant Leg / Calf + Bloused Trouser Cuff above Boot
  const calf = new THREE.Mesh(
    new THREE.CylinderGeometry(0.092, 0.076, 0.24, 14),
    pantsMat
  );
  calf.position.set(0, -0.12, -0.006);
  knee.add(calf);

  const blousedCuff = new THREE.Mesh(
    new THREE.TorusGeometry(0.074, 0.019, 8, 16),
    pantsMat
  );
  blousedCuff.rotation.x = Math.PI / 2;
  blousedCuff.position.set(0, -0.225, 0);
  knee.add(blousedCuff);

  // Ankle & Heavy Laced Combat Boot (y = -0.39, sole bottom at -0.10 -> world y = 0.0)
  const ankle = new THREE.Group();
  ankle.position.set(0, -0.39, 0);
  knee.add(ankle);

  const bootShaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.074, 0.068, 0.19, 14),
    bootLeatherMat
  );
  bootShaft.position.set(0, 0.075, 0);
  ankle.add(bootShaft);

  // Lace Rungs up front of Boot Shaft
  for (let l = 0; l < 5; l++) {
    const lace = new THREE.Mesh(
      new THREE.BoxGeometry(0.056, 0.009, 0.018),
      darkCyberMat
    );
    lace.position.set(0, 0.015 + l * 0.028, 0.068);
    ankle.add(lace);
  }

  // Boot Foot Vamp & Rounded Toe Box
  const bootFoot = new THREE.Mesh(
    new THREE.BoxGeometry(0.118, 0.072, 0.21),
    bootLeatherMat
  );
  bootFoot.position.set(0, -0.038, 0.046);
  ankle.add(bootFoot);

  const toeCap = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 14, 10),
    bootLeatherMat
  );
  toeCap.scale.set(0.98, 0.64, 1.05);
  toeCap.position.set(0, -0.044, 0.145);
  ankle.add(toeCap);

  // Thick Lugged Rubber Outsole resting at y = -0.10
  const outsole = new THREE.Mesh(
    new THREE.BoxGeometry(0.126, 0.032, 0.255),
    bootSoleMat
  );
  outsole.position.set(0, -0.084, 0.052);
  ankle.add(outsole);

  return { hip, knee, ankle };
}

/**
 * Builds the First-Person Player Cyber-Brawler Hand & Forearm matching KAI_THE_BRAWLER's aesthetic:
 * - Brushed titanium-chrome bionic forearm armor with glowing fiery orange conduits & hexagonal honeycomb power vent
 * - Multi-layered khaki/taupe Muay-Thai cloth hand wraps with figure-8 metacarpal straps
 * - 4 glowing amber-gold cyber knuckle emitter studs
 * - Sculpted fingerless-wrap brawler fist with brass finger rings & clamped thumb
 */
export function createPlayerBrawlerHand(sideSign: -1 | 1): PlayerHandRig {
  const textures = getSharedTextures();
  const group = new THREE.Group();

  const bionicChromeMat = new THREE.MeshStandardMaterial({
    color: 0x9ba4b2,
    map: textures.brushedMetalTex,
    roughness: 0.22,
    metalness: 0.89,
  });
  const darkCyberMat = new THREE.MeshStandardMaterial({
    color: 0x1b1f27,
    roughness: 0.4,
    metalness: 0.8,
  });
  const wrapMat = new THREE.MeshStandardMaterial({
    color: 0xa2937d,
    map: textures.wrapTex,
    bumpMap: textures.wrapTex,
    bumpScale: 0.01,
    roughness: 0.87,
    metalness: 0.04,
  });
  const skinMat = new THREE.MeshStandardMaterial({
    color: 0xc28664,
    roughness: 0.56,
    metalness: 0.06,
  });
  const brassRingMat = new THREE.MeshStandardMaterial({
    color: 0xc99142,
    roughness: 0.28,
    metalness: 0.84,
  });

  const conduitMat = new THREE.MeshStandardMaterial({
    color: 0xff6200,
    emissive: 0xff5500,
    emissiveIntensity: 2.5,
    roughness: 0.2,
    metalness: 0.2,
  });
  const knuckleStudMat = new THREE.MeshStandardMaterial({
    color: 0xffbc38,
    emissive: 0xff9000,
    emissiveIntensity: 2.8,
    roughness: 0.16,
    metalness: 0.35,
  });
  const honeycombMat = new THREE.MeshStandardMaterial({
    color: 0xff9828,
    map: textures.honeycombTex,
    emissive: 0xff6600,
    emissiveMap: textures.honeycombTex,
    emissiveIntensity: 2.6,
    roughness: 0.24,
    metalness: 0.3,
    side: THREE.DoubleSide,
  });

  // Local orientation of PlayerHandRig:
  // -Z = Distal (striking knuckles pointing forward toward opponent)
  // +Z = Proximal (cybernetic forearm extending back toward elbow)
  // +Y = Dorsal back-of-hand & top forearm plate
  // -Y = Palmar (curled fingers & palm)
  // -sideSign * X = Inner/Radial (Thumb & Honeycomb Power Vent)
  // +sideSign * X = Outer/Ulnar (Pinky ridge)

  // =========================================================================
  // 1. CYBERNETIC BIONIC FOREARM (+Z = +0.10 .. +0.48)
  // =========================================================================
  const forearmChassis = new THREE.Mesh(
    new THREE.CylinderGeometry(0.074, 0.056, 0.38, 16),
    darkCyberMat
  );
  forearmChassis.rotation.x = Math.PI / 2;
  forearmChassis.scale.set(1.06, 1, 0.92);
  forearmChassis.position.set(0, -0.004, 0.29);
  group.add(forearmChassis);

  // Dorsal Sculpted Chrome Forearm Armor Plate (wider at elbow +Z, tapered at wrist -Z)
  const dorsalPlate = new THREE.Mesh(
    new THREE.CylinderGeometry(
      0.077,
      0.058,
      0.34,
      14,
      1,
      false,
      Math.PI * 0.56,
      Math.PI * 0.88
    ),
    bionicChromeMat
  );
  dorsalPlate.rotation.x = Math.PI / 2;
  dorsalPlate.position.set(0, 0.008, 0.285);
  group.add(dorsalPlate);

  // Radial Brachioradialis Muscle Chrome Plate (inner/thumb side)
  const radialMuscle = new THREE.Mesh(
    new THREE.SphereGeometry(0.055, 14, 12),
    bionicChromeMat
  );
  radialMuscle.scale.set(0.75, 0.82, 2.85);
  radialMuscle.position.set(-sideSign * 0.032, 0.012, 0.28);
  group.add(radialMuscle);

  // Ulnar Outer Chrome Plate
  const ulnarMuscle = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 14, 12),
    bionicChromeMat
  );
  ulnarMuscle.scale.set(0.72, 0.78, 2.75);
  ulnarMuscle.position.set(sideSign * 0.034, 0.006, 0.285);
  group.add(ulnarMuscle);

  // Glowing Fiery Orange Forearm Seam Conduits
  [-1, 1].forEach((s) => {
    const seamLine = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0072, 0.0054, 0.33, 8),
      conduitMat
    );
    seamLine.rotation.x = Math.PI / 2;
    seamLine.position.set(s * 0.044, 0.036, 0.28);
    group.add(seamLine);
  });

  // Glowing Orange Wrist-Transition Energy Ring (where metal meets cloth wraps)
  const wristEnergyArc = new THREE.Mesh(
    new THREE.TorusGeometry(0.058, 0.006, 8, 22),
    conduitMat
  );
  wristEnergyArc.scale.set(1.06, 0.9, 1);
  wristEnergyArc.position.set(0, 0, 0.118);
  group.add(wristEnergyArc);

  // Signature Glowing Orange Hexagonal Honeycomb Power Vent on Inner-Radial Forearm
  const ventFrame = new THREE.Mesh(
    new THREE.CylinderGeometry(0.033, 0.033, 0.012, 6),
    darkCyberMat
  );
  ventFrame.rotation.z = sideSign * (Math.PI / 2 - 0.35);
  ventFrame.position.set(-sideSign * 0.058, 0.016, 0.235);
  group.add(ventFrame);

  const ventHoneycomb = new THREE.Mesh(
    new THREE.CircleGeometry(0.028, 6),
    honeycombMat
  );
  ventHoneycomb.rotation.y = -sideSign * (Math.PI / 2);
  ventHoneycomb.rotation.z = -sideSign * 0.35;
  ventHoneycomb.position.set(-sideSign * 0.065, 0.019, 0.235);
  group.add(ventHoneycomb);

  // =========================================================================
  // 2. LAYERED CLOTH HAND WRAPS (+Z = +0.11 forward to -0.07)
  // =========================================================================
  for (let w = 0; w < 6; w++) {
    const r = 0.058 + (w === 5 ? 0.003 : -w * 0.001);
    const wrapRing = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r * 1.01, 0.028, 16),
      wrapMat
    );
    wrapRing.rotation.x = Math.PI / 2 + (w % 2 === 0 ? 0.06 : -0.06);
    wrapRing.rotation.z = (w % 2 === 0 ? 1 : -1) * 0.08;
    wrapRing.scale.set(1.14, 1, 0.86);
    wrapRing.position.set(0, 0, 0.102 - w * 0.024);
    group.add(wrapRing);
  }

  // Wrapped Metacarpal Hand Core
  const handBlock = new THREE.Mesh(
    new THREE.BoxGeometry(0.132, 0.082, 0.105),
    wrapMat
  );
  handBlock.position.set(0, 0.002, -0.048);
  group.add(handBlock);

  // Criss-cross Figure-8 Cloth Bandages over Back of Hand
  [-1, 1].forEach((diag) => {
    const strap = new THREE.Mesh(
      new THREE.BoxGeometry(0.136, 0.02, 0.046),
      wrapMat
    );
    strap.position.set(0, 0.036, -0.044);
    strap.rotation.y = diag * 0.36;
    group.add(strap);
  });

  // =========================================================================
  // 3. 4 GLOWING AMBER KNUCKLE STUDS & FINGERLESS CURLED CYBER FIST
  // =========================================================================
  // Ordered from Index (-sideSign * X) across to Pinky (+sideSign * X)
  const fingerSpecs = [
    { offset: -0.046, len: 0.05, width: 0.028 },
    { offset: -0.015, len: 0.054, width: 0.029 },
    { offset: 0.016, len: 0.051, width: 0.028 },
    { offset: 0.046, len: 0.045, width: 0.026 },
  ];

  fingerSpecs.forEach((spec) => {
    // Index sits on inner thumb side (-sideSign * 0.046), Pinky on outer side (+sideSign * 0.046)
    const fingerX = sideSign * spec.offset;

    // Glowing Golden-Amber Knuckle Emitter Stud on Dorsal-Front Knuckle Ridge
    const studBezel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.013, 0.014, 0.01, 12),
      darkCyberMat
    );
    studBezel.rotation.x = Math.PI / 4;
    studBezel.position.set(fingerX, 0.034, -0.098);
    group.add(studBezel);

    const studGem = new THREE.Mesh(
      new THREE.SphereGeometry(0.0105, 12, 10),
      knuckleStudMat
    );
    studGem.position.set(fingerX, 0.039, -0.103);
    group.add(studGem);

    // Exposed Proximal Finger Segment + Brass Cyber-Knuckle Ring
    const proximal = new THREE.Mesh(
      new THREE.BoxGeometry(spec.width, 0.034, spec.len),
      darkCyberMat
    );
    proximal.position.set(fingerX, 0.004, -0.115);
    proximal.rotation.x = 0.25;
    group.add(proximal);

    const brassBand = new THREE.Mesh(
      new THREE.BoxGeometry(spec.width + 0.002, 0.036, 0.012),
      brassRingMat
    );
    brassBand.position.set(fingerX, 0.005, -0.106);
    brassBand.rotation.x = 0.25;
    group.add(brassBand);

    // Middle Phalanx curving downward (-Y)
    const middle = new THREE.Mesh(
      new THREE.BoxGeometry(spec.width * 0.94, 0.042, 0.026),
      skinMat
    );
    middle.position.set(fingerX, -0.024, -0.126);
    middle.rotation.x = 0.18;
    group.add(middle);

    // Distal Finger Tip tucked tightly back into Wrapped Palm (+Z / -Y)
    const distal = new THREE.Mesh(
      new THREE.BoxGeometry(spec.width * 0.9, 0.024, 0.038),
      skinMat
    );
    distal.position.set(fingerX, -0.04, -0.1);
    group.add(distal);
  });

  // =========================================================================
  // 4. CLAMPED BRAWLER THUMB (Inner -sideSign * X side across curled fingers)
  // =========================================================================
  const thumbWrapBase = new THREE.Mesh(
    new THREE.BoxGeometry(0.042, 0.048, 0.068),
    wrapMat
  );
  thumbWrapBase.position.set(-sideSign * 0.068, -0.012, -0.036);
  thumbWrapBase.rotation.y = sideSign * 0.28;
  thumbWrapBase.rotation.z = sideSign * -0.22;
  group.add(thumbWrapBase);

  const thumbProx = new THREE.Mesh(
    new THREE.BoxGeometry(0.032, 0.032, 0.052),
    skinMat
  );
  thumbProx.position.set(-sideSign * 0.064, -0.024, -0.088);
  thumbProx.rotation.y = sideSign * -0.35;
  group.add(thumbProx);

  const thumbRing = new THREE.Mesh(
    new THREE.BoxGeometry(0.034, 0.034, 0.011),
    brassRingMat
  );
  thumbRing.position.set(-sideSign * 0.065, -0.023, -0.078);
  thumbRing.rotation.y = sideSign * -0.35;
  group.add(thumbRing);

  const thumbDistal = new THREE.Mesh(
    new THREE.BoxGeometry(0.046, 0.028, 0.028),
    skinMat
  );
  thumbDistal.position.set(-sideSign * 0.034, -0.03, -0.114);
  thumbDistal.rotation.z = sideSign * 0.15;
  group.add(thumbDistal);

  return {
    group,
    conduitMat,
    knuckleStudMat,
    honeycombMat,
  };
}
