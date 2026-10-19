import * as THREE from 'three';
import { fbm } from './verdant/math.js';
import { createDarkRockMaterial } from './rock-material.js';
import { createHeroDecorations } from './hero-decorations.js';

export async function loadStone(manager) {
  const loader = new THREE.TextureLoader(manager), base = '/assets/dark-rock/';
  const [map, normalMap, roughnessMap, heightMap] = await Promise.all([
    loader.loadAsync(base + 'dark_rock_diff_2k.jpg'), loader.loadAsync(base + 'dark_rock_nor_gl_2k.jpg'),
    loader.loadAsync(base + 'dark_rock_rough_1k.jpg'), loader.loadAsync(base + 'dark_rock_disp_2k.jpg'),
  ]);
  map.colorSpace = THREE.SRGBColorSpace;
  for (const texture of [map, normalMap, roughnessMap, heightMap]) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1.6, 1.6); texture.anisotropy = 8;
  }
  const material = new THREE.MeshStandardMaterial({map, normalMap, roughnessMap,
    normalScale: new THREE.Vector2(.8, .8), roughness: .98});
  material.color.setRGB(1.55, 1.60, 1.58);
  material.userData.heightMap = heightMap;
  return material;
}

function rockGeometry(seed) {
  const geometry = new THREE.SphereGeometry(1, 48, 32), p = geometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x=p.getX(i),y=p.getY(i),z=p.getZ(i);
    const radius=.78+fbm(x*2.3+z*.7+seed,y*2.2-z*.6)*.5;
    p.setXYZ(i,x*radius*1.4+y*.15,y*radius,z*radius);
  }
  geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  return geometry;
}

export function createFloatingRocks(stoneMaterial, _uniforms, assets = null) {
  const group = new THREE.Group(); group.name = 'Floating dark stone, solar energy and ferns';
  const material = createDarkRockMaterial(stoneMaterial), main = new THREE.Group();
  const rock = new THREE.Mesh(assets?.mainGeometry ?? rockGeometry(3), material);
  rock.name = 'Central bare Dark Rock'; rock.castShadow = rock.receiveShadow = true;
  main.add(rock); main.scale.setScalar(2.05); main.position.set(.5,.25,0); group.add(main);
  const placements = [
    [-5.5,3.8,-2.8,.58,.8,-.4], [6.2,4.35,-3.3,.55,1.8,.6],
    [-2.0,-2.8,.7,.46,.3,.5], [6.8,.6,1.0,.85,2.4,-.5],
    [-.4,5.4,-4.2,.48,1.0,-.4], [6.7,4.2,-.2,.33,2.2,.6],
    [-5.7,.1,-4.7,.38,.7,.5], [-6.6,-2.6,-2.4,.75,1.4,-.3],
    [-.9,-5.3,-2.6,.48,2.9,.2], [6.5,-5.2,-3.0,.56,.2,.6],
    [7.7,1.5,-4.2,.32,2.1,.2], [-.9,.6,-5.3,.26,1.1,-.8],
    [-5.7,-2.7,3.4,1.45,1.1,-.18], [6.6,-3.5,4.2,1.45,2.4,.20],
    [6.8,4.5,2.7,1.18,1.9,-.25],
    [4.65,2.45,-1.6,1.06,.7,-.2],
  ];
  const shapes = assets?.satelliteGeometries ?? [rockGeometry(16),rockGeometry(17),rockGeometry(18)];
  const satellites = placements.map(([x,y,z,scale,yaw,roll], i) => {
    const mesh = new THREE.Mesh(shapes[i % shapes.length],material);
    mesh.name = `Bare floating stone ${i+1}`;
    mesh.position.set(x,y,z); mesh.scale.setScalar(scale); mesh.rotation.set(.2+i*.11,yaw,roll);
    mesh.castShadow = mesh.receiveShadow = true; group.add(mesh);
    const foreground=z>2;
    mesh.userData.foreground=foreground;
    if(foreground)mesh.name=`Foreground boulder ${i-11}`;
    return {mesh,settings:{position:[x,y,z],rotation:[mesh.rotation.x,yaw,roll],foreground,
      depthResponse:THREE.MathUtils.clamp((z+6)/10,.10,1.15)}};
  });
  const foreground=satellites.filter(item=>item.settings.foreground);
  main.rotation.set(-.10,-.28,-.085);
  group.updateMatrixWorld(true);
  const decorations = createHeroDecorations(rock,satellites,assets?.fernTemplates);
  return {group,main,satellites,foreground,decorations,update(time,progress,reducedMotion,interaction){
    const strength=reducedMotion?0:(interaction?.presence??0)*(interaction?.strength??1);
    const px=(interaction?.pointer.x??0)*strength,py=(interaction?.pointer.y??0)*strength;
    main.position.x=.5-px*.14;
    main.position.y=.25+(reducedMotion?0:Math.sin(time*.23)*.045)-py*.10;
    main.rotation.set(-.10+progress*.25+py*.22,-.28+progress*1.05+px*.28,-.085-px*.08+py*.04);
    satellites.forEach(({mesh,settings},i)=>{
      const [x,y,z]=settings.position,phase=time*.11+i*1.7;
      const response=settings.depthResponse;
      mesh.position.set(x+(reducedMotion?0:Math.sin(phase)*.11)-px*response*.48,
        y+(reducedMotion?0:Math.cos(phase*.8)*.12)-py*response*.30,
        z+(reducedMotion?0:Math.sin(phase*.6)*.16));
      mesh.rotation.x=settings.rotation[0]+py*response*.035;
      mesh.rotation.y=settings.rotation[1]+(reducedMotion?0:Math.sin(time*.055+i)*.08)+px*response*.055;
      mesh.rotation.z=settings.rotation[2]-px*response*.012;
    });
    decorations.update(time,reducedMotion);
  }};
}

