import { Matrix3, Vector3 } from 'three';
import { smoothstep } from './verdant/math.js';

// Panel-local X is its long side, Z its short side, and +Y the glass face.
const anchors = [
  { id: 'power', point: [.53, .065, -.40], delay: 0, offset: -20 },
  { id: 'efficiency', point: [.02, .065, .40], delay: .045, offset: 20 },
  { id: 'yield', point: [-.55, .065, -.38], delay: .09, offset: -20 },
];

/** Glass cards follow the actual editable module, including all parent poses. */
export function createSolarSpecs(element, panel, camera) {
  const cards = anchors.map(anchor => ({ ...anchor,
    element: element.querySelector(`[data-panel-anchor="${anchor.id}"]`),
    point: new Vector3(...anchor.point), projected: new Vector3(),
  }));
  const normalMatrix = new Matrix3(), normal = new Vector3(), eye = new Vector3();
  function update(progress, width, height, show = true, cameraFinish = 0) {
    // Both transforms settle before any card can appear. This interval is
    // driven only by further scrolling, including reverse scrolling.
    const revealStart = Math.max(panel.parent.userData.descentRange[1], cameraFinish) + .04;
    panel.updateWorldMatrix(true, false);
    normal.set(0, 1, 0).applyMatrix3(normalMatrix.getNormalMatrix(panel.matrixWorld)).normalize();
    let visible = false;
    for (const card of cards) {
      const projected = card.projected.copy(card.point).applyMatrix4(panel.matrixWorld);
      const frontFacing = normal.dot(eye.subVectors(camera.position, projected)) > 0;
      projected.project(camera);
      const finite = projected.toArray().every(Number.isFinite);
      const inView = finite && frontFacing && projected.z > -1 && projected.z < 1 && Math.abs(projected.x) < 1.1 && Math.abs(projected.y) < 1.1;
      const reveal = show && panel.parent.visible && inView
        ? smoothstep(revealStart + card.delay, revealStart + card.delay + .12, progress) : 0;
      if (finite) {
        const compact=width<=900;
        const landscape=compact && width>height && height<=540;
        const halfWidth=compact?(landscape?132:Math.min(180,Math.max(132,width*.37)))/2:0;
        const x=(projected.x+1)*width/2+(landscape?card.offset*2.8:compact?card.offset*.35:card.offset);
        card.element.style.left = `${(compact?Math.max(halfWidth+14,Math.min(width-halfWidth-14,x)):x).toFixed(1)}px`;
        card.element.style.top = `${((1 - projected.y) * height / 2).toFixed(1)}px`;
      }
      card.element.style.setProperty('--card-reveal', reveal.toFixed(3));
      card.element.inert = reveal < .08;
      visible ||= reveal >= .08;
    }
    element.inert = !visible;
    element.style.opacity = visible ? '1' : '0';
    return { visible, revealStart };
  }
  return { update };
}
