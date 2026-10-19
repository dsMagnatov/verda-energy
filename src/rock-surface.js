import * as THREE from 'three';

// Work against an identity proxy: a rock's animated parents must never affect
// coordinates used to build something that will be parented to that rock.
function surfaceQuery(rockMesh) {
  const geometry = rockMesh?.geometry;
  if (!geometry?.attributes?.position) return null;
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  if (!bounds || bounds.isEmpty()) return null;
  const size = bounds.getSize(new THREE.Vector3());
  const reach = Math.max(size.length(), 1) * 2;
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const proxy = new THREE.Mesh(geometry, material);
  proxy.matrixAutoUpdate = false;
  proxy.matrixWorld.identity();
  const raycaster = new THREE.Raycaster();
  raycaster.far = reach * 3;
  return {
    geometry, bounds, reach,
    cast(point, normal = new THREE.Vector3(0, 1, 0)) {
      const origin = point.clone().addScaledVector(normal, reach);
      raycaster.set(origin, normal.clone().negate());
      const hit = raycaster.intersectObject(proxy, false)[0];
      if (!hit?.face) return null;
      const hitNormal = hit.face.normal.clone().normalize();
      if (hitNormal.y < 0) hitNormal.negate();
      return { point: hit.point.clone(), normal: hitNormal, faceIndex: hit.faceIndex };
    },
    dispose() { material.dispose(); },
  };
}

/** The upper triangle surface at rock-local X/Z, independent of mesh transforms. */
export function sampleRockSurface(rockMesh, x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  const query = surfaceQuery(rockMesh);
  if (!query) return null;
  try {
    return query.cast(new THREE.Vector3(x, query.bounds.max.y, z));
  } finally {
    query.dispose();
  }
}

// Least squares y = ax + bz + c, centered on the sample centroid to avoid
// conditioning problems when a requested patch is away from the rock origin.
function fittedPlane(samples) {
  const center = samples.reduce((sum, hit) => sum.add(hit.point), new THREE.Vector3())
    .multiplyScalar(1 / samples.length);
  let xx = 0, xz = 0, zz = 0, xy = 0, zy = 0;
  for (const { point } of samples) {
    const x = point.x - center.x, z = point.z - center.z, y = point.y - center.y;
    xx += x * x; xz += x * z; zz += z * z;
    xy += x * y; zy += z * y;
  }
  const determinant = xx * zz - xz * xz;
  let normal;
  if (determinant > 1e-12) {
    const slopeX = (xy * zz - zy * xz) / determinant;
    const slopeZ = (zy * xx - xy * xz) / determinant;
    normal = new THREE.Vector3(-slopeX, 1, -slopeZ).normalize();
  } else {
    normal = samples.reduce((sum, hit) => sum.add(hit.normal), new THREE.Vector3()).normalize();
    if (normal.lengthSq() === 0) normal.set(0, 1, 0);
    if (normal.y < 0) normal.negate();
  }
  return { center, normal };
}

function clipPolygon(points, axis, limit, sign) {
  if (!points.length) return points;
  const clipped = [];
  let previous = points[points.length - 1];
  let previousDistance = limit - previous[axis] * sign;
  for (const current of points) {
    const currentDistance = limit - current[axis] * sign;
    if ((currentDistance >= 0) !== (previousDistance >= 0)) {
      const t = previousDistance / (previousDistance - currentDistance);
      clipped.push(previous.clone().lerp(current, t));
    }
    if (currentDistance >= 0) clipped.push(current);
    previous = current; previousDistance = currentDistance;
  }
  return clipped;
}

// Clip every triangle to the panel footprint. A grid alone could miss a sharp
// mesh peak between samples; this exact envelope keeps the rigid underside out
// of every intersecting triangle, including triangles spanning the rectangle.
function upperEnvelope(geometry, center, xAxis, normal, zAxis, width, depth) {
  const positions = geometry.attributes.position, index = geometry.index;
  const count = index ? index.count : positions.count;
  const project = (i) => {
    const point = new THREE.Vector3().fromBufferAttribute(positions, index ? index.getX(i) : i).sub(center);
    return new THREE.Vector3(point.dot(xAxis), point.dot(normal), point.dot(zAxis));
  };
  let highest = -Infinity;
  for (let i = 0; i + 2 < count; i += 3) {
    let polygon = [project(i), project(i + 1), project(i + 2)];
    if (polygon.every(p => p.x < -width / 2) || polygon.every(p => p.x > width / 2)
      || polygon.every(p => p.z < -depth / 2) || polygon.every(p => p.z > depth / 2)) continue;
    polygon = clipPolygon(polygon, 'x', width / 2, 1);
    polygon = clipPolygon(polygon, 'x', width / 2, -1);
    polygon = clipPolygon(polygon, 'z', depth / 2, 1);
    polygon = clipPolygon(polygon, 'z', depth / 2, -1);
    for (const point of polygon) highest = Math.max(highest, point.y);
  }
  return highest;
}

