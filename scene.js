/* ============================================================
   scene.js — cinematic procedural Earth + satellite (three.js r128)
   Exposes window.Scene: { ready, setElevation(deg), setCombo(on) }
   Everything is generated in-shader — no external image assets.
   ============================================================ */
(function () {
  "use strict";

  const Scene = {
    ready: false,
    setElevation: function () {},
    setCombo: function () {}
  };
  window.Scene = Scene;

  const canvas = document.getElementById('scene');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (!window.THREE) { showFallback(); return; }

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, alpha: true, powerPreference: 'high-performance'
    });
  } catch (e) { showFallback(); return; }

  function showFallback() {
    const f = document.getElementById('webglFallback');
    if (f) f.hidden = false;
  }

  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(DPR);
  renderer.setSize(window.innerWidth, window.innerHeight);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 0.35, 6.2);

  // ---- lighting: a low warm key (sun) + faint fill ----
  const sunDir = new THREE.Vector3(-0.55, 0.32, 0.78).normalize();

  /* -----------------------------------------------------------
     Shared GLSL noise (simplex 3D) used by earth + clouds
     ----------------------------------------------------------- */
  const NOISE_GLSL = `
    vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
    vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
    vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
    vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
    float snoise(vec3 v){
      const vec2 C=vec2(1.0/6.0,1.0/3.0);const vec4 D=vec4(0.0,0.5,1.0,2.0);
      vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);
      vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.0-g;vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);
      vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;
      i=mod289(i);
      vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
      float n_=0.142857142857;vec3 ns=n_*D.wyz-D.xzx;
      vec4 j=p-49.0*floor(p*ns.z*ns.z);
      vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.0*x_);
      vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.0-abs(x)-abs(y);
      vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);
      vec4 s0=floor(b0)*2.0+1.0;vec4 s1=floor(b1)*2.0+1.0;vec4 sh=-step(h,vec4(0.0));
      vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
      vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
      vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
      p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
      vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);m=m*m;
      return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
    }
    float fbm(vec3 p){
      float f=0.0, a=0.5;
      for(int i=0;i<6;i++){ f+=a*snoise(p); p*=2.02; a*=0.5; }
      return f;
    }
  `;

  /* -----------------------------------------------------------
     EARTH surface shader — continents, oceans, ice, city lights
     ----------------------------------------------------------- */
  const earthUniforms = {
    uSun:  { value: sunDir.clone() },
    uTime: { value: 0 }
  };
  const earthMat = new THREE.ShaderMaterial({
    uniforms: earthUniforms,
    vertexShader: `
      varying vec3 vNormal; varying vec3 vPos; varying vec3 vWorld;
      void main(){
        vNormal = normalize(normalMatrix * normal);
        vPos = position;
        vWorld = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
      }`,
    fragmentShader: NOISE_GLSL + `
      uniform vec3 uSun; uniform float uTime;
      varying vec3 vNormal; varying vec3 vPos; varying vec3 vWorld;

      void main(){
        vec3 p = normalize(vPos);

        // continents: ridged fbm, thresholded into land masses
        float base = fbm(p*1.7);
        float detail = fbm(p*4.3)*0.35;
        float h = base + detail;
        float land = smoothstep(0.02, 0.14, h);

        // latitude for ice caps
        float lat = abs(p.y);
        float ice = smoothstep(0.82, 0.93, lat + fbm(p*3.0)*0.05);

        // ocean vs land colours (deep teal -> shallow -> land greens/browns)
        vec3 deep    = vec3(0.015,0.055,0.11);
        vec3 shallow = vec3(0.03,0.13,0.20);
        vec3 ocean   = mix(deep, shallow, smoothstep(-0.15,0.02,h));

        vec3 lowland = vec3(0.10,0.16,0.07);
        vec3 forest  = vec3(0.06,0.12,0.05);
        vec3 arid    = vec3(0.22,0.17,0.10);
        float dryness = smoothstep(0.15,0.45, fbm(p*2.6+3.1));
        vec3 landcol = mix(forest, lowland, 0.5);
        landcol = mix(landcol, arid, dryness*0.7);

        vec3 albedo = mix(ocean, landcol, land);
        albedo = mix(albedo, vec3(0.86,0.90,0.94), ice);           // ice caps

        // day / night terminator
        float ndl = dot(normalize(vNormal), uSun);
        float day = smoothstep(-0.18, 0.22, ndl);

        // diffuse day side
        vec3 lit = albedo * (0.15 + 0.95*max(ndl,0.0));

        // specular ocean glint
        float oceanMask = 1.0 - land;
        vec3 viewDir = normalize(-vPos);
        vec3 hvec = normalize(uSun + viewDir);
        float spec = pow(max(dot(normalize(vNormal), hvec),0.0), 40.0) * oceanMask * day;
        lit += vec3(0.35,0.42,0.5)*spec;

        // NIGHT side: city lights clustered on land, away from sun
        float nightMask = smoothstep(0.15, -0.25, ndl);
        float cityField = fbm(p*10.0);
        float cities = smoothstep(0.58, 0.72, cityField) * land * (1.0-ice);
        // twinkle
        cities *= 0.7 + 0.3*sin(uTime*2.0 + cityField*40.0);
        vec3 cityGlow = vec3(1.0,0.72,0.36) * cities * nightMask * 1.7;

        vec3 col = lit + cityGlow;
        // subtle night ambient so dark side isn't pure black
        col += albedo*0.02*nightMask;

        gl_FragColor = vec4(col,1.0);
      }`
  });

  const earth = new THREE.Mesh(new THREE.SphereGeometry(2.0, 96, 96), earthMat);
  earth.rotation.z = 0.32; // slight axial tilt
  scene.add(earth);

  /* -----------------------------------------------------------
     CLOUD shell — drifting fbm, additive white
     ----------------------------------------------------------- */
  const cloudUniforms = {
    uSun:  { value: sunDir.clone() },
    uTime: { value: 0 }
  };
  const cloudMat = new THREE.ShaderMaterial({
    uniforms: cloudUniforms,
    transparent: true, depthWrite: false,
    vertexShader: `
      varying vec3 vNormal; varying vec3 vPos;
      void main(){
        vNormal=normalize(normalMatrix*normal); vPos=position;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
      }`,
    fragmentShader: NOISE_GLSL + `
      uniform vec3 uSun; uniform float uTime;
      varying vec3 vNormal; varying vec3 vPos;
      void main(){
        vec3 p=normalize(vPos);
        vec3 q=p; q.x += uTime*0.012;                 // slow drift
        float c=fbm(q*2.4)*0.6 + fbm(q*5.0)*0.4;
        float clouds=smoothstep(0.18,0.55,c);
        float ndl=dot(normalize(vNormal),uSun);
        float day=smoothstep(-0.2,0.3,ndl);
        float a=clouds*(0.16+0.72*day);
        gl_FragColor=vec4(vec3(1.0)*(0.4+0.6*day), a);
      }`
  });
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(2.03, 80, 80), cloudMat);
  clouds.rotation.z = 0.32;
  scene.add(clouds);

  /* -----------------------------------------------------------
     ATMOSPHERE — fresnel rim, rendered on a back-face sphere
     ----------------------------------------------------------- */
  const atmoUniforms = { uSun: { value: sunDir.clone() } };
  const atmoMat = new THREE.ShaderMaterial({
    uniforms: atmoUniforms,
    transparent: true, side: THREE.BackSide, depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      varying vec3 vNormal; varying vec3 vPos;
      void main(){
        vNormal=normalize(normalMatrix*normal); vPos=position;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
      }`,
    fragmentShader: `
      uniform vec3 uSun; varying vec3 vNormal; varying vec3 vPos;
      void main(){
        vec3 viewDir=normalize(-vPos);
        float rim=pow(1.0 - max(dot(normalize(vNormal), viewDir),0.0), 3.0);
        float ndl=dot(normalize(vNormal),uSun);
        float day=smoothstep(-0.4,0.5,ndl);
        vec3 glow=mix(vec3(0.10,0.22,0.45), vec3(0.35,0.55,0.95), day);
        gl_FragColor=vec4(glow, rim*(0.35+0.65*day));
      }`
  });
  const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(2.16, 64, 64), atmoMat);
  scene.add(atmosphere);

  /* -----------------------------------------------------------
     STARFIELD — points with slight size variance
     ----------------------------------------------------------- */
  (function stars(){
    const N=1400, pos=new Float32Array(N*3), siz=new Float32Array(N);
    for(let i=0;i<N;i++){
      // distribute on a large sphere behind the scene
      const u=Math.random()*2-1, t=Math.random()*Math.PI*2, r=Math.sqrt(1-u*u);
      const R=40+Math.random()*20;
      pos[i*3]=Math.cos(t)*r*R; pos[i*3+1]=u*R; pos[i*3+2]=Math.sin(t)*r*R;
      siz[i]=Math.random()<0.08 ? 2.4 : (0.5+Math.random()*1.1);
    }
    const g=new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos,3));
    g.setAttribute('aSize', new THREE.BufferAttribute(siz,1));
    const m=new THREE.ShaderMaterial({
      transparent:true, depthWrite:false, blending:THREE.AdditiveBlending,
      uniforms:{ uTime:{value:0} },
      vertexShader:`
        attribute float aSize; varying float vT; uniform float uTime;
        void main(){
          vT = aSize;
          vec4 mv=modelViewMatrix*vec4(position,1.0);
          gl_PointSize=aSize*(300.0/-mv.z);
          gl_Position=projectionMatrix*mv;
        }`,
      fragmentShader:`
        varying float vT;
        void main(){
          vec2 c=gl_PointCoord-0.5; float d=length(c);
          float a=smoothstep(0.5,0.0,d);
          vec3 col=mix(vec3(0.7,0.8,1.0), vec3(1.0,0.95,0.85), step(2.0,vT));
          gl_FragColor=vec4(col, a*0.9);
        }`
    });
    scene.add(new THREE.Points(g,m));
  })();

  /* -----------------------------------------------------------
     SATELLITE — small emissive body + panels + halo sprite
     rides an orbit ring; elevation drives its angle
     ----------------------------------------------------------- */
  const sat = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.16, 0.22),
    new THREE.MeshStandardMaterial({ color:0x2a2f38, metalness:0.7, roughness:0.35,
      emissive:0xf4a72a, emissiveIntensity:0.18 })
  );
  sat.add(body);

  const panelMat = new THREE.MeshStandardMaterial({
    color:0x1b3a5a, metalness:0.4, roughness:0.5, emissive:0x1b4b7a, emissiveIntensity:0.25 });
  const pL = new THREE.Mesh(new THREE.BoxGeometry(0.30,0.005,0.14), panelMat);
  pL.position.x = -0.26; sat.add(pL);
  const pR = pL.clone(); pR.position.x = 0.26; sat.add(pR);

  // amber beacon
  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.035, 12, 12),
    new THREE.MeshBasicMaterial({ color:0xf4a72a })
  );
  beacon.position.z = 0.13; sat.add(beacon);

  // point light travelling with sat (small, warm)
  const satLight = new THREE.PointLight(0xf4a72a, 0.6, 4);
  sat.add(satLight);

  // soft halo sprite
  const halo = makeHalo(0xf4a72a, 0.55);
  sat.add(halo);

  scene.add(sat);

  // beam cone from sat toward earth (thin, additive)
  const beam = new THREE.Mesh(
    new THREE.ConeGeometry(0.34, 1.0, 24, 1, true),
    new THREE.ShaderMaterial({
      transparent:true, depthWrite:false, side:THREE.DoubleSide, blending:THREE.AdditiveBlending,
      uniforms:{ uCol:{value:new THREE.Color(0xf4a72a)} },
      vertexShader:`varying float vY; void main(){ vY=uv.y;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader:`uniform vec3 uCol; varying float vY;
        void main(){ float a=smoothstep(0.0,1.0,vY)*0.28; gl_FragColor=vec4(uCol,a);}`
    })
  );
  scene.add(beam);

  // faint orbit ring
  const orbitRing = new THREE.Mesh(
    new THREE.RingGeometry(3.28, 3.30, 128),
    new THREE.MeshBasicMaterial({ color:0x3a5f80, transparent:true, opacity:0.28, side:THREE.DoubleSide })
  );
  scene.add(orbitRing);

  function makeHalo(hex, size){
    const c=document.createElement('canvas'); c.width=c.height=128;
    const g=c.getContext('2d');
    const grd=g.createRadialGradient(64,64,0,64,64,64);
    const col=new THREE.Color(hex);
    grd.addColorStop(0,`rgba(${col.r*255|0},${col.g*255|0},${col.b*255|0},0.9)`);
    grd.addColorStop(0.4,`rgba(${col.r*255|0},${col.g*255|0},${col.b*255|0},0.25)`);
    grd.addColorStop(1,'rgba(0,0,0,0)');
    g.fillStyle=grd; g.fillRect(0,0,128,128);
    const tex=new THREE.CanvasTexture(c);
    const spr=new THREE.Sprite(new THREE.SpriteMaterial({ map:tex, blending:THREE.AdditiveBlending,
      transparent:true, depthWrite:false }));
    spr.scale.set(size,size,1);
    return spr;
  }

  // lights for the standard-material satellite
  const key = new THREE.DirectionalLight(0xfff0d8, 1.4); key.position.copy(sunDir); scene.add(key);
  scene.add(new THREE.AmbientLight(0x24313f, 0.9));

  /* -----------------------------------------------------------
     ORBIT MAPPING
     The base station sits on Earth's front-right limb facing camera.
     Elevation 90° => satellite directly above BS (nearest camera).
     Elevation 30° => satellite low on the horizon (swept around limb).
     ----------------------------------------------------------- */
  const ORBIT_R = 3.3;
  // anchor point on the globe representing the terrestrial BS
  const bsDir = new THREE.Vector3(0.35, 0.28, 0.9).normalize();
  const bsPoint = bsDir.clone().multiplyScalar(2.0);

  // build an orbital basis: 'up' = bsDir (zenith), 'tangent' = sweep direction
  const worldUp = new THREE.Vector3(0,1,0);
  const tangent = new THREE.Vector3().crossVectors(bsDir, worldUp).normalize();

  let targetElev = 90, curElev = 90, combo = false;

  function satPosForElev(elevDeg){
    // angular offset from zenith along the orbit: 90° -> 0 rad, 30° -> larger arc
    const off = (90 - elevDeg) * Math.PI/180;      // radians of arc from zenith
    const dir = bsDir.clone().multiplyScalar(Math.cos(off))
                 .add(tangent.clone().multiplyScalar(Math.sin(off)))
                 .normalize();
    return dir.multiplyScalar(ORBIT_R);
  }

  Scene.setElevation = function(deg){ targetElev = deg; combo=false; };
  Scene.setCombo = function(on){
    combo = on;
    if(on) targetElev = 90;   // park at zenith for the aggregate view
  };

  // orient orbit ring to the orbital plane (normal = tangent x bsDir)
  (function orientRing(){
    const n = new THREE.Vector3().crossVectors(tangent, bsDir).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1), n);
    orbitRing.quaternion.copy(q);
  })();

  /* -----------------------------------------------------------
     RESIZE + RENDER LOOP
     ----------------------------------------------------------- */
  function resize(){
    const w=window.innerWidth, h=window.innerHeight;
    renderer.setSize(w,h); camera.aspect=w/h; camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);

  const clock = new THREE.Clock();
  let comboPhase = 0;

  function tick(){
    const dt = clock.getDelta();
    const t = clock.getElapsedTime();

    // slow globe spin
    earth.rotation.y += dt * 0.035;
    clouds.rotation.y += dt * 0.045;

    // combo mode: sweep the satellite through the arc for drama
    if(combo){
      comboPhase += dt*0.5;
      curElev = 60 + Math.sin(comboPhase)*30;   // oscillate 30–90
    }else{
      curElev += (targetElev - curElev) * Math.min(1, dt*4.5);
    }

    const sp = satPosForElev(curElev);
    sat.position.copy(sp);
    sat.lookAt(bsPoint);
    halo.position.set(0,0,0);

    // beam: from satellite to BS point
    const mid = sp.clone().add(bsPoint).multiplyScalar(0.5);
    const len = sp.distanceTo(bsPoint);
    beam.position.copy(mid);
    beam.scale.set(1, len, 1);
    const dir = bsPoint.clone().sub(sp).normalize();
    beam.quaternion.setFromUnitVectors(new THREE.Vector3(0,-1,0), dir);

    // beacon pulse
    beacon.material.color.setScalar(1);
    const pulse = 0.5 + 0.5*Math.sin(t*4.0);
    satLight.intensity = 0.35 + pulse*0.5;
    halo.material.opacity = 0.5 + pulse*0.35;

    // uniforms
    earthUniforms.uTime.value = t;
    cloudUniforms.uTime.value = t;

    // gentle camera parallax
    camera.position.x = Math.sin(t*0.08)*0.25;
    camera.lookAt(0.15, 0.05, 0);

    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }

  // signal readiness, start
  Scene.ready = true;
  requestAnimationFrame(tick);
})();
