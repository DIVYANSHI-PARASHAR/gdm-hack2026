import * as THREE from 'three';
import { CombatSnapshot } from '../game/combatEngine';
import { PlayerArm } from './PlayerArm';
import { animateTrackedGlove } from './playerGlove';
import type { GlovePose } from '../vision/gestureRecognizer';
import { CombatEvent } from '../shared/types';

interface SparkParticle {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
}

interface ArmRig {
  shoulder: THREE.Group;
  elbow: THREE.Group;
  gauntlet: THREE.Group;
  knuckleGlow: THREE.MeshStandardMaterial;
  telegraphRing: THREE.Mesh;
}

export class ArenaScene {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private cameraRig: THREE.Group;

  // Boss rig
  private bossRoot: THREE.Group;
  private bossPelvis: THREE.Group;
  private bossTorso: THREE.Group;
  private bossHead: THREE.Group;
  private coreGroup: THREE.Group;
  private coreRingOuter: THREE.Mesh;
  private coreRingInner: THREE.Mesh;
  private coreMaterial: THREE.MeshStandardMaterial;
  private visorMaterial: THREE.MeshStandardMaterial;
  private coreLight: THREE.PointLight;
  private thrusterCone: THREE.Mesh;
  private screenLeftArm!: ArmRig; // Located at x < 0 (Boss's anatomical right arm)
  private screenRightArm!: ArmRig; // Located at x > 0 (Boss's anatomical left arm)
  private bossArmorMaterials: THREE.MeshStandardMaterial[] = [];

  // Player first-person gloves
  private playerLeftArm = new PlayerArm(-1);
  private playerRightArm = new PlayerArm(1);

  // Arena dynamic props
  private fans: THREE.Group[] = [];
  private ambientDust: THREE.Points;
  private shockwaveRing: THREE.Mesh;
  private shockwaveLife = 0;

