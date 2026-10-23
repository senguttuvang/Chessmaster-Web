/** Presentation adapter for original CMSETS meshes; no chess/engine decisions. */
import * as T from "three";
import { Reflector } from "three/addons/objects/Reflector.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

export type DisplayPiece = { square: string; type: string; color: string };
export type CapturedPiece = { type: string; color: string };
async function complete(tasks: Promise<void>[]): Promise<void> {
  const results = await Promise.allSettled(tasks);
  const failure = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failure) throw failure.reason;
}
const asset = "/assets/recovered/";
export class OriginalBoard {
  private renderer: T.WebGLRenderer;
  private scene = new T.Scene();
  private camera = new T.PerspectiveCamera(32, 1, 0.1, 100);
  private pieces = new T.Group();
  private labels = new T.Group();
  private models = new Map<string, T.Object3D>();
  private materials = new Map<string, T.MeshPhongMaterial>();
  private textures = new Map<string, T.Texture>();
  private boardMaterial = new T.MeshPhongMaterial({
    shininess: 45,
    specular: 0x595346,
  });
  private observer: ResizeObserver;
  private flipped = false;
  private disposed = false;
  private active = true;
  private captured: CapturedPiece[] = [];
  private capturedRenderer: T.WebGLRenderer;
  private capturedScene = new T.Scene();
  private capturedCamera = new T.PerspectiveCamera(30, 1, 0.1, 100);
  private capturedGroup = new T.Group();
  private capturedObserver: ResizeObserver;

