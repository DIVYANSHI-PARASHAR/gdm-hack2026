import * as THREE from 'three';
import { CombatSnapshot } from '../game/combatEngine';
import { CombatEvent } from '../shared/types';
import {
  buildKaiBrawler,
  createPlayerBrawlerHand,
  KaiArmRig,
  KaiBrawlerRig,
  PlayerHandRig,
} from './KaiBrawlerModel';

interface SparkParticle {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
}

const BOSS_BASE_Z = 0.72;
const BOSS_SCALE = 1.12;

export class ArenaScene {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private cameraRig: THREE.Group;

  // Opponent rig: KAI_THE_BRAWLER
  private kai: KaiBrawlerRig;

  // Player first-person cyber-brawler hands & forearms
  private playerLeftHand: PlayerHandRig;
  private playerRightHand: PlayerHandRig;

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
    this.renderer.toneMappingExposure = 1.22;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x060812);
    this.scene.fog = new THREE.FogExp2(0x060812, 0.048);

    this.camera = new THREE.PerspectiveCamera(
      62,
      container.clientWidth / Math.max(1, container.clientHeight),
      0.08,
      60
    );
    this.cameraRig = new THREE.Group();
    this.cameraRig.position.set(0, 1.68, 3.45);
    this.cameraRig.add(this.camera);
    this.scene.add(this.cameraRig);

    this.setupLighting();
    this.buildIndustrialArena();
    this.ambientDust = this.buildAmbientParticles();

    // Build KAI_THE_BRAWLER standing grounded on the ring deck (y = 0)
    this.kai = buildKaiBrawler();
    this.kai.root.scale.setScalar(BOSS_SCALE);
    this.kai.root.position.set(0, 0, BOSS_BASE_Z);
    this.scene.add(this.kai.root);

    // Build matching first-person cyber-brawler hands & forearms attached to camera
    this.playerLeftHand = createPlayerBrawlerHand(-1);
    this.playerRightHand = createPlayerBrawlerHand(1);
    this.camera.add(this.playerLeftHand.group);
    this.camera.add(this.playerRightHand.group);

    // Impact shockwave ring & spark pool
    const ringGeo = new THREE.RingGeometry(0.18, 0.28, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xff7b00,
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
    const hemi = new THREE.HemisphereLight(0x4b74ff, 0x241410, 1.05);
    this.scene.add(hemi);

    const keySpot = new THREE.SpotLight(
      0xfff3e6,
      46,
      24,
      Math.PI / 3.2,
      0.52,
      1.25
    );
    keySpot.position.set(0, 7.2, 4.2);
    keySpot.target.position.set(0, 1.4, BOSS_BASE_Z);
    this.scene.add(keySpot);
    this.scene.add(keySpot.target);

    // Front-fill light for crisp facial features, brushed chrome arms, and player wraps
    const fighterFill = new THREE.DirectionalLight(0xdceeff, 1.35);
    fighterFill.position.set(0.8, 2.8, 5.2);
    this.scene.add(fighterFill);

    const cyanRim = new THREE.PointLight(0x00f0ff, 14, 14, 1.5);
    cyanRim.position.set(-4.2, 3.0, -2.0);
    this.scene.add(cyanRim);

    const amberRim = new THREE.PointLight(0xff5e00, 15, 14, 1.5);
    amberRim.position.set(4.2, 3.0, -2.0);
    this.scene.add(amberRim);

    const underGlow = new THREE.PointLight(0xff6b00, 5.5, 8, 1.6);
    underGlow.position.set(0, 0.25, 1.1);
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
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.45)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(256, 256, 150, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 102, 0, 0.45)';
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
    // Elevated boxing ring deck (top surface at y = 0.0)
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

      const beaconColor = idx % 2 === 0 ? 0x00f0ff : 0xff6200;
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
      const ropeColor = i === 1 ? 0xff6200 : 0x00f0ff;
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
          color: z % 2 === 0 ? 0x00f0ff : 0xff6a00,
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
          color: idx === 0 ? 0x072d3d : 0x3b1808,
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
      color: 0xff9d42,
      size: 0.05,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geo, mat);
    this.scene.add(points);
    return points;
  }

  private initSparkPool(): void {
    const geo = new THREE.BoxGeometry(0.042, 0.042, 0.14);
    for (let i = 0; i < 36; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: i % 2 === 0 ? 0xff9500 : 0x00f5ff,
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
          new THREE.Vector3(
            event.side === 'LEFT' ? -0.22 : 0.22,
            1.78,
            BOSS_BASE_Z + 0.35
          ),
          0xff9d00,
          14
        );
        this.shakeIntensity = Math.max(this.shakeIntensity, 0.07);
        this.bossFlashTimer = 0.11;
        break;

      case 'PLAYER_PUNCH_COUNTER_HIT':
        this.spawnImpactBurst(
          new THREE.Vector3(0, 1.76, BOSS_BASE_Z + 0.32),
          0xffd60a,
          24
        );
        this.triggerShockwave(
          new THREE.Vector3(0, 1.74, BOSS_BASE_Z + 0.36),
          0x39ff9f
        );
        this.shakeIntensity = Math.max(this.shakeIntensity, 0.14);
        this.bossFlashTimer = 0.16;
        break;

      case 'PLAYER_PUNCH_BAITED':
        this.spawnImpactBurst(
          new THREE.Vector3(0, 1.78, BOSS_BASE_Z + 0.42),
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
        this.triggerShockwave(new THREE.Vector3(0, 1.65, 1.7), 0x00f5ff);
        break;

      case 'MATCH_VICTORY':
        this.spawnImpactBurst(
          new THREE.Vector3(0, 1.72, BOSS_BASE_Z + 0.2),
          0xff7b00,
          32
        );
        this.shakeIntensity = 0.22;
        break;

      default:
        break;
    }
  }

  private spawnImpactBurst(
    origin: THREE.Vector3,
    colorHex: number,
    count: number
  ): void {
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

  public render(snapshot: CombatSnapshot, dtSec: number): void {
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
        ? Math.sin(snapshot.playerPunchProgress * Math.PI) * -0.09
        : 0;

    this.cameraRig.position.set(
      this.currentCamX + shakeX,
      1.68 + Math.abs(this.currentCamX) * -0.06 + shakeY,
      3.45 + punchForwardKick
    );
    this.camera.rotation.set(
      -0.05,
      this.currentCamX * -0.08,
      this.currentCamRoll
    );

    // Animate first-person cyber-brawler hands & forearms
    this.animatePlayerHands(snapshot);

    // Animate KAI_THE_BRAWLER according to explicit combat state machine
    this.animateKaiBrawler(snapshot, dt);

    // Update sparks & shockwave
    this.updateFX(dt);

    this.renderer.render(this.scene, this.camera);
  }

  private animatePlayerHands(snapshot: CombatSnapshot): void {
    const t = this.clockTime;
    const idleBob = Math.sin(t * 4.2) * 0.014;
    const idleSway = Math.cos(t * 2.1) * 0.01;
    const pulse = 0.5 + 0.5 * Math.sin(t * 5.2);

    const leftExtend =
      snapshot.playerPunchSide === 'LEFT'
        ? Math.sin(snapshot.playerPunchProgress * Math.PI)
        : 0;
    const rightExtend =
      snapshot.playerPunchSide === 'RIGHT'
        ? Math.sin(snapshot.playerPunchProgress * Math.PI)
        : 0;

    const guardTighten = snapshot.playerState === 'HIT_STUN' ? 0.07 : 0;
    const leanShift =
      snapshot.playerLean === 'LEFT'
        ? -0.04
        : snapshot.playerLean === 'RIGHT'
          ? 0.04
          : 0;

    // Left Brawler Hand & Cyber-Forearm (Guard -> Corkscrew Pronated Punch)
    this.playerLeftHand.group.position.set(
      -0.38 + guardTighten + leanShift + idleSway + leftExtend * 0.29,
      -0.31 + guardTighten + idleBob + leftExtend * 0.18,
      -0.66 - leftExtend * 1.18
    );
    this.playerLeftHand.group.rotation.set(
      0.56 - leftExtend * 0.48,
      -0.22 + leftExtend * 0.18,
      1.06 * (1 - leftExtend * 0.92)
    );
    this.playerLeftHand.conduitMat.emissiveIntensity =
      2.3 + pulse * 0.45 + leftExtend * 2.4;
    this.playerLeftHand.knuckleStudMat.emissiveIntensity =
      2.6 + pulse * 0.4 + leftExtend * 2.6;
    this.playerLeftHand.honeycombMat.emissiveIntensity =
      2.4 + pulse * 0.5 + leftExtend * 1.8;

    // Right Brawler Hand & Cyber-Forearm (Guard -> Corkscrew Pronated Punch)
    this.playerRightHand.group.position.set(
      0.38 - guardTighten + leanShift - idleSway - rightExtend * 0.29,
      -0.31 + guardTighten - idleBob + rightExtend * 0.18,
      -0.66 - rightExtend * 1.18
    );
    this.playerRightHand.group.rotation.set(
      0.56 - rightExtend * 0.48,
      0.22 - rightExtend * 0.18,
      -1.06 * (1 - rightExtend * 0.92)
    );
    this.playerRightHand.conduitMat.emissiveIntensity =
      2.3 + pulse * 0.45 + rightExtend * 2.4;
    this.playerRightHand.knuckleStudMat.emissiveIntensity =
      2.6 + pulse * 0.4 + rightExtend * 2.6;
    this.playerRightHand.honeycombMat.emissiveIntensity =
      2.4 + pulse * 0.5 + rightExtend * 1.8;
  }

  private animateKaiBrawler(snapshot: CombatSnapshot, dt: number): void {
    const t = this.clockTime;
    const p = snapshot.bossStateProgress;
    const kai = this.kai;

    // Hit flash decay across armor & bionic plates
    if (this.bossFlashTimer > 0) {
      this.bossFlashTimer = Math.max(0, this.bossFlashTimer - dt);
      for (const mat of kai.flashableMaterials) {
        mat.emissive.setHex(0xffffff);
        mat.emissiveIntensity = this.bossFlashTimer * 3.0;
      }
    } else {
      for (const mat of kai.flashableMaterials) {
        mat.emissiveIntensity = 0;
      }
    }

    // Athletic boxing footwork bounce (keeps boots grounded cleanly)
    const bounce = Math.abs(Math.sin(t * 3.6)) * 0.028;
    kai.root.position.set(0, 0, BOSS_BASE_Z);
    kai.root.rotation.set(0, 0, 0);

    kai.pelvis.position.set(0, 0.945 - bounce, 0);
    kai.pelvis.rotation.set(0, 0.12, 0); // Subtle orthodox brawler angle
    kai.torso.rotation.set(0.05, -0.06, 0);
    kai.head.rotation.set(-0.03, -0.05, 0);

    // Default split-stance boxing legs
    this.setDefaultLegStance(bounce);

    // Default high Muay-Thai / Cyber-Brawler guard for both arms
    this.setGuardArmPose(kai.screenLeftArm, -1, t);
    this.setGuardArmPose(kai.screenRightArm, 1, t);
    (kai.screenLeftArm.telegraphRing.material as THREE.MeshBasicMaterial).opacity = 0;
    (kai.screenRightArm.telegraphRing.material as THREE.MeshBasicMaterial).opacity = 0;

    // Kai's signature fiery cybernetic orange-amber energy palette
    let conduitColor = 0xff5e00;
    let knuckleColor = 0xffa800;
    let conduitIntensity = 2.6 + Math.sin(t * 5.0) * 0.3;

    switch (snapshot.bossState) {
      case 'IDLE': {
        const sway = Math.sin(t * 1.85);
        kai.root.position.x = sway * 0.11;
        kai.torso.rotation.y = -0.06 + sway * 0.08;
        kai.torso.rotation.z = sway * -0.04;
        kai.head.rotation.y = -0.04 - sway * 0.05;
        break;
      }

      case 'BAIT_GUARD': {
        conduitColor = 0xc040ff;
        knuckleColor = 0xe066ff;
        conduitIntensity = 3.5 + Math.sin(t * 24) * 0.8;
        // Tight crossed cyber-brawler counter shell
        kai.pelvis.position.y = 0.92 - bounce * 0.5;
        kai.torso.rotation.set(0.14, 0, 0);
        kai.head.rotation.set(0.08, 0, 0);

        kai.screenLeftArm.shoulder.rotation.set(-0.92, 0.42, 0.18);
        kai.screenLeftArm.elbow.rotation.set(-1.68, 0, 0.46);
        kai.screenLeftArm.wrist.rotation.set(0, 0.4, 0);

        kai.screenRightArm.shoulder.rotation.set(-0.92, -0.42, -0.18);
        kai.screenRightArm.elbow.rotation.set(-1.68, 0, -0.46);
        kai.screenRightArm.wrist.rotation.set(0, -0.4, 0);
        break;
      }

      case 'WINDUP': {
        const pulse = 0.5 + 0.5 * Math.sin(p * Math.PI * 6);
        conduitColor = p > 0.65 ? 0xff1744 : 0xff7b00;
        knuckleColor = p > 0.65 ? 0xff2a4b : 0xffbe0b;
        conduitIntensity = 3.4 + p * 2.2;

        if (snapshot.bossAttackSide === 'LEFT') {
          // Coil Screen-Left cyber-arm wide for heavy hook/cross
          kai.pelvis.rotation.y = -0.22 * p;
          kai.torso.rotation.set(0.06, -0.54 * p, 0.1 * p);
          kai.head.rotation.set(0, 0.42 * p, 0);
          kai.screenLeftArm.shoulder.rotation.set(
            -0.55 - 0.35 * p,
            -0.58 * p,
            -0.78 * p
          );
          kai.screenLeftArm.elbow.rotation.set(-1.15 + 0.25 * p, 0, 0);
          kai.screenLeftArm.wrist.rotation.set(0, 1.15 * p, 0);
          this.updateTelegraphRing(kai.screenLeftArm.telegraphRing, p, pulse);
        } else if (snapshot.bossAttackSide === 'RIGHT') {
          // Coil Screen-Right cyber-arm wide for heavy hook/cross
          kai.pelvis.rotation.y = 0.28 * p;
          kai.torso.rotation.set(0.06, 0.54 * p, -0.1 * p);
          kai.head.rotation.set(0, -0.42 * p, 0);
          kai.screenRightArm.shoulder.rotation.set(
            -0.55 - 0.35 * p,
            0.58 * p,
            0.78 * p
          );
          kai.screenRightArm.elbow.rotation.set(-1.15 + 0.25 * p, 0, 0);
          kai.screenRightArm.wrist.rotation.set(0, -1.15 * p, 0);
          this.updateTelegraphRing(kai.screenRightArm.telegraphRing, p, pulse);
        } else {
          // CENTER power windup: deep crouch & dual cocked cyber-fists
          kai.root.position.z = BOSS_BASE_Z - 0.26 * p;
          kai.pelvis.position.y = 0.93 - 0.08 * p;
          kai.torso.rotation.set(-0.22 * p, 0, 0);
          kai.screenLeftArm.shoulder.rotation.set(-1.25 * p, -0.25, -0.52);
          kai.screenLeftArm.elbow.rotation.set(-1.35, 0, 0);
          kai.screenRightArm.shoulder.rotation.set(-1.25 * p, 0.25, 0.52);
          kai.screenRightArm.elbow.rotation.set(-1.35, 0, 0);
          this.updateTelegraphRing(kai.screenLeftArm.telegraphRing, p, pulse);
          this.updateTelegraphRing(kai.screenRightArm.telegraphRing, p, pulse);
        }
        break;
      }

      case 'STRIKE_ACTIVE': {
        conduitColor = 0xff1e00;
        knuckleColor = 0xffaa00;
        conduitIntensity = 4.8;
        const thrust = Math.sin(Math.min(1, p * 1.35) * Math.PI * 0.5);
        kai.root.position.z = BOSS_BASE_Z + 1.05 * thrust;
        kai.pelvis.position.y = 0.91;
        kai.screenLeftLeg.hip.rotation.x = -0.34 * thrust;
        kai.screenLeftLeg.knee.rotation.x = 0.42 * thrust;
        kai.screenRightLeg.hip.rotation.x = 0.32 * thrust;

        if (snapshot.bossAttackSide === 'LEFT') {
          kai.root.position.x = -0.28 * thrust;
          kai.pelvis.rotation.y = 0.26 * thrust;
          kai.torso.rotation.set(0.14 * thrust, 0.56 * thrust, -0.06 * thrust);
          kai.head.rotation.set(-0.08, -0.45 * thrust, 0);
          kai.screenLeftArm.shoulder.rotation.set(-1.52, 0.22, 0.12);
          kai.screenLeftArm.elbow.rotation.set(-0.08, 0, 0);
          kai.screenLeftArm.wrist.rotation.set(0, 1.45, 0);
        } else if (snapshot.bossAttackSide === 'RIGHT') {
          kai.root.position.x = 0.28 * thrust;
          kai.pelvis.rotation.y = -0.26 * thrust;
          kai.torso.rotation.set(0.14 * thrust, -0.56 * thrust, 0.06 * thrust);
          kai.head.rotation.set(-0.08, 0.45 * thrust, 0);
          kai.screenRightArm.shoulder.rotation.set(-1.52, -0.22, -0.12);
          kai.screenRightArm.elbow.rotation.set(-0.08, 0, 0);
          kai.screenRightArm.wrist.rotation.set(0, -1.45, 0);
        } else {
          // Center dual straight power slam down the middle
          kai.torso.rotation.set(0.24 * thrust, 0, 0);
          kai.head.rotation.set(-0.14 * thrust, 0, 0);
          kai.screenLeftArm.shoulder.rotation.set(-1.52, 0.16, 0.08);
          kai.screenLeftArm.elbow.rotation.set(-0.06, 0, 0);
          kai.screenLeftArm.wrist.rotation.set(0, 1.45, 0);
          kai.screenRightArm.shoulder.rotation.set(-1.52, -0.16, -0.08);
          kai.screenRightArm.elbow.rotation.set(-0.06, 0, 0);
          kai.screenRightArm.wrist.rotation.set(0, -1.45, 0);
        }
        break;
      }

      case 'RECOVERY': {
        // Overextended & vulnerable: dropped guard + emerald-cyan overload cue
        conduitColor = 0x39ff9f;
        knuckleColor = 0x39ff9f;
        conduitIntensity = 3.8 + Math.sin(t * 20) * 1.1;
        const recoverEase = 1 - p * 0.45;
        kai.root.position.z = BOSS_BASE_Z + 0.36 * recoverEase;
        kai.pelvis.position.y = 0.89;
        kai.torso.rotation.set(0.28 * recoverEase, 0, 0);
        kai.head.rotation.set(0.24 * recoverEase, 0, 0);

        // Arms hang low & wide leaving jaw and torso wide open for counters
        kai.screenLeftArm.shoulder.rotation.set(-0.18, -0.15, -0.36);
        kai.screenLeftArm.elbow.rotation.set(-0.62, 0, 0);
        kai.screenLeftArm.wrist.rotation.set(0, 0.2, 0);

        kai.screenRightArm.shoulder.rotation.set(-0.18, 0.15, 0.36);
        kai.screenRightArm.elbow.rotation.set(-0.62, 0, 0);
        kai.screenRightArm.wrist.rotation.set(0, -0.2, 0);
        break;
      }

      case 'DODGING': {
        const evadeArc = Math.sin(p * Math.PI);
        const dir = snapshot.bossDodgeSide === 'LEFT' ? -1 : 1;
        kai.root.position.x = dir * 0.86 * evadeArc;
        kai.root.position.z = BOSS_BASE_Z - 0.2 * evadeArc;
        kai.pelvis.position.y = 0.88;
        kai.torso.rotation.z = dir * -0.24 * evadeArc;
        kai.torso.rotation.x = 0.16 * evadeArc;
        kai.torso.rotation.y = dir * 0.22 * evadeArc;
        break;
      }

      case 'HIT_REACT': {
        conduitColor = 0xffbe0b;
        knuckleColor = 0xffffff;
        conduitIntensity = 4.2;
        const recoil = Math.sin((1 - p) * Math.PI * 0.5);
        const hitDir = snapshot.bossHitSide === 'LEFT' ? 1 : -1;
        kai.root.position.z = BOSS_BASE_Z - 0.24 * recoil;
        kai.torso.rotation.x = -0.28 * recoil;
        kai.torso.rotation.y = hitDir * 0.34 * recoil;
        kai.head.rotation.x = -0.36 * recoil;
        kai.head.rotation.y = hitDir * 0.42 * recoil;
        break;
      }

      case 'KO': {
        conduitColor = 0x4a2511;
        knuckleColor = 0x3b2314;
        conduitIntensity = 0.25;
        const fall = Math.min(1, p * 1.4);
        // Drop heavily to one knee on the canvas
        kai.root.position.z = BOSS_BASE_Z - fall * 0.35;
        kai.pelvis.position.y = 0.94 - fall * 0.42;
        kai.screenLeftLeg.hip.rotation.set(-1.05 * fall, 0, 0);
        kai.screenLeftLeg.knee.rotation.set(1.65 * fall, 0, 0);
        kai.screenRightLeg.hip.rotation.set(0.18 * fall, 0, 0);
        kai.screenRightLeg.knee.rotation.set(1.42 * fall, 0, 0);

        kai.torso.rotation.set(0.58 * fall, 0, 0.08 * fall);
        kai.head.rotation.set(0.52 * fall, 0, 0);
        kai.screenLeftArm.shoulder.rotation.set(-0.25, 0, -0.35);
        kai.screenLeftArm.elbow.rotation.set(-0.4, 0, 0);
        kai.screenRightArm.shoulder.rotation.set(-0.25, 0, 0.35);
        kai.screenRightArm.elbow.rotation.set(-0.4, 0, 0);
        break;
      }

      case 'VICTORY_POSE': {
        conduitColor = 0xff5500;
        knuckleColor = 0xffbe0b;
        conduitIntensity = 4.2;
        kai.pelvis.position.y = 0.96;
        kai.torso.rotation.set(-0.1, 0, 0);
        kai.head.rotation.set(-0.08, 0, 0);
        // Triumphant double-bicep / raised brawler fists
        kai.screenLeftArm.shoulder.rotation.set(-2.25, 0.2, -0.48);
        kai.screenLeftArm.elbow.rotation.set(-1.05, 0, 0);
        kai.screenRightArm.shoulder.rotation.set(-2.25, -0.2, 0.48);
        kai.screenRightArm.elbow.rotation.set(-1.05, 0, 0);
        break;
      }
    }

    kai.cyberConduitMat.color.setHex(conduitColor);
    kai.cyberConduitMat.emissive.setHex(conduitColor);
    kai.cyberConduitMat.emissiveIntensity = conduitIntensity;

    kai.knuckleStudMat.color.setHex(knuckleColor);
    kai.knuckleStudMat.emissive.setHex(knuckleColor);
    kai.knuckleStudMat.emissiveIntensity = conduitIntensity * 1.05;

    kai.honeycombMat.emissive.setHex(conduitColor);
    kai.honeycombMat.emissiveIntensity = conduitIntensity * 0.92;

    kai.faceImplantMat.emissive.setHex(conduitColor);
    kai.faceImplantMat.emissiveIntensity = Math.max(0.4, conduitIntensity * 0.85);

    kai.cyberGlowLight.color.setHex(conduitColor);
    kai.cyberGlowLight.intensity = conduitIntensity * 0.9;
  }

  private setDefaultLegStance(bounce: number): void {
    const kneeFlex = 0.22 + bounce * 1.4;
    // Screen-Left leg (Kai's right) slightly forward; Screen-Right leg slightly back
    this.kai.screenLeftLeg.hip.rotation.set(-0.14 - bounce * 0.7, 0.06, -0.05);
    this.kai.screenLeftLeg.knee.rotation.set(kneeFlex, 0, 0);
    this.kai.screenLeftLeg.ankle.rotation.set(-kneeFlex + 0.14, 0, 0.05);

    this.kai.screenRightLeg.hip.rotation.set(0.1 - bounce * 0.7, -0.1, 0.06);
    this.kai.screenRightLeg.knee.rotation.set(kneeFlex + 0.04, 0, 0);
    this.kai.screenRightLeg.ankle.rotation.set(-kneeFlex - 0.12, 0, -0.06);
  }

  private setGuardArmPose(arm: KaiArmRig, sideSign: -1 | 1, t: number): void {
    const weave = Math.sin(t * 3.8 + sideSign) * 0.055;
    // Tucked elbows, wrapped cyber-fists protecting jawline & cheekbones
    arm.shoulder.rotation.set(
      -0.46 + weave,
      sideSign * -0.15,
      sideSign * 0.18
    );
    arm.elbow.rotation.set(-1.98 - weave * 0.45, 0, -sideSign * 0.34);
    arm.wrist.rotation.set(0, -sideSign * 0.38, 0);
  }

  private updateTelegraphRing(
    ring: THREE.Mesh,
    progress: number,
    pulse: number
  ): void {
    const mat = ring.material as THREE.MeshBasicMaterial;
    mat.opacity = 0.48 + pulse * 0.45;
    mat.color.setHex(progress > 0.65 ? 0xff1744 : 0xff9f0a);
    const scale = 1.65 - progress * 0.72;
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