  // FX state
  private sparks: SparkParticle[] = [];
  private shakeIntensity = 0;
  private bossFlashTimer = 0;
  private clockTime = 0;
  private currentCamX = 0;
  private currentCamRoll = 0;
  private resizeHandler: () => void;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x060812);
    this.scene.fog = new THREE.FogExp2(0x060812, 0.052);

    this.camera = new THREE.PerspectiveCamera(
      62,
      container.clientWidth / Math.max(1, container.clientHeight),
      0.1,
      60
    );
    this.cameraRig = new THREE.Group();
    this.cameraRig.position.set(0, 1.68, 3.45);
    this.cameraRig.add(this.camera);
    this.scene.add(this.cameraRig);

    this.setupLighting();
    this.buildIndustrialArena();
    this.ambientDust = this.buildAmbientParticles();

    // Build floating robot boss
    this.bossRoot = new THREE.Group();
    this.bossRoot.position.set(0, 1.38, 0.0);
    this.scene.add(this.bossRoot);

    this.bossPelvis = new THREE.Group();
    this.bossTorso = new THREE.Group();
    this.bossHead = new THREE.Group();
    this.coreGroup = new THREE.Group();

    this.coreMaterial = new THREE.MeshStandardMaterial({
      color: 0x00f0ff,
      emissive: 0x00d8ff,
      emissiveIntensity: 2.6,
      roughness: 0.2,
      metalness: 0.1,
    });

    this.visorMaterial = new THREE.MeshStandardMaterial({
      color: 0x00f0ff,
      emissive: 0x00e5ff,
      emissiveIntensity: 2.4,
      roughness: 0.15,
    });

    this.coreLight = new THREE.PointLight(0x00f0ff, 3.5, 7);
    this.coreRingOuter = new THREE.Mesh();
    this.coreRingInner = new THREE.Mesh();
    this.thrusterCone = new THREE.Mesh();

    this.buildRobotBoss();

    this.camera.add(this.playerLeftArm, this.playerRightArm);

    // Impact shockwave ring & spark pool
    const ringGeo = new THREE.RingGeometry(0.18, 0.28, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x00f5ff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
    });
    this.shockwaveRing = new THREE.Mesh(ringGeo, ringMat);
    this.scene.add(this.shockwaveRing);
    this.initSparkPool();

    this.resizeHandler = () => {
      if (!container) return;
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      this.camera.aspect = w / Math.max(1, h);
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    };
    window.addEventListener('resize', this.resizeHandler);
  }

  private setupLighting(): void {
    const hemi = new THREE.HemisphereLight(0x3a64ff, 0x1a0b24, 0.95);
    this.scene.add(hemi);

    const keySpot = new THREE.SpotLight(0xd8f3ff, 42, 22, Math.PI / 3.5, 0.55, 1.3);
    keySpot.position.set(0, 7.2, 3.6);
    keySpot.target.position.set(0, 1.2, 0);
    this.scene.add(keySpot);
    this.scene.add(keySpot.target);

    const cyanRim = new THREE.PointLight(0x00f0ff, 14, 14, 1.5);
    cyanRim.position.set(-4.5, 3.2, -2.5);
    this.scene.add(cyanRim);

    const magentaRim = new THREE.PointLight(0xff1e8a, 14, 14, 1.5);
    magentaRim.position.set(4.5, 3.2, -2.5);
    this.scene.add(magentaRim);

    const underGlow = new THREE.PointLight(0xff6b00, 5, 8, 1.6);
    underGlow.position.set(0, 0.15, 0.4);
    this.scene.add(underGlow);
  }

  private createDeckTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#0f1523';
    ctx.fillRect(0, 0, 512, 512);

    // Industrial steel grating grid
    ctx.strokeStyle = '#1b263d';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 512; i += 32) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 512);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(512, i);
      ctx.stroke();
    }

    // Neon center ring emblem
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.48)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(256, 256, 150, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 30, 138, 0.4)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(256, 256, 95, 0, Math.PI * 2);
    ctx.stroke();

    // Hazard border stripes
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 14;
    ctx.strokeRect(12, 12, 488, 488);

    const tex = new THREE.CanvasTexture(canvas);
    tex.anisotropy = 4;
    return tex;
  }

  private buildIndustrialArena(): void {
    // Elevated boxing ring deck
    const deckTex = this.createDeckTexture();
    const deckGeo = new THREE.BoxGeometry(7.6, 0.5, 7.6);
    const deckMat = new THREE.MeshStandardMaterial({
      map: deckTex,
      roughness: 0.42,
      metalness: 0.68,
    });
    const deck = new THREE.Mesh(deckGeo, deckMat);
    deck.position.set(0, -0.25, 0.5);
    this.scene.add(deck);

    // Sub-floor industrial abyss grid
    const outerFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(46, 46),
      new THREE.MeshStandardMaterial({
        color: 0x05070e,
        roughness: 0.85,
        metalness: 0.4,
      })
    );
    outerFloor.rotation.x = -Math.PI / 2;
    outerFloor.position.y = -1.2;
    this.scene.add(outerFloor);

    // 4 Corner Steel Pylons + Laser Ring Ropes
    const pylonMetal = new THREE.MeshStandardMaterial({
      color: 0x1e2738,
      roughness: 0.35,
      metalness: 0.82,
    });
    const corners: [number, number][] = [
      [-3.55, -3.05],
      [3.55, -3.05],
      [-3.55, 4.05],
      [3.55, 4.05],
    ];

    corners.forEach(([cx, cz], idx) => {
      const pylon = new THREE.Mesh(
        new THREE.BoxGeometry(0.28, 2.35, 0.28),
        pylonMetal
      );
      pylon.position.set(cx, 0.92, cz);
      this.scene.add(pylon);

      const beaconColor = idx % 2 === 0 ? 0x00f0ff : 0xff1e8a;
      const beacon = new THREE.Mesh(
        new THREE.CylinderGeometry(0.11, 0.14, 0.22, 12),
        new THREE.MeshStandardMaterial({
          color: beaconColor,
          emissive: beaconColor,
          emissiveIntensity: 2.2,
        })
      );
      beacon.position.set(cx, 2.18, cz);
      this.scene.add(beacon);
    });

    // Laser ropes along Left, Right, and Back edges of ring
    const ropeHeights = [0.55, 1.08, 1.62];
    ropeHeights.forEach((ry, i) => {
      const ropeColor = i === 1 ? 0xff1e8a : 0x00f0ff;
      const ropeMat = new THREE.MeshBasicMaterial({
        color: ropeColor,
      });

      // Back rope
      const backRope = new THREE.Mesh(
        new THREE.CylinderGeometry(0.022, 0.022, 7.1, 8),
        ropeMat
      );
      backRope.rotation.z = Math.PI / 2;
      backRope.position.set(0, ry, -3.05);
      this.scene.add(backRope);

      // Left & Right side ropes
      [-3.55, 3.55].forEach((rx) => {
        const sideRope = new THREE.Mesh(
          new THREE.CylinderGeometry(0.022, 0.022, 7.1, 8),
          ropeMat
        );
        sideRope.rotation.x = Math.PI / 2;
        sideRope.position.set(rx, ry, 0.5);
        this.scene.add(sideRope);
      });
    });

    // Overhead industrial steel rafters & neon light strips
    const trussMat = new THREE.MeshStandardMaterial({
      color: 0x131926,
      metalness: 0.85,
      roughness: 0.4,
    });
    for (let z = -6; z <= 4; z += 3.2) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(14, 0.32, 0.32), trussMat);
      beam.position.set(0, 6.4, z);
      this.scene.add(beam);

      const lightBar = new THREE.Mesh(
        new THREE.BoxGeometry(5.6, 0.07, 0.1),
        new THREE.MeshBasicMaterial({
          color: z % 2 === 0 ? 0x00f0ff : 0xff2a9d,
        })
      );
      lightBar.position.set(0, 6.2, z);
      this.scene.add(lightBar);
    }

    // Background industrial columns & giant spinning exhaust turbines
    [-6.2, 6.2].forEach((px) => {
      for (let pz = -8; pz <= 2; pz += 5) {
        const col = new THREE.Mesh(
          new THREE.BoxGeometry(0.85, 9, 0.85),
          trussMat
        );
        col.position.set(px, 3.3, pz);
        this.scene.add(col);
      }
    });

    [-3.1, 3.1].forEach((fx, idx) => {
      const housing = new THREE.Group();
      housing.position.set(fx, 3.4, -7.8);

      const rim = new THREE.Mesh(
        new THREE.TorusGeometry(1.45, 0.16, 12, 28),
        pylonMetal
      );
      housing.add(rim);

      const backGlow = new THREE.Mesh(
        new THREE.CircleGeometry(1.38, 24),
        new THREE.MeshBasicMaterial({
          color: idx === 0 ? 0x072d3d : 0x380926,
        })
      );
      backGlow.position.z = -0.1;
      housing.add(backGlow);

      const rotor = new THREE.Group();
      for (let b = 0; b < 6; b++) {
        const blade = new THREE.Mesh(
          new THREE.BoxGeometry(0.26, 1.28, 0.06),
          pylonMetal
        );
        const angle = (b / 6) * Math.PI * 2;
        blade.position.set(Math.cos(angle) * 0.65, Math.sin(angle) * 0.65, 0);
        blade.rotation.z = angle + 0.35;
        rotor.add(blade);
      }
      housing.add(rotor);
      this.fans.push(rotor);
      this.scene.add(housing);
    });
  }

  private buildAmbientParticles(): THREE.Points {
    const count = 90;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 11;
      positions[i * 3 + 1] = Math.random() * 5.5;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 9;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0x38e8ff,
      size: 0.055,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geo, mat);
    this.scene.add(points);
    return points;
  }

  private buildRobotBoss(): void {
    const darkChassis = new THREE.MeshStandardMaterial({
      color: 0x1a2234,
      roughness: 0.34,
      metalness: 0.85,
    });
    const gunmetalPlate = new THREE.MeshStandardMaterial({
      color: 0x2c3a52,
      roughness: 0.28,
      metalness: 0.88,
    });
    const hazardAccent = new THREE.MeshStandardMaterial({
      color: 0xe68a00,
      roughness: 0.38,
      metalness: 0.55,
    });
    this.bossArmorMaterials.push(darkChassis, gunmetalPlate, hazardAccent);

    // Floating thruster pelvis
    this.bossRoot.add(this.bossPelvis);
    const pelvisMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.26, 0.36, 8),
      darkChassis
    );
    this.bossPelvis.add(pelvisMesh);

    const thrusterRim = new THREE.Mesh(
      new THREE.TorusGeometry(0.32, 0.06, 10, 20),
      gunmetalPlate
    );
    thrusterRim.rotation.x = Math.PI / 2;
    thrusterRim.position.y = -0.2;
    this.bossPelvis.add(thrusterRim);

    this.thrusterCone = new THREE.Mesh(
      new THREE.ConeGeometry(0.26, 0.65, 16, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0x00e5ff,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      })
    );
    this.thrusterCone.rotation.x = Math.PI;
    this.thrusterCone.position.y = -0.52;
    this.bossPelvis.add(this.thrusterCone);

    // Torso attached above pelvis
    this.bossTorso.position.set(0, 0.34, 0);
    this.bossPelvis.add(this.bossTorso);

    // Main armored chest block
    const chestMain = new THREE.Mesh(
      new THREE.BoxGeometry(1.16, 0.82, 0.66),
      gunmetalPlate
    );
    chestMain.position.set(0, 0.34, 0);
    this.bossTorso.add(chestMain);

    // Angled chest armor plates flanking the core
    [-0.42, 0.42].forEach((px) => {
      const plate = new THREE.Mesh(
        new THREE.BoxGeometry(0.34, 0.72, 0.74),
        darkChassis
      );
      plate.position.set(px, 0.35, 0.05);
      plate.rotation.y = px < 0 ? 0.18 : -0.18;
      this.bossTorso.add(plate);

      // Shoulder exhaust stacks
      const stack = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.1, 0.48, 8),
        darkChassis
      );
      stack.position.set(px * 0.9, 0.88, -0.24);
      stack.rotation.x = -0.22;
      this.bossTorso.add(stack);
    });

    // Glowing Reactor Core in center of chest
    this.coreGroup.position.set(0, 0.34, 0.35);
    this.bossTorso.add(this.coreGroup);

    const coreSphere = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.2, 2),
      this.coreMaterial
    );
    this.coreGroup.add(coreSphere);

    this.coreRingOuter = new THREE.Mesh(
      new THREE.TorusGeometry(0.27, 0.032, 8, 24),
      hazardAccent
    );
    this.coreGroup.add(this.coreRingOuter);

    this.coreRingInner = new THREE.Mesh(
      new THREE.TorusGeometry(0.22, 0.02, 8, 20),
      this.coreMaterial
    );
    this.coreGroup.add(this.coreRingInner);

    this.coreLight.position.set(0, 0, 0.25);
    this.coreGroup.add(this.coreLight);

    // Articulated Visor Head
    this.bossHead.position.set(0, 0.92, 0.06);
    this.bossTorso.add(this.bossHead);

    const helmet = new THREE.Mesh(
      new THREE.BoxGeometry(0.52, 0.38, 0.48),
      gunmetalPlate
    );
    this.bossHead.add(helmet);

    const crest = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.18, 0.54),
      hazardAccent
    );
    crest.position.set(0, 0.22, -0.02);
    this.bossHead.add(crest);

    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(0.44, 0.11, 0.06),
      this.visorMaterial
    );
    visor.position.set(0, 0.02, 0.24);
    this.bossHead.add(visor);

    // Build Left & Right Chunky Articulated Gauntlet Arms
    // x = -0.82 is Screen-Left; x = +0.82 is Screen-Right
    this.screenLeftArm = this.createBossArm(-1, gunmetalPlate, darkChassis, hazardAccent);
    this.screenRightArm = this.createBossArm(1, gunmetalPlate, darkChassis, hazardAccent);
    this.bossTorso.add(this.screenLeftArm.shoulder);
    this.bossTorso.add(this.screenRightArm.shoulder);
  }

  private createBossArm(
    sideSign: -1 | 1,
    plateMat: THREE.MeshStandardMaterial,
    darkMat: THREE.MeshStandardMaterial,
    accentMat: THREE.MeshStandardMaterial
  ): ArmRig {
    const shoulder = new THREE.Group();
    shoulder.position.set(sideSign * 0.78, 0.62, 0.02);

    // Massive Shoulder Pauldron
    const pauldron = new THREE.Mesh(
      new THREE.BoxGeometry(0.46, 0.44, 0.52),
      plateMat
    );
    pauldron.position.set(sideSign * 0.1, 0.06, 0);
    pauldron.rotation.z = sideSign * -0.18;
    shoulder.add(pauldron);

    const pauldronStripe = new THREE.Mesh(
      new THREE.BoxGeometry(0.48, 0.08, 0.54),
      accentMat
    );
    pauldronStripe.position.set(sideSign * 0.1, 0.14, 0);
    pauldronStripe.rotation.z = sideSign * -0.18;
    shoulder.add(pauldronStripe);

    // Upper Arm cylinder
    const upperArm = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13, 0.11, 0.52, 10),
      darkMat
    );
    upperArm.position.set(sideSign * 0.12, -0.28, 0);
    shoulder.add(upperArm);

    // Elbow Pivot
    const elbow = new THREE.Group();
    elbow.position.set(sideSign * 0.14, -0.54, 0.02);
    shoulder.add(elbow);

    const elbowJoint = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 12, 12),
      accentMat
    );
    elbow.add(elbowJoint);

    // Chunky Articulated Forearm Gauntlet (extends along +Z when bent forward)
    const gauntlet = new THREE.Group();
    gauntlet.position.set(0, -0.06, 0.34);
    elbow.add(gauntlet);

    const forearmCasing = new THREE.Mesh(
      new THREE.BoxGeometry(0.38, 0.36, 0.62),
      plateMat
    );
    gauntlet.add(forearmCasing);

    // Twin hydraulic pistons along top of gauntlet
    [-0.11, 0.11].forEach((px) => {
      const piston = new THREE.Mesh(
        new THREE.CylinderGeometry(0.036, 0.036, 0.58, 8),
        accentMat
      );
      piston.rotation.x = Math.PI / 2;
      piston.position.set(px, 0.2, -0.02);
      gauntlet.add(piston);
    });

    // Glowing Knuckle Strike Bumper
    const knuckleGlow = new THREE.MeshStandardMaterial({
      color: 0x00f0ff,
      emissive: 0x00c8ff,
      emissiveIntensity: 1.6,
      roughness: 0.25,
      metalness: 0.5,
    });
    const knucklePlate = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.32, 0.14),
      knuckleGlow
    );
    knucklePlate.position.set(0, 0, 0.34);
    gauntlet.add(knucklePlate);

    // Articulated Clamped Mechanical Fingers
    [-0.13, 0, 0.13].forEach((fx) => {
      const fingerProximal = new THREE.Mesh(
        new THREE.BoxGeometry(0.09, 0.12, 0.14),
        darkMat
      );
      fingerProximal.position.set(fx, -0.06, 0.43);
      fingerProximal.rotation.x = 0.45;
      gauntlet.add(fingerProximal);

      const fingerDistal = new THREE.Mesh(
        new THREE.BoxGeometry(0.085, 0.13, 0.1),
        plateMat
      );
      fingerDistal.position.set(fx, -0.15, 0.41);
      gauntlet.add(fingerDistal);
    });

    // Inner Thumb Clamp
    const thumb = new THREE.Mesh(
      new THREE.BoxGeometry(0.11, 0.12, 0.2),
      accentMat
    );
    thumb.position.set(-sideSign * 0.21, -0.06, 0.3);
    gauntlet.add(thumb);

    // Expanding Holographic Telegraph Ring during windup
    const telegraphRing = new THREE.Mesh(
      new THREE.RingGeometry(0.28, 0.36, 24),
      new THREE.MeshBasicMaterial({
        color: 0xff3b30,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
      })
    );
    telegraphRing.position.set(0, 0, 0.46);
    gauntlet.add(telegraphRing);

    return {
      shoulder,
      elbow,
      gauntlet,
      knuckleGlow,
      telegraphRing,
    };
  }

  private initSparkPool(): void {
    const geo = new THREE.BoxGeometry(0.045, 0.045, 0.14);
    for (let i = 0; i < 36; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: i % 2 === 0 ? 0x00f5ff : 0xffaa00,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      this.scene.add(mesh);
      this.sparks.push({
        mesh,
        vel: new THREE.Vector3(),
        life: 0,
        maxLife: 0.35,
      });
    }
  }

  public handleCombatEvent(event: CombatEvent): void {
    switch (event.type) {
      case 'PLAYER_PUNCH_HIT':
        this.spawnImpactBurst(
          new THREE.Vector3(event.side === 'LEFT' ? -0.25 : 0.25, 1.85, 0.55),
          0x00f5ff,
          14
        );
        this.shakeIntensity = Math.max(this.shakeIntensity, 0.07);
        this.bossFlashTimer = 0.11;
        break;

      case 'PLAYER_PUNCH_COUNTER_HIT':
        this.spawnImpactBurst(
          new THREE.Vector3(0, 1.78, 0.52),
          0xffd60a,
          24
        );
        this.triggerShockwave(new THREE.Vector3(0, 1.78, 0.55), 0x39ff9f);
        this.shakeIntensity = Math.max(this.shakeIntensity, 0.14);
        this.bossFlashTimer = 0.16;
        break;

      case 'PLAYER_PUNCH_BAITED':
        this.spawnImpactBurst(
          new THREE.Vector3(0, 1.88, 0.65),
          0xc040ff,
          16
        );
        this.shakeIntensity = Math.max(this.shakeIntensity, 0.09);
        break;

      case 'BOSS_STRIKE_HIT_PLAYER':
        this.shakeIntensity = Math.max(this.shakeIntensity, 0.24);
        this.triggerShockwave(new THREE.Vector3(0, 1.65, 2.2), 0xff1744);
        break;

      case 'PLAYER_DODGE_SUCCESS':
        this.triggerShockwave(
          new THREE.Vector3(0, 1.65, 1.6),
          0x00f5ff
        );
        break;

      case 'MATCH_VICTORY':
        this.spawnImpactBurst(new THREE.Vector3(0, 1.75, 0.2), 0x00f5ff, 32);
        this.shakeIntensity = 0.22;
        break;

      default:
        break;
    }
  }

  private spawnImpactBurst(origin: THREE.Vector3, colorHex: number, count: number): void {
    let spawned = 0;
    for (const s of this.sparks) {
      if (s.life <= 0) {
        s.mesh.position.copy(origin);
        s.mesh.visible = true;
        (s.mesh.material as THREE.MeshBasicMaterial).color.setHex(colorHex);
        (s.mesh.material as THREE.MeshBasicMaterial).opacity = 1;
        s.vel.set(
          (Math.random() - 0.5) * 7.5,
          (Math.random() - 0.25) * 6.5,
          (Math.random() - 0.2) * 6.5
        );
        s.maxLife = 0.24 + Math.random() * 0.2;
        s.life = s.maxLife;
        spawned++;
        if (spawned >= count) break;
      }
    }
  }

  private triggerShockwave(pos: THREE.Vector3, colorHex: number): void {
    this.shockwaveRing.position.copy(pos);
    this.shockwaveRing.scale.setScalar(1);
    const mat = this.shockwaveRing.material as THREE.MeshBasicMaterial;
    mat.color.setHex(colorHex);
    mat.opacity = 0.85;
    this.shockwaveLife = 0.28;
  }

  public render(snapshot: CombatSnapshot, dtSec: number, gloves: GlovePose | null, keyboardPunch: boolean): void {
    const dt = Math.min(0.05, Math.max(0.001, dtSec));
    this.clockTime += dt;

    // Spin arena turbines & float dust
    for (const fan of this.fans) {
      fan.rotation.z += dt * 1.9;
    }
    this.ambientDust.rotation.y += dt * 0.04;

    // Update camera lean + punch kick + impact shake
    const targetX =
      snapshot.playerLean === 'LEFT'
        ? -0.82
        : snapshot.playerLean === 'RIGHT'
          ? 0.82
          : 0;
    const targetRoll =
      snapshot.playerLean === 'LEFT'
        ? 0.13
        : snapshot.playerLean === 'RIGHT'
          ? -0.13
          : 0;

    const lerpRate = 1 - Math.exp(-dt * 18);
    this.currentCamX += (targetX - this.currentCamX) * lerpRate;
    this.currentCamRoll += (targetRoll - this.currentCamRoll) * lerpRate;

    let shakeX = 0;
    let shakeY = 0;
    if (this.shakeIntensity > 0.001) {
      shakeX = (Math.random() - 0.5) * this.shakeIntensity;
      shakeY = (Math.random() - 0.5) * this.shakeIntensity;
      this.shakeIntensity = Math.max(0, this.shakeIntensity - dt * 0.85);
    }

    const punchForwardKick =
      snapshot.playerPunchSide !== null
        ? Math.sin(snapshot.playerPunchProgress * Math.PI) * -0.08
        : 0;

    this.cameraRig.position.set(
      this.currentCamX + shakeX,
      1.68 + Math.abs(this.currentCamX) * -0.06 + shakeY,
      3.45 + punchForwardKick
    );
    this.camera.rotation.set(-0.04, this.currentCamX * -0.08, this.currentCamRoll);

    // Animate first-person player gloves
    this.animatePlayerGloves(snapshot, dt, gloves, keyboardPunch);

    // Animate floating robot boss according to explicit state machine
    this.animateBoss(snapshot, dt);

    // Update sparks & shockwave
    this.updateFX(dt);

    this.renderer.render(this.scene, this.camera);
  }

  private animatePlayerGloves(
    snapshot: CombatSnapshot,
    dt: number,
    gloves: GlovePose | null,
    keyboardPunch: boolean,
  ): void {
    const tanHalfFov = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const idleBob = Math.sin(this.clockTime * 4.2) * 0.015;
    for (const side of ['LEFT', 'RIGHT'] as const) {
      const left = side === 'LEFT';
      const sign = left ? -1 : 1;
      const arm = left ? this.playerLeftArm : this.playerRightArm;
      const glove = arm.glove;
      const throwing = snapshot.playerPunchSide === side;
      const hand = (left ? gloves?.left : gloves?.right) ?? null;
      let reach: number;
      if (gloves && !(keyboardPunch && throwing)) {
        reach = animateTrackedGlove(glove, sign, hand, dt, this.camera.aspect, tanHalfFov);
      } else {
        const progress = snapshot.playerPunchProgress;
        // Snap out quickly, then draw the hand back to the cheek.
        reach = throwing ? (progress < 0.26
          ? THREE.MathUtils.smoothstep(progress, 0, 0.26)
          : 1 - THREE.MathUtils.smoothstep(progress, 0.26, 1)) : 0;
        glove.position.set(
          sign * (0.36 - reach * 0.27),
          -0.22 - sign * idleBob + reach * 0.20,
          -0.59 - reach * 0.83,
        );
      }
      arm.updateJoints(reach, hand?.elbow, dt);
    }
  }

  private animateBoss(snapshot: CombatSnapshot, dt: number): void {
    const t = this.clockTime;
    const p = snapshot.bossStateProgress;

    // Spin reactor containment rings & pulse thruster cone
    this.coreRingOuter.rotation.z = t * 1.8;
    this.coreRingInner.rotation.x = t * 2.5;
    this.coreRingInner.rotation.y = t * 1.7;
    this.thrusterCone.scale.set(
      1 + Math.sin(t * 28) * 0.08,
      0.92 + Math.cos(t * 34) * 0.14,
      1 + Math.sin(t * 28) * 0.08
    );

    // Hit flash decay
    if (this.bossFlashTimer > 0) {
      this.bossFlashTimer = Math.max(0, this.bossFlashTimer - dt);
      for (const mat of this.bossArmorMaterials) {
        mat.emissive.setHex(0xffffff);
        mat.emissiveIntensity = this.bossFlashTimer * 3.2;
      }
    } else {
      for (const mat of this.bossArmorMaterials) {
        mat.emissiveIntensity = 0;
      }
    }

    // Reset baseline transforms
    const hoverY = 1.38 + Math.sin(t * 3.1) * 0.065;
    this.bossRoot.position.set(0, hoverY, 0);
    this.bossRoot.rotation.set(0, 0, 0);
    this.bossTorso.rotation.set(0, 0, 0);
    this.bossHead.rotation.set(0, 0, 0);

    // Default boxing guard pose for both arms
    this.setGuardArmPose(this.screenLeftArm, -1, t);
    this.setGuardArmPose(this.screenRightArm, 1, t);
    (this.screenLeftArm.telegraphRing.material as THREE.MeshBasicMaterial).opacity = 0;
    (this.screenRightArm.telegraphRing.material as THREE.MeshBasicMaterial).opacity = 0;

    let themeColor = 0x00f0ff;
    let coreIntensity = 2.4;

    switch (snapshot.bossState) {
      case 'IDLE': {
        themeColor = 0x00f0ff;
        this.bossRoot.position.x = Math.sin(t * 1.7) * 0.14;
        this.bossTorso.rotation.y = Math.sin(t * 1.7) * 0.08;
        break;
      }

      case 'BAIT_GUARD': {
        themeColor = 0xc040ff;
        coreIntensity = 3.4 + Math.sin(t * 24) * 0.8;
        // High crossed electric counter-guard
        this.bossTorso.rotation.x = 0.08;
        this.screenLeftArm.shoulder.rotation.set(-0.85, 0.42, 0.2);
        this.screenLeftArm.elbow.rotation.set(-0.95, 0.3, 0);
        this.screenRightArm.shoulder.rotation.set(-0.85, -0.42, -0.2);
        this.screenRightArm.elbow.rotation.set(-0.95, -0.3, 0);
        break;
      }

      case 'WINDUP': {
        const pulse = 0.5 + 0.5 * Math.sin(p * Math.PI * 6);
        themeColor = p > 0.65 ? 0xff1744 : 0xff7b00;
        coreIntensity = 3.2 + p * 2.0;

        if (snapshot.bossAttackSide === 'LEFT') {
          // Wind up Screen-Left arm wide & high!
          this.bossTorso.rotation.y = -0.48 * p;
          this.bossTorso.rotation.z = 0.12 * p;
          this.screenLeftArm.shoulder.rotation.set(0.35 * p, -0.65 * p, -0.85 * p);
          this.screenLeftArm.elbow.rotation.set(-0.55, 0, 0);
          this.updateTelegraphRing(this.screenLeftArm.telegraphRing, p, pulse);
        } else if (snapshot.bossAttackSide === 'RIGHT') {
          // Wind up Screen-Right arm wide & high!
          this.bossTorso.rotation.y = 0.48 * p;
          this.bossTorso.rotation.z = -0.12 * p;
          this.screenRightArm.shoulder.rotation.set(0.35 * p, 0.65 * p, 0.85 * p);
          this.screenRightArm.elbow.rotation.set(-0.55, 0, 0);
          this.updateTelegraphRing(this.screenRightArm.telegraphRing, p, pulse);
        } else {
          // CENTER heavy double/overhead straight windup!
          this.bossRoot.position.z = -0.32 * p;
          this.bossTorso.rotation.x = -0.28 * p;
          this.screenLeftArm.shoulder.rotation.set(-1.35 * p, -0.25, -0.45);
          this.screenRightArm.shoulder.rotation.set(-1.35 * p, 0.25, 0.45);
          this.updateTelegraphRing(this.screenLeftArm.telegraphRing, p, pulse);
          this.updateTelegraphRing(this.screenRightArm.telegraphRing, p, pulse);
        }
        break;
      }

      case 'STRIKE_ACTIVE': {
        themeColor = 0xff1744;
        coreIntensity = 4.6;
        const thrust = Math.sin(Math.min(1, p * 1.35) * Math.PI * 0.5);
        this.bossRoot.position.z = 1.15 * thrust;

        if (snapshot.bossAttackSide === 'LEFT') {
          this.bossRoot.position.x = -0.36 * thrust;
          this.bossTorso.rotation.y = 0.52 * thrust;
          this.screenLeftArm.shoulder.rotation.set(-1.28, 0.28, 0.15);
          this.screenLeftArm.elbow.rotation.set(-0.08, 0, 0);
        } else if (snapshot.bossAttackSide === 'RIGHT') {
          this.bossRoot.position.x = 0.36 * thrust;
          this.bossTorso.rotation.y = -0.52 * thrust;
          this.screenRightArm.shoulder.rotation.set(-1.28, -0.28, -0.15);
          this.screenRightArm.elbow.rotation.set(-0.08, 0, 0);
        } else {
          // Center dual straight slam down the middle
          this.bossTorso.rotation.x = 0.25 * thrust;
          this.screenLeftArm.shoulder.rotation.set(-1.42, 0.18, 0.1);
          this.screenLeftArm.elbow.rotation.set(-0.05, 0, 0);
          this.screenRightArm.shoulder.rotation.set(-1.42, -0.18, -0.1);
          this.screenRightArm.elbow.rotation.set(-0.05, 0, 0);
        }
        break;
      }

      case 'RECOVERY': {
        // Clearly readable overextended vulnerable state! Gauntlets dropped, glowing emerald-gold core exposed!
        themeColor = 0x39ff9f;
        coreIntensity = 3.8 + Math.sin(t * 20) * 1.1;
        const recoverEase = 1 - p * 0.45;
        this.bossRoot.position.z = 0.42 * recoverEase;
        this.bossRoot.position.y = hoverY - 0.18 * recoverEase;
        this.bossTorso.rotation.x = 0.32 * recoverEase;
        this.bossHead.rotation.x = 0.28 * recoverEase;

        // Arms hang wide & low leaving core wide open
        this.screenLeftArm.shoulder.rotation.set(0.18, -0.2, -0.45);
        this.screenLeftArm.elbow.rotation.set(-0.35, 0, 0);
        this.screenRightArm.shoulder.rotation.set(0.18, 0.2, 0.45);
        this.screenRightArm.elbow.rotation.set(-0.35, 0, 0);
        break;
      }

      case 'DODGING': {
        themeColor = 0x00f0ff;
        const evadeArc = Math.sin(p * Math.PI);
        const dir = snapshot.bossDodgeSide === 'LEFT' ? -1 : 1;
        this.bossRoot.position.x = dir * 0.92 * evadeArc;
        this.bossRoot.position.z = -0.25 * evadeArc;
        this.bossRoot.rotation.z = dir * -0.26 * evadeArc;
        break;
      }

      case 'HIT_REACT': {
        themeColor = 0xffbe0b;
        const recoil = Math.sin((1 - p) * Math.PI * 0.5);
        const hitDir = snapshot.bossHitSide === 'LEFT' ? 1 : -1;
        this.bossRoot.position.z = -0.28 * recoil;
        this.bossTorso.rotation.x = -0.32 * recoil;
        this.bossTorso.rotation.y = hitDir * 0.35 * recoil;
        this.bossHead.rotation.x = -0.35 * recoil;
        break;
      }

      case 'KO': {
        themeColor = 0x334155;
        coreIntensity = 0.3;
        const fall = Math.min(1, p * 1.4);
        this.bossRoot.position.y = 1.38 - fall * 0.85;
        this.bossRoot.position.z = -fall * 0.7;
        this.bossTorso.rotation.x = 0.65 * fall;
        this.bossHead.rotation.x = 0.55 * fall;
        this.screenLeftArm.shoulder.rotation.set(0.35, 0, -0.5);
        this.screenRightArm.shoulder.rotation.set(0.35, 0, 0.5);
        break;
      }

      case 'VICTORY_POSE': {
        themeColor = 0xff1744;
        coreIntensity = 3.8;
        this.bossRoot.position.y = hoverY + 0.2;
        this.screenLeftArm.shoulder.rotation.set(-2.3, 0, -0.35);
        this.screenRightArm.shoulder.rotation.set(-2.3, 0, 0.35);
        break;
      }
    }

    this.coreMaterial.color.setHex(themeColor);
    this.coreMaterial.emissive.setHex(themeColor);
    this.coreMaterial.emissiveIntensity = coreIntensity;
    this.visorMaterial.color.setHex(themeColor);
    this.visorMaterial.emissive.setHex(themeColor);
    this.coreLight.color.setHex(themeColor);
    this.screenLeftArm.knuckleGlow.color.setHex(themeColor);
    this.screenLeftArm.knuckleGlow.emissive.setHex(themeColor);
    this.screenRightArm.knuckleGlow.color.setHex(themeColor);
    this.screenRightArm.knuckleGlow.emissive.setHex(themeColor);
  }

  private setGuardArmPose(arm: ArmRig, sideSign: -1 | 1, t: number): void {
    const weave = Math.sin(t * 3.8 + sideSign) * 0.06;
    arm.shoulder.rotation.set(-0.55 + weave, sideSign * -0.18, sideSign * 0.14);
    arm.elbow.rotation.set(-0.82 - weave * 0.5, sideSign * -0.22, 0);
  }

  private updateTelegraphRing(
    ring: THREE.Mesh,
    progress: number,
    pulse: number
  ): void {
    const mat = ring.material as THREE.MeshBasicMaterial;
    mat.opacity = 0.45 + pulse * 0.45;
    mat.color.setHex(progress > 0.65 ? 0xff1744 : 0xff9f0a);
    const scale = 1.6 - progress * 0.75;
    ring.scale.setScalar(scale);
  }

  private updateFX(dt: number): void {
    for (const s of this.sparks) {
      if (s.life > 0) {
        s.life -= dt;
        if (s.life <= 0) {
          s.mesh.visible = false;
        } else {
          s.mesh.position.addScaledVector(s.vel, dt);
          s.vel.y -= 9.8 * dt;
          s.mesh.lookAt(
            s.mesh.position.x + s.vel.x,
            s.mesh.position.y + s.vel.y,
            s.mesh.position.z + s.vel.z
          );
          (s.mesh.material as THREE.MeshBasicMaterial).opacity =
            s.life / s.maxLife;
        }
      }
    }

    if (this.shockwaveLife > 0) {
      this.shockwaveLife = Math.max(0, this.shockwaveLife - dt);
      const norm = 1 - this.shockwaveLife / 0.28;
      this.shockwaveRing.scale.setScalar(1 + norm * 4.2);
      (this.shockwaveRing.material as THREE.MeshBasicMaterial).opacity =
        (1 - norm) * 0.8;
    }
  }

  public dispose(): void {
    window.removeEventListener('resize', this.resizeHandler);
    this.renderer.dispose();
  }
}