  private constructor(
    private host: HTMLElement,
    private targets: HTMLElement,
    private capturedHost: HTMLElement,
    onFailure: (error: string) => void,
  ) {
    this.renderer = new T.WebGLRenderer({ alpha: true, antialias: true });
    try {
      this.capturedRenderer = new T.WebGLRenderer({
        alpha: true,
        antialias: true,
      });
    } catch (error) {
      this.renderer.dispose();
      throw error;
    }
    this.renderer.domElement.style.removeProperty("display");
    this.capturedRenderer.domElement.style.removeProperty("display");
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.capturedRenderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0, 0);
    this.capturedRenderer.setClearColor(0, 0);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.renderer.outputColorSpace = this.capturedRenderer.outputColorSpace =
      T.SRGBColorSpace;
    this.renderer.domElement.setAttribute("aria-hidden", "true");
    this.capturedRenderer.domElement.setAttribute("aria-hidden", "true");
    this.renderer.domElement.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      onFailure(
        "3D graphics context lost. Select 2D view to continue, or reload to retry 3D.",
      );
    });
    host.prepend(this.renderer.domElement);
    capturedHost.append(this.capturedRenderer.domElement);
    this.camera.position.set(0, 10.8, 12.8);
    this.camera.lookAt(0, 0.2, 0);
    this.capturedCamera.position.set(0, 7, 11);
    this.capturedCamera.lookAt(0, 0.4, 0);
    this.scene.add(this.pieces);
    this.capturedScene.add(this.capturedGroup);
    for (const scene of [this.scene, this.capturedScene]) {
      scene.add(new T.AmbientLight(0xfff0d4, 1.3));
      const key = new T.DirectionalLight(0xfff4d8, 2.6);
      key.position.set(-6, 9, 6);
      key.castShadow = scene === this.scene;
      key.shadow.mapSize.set(2048, 2048);
      key.shadow.camera.left = key.shadow.camera.bottom = -6;
      key.shadow.camera.right = key.shadow.camera.top = 6;
      key.shadow.bias = -0.001;
      scene.add(key);
      const fill = new T.DirectionalLight(0xbac9ed, 0.8);
      fill.position.set(5, 5, -6);
      scene.add(fill);
    }
    this.observer = new ResizeObserver(() => this.draw());
    this.observer.observe(host);
    this.capturedObserver = new ResizeObserver(() => this.drawCaptured());
    this.capturedObserver.observe(capturedHost);
  }

  static async create(
    host: HTMLElement,
    targets: HTMLElement,
    capturedHost: HTMLElement,
    onFailure: (error: string) => void,
  ): Promise<OriginalBoard> {
    let view: OriginalBoard | undefined;
    try {
      view = new OriginalBoard(host, targets, capturedHost, onFailure);
      await view.load();
      return view;
    } catch (error) {
      view?.dispose();
      throw error;
    }
  }

  private async load(): Promise<void> {
    const loader = new GLTFLoader();
    const textures = new T.TextureLoader();
    await complete(
      [
        "StauntonWood01W",
        "StauntonWood01B",
        "BoardWoodDark512",
        "BoardWoodBurl512",
        "BoardWoodMahogany512",
      ].map(async (name) => {
        const texture = await textures.loadAsync(`${asset}${name}.png`);
        texture.colorSpace = T.SRGBColorSpace;
        texture.flipY = false;
        texture.wrapS = texture.wrapT = T.RepeatWrapping;
        texture.anisotropy = Math.min(
          8,
          this.renderer.capabilities.getMaxAnisotropy(),
        );
        this.textures.set(name, texture);
      }),
    );
    for (const color of ["w", "b"])
      this.materials.set(
        color,
        new T.MeshPhongMaterial({
          map: this.textures.get(
            color === "w" ? "StauntonWood01W" : "StauntonWood01B",
          ),
          shininess: 80,
          specular: color === "w" ? 0xaaa290 : 0x6b5146,
        }),
      );
    this.boardMaterial.map = this.textures.get("BoardWoodDark512")!;
    await complete(
      ["K", "Q", "B", "N", "R", "P", "surface", "frame"].map(async (key) => {
        const name = key.length === 1 ? `Staunton_${key}` : `planar_${key}`;
        const model = (await loader.loadAsync(`${asset}${name}.gltf`)).scene;
        // Assimp converts DirectX left-handed coordinates; converted geometry is Z-up.
        model.rotation.x = -Math.PI / 2;
        model.traverse((node) => {
          if (node instanceof T.Mesh) {
            const original = node.material;
            if (Array.isArray(original)) original.forEach((m) => m.dispose());
            else original.dispose();
            node.material = this.boardMaterial;
            node.castShadow = key.length === 1;
            node.receiveShadow = true;
          }
        });
        if (key.length === 1) this.models.set(key.toLowerCase(), model);
        else this.scene.add(model);
      }),
    );
    const reflection = new Reflector(new T.PlaneGeometry(8.98, 8.98), {
      textureWidth: 1024,
      textureHeight: 1024,
      color: 0x777777,
    });
    reflection.rotation.x = -Math.PI / 2;
    reflection.position.y = 0.002;
    const reflectionMaterial = reflection.material as T.ShaderMaterial;
    reflectionMaterial.transparent = true;
    reflectionMaterial.depthWrite = false;
    reflectionMaterial.fragmentShader =
      reflectionMaterial.fragmentShader.replace(
        "gl_FragColor = vec4( blendOverlay( base.rgb, color ), 1.0 );",
        "gl_FragColor = vec4( blendOverlay( base.rgb, color ), 0.20 );",
      );
    this.scene.add(reflection);
    const labels = this.labels;
    await complete(
      Array.from({ length: 8 }, async (_, i) => {
        for (const [text, x, z] of [
          ["abcdefgh"[i], i - 3.5, 4.24],
          [String(8 - i), -4.24, i - 3.5],
        ] as const) {
          const texture = await textures.loadAsync(`${asset}decal-${text}.png`);
          texture.colorSpace = T.SRGBColorSpace;
          this.textures.set(`decal-${text}`, texture);
          const label = new T.Mesh(
            new T.PlaneGeometry(0.33, 0.33),
            new T.MeshBasicMaterial({
              map: texture,
              transparent: true,
              depthWrite: false,
            }),
          );
          label.rotation.x = -Math.PI / 2;
          label.position.set(x, 0.015, z);
          label.userData = { index: i, file: text.charCodeAt(0) > 96 };
          labels.add(label);
        }
      }),
    );
    this.scene.add(labels);
  }

  update(
    pieces: DisplayPiece[],
    flipped: boolean,
    captured: CapturedPiece[],
  ): void {
    this.flipped = flipped;
    this.labels.traverse((node) => {
      if (node instanceof T.Mesh) {
        const { index, file } = node.userData;
        const text = file
          ? (flipped ? "hgfedcba" : "abcdefgh")[index]
          : String(flipped ? index + 1 : 8 - index);
        (node.material as T.MeshBasicMaterial).map = this.textures.get(
          `decal-${text}`,
        )!;
      }
    });
    this.pieces.clear();
    for (const piece of pieces) {
      const model = this.models.get(piece.type)!.clone(true);
      model.traverse((node) => {
        if (node instanceof T.Mesh)
          node.material = this.materials.get(piece.color)!;
      });
      const file = piece.square.charCodeAt(0) - 97,
        rank = Number(piece.square[1]);
      model.position.set(
        (flipped ? 7 - file : file) - 3.5,
        0.006,
        (flipped ? rank - 1 : 8 - rank) - 3.5,
      );
      // Rotate only around the board's vertical axis; retain the imported Z-up transform.
      if (piece.color === "b") model.rotateZ(Math.PI);
      this.pieces.add(model);
    }
    this.captured = captured;
    this.draw();
    this.updateCaptured();
  }

  setMaterial(name: string): void {
    const texture = this.textures.get(name);
    if (!texture) throw new Error(`Unknown board texture: ${name}`);
    this.boardMaterial.map = texture;
    this.boardMaterial.needsUpdate = true;
    this.draw();
  }

  setActive(active: boolean): void {
    this.active = active;
    if (active) this.draw();
  }

  private draw(): void {
    if (this.disposed || !this.active) return;
    const { width, height } = this.host.getBoundingClientRect();
    if (!width || !height) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.position.set(
      0,
      width / height < 1.1 ? 13.2 : 11.5,
      width / height < 1.1 ? 15.8 : 11.8,
    );
    this.camera.lookAt(0, 0.2, 0);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    // The visible HTML buttons follow each rendered square, preserving keyboard/AT input.
    for (const button of this.targets.querySelectorAll<HTMLButtonElement>(
      "[data-square]",
    )) {
      const square = button.dataset.square!;
      const f = square.charCodeAt(0) - 97,
        r = Number(square[1]);
      const x = (this.flipped ? 7 - f : f) - 4,
        z = (this.flipped ? r - 1 : 8 - r) - 4;
      const points = [
        [x, z],
        [x + 1, z],
        [x + 1, z + 1],
        [x, z + 1],
      ].map(([px, pz]) => {
        const v = new T.Vector3(px, 0.02, pz).project(this.camera);
        return [((v.x + 1) * width) / 2, ((1 - v.y) * height) / 2];
      });
      const minX = Math.min(...points.map((p) => p[0])),
        minY = Math.min(...points.map((p) => p[1]));
      const w = Math.max(...points.map((p) => p[0])) - minX,
        h = Math.max(...points.map((p) => p[1])) - minY;
      Object.assign(button.style, {
        left: `${minX}px`,
        top: `${minY}px`,
        width: `${w}px`,
        height: `${h}px`,
        clipPath: `polygon(${points.map((p) => `${((p[0] - minX) / w) * 100}% ${((p[1] - minY) / h) * 100}%`).join(",")})`,
      });
    }
    this.renderer.render(this.scene, this.camera);
  }

  private updateCaptured(): void {
    this.capturedGroup.clear();
    for (const color of ["w", "b"]) {
      const row = this.captured.filter((p) => p.color === color);
      row.forEach((piece, i) => {
        const model = this.models.get(piece.type)!.clone(true);
        model.traverse((node) => {
          if (node instanceof T.Mesh)
            node.material = this.materials.get(color)!;
        });
        const scale = row.length > 8 ? 0.6 : 0.85;
        model.scale.setScalar(scale);
        model.position.set(
          (i - (row.length - 1) / 2) * Math.min(1, 7 / Math.max(row.length, 1)),
          0,
          color === "w" ? -1.1 : 1.1,
        );
        this.capturedGroup.add(model);
      });
    }
    this.drawCaptured();
  }

  private drawCaptured(): void {
    if (this.disposed) return;
    const { width, height } = this.capturedHost.getBoundingClientRect();
    if (!width || !height) return;
    this.capturedRenderer.setSize(width, height, false);
    this.capturedCamera.aspect = width / height;
    this.capturedCamera.updateProjectionMatrix();
    this.capturedRenderer.render(this.capturedScene, this.capturedCamera);
  }

  dispose(): void {
    this.disposed = true;
    this.observer.disconnect();
    this.capturedObserver.disconnect();
    const geometries = new Set<T.BufferGeometry>();
    const materials = new Set<T.Material>();
    for (const root of [
      this.scene,
      this.capturedScene,
      ...this.models.values(),
    ])
      root.traverse((node) => {
        if (node instanceof T.Mesh) {
          geometries.add(node.geometry);
          for (const m of Array.isArray(node.material)
            ? node.material
            : [node.material])
            materials.add(m);
        }
      });
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    this.boardMaterial.dispose();
    this.materials.forEach((m) => m.dispose());
    this.textures.forEach((t) => t.dispose());
    this.scene.traverse((node) => {
      if (node instanceof Reflector) node.dispose();
    });
    this.renderer.dispose();
    this.capturedRenderer.dispose();
    this.renderer.domElement.remove();
    this.capturedRenderer.domElement.remove();
  }
}