/**
 * Fits a rigid rectangular panel onto the actual rock scan. Coordinates in the
 * result are all rock-local. position is the UNDERSIDE origin; quaternion maps
 * panel +Y to normal, X to width and Z to depth. Build thickness above Y=0.
 * contacts[].mount is a point on that underside, contacts[].surface is its
 * attachment on the real rock. No arbitrary tilt or parent transform is used.
 */
export function fitRockPanel(rockMesh, {
  centerX = 0, centerZ = .35, width = 1.65, depth = 1.05, clearance = .018,
} = {}) {
  if (![centerX, centerZ, width, depth, clearance].every(Number.isFinite) || width <= 0 || depth <= 0) return null;
  const query = surfaceQuery(rockMesh);
  if (!query) return null;
  const requestedWidth = width, requestedDepth = depth;
  clearance = Math.max(clearance, 0);
  try {
    const centerHit = query.cast(new THREE.Vector3(centerX, query.bounds.max.y, centerZ));
    if (!centerHit) return null;
    for (let attempt = 0; attempt < 9; attempt++) {
      const samples = [];
      for (let iz = 0; iz < 5; iz++) for (let ix = 0; ix < 5; ix++) {
        const hit = query.cast(new THREE.Vector3(
          centerX + (ix / 4 - .5) * width,
          query.bounds.max.y,
          centerZ + (iz / 4 - .5) * depth,
        ));
        if (hit) samples.push(hit);
      }
      if (samples.length !== 25) { width *= .86; depth *= .86; continue; }
      const { center, normal } = fittedPlane(samples);
      // Use the requested center even when the sampled fit has slight numerical
      // asymmetry. Project its original surface point onto the fitted plane.
      const planeCenter = centerHit.point.clone().addScaledVector(normal,
        center.clone().sub(centerHit.point).dot(normal));
      const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
      const xAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion);
      const zAxis = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion);
      const hits = [];
      let supported = true;
      for (let iz = 0; iz < 5; iz++) for (let ix = 0; ix < 5; ix++) {
        const x = (ix / 4 - .5) * width, z = (iz / 4 - .5) * depth;
        const point = planeCenter.clone().addScaledVector(xAxis, x).addScaledVector(zAxis, z);
        const hit = query.cast(point, normal);
        if (!hit || hit.normal.dot(normal) < .12) { supported = false; break; }
        hits.push({ ...hit, x, z });
      }
      if (!supported || hits.length !== 25) { width *= .86; depth *= .86; continue; }
      const elevation = upperEnvelope(query.geometry, planeCenter, xAxis, normal, zAxis, width, depth);
      if (!Number.isFinite(elevation)) return null;
      const position = planeCenter.clone().addScaledVector(normal, elevation + clearance + 1e-5);
      const contacts = hits.filter(hit => Math.abs(hit.x) > width * .49 && Math.abs(hit.z) > depth * .49)
        .map(hit => {
          const mount = position.clone().addScaledVector(xAxis, hit.x).addScaledVector(zAxis, hit.z);
          return { mount, surface: hit.point.clone(), normal: hit.normal.clone(), faceIndex: hit.faceIndex,
            gap: mount.clone().sub(hit.point).dot(normal) };
        });
      const maxGap = Math.max(...contacts.map(contact => contact.gap));
      // The module may reduce the footprint on a curved summit instead of
      // returning a broad panel with visibly tall, unsupported corner legs.
      if (maxGap > Math.max(.11, Math.min(width, depth) * .42) && attempt < 8) {
        width *= .86; depth *= .86; continue;
      }
      return { position, quaternion, normal, contacts, width, depth, clearance,
        requestedWidth, requestedDepth, centerX, centerZ,
        scale: width / requestedWidth, maxGap, samples: hits.length,
        centerSurface: centerHit.point.clone(), supported: true };
    }
    return null;
  } finally {
    query.dispose();
  }
}
